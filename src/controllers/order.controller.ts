import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';
import { PricingEngine } from '../services/pricing.service.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TW-${dateStr}-${rand}`;
}

export const createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, addressId, address, paymentMethod, couponCode, shippingMethod } = req.body;
    let userId = (req as any).user?.userId || (req as any).user?.id;
    
    // Ensure a valid User record exists
    if (!userId) {
      const defaultUser = await prisma.user.findFirst();
      if (defaultUser) {
        userId = defaultUser.id;
      } else {
        res.status(401).json({ success: false, message: 'Valid authentication required to checkout' });
        return;
      }
    } else {
      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        const defaultUser = await prisma.user.findFirst();
        if (defaultUser) userId = defaultUser.id;
      }
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Items are required' });
      return;
    }

    const orderEmail = (req.body.email || req.body.customerEmail || address?.email || (req as any).user?.email || '').trim();
    if (!orderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orderEmail)) {
      res.status(400).json({ success: false, message: 'Valid Customer Email ID is mandatory to place an order' });
      return;
    }

    const isSelfPickup = shippingMethod === 'SELF_PICKUP';
    const isCOD = (String(paymentMethod || '').trim().toUpperCase() === 'COD' || String(paymentMethod || '').toLowerCase().includes('cash on delivery'));

    if (isSelfPickup && isCOD) {
      res.status(400).json({ success: false, message: 'Store Self-Pickup orders must be paid online. Cash on Delivery (COD) is not available for store takeaway.' });
      return;
    }

    let pickupName: string | null = null;
    let pickupPhone: string | null = null;
    let pickupEmail: string | null = null;

    if (isSelfPickup) {
      pickupName = (req.body.pickupName || req.body.name || address?.fullName || (req as any).user?.name || '').trim();
      if (!pickupName) {
        res.status(400).json({ success: false, message: "Collector's full name is required for Store Pickup." });
        return;
      }
      pickupPhone = (req.body.pickupPhone || req.body.phone || address?.phone || (req as any).user?.phone || '').trim();
      if (!pickupPhone || pickupPhone.replace(/\D/g, '').length < 10) {
        res.status(400).json({ success: false, message: "Valid 10-digit mobile phone number is required for store pickup alerts." });
        return;
      }
      pickupEmail = (req.body.pickupEmail || orderEmail).trim();
    }

    // 1. Validate via Pricing Engine with full address details for Same-Batch Free Delivery calculation
    const pricingResult = await PricingEngine.calculate({
      items,
      promotionCode: couponCode,
      userId,
      pincode: isSelfPickup ? undefined : address?.pincode,
      addressId,
      shippingMethod: shippingMethod || 'NORMAL_POST',
      paymentMethod: paymentMethod || 'COD',
      address: {
        fullName: address?.fullName || address?.name,
        phone: address?.phone,
        email: orderEmail,
        addressLine1: address?.addressLine1 || address?.line1,
        line1: address?.line1,
        pincode: address?.pincode,
        city: address?.city,
        state: address?.state,
      }
    });

    if (!pricingResult.isValid) {
      res.status(400).json({ success: false, message: pricingResult.errors[0] || 'Pricing validation failed' });
      return;
    }
    
    if (pricingResult.promotionError) {
      res.status(400).json({ success: false, message: pricingResult.promotionError });
      return;
    }

    // Atomic Transaction: Stock decrement + Order Creation + Address Deduplication + Loyalty Points Increment
    const order = await prisma.$transaction(async (tx) => {
      const orderItems: any[] = [];
      
      for (const item of pricingResult.items) {
        orderItems.push({ bookId: item.bookId, quantity: item.quantity, priceAtPurchase: item.unitPrice });
        
        // Controlled Overselling Check: allow up to 5 items of backorder buffer
        const ALLOWED_NEGATIVE_STOCK_BUFFER = -5;
        const minStockAllowed = item.quantity + ALLOWED_NEGATIVE_STOCK_BUFFER;

        // Atomically verify and decrement stock
        const stockUpdate = await tx.book.updateMany({
          where: { 
            id: item.bookId,
            stock: { gte: minStockAllowed }
          },
          data: {
            stock: { decrement: item.quantity }
          }
        });

        if (stockUpdate.count === 0) {
          throw new Error(`Maximum backorder limit reached for book ID: ${item.bookId}. Cannot fulfill at this moment.`);
        }
      }

      // Address Deduplication: Search for identical address before creating
      let finalAddressId: string | null = null;
      if (addressId) {
        const existingAddr = await tx.address.findFirst({ where: { id: addressId, userId } });
        if (existingAddr) {
          finalAddressId = existingAddr.id;
        }
      }

      if (!finalAddressId && address) {
        const line1 = (address.addressLine1 || address.line1 || '').trim();
        const pin = (address.pincode || '').trim();

        // Check if an identical address already exists for this user
        const dedupeAddr = await tx.address.findFirst({
          where: {
            userId,
            addressLine1: line1,
            pincode: pin,
          },
        });

        if (dedupeAddr) {
          finalAddressId = dedupeAddr.id;
          await tx.address.update({
            where: { id: dedupeAddr.id },
            data: {
              fullName: address.fullName || address.name || dedupeAddr.fullName,
              phone: address.phone || dedupeAddr.phone,
              email: orderEmail,
              postOffice: (address.postOffice || address.localPostOffice || dedupeAddr.postOffice || '').trim(),
              landmark: (address.landmark || dedupeAddr.landmark || null)?.trim(),
            },
          });
        } else {
          const createdAddr = await tx.address.create({
            data: {
              userId,
              fullName: address.fullName || address.name || 'Valued Customer',
              phone: address.phone || '9876543210',
              email: orderEmail,
              addressLine1: line1 || 'Delivery Address',
              addressLine2: (address.addressLine2 || address.line2 || null)?.trim(),
              postOffice: (address.postOffice || address.localPostOffice || '').trim(),
              landmark: (address.landmark || null)?.trim(),
              city: (address.city || 'Kolkata').trim(),
              state: (address.state || 'West Bengal').trim(),
              pincode: pin || '700001',
              type: address.type || 'HOME',
              country: 'India',
              isDefault: true,
            },
          });
          finalAddressId = createdAddr.id;
        }
      }

      const created = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: userId,
          customerEmail: orderEmail,
          addressId: finalAddressId,
          status: 'PENDING',
          paymentStatus: (String(paymentMethod || '').trim().toUpperCase() === 'COD' || String(paymentMethod || '').toLowerCase().includes('cash on delivery')) ? 'PENDING' : 'PAID',
          paymentMethod: (String(paymentMethod || '').trim().toUpperCase() === 'COD' || String(paymentMethod || '').toLowerCase().includes('cash on delivery')) ? 'COD' : (paymentMethod || 'COD'),
          subtotal: pricingResult.subtotal,
          discountAmount: pricingResult.promotionDiscount,
          shippingCharge: pricingResult.shippingCharge,
          shippingMethod: pricingResult.selectedShippingMethod || shippingMethod || 'NORMAL_POST',
          shippingCarrier: isSelfPickup ? 'STORE_TAKEAWAY' : null,
          pickupName: isSelfPickup ? pickupName : null,
          pickupPhone: isSelfPickup ? pickupPhone : null,
          pickupEmail: isSelfPickup ? pickupEmail : null,
          pickupStatus: isSelfPickup ? 'PENDING_SLOTS' : 'NONE',
          taxAmount: pricingResult.taxAmount,
          totalAmount: pricingResult.totalAmount,
          promotionId: pricingResult.promotionId,
          items: { create: orderItems },
        },
        include: { items: { include: { book: true } }, address: true, user: true },
      });

      if (pricingResult.promotionId && userId) {
        await tx.promotion.update({
          where: { id: pricingResult.promotionId },
          data: { usedCount: { increment: 1 } }
        });
        
        await tx.promotionUsage.create({
          data: {
            promotionId: pricingResult.promotionId,
            userId: userId,
            orderId: created.id
          }
        });
      }

      // Add-on Bundle Synchronizer: If customer upgraded delivery service, elevate parent order to match
      if (pricingResult.isAddonBundle && pricingResult.bundledWithOrderNumber) {
        const getTier = (m: string) => (m === 'EXPRESS_LOCAL' ? 3 : m === 'SPEED_POST' ? 2 : 1);
        const finalMethod = pricingResult.selectedShippingMethod || 'NORMAL_POST';
        const parentMethod = pricingResult.parentShippingMethod || 'NORMAL_POST';
        if (getTier(finalMethod) > getTier(parentMethod)) {
          await tx.order.updateMany({
            where: { orderNumber: pricingResult.bundledWithOrderNumber },
            data: { shippingMethod: finalMethod }
          });
        }
      }

      // Techno Points Loyalty Engine: 1 point/coin for every ₹100 spent
      const pointsEarned = Math.floor(pricingResult.totalAmount / 100);
      if (pointsEarned > 0 && userId) {
        await tx.user.update({
          where: { id: userId },
          data: { technoPoints: { increment: pointsEarned } },
        });

        const oneYearExpiry = new Date();
        oneYearExpiry.setFullYear(oneYearExpiry.getFullYear() + 1);

        await tx.pointTransaction.create({
          data: {
            userId,
            orderId: created.id,
            points: pointsEarned,
            type: 'EARNED',
            status: 'CREDITED',
            description: `Earned ${pointsEarned} Techno Points on Order #${created.orderNumber} (1 Year Validity)`,
            expiresAt: oneYearExpiry,
          },
        });
      }

      return created;
    });

    let razorpayOrder = null;
    const isOrderCOD = String(paymentMethod || '').trim().toUpperCase() === 'COD' || String(paymentMethod || '').toLowerCase().includes('cash on delivery');
    if (!isOrderCOD && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
      const razorpay = new Razorpay({
        key_id: env.RAZORPAY_KEY_ID,
        key_secret: env.RAZORPAY_KEY_SECRET
      });

      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(order.totalAmount * 100),
        currency: 'INR',
        receipt: order.id
      });
      
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentId: razorpayOrder.id }
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Order placed successfully', 
      data: {
        ...order,
        razorpayOrderId: razorpayOrder?.id
      }
    });
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('Insufficient') || error.message?.includes('backorder')) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    logger.error('Order creation error:', error);
    next(error);
  }
};

