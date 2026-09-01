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
    const { items, addressId, paymentMethod, couponCode } = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.id;
    
    if (!userId) {
      res.status(401).json({ success: false, message: 'Valid authentication required to checkout' });
      return;
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Items are required' });
      return;
    }

    // 1. Validate via Pricing Engine
    const pricingResult = await PricingEngine.calculate({
      items,
      promotionCode: couponCode,
      userId
    });

    if (!pricingResult.isValid) {
      res.status(400).json({ success: false, message: pricingResult.errors[0] || 'Pricing validation failed' });
      return;
    }
    
    if (pricingResult.promotionError) {
      res.status(400).json({ success: false, message: pricingResult.promotionError });
      return;
    }

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

      const created = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: userId || 'guest',
          addressId: addressId || null,
          status: 'PENDING',
          paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID',
          paymentMethod: paymentMethod || 'COD',
          subtotal: pricingResult.subtotal,
          discountAmount: pricingResult.promotionDiscount,
          shippingCharge: pricingResult.shippingCharge,
          taxAmount: pricingResult.taxAmount,
          totalAmount: pricingResult.totalAmount,
          promotionId: pricingResult.promotionId,
          items: { create: orderItems },
        },
        include: { items: { include: { book: true } } },
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

      return created;
    });

    let razorpayOrder = null;
    if (paymentMethod !== 'COD' && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
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

    // If order was cancelled / rejected, send notification email
    if (status === 'CANCELLED') {
      const recipientEmail = order.user?.email || 'customer@example.com';
      const recipientName = order.address?.fullName || order.user?.name || 'Valued Customer';
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

    const emailTo = recipientEmail || order.user?.email || 'customer@example.com';
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