export const getMyOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        items: { include: { book: { select: { id: true, title: true, slug: true, coverUrl: true, authors: { select: { name: true } } } } } },
        address: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[GET_MY_ORDERS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
  }
};

export const getAllOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, page = '1', limit = '50' } = req.query;
    
    const queryStatus = typeof status === 'string' ? status : undefined;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where = queryStatus ? { status: queryStatus as any } : {};

    const [orders, total, pendingCount] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { book: { select: { id: true, title: true, coverUrl: true, stock: true } } } },
          user: { select: { id: true, name: true, email: true } },
          address: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.order.count({ where }),
      prisma.order.count({ where: { status: 'PENDING' } })
    ]);

    res.status(200).json({
      success: true,
      data: orders,
      pendingCount,
      meta: {
        total,
        page: Number(page),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('[GET_ALL_ORDERS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
  }
};

export const getOrderNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [pendingCount, pendingOrders] = await Promise.all([
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.findMany({
        where: { status: 'PENDING' },
        include: {
          items: { include: { book: { select: { id: true, title: true } } } },
          user: { select: { id: true, name: true, email: true } },
          address: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    res.status(200).json({
      success: true,
      pendingCount,
      pendingOrders,
    });
  } catch (error) {
    console.error('[GET_ORDER_NOTIFICATIONS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to retrieve order notifications' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes, reason } = req.body;

    const existing = await prisma.order.findUnique({
      where: { id },
      include: { user: true, address: true, items: { include: { book: true } } }
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const noteEntry = reason
      ? `[${new Date().toISOString()}] Status changed to ${status}: ${reason}`
      : notes
      ? `[${new Date().toISOString()}] Status changed to ${status}: ${notes}`
      : `[${new Date().toISOString()}] Status changed to ${status}`;

    const updatedNotes = existing.notes ? `${existing.notes}\n${noteEntry}` : noteEntry;

    const order = await prisma.order.update({
      where: { id },
      data: {
        status,
        notes: updatedNotes
      },
      include: { items: { include: { book: true } }, user: true, address: true },
    });

    // Create in-app Customer Notification for status update
    try {
      if (order.userId) {
        let notifTitle = `Order #${order.orderNumber} Update`;
        let notifMsg = `Your order #${order.orderNumber} status is now: ${status}.`;
        let notifType = 'order_status';

        if (status === 'CONFIRMED') {
          notifTitle = `✅ Order Confirmed: #${order.orderNumber}`;
          notifMsg = `Your order #${order.orderNumber} (₹${order.totalAmount}) has been approved by the bookstore and is confirmed!`;
          notifType = 'order_confirmed';
        } else if (status === 'PROCESSING') {
          notifTitle = `📦 Packing Order: #${order.orderNumber}`;
          notifMsg = `Order #${order.orderNumber} is being carefully packed and prepared for India Post dispatch.`;
          notifType = 'order_processing';
        } else if (status === 'SHIPPED') {
          notifTitle = `🚚 Dispatched: #${order.orderNumber}`;
          notifMsg = `Order #${order.orderNumber} has been dispatched via India Post Speed Post. Tracking: ${order.trackingNumber || 'Active'}`;
          notifType = 'order_shipped';
        } else if (status === 'DELIVERED') {
          notifTitle = `🎉 Order Delivered: #${order.orderNumber}`;
          notifMsg = `Your package for order #${order.orderNumber} has been successfully delivered. Enjoy your reading!`;
          notifType = 'order_delivered';
        } else if (status === 'CANCELLED') {
          notifTitle = `❌ Order Cancelled: #${order.orderNumber}`;
          notifMsg = `Order #${order.orderNumber} was cancelled. Reason: ${reason || 'Fulfillment unavailable'}. Any deducted payment will be refunded.`;
          notifType = 'order_cancelled';
        }

        await prisma.notification.create({
          data: {
            userId: order.userId,
            title: notifTitle,
            message: notifMsg,
            type: notifType,
            link: '/profile?tab=orders',
          }
        });
      }
    } catch (notifErr) {
      console.error('[IN_APP_NOTIF_ERROR]', notifErr);
    }

    // If order was cancelled / rejected, revoke points if previously credited
    if (status === 'CANCELLED') {
      const recipientEmail = (order as any).customerEmail || order.address?.email || order.user?.email || 'customer@example.com';
      const recipientName = order.address?.fullName || order.user?.name || 'Valued Customer';
      
      const pointsToRevoke = Math.floor(order.totalAmount / 100);
      if (pointsToRevoke > 0 && order.userId) {
        await prisma.user.update({
          where: { id: order.userId },
          data: { technoPoints: { decrement: Math.min(pointsToRevoke, order.user?.technoPoints || 0) } }
        });
      }

      await emailService.sendOrderEmail({
        orderId: order.id,
        orderNumber: order.orderNumber,
        recipientEmail,
        recipientName,
        subject: `Order #${order.orderNumber} Status Update - Cancelled`,
        message: `Dear ${recipientName},\n\nYour order #${order.orderNumber} has been cancelled.\nReason: ${reason || 'Fulfillment unavailable'}\n\nIf payment was deducted, a full refund will be processed to your original payment source within 3–5 business days.\n\nSincerely,\nTechno World Books`,
        templateType: 'REJECT_NOTICE'
      });
    }

    res.status(200).json({ success: true, message: `Order status updated to ${status}`, data: order });
  } catch (error) {
    console.error('[UPDATE_ORDER_STATUS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};

export const sendOrderCustomEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { subject, message, templateType, recipientEmail, recipientName } = req.body;

    if (!subject || !message) {
      res.status(400).json({ success: false, message: 'Subject and message are required' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true, address: true, items: { include: { book: true } } }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const emailTo = recipientEmail || (order as any).customerEmail || order.address?.email || order.user?.email || 'customer@example.com';
    const nameTo = recipientName || order.address?.fullName || order.user?.name || 'Customer';

    const dispatchResult = await emailService.sendOrderEmail({
      orderId: order.id,
      orderNumber: order.orderNumber,
      recipientEmail: emailTo,
      recipientName: nameTo,
      subject,
      message,
      templateType: templateType || 'CUSTOM',
      adminSender: 'admin@technoworld.com'
    });

    // Create in-app Customer Notification for Admin Delay Notice or Custom message
    try {
      if (order.userId) {
        await prisma.notification.create({
          data: {
            userId: order.userId,
            title: subject,
            message: message,
            type: templateType === 'DELAY_NOTICE' ? 'order_delay' : 'admin_message',
            link: '/profile?tab=orders',
          }
        });
      }
    } catch (notifErr) {
      console.error('[IN_APP_DELAY_NOTIF_ERROR]', notifErr);
    }

    // Append email record into order notes
    const emailLogEntry = `[${new Date().toISOString()}] Admin Email Sent (${templateType || 'CUSTOM'}): "${subject}" -> ${emailTo}`;
    const updatedNotes = order.notes ? `${order.notes}\n${emailLogEntry}` : emailLogEntry;

    await prisma.order.update({
      where: { id },
      data: { notes: updatedNotes }
    });

    res.status(200).json({
      success: true,
      message: `Email dispatched successfully to ${emailTo}`,
      data: dispatchResult
    });
  } catch (error) {
    console.error('[SEND_ORDER_EMAIL_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to send customer email' });
  }
};

export const batchUpdateOrderStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderIds, status, notes, reason } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, message: 'orderIds must be a non-empty array' });
      return;
    }

    if (!status) {
      res.status(400).json({ success: false, message: 'status is required' });
      return;
    }

    const updatedOrders: any[] = [];

    for (const id of orderIds) {
      const existing = await prisma.order.findUnique({
        where: { id },
        include: { user: true, address: true, items: { include: { book: true } } }
      });

      if (!existing) continue;

      const noteEntry = reason
        ? `[${new Date().toISOString()}] Status batch-changed to ${status}: ${reason}`
        : notes
        ? `[${new Date().toISOString()}] Status batch-changed to ${status}: ${notes}`
        : `[${new Date().toISOString()}] Status batch-changed to ${status}`;

      const updatedNotes = existing.notes ? `${existing.notes}\n${noteEntry}` : noteEntry;

      const order = await prisma.order.update({
        where: { id },
        data: {
          status,
          notes: updatedNotes,
        },
        include: { items: { include: { book: true } }, user: true, address: true },
      });

      // Dispatch in-app customer notification
      try {
        if (order.userId) {
          let notifTitle = `Order #${order.orderNumber} Update`;
          let notifMsg = `Your order #${order.orderNumber} status is now: ${status}.`;
          let notifType = 'order_status';

          if (status === 'CONFIRMED') {
            notifTitle = `✅ Order Confirmed: #${order.orderNumber}`;
            notifMsg = `Your order #${order.orderNumber} (₹${order.totalAmount}) has been approved by the bookstore and is confirmed!`;
            notifType = 'order_confirmed';
          } else if (status === 'PROCESSING') {
            notifTitle = `📦 Packing Order: #${order.orderNumber}`;
            notifMsg = `Order #${order.orderNumber} is being packed and prepared for dispatch.`;
            notifType = 'order_processing';
          } else if (status === 'SHIPPED') {
            notifTitle = `🚚 Dispatched: #${order.orderNumber}`;
            notifMsg = `Order #${order.orderNumber} has been dispatched via India Post Speed Post. Tracking: ${order.trackingNumber || 'Active'}`;
            notifType = 'order_shipped';
          } else if (status === 'DELIVERED') {
            notifTitle = `🎉 Order Delivered: #${order.orderNumber}`;
            notifMsg = `Your package for order #${order.orderNumber} has been delivered.`;
            notifType = 'order_delivered';
          } else if (status === 'CANCELLED') {
            notifTitle = `❌ Order Cancelled: #${order.orderNumber}`;
            notifMsg = `Order #${order.orderNumber} was cancelled. Reason: ${reason || 'Fulfillment unavailable'}.`;
            notifType = 'order_cancelled';
          }

          await prisma.notification.create({
            data: {
              userId: order.userId,
              title: notifTitle,
              message: notifMsg,
              type: notifType,
              link: '/profile?tab=orders',
            }
          });
        }
      } catch (err) {
        console.error('[BATCH_NOTIF_ERR]', err);
      }

      // Revoke points if cancelled
      if (status === 'CANCELLED') {
        const pointsToRevoke = Math.floor(order.totalAmount / 100);
        if (pointsToRevoke > 0 && order.userId) {
          await prisma.user.update({
            where: { id: order.userId },
            data: { technoPoints: { decrement: Math.min(pointsToRevoke, order.user?.technoPoints || 0) } }
          });
        }
      }

      updatedOrders.push(order);
    }

    res.status(200).json({
      success: true,
      message: `Batch status updated to ${status} for ${updatedOrders.length} order(s)`,
      count: updatedOrders.length,
      data: updatedOrders
    });
  } catch (error) {
    console.error('[BATCH_UPDATE_STATUS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to batch update orders' });
  }
};

export const batchSendOrderEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderIds, subject, message, templateType } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0 || !subject || !message) {
      res.status(400).json({ success: false, message: 'orderIds, subject, and message are required' });
      return;
    }

    const results: any[] = [];

    for (const id of orderIds) {
      const order = await prisma.order.findUnique({
        where: { id },
        include: { user: true, address: true, items: { include: { book: true } } }
      });

      if (!order) continue;

      const emailTo = order.user?.email || 'customer@example.com';
      const nameTo = order.address?.fullName || order.user?.name || 'Valued Customer';

      const dispatchResult = await emailService.sendOrderEmail({
        orderId: order.id,
        orderNumber: order.orderNumber,
        recipientEmail: emailTo,
        recipientName: nameTo,
        subject,
        message,
        templateType: templateType || 'DELAY_NOTICE',
        adminSender: 'admin@technoworld.com'
      });

      try {
        if (order.userId) {
          await prisma.notification.create({
            data: {
              userId: order.userId,
              title: subject,
              message,
              type: templateType === 'DELAY_NOTICE' ? 'order_delay' : 'admin_message',
              link: '/profile?tab=orders',
            }
          });
        }
      } catch (nErr) {
        console.error('[BATCH_EMAIL_NOTIF_ERR]', nErr);
      }

      const emailLogEntry = `[${new Date().toISOString()}] Batch Email Sent (${templateType || 'DELAY_NOTICE'}): "${subject}" -> ${emailTo}`;
      const updatedNotes = order.notes ? `${order.notes}\n${emailLogEntry}` : emailLogEntry;

      await prisma.order.update({
        where: { id },
        data: { notes: updatedNotes }
      });

      results.push({ orderId: id, orderNumber: order.orderNumber, status: dispatchResult.status });
    }

    res.status(200).json({
      success: true,
      message: `Batch email dispatched to ${results.length} order(s)`,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('[BATCH_SEND_EMAIL_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to batch send emails' });
  }
};

export const updateBookDimensions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { dimensions, weight } = req.body;

    const book = await prisma.book.update({
      where: { id },
      data: {
        dimensions: dimensions || undefined,
        weight: typeof weight === 'number' ? weight : undefined,
      }
    });

    res.status(200).json({
      success: true,
      message: 'Book packaging dimensions and weight updated successfully',
      data: book
    });
  } catch (error) {
    console.error('[UPDATE_BOOK_DIMENSIONS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to update book dimensions' });
  }
};

// POST /api/v1/orders/:id/pickup-slots (Admin sets 3-4 slots)
export const setPickupSlots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { slots } = req.body;

    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      res.status(400).json({ success: false, message: 'At least one pickup time slot is required (3–4 recommended).' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        pickupSlots: JSON.stringify(slots),
        pickupStatus: 'SLOTS_OFFERED',
      },
    });

    // Create In-App Notification for customer
    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `🏪 Choose Your Store Pickup Slot (Order #${order.orderNumber})`,
          message: `Your store takeaway order has been accepted! Admin has proposed ${slots.length} pickup time slots. Please select your convenient time to collect your books from our College Street office.`,
          type: 'pickup',
          link: `/profile?tab=orders`,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: `${slots.length} pickup time slots offered to customer successfully!`,
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/orders/:id/confirm-pickup-slot (Customer selects a slot)
export const confirmPickupSlot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { selectedSlot } = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.id;

    if (!selectedSlot || typeof selectedSlot !== 'string' || !selectedSlot.trim()) {
      res.status(400).json({ success: false, message: 'Selected pickup slot is required.' });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const userRole = (req as any).user?.role;
    if (order.userId !== userId && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, message: 'Unauthorized to update this order' });
      return;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        selectedPickupSlot: selectedSlot.trim(),
        pickupStatus: 'SLOT_CONFIRMED',
      },
    });

    // Notify customer confirmation
    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `✅ Store Pickup Appointment Confirmed`,
          message: `Your pickup slot for order #${order.orderNumber} is confirmed for "${selectedSlot.trim()}". Please download your invoice from Account Center and bring it to our College Street dispatch desk.`,
          type: 'pickup',
          link: `/profile?tab=orders`,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Pickup slot confirmed successfully!',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/orders/:id/mark-collected (Admin completes handover)
export const markOrderCollected = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        pickupStatus: 'COLLECTED',
        status: 'DELIVERED',
        paymentStatus: 'PAID',
      },
    });

    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          title: `🎉 Order Handover Completed (Order #${order.orderNumber})`,
          message: `Your books have been collected from the College Street dispatch desk. Thank you for shopping with Techno World Books!`,
          type: 'delivery',
          link: `/profile?tab=orders`,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Order marked as handed over and completed successfully!',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};
