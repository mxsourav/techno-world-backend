import { Request, Response } from 'express';
import crypto from 'crypto';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { indiaPostWebhookPayloadSchema } from '../schemas/indiapost.schema.js';
import { emailService } from '../services/email.service.js';


export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).json({ success: false, message: 'Webhook secret not configured' });
    return;
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    res.status(400).json({ success: false, message: 'Missing signature' });
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(String(signature), 'utf8');

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    console.error('Invalid Razorpay webhook signature');
    res.status(400).json({ success: false, message: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    return;
  }

  const event = payload.event;
  if (event === 'payment.captured' || event === 'order.paid') {
    const paymentEntity = payload.payload.payment.entity;
    const razorpayOrderId = paymentEntity.order_id;

    if (razorpayOrderId) {
      try {
        await prisma.order.updateMany({
          where: { paymentId: razorpayOrderId },
          data: { paymentStatus: 'PAID' }
        });
        console.log('Order ' + razorpayOrderId + ' marked as PAID via webhook');
      } catch (error) {
        console.error('Failed to update order ' + razorpayOrderId + ' status', error);
      }
    }
  }

  res.status(200).json({ status: 'ok' });
};

/**
 * India Post Tracking & Dispatch Event Webhook
 * POST /api/v1/webhook/indiapost
 */
export const handleIndiaPostWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. IP Whitelisting Verification (using sanitized req.ip via trusted reverse proxy)
    const clientIp = req.ip || '';
    const allowedIps = env.INDIAPOST_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean);

    const isIpAllowed =
      allowedIps.includes('*') ||
      allowedIps.includes(clientIp) ||
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp === '::ffff:127.0.0.1';

    if (!isIpAllowed) {
      logger.warn('Unauthorized India Post Webhook IP attempt: ' + clientIp);
      res.status(403).json({ success: false, message: 'Forbidden: IP not whitelisted' });
      return;
    }

    // 2. Cryptographic Timing-Safe Secret Verification (if secret configured)
    if (env.INDIAPOST_WEBHOOK_SECRET) {
      const secretHeader = (req.headers['x-indiapost-secret'] || req.headers['x-webhook-secret']) as string;
      const expectedSecret = env.INDIAPOST_WEBHOOK_SECRET;
      if (!secretHeader || typeof secretHeader !== 'string') {
        logger.warn('Missing or invalid India Post Webhook Secret Header');
        res.status(401).json({ success: false, message: 'Invalid webhook authentication secret' });
        return;
      }

      const expectedBuf = Buffer.from(expectedSecret, 'utf8');
      const providedBuf = Buffer.from(secretHeader, 'utf8');
      if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        logger.warn('Invalid India Post Webhook Secret Header');
        res.status(401).json({ success: false, message: 'Invalid webhook authentication secret' });
        return;
      }
    }

    // 3. Payload Validation with Zod Schema
    const payload = indiaPostWebhookPayloadSchema.parse(req.body);
    logger.info('India Post Webhook Received for article ' + payload.article_number + ' - Event: ' + payload.event_code);

    // 4. Map Event Code to Order Status Machine
    let newStatus: OrderStatus | null = null;
    const eventUpper = (payload.event_code || '').toUpperCase();

    if (eventUpper.includes('DELIVER') || eventUpper === 'DELIVERY' || eventUpper === 'ITEM_DELIVERED') {
      newStatus = OrderStatus.DELIVERED;
    } else if (
      eventUpper.includes('DISPATCH') ||
      eventUpper.includes('BAG') ||
      eventUpper === 'BAG_CLOSE' ||
      eventUpper === 'ITEM_DISPATCH' ||
      eventUpper === 'OUT_FOR_DELIVERY'
    ) {
      newStatus = OrderStatus.SHIPPED;
    } else if (eventUpper === 'ITEM_BOOK' || eventUpper === 'ITEM_RECEIVE') {
      newStatus = OrderStatus.PROCESSING;
    } else if (eventUpper.includes('RTS') || eventUpper.includes('RETURN') || eventUpper === 'RTA') {
      newStatus = OrderStatus.CANCELLED;
    }

    // 5. Update Order in Database
    const matchedOrder = await prisma.order.findFirst({
      where: {
        OR: [
          { trackingNumber: payload.article_number },
          { orderNumber: payload.article_number },
        ],
      },
    });

    if (matchedOrder) {
      const updateData: any = {};
      const isDelivering = newStatus === OrderStatus.DELIVERED && matchedOrder.status !== OrderStatus.DELIVERED;

      if (newStatus && matchedOrder.status !== OrderStatus.DELIVERED) {
        updateData.status = newStatus;
      }
      if (newStatus === OrderStatus.DELIVERED && !matchedOrder.deliveredAt) {
        updateData.deliveredAt = new Date();
      }
      
      const eventNote = '[' + (payload.event_date || new Date().toISOString()) + '] ' + (payload.event_description || payload.event_code) + ' at ' + (payload.event_office_name || 'Postal Hub');
      updateData.notes = (matchedOrder.notes ? matchedOrder.notes + ' | ' : '') + eventNote;

      const updatedOrder = await prisma.order.update({
        where: { id: matchedOrder.id },
        data: updateData,
        include: {
          items: { include: { book: true } },
          user: true,
          address: true,
        },
      });

      logger.info('Order ' + matchedOrder.orderNumber + ' updated to status ' + (newStatus || matchedOrder.status));

      // When India Post pings that the order is DELIVERED, trigger customer in-app notification & book review request email
      if (isDelivering && !matchedOrder.reviewEmailSentAt) {
        try {
          await prisma.order.update({
            where: { id: matchedOrder.id },
            data: { reviewEmailSentAt: new Date() },
          });

          // In-app Notification
          if (updatedOrder.userId) {
            await prisma.notification.create({
              data: {
                userId: updatedOrder.userId,
                title: `Order Delivered: #${updatedOrder.orderNumber}`,
                message: `Your package for order #${updatedOrder.orderNumber} has arrived via India Post. Enjoy your reading!`,
                type: 'order_delivered',
                link: '/profile?tab=orders',
              },
            }).catch(() => {});
          }

          // Customer Review Request Email
          const recipientEmail = (updatedOrder.address?.email && !updatedOrder.address.email.includes('@mail.com') && !updatedOrder.address.email.includes('@example.com'))
            ? updatedOrder.address.email
            : (updatedOrder.user?.email && !updatedOrder.user.email.includes('@mail.com') && !updatedOrder.user.email.includes('@example.com'))
            ? updatedOrder.user.email
            : null;
          const recipientName = updatedOrder.address?.fullName || updatedOrder.user?.name || 'Valued Customer';

          if (recipientEmail && recipientEmail.includes('@') && !recipientEmail.includes('@technoworld.com')) {
            const itemsSummary = (updatedOrder.items || []).map((it: any) => ({
              title: it.book?.title || 'Academic Book',
              quantity: it.quantity,
              price: Number(it.priceAtPurchase),
              sku: it.book?.sku || it.book?.bookCode || undefined,
              slug: it.book?.slug || it.book?.id || undefined,
              coverUrl: it.book?.coverUrl || undefined,
              author: it.book?.author || it.book?.authors?.[0]?.name || undefined,
            }));

            const emailContent = emailService.generateLifecycleEmailHtml({
              status: 'DELIVERED',
              orderNumber: updatedOrder.orderNumber,
              customerName: recipientName,
              items: itemsSummary,
              totalAmount: Number(updatedOrder.totalAmount),
              subtotal: Number(updatedOrder.subtotal),
              shippingCharge: Number(updatedOrder.shippingCharge),
              discountAmount: Number(updatedOrder.discountAmount),
              trackingNumber: updatedOrder.trackingNumber,
              shippingCarrier: updatedOrder.shippingCarrier || 'India Post',
              shippingMethod: updatedOrder.shippingMethod,
              paymentMethod: updatedOrder.paymentMethod,
            });

            emailService.sendOrderNotification({
              recipientEmail,
              recipientName,
              orderNumber: updatedOrder.orderNumber,
              customerId: updatedOrder.user?.customerId || updatedOrder.userId || undefined,
              customerPhone: updatedOrder.address?.phone || updatedOrder.user?.phone || undefined,
              subject: emailContent.subject,
              message: emailContent.text,
            }, emailContent.html).catch((err: any) => {
              logger.warn(`[INDIA_POST_DELIVERY_EMAIL_WARN] ${err.message}`);
            });
          }
        } catch (deliveryPostErr: any) {
          logger.warn(`[INDIA_POST_DELIVERY_TRIGGER_ERR] ${deliveryPostErr.message}`);
        }
      }
    } else {
      logger.warn('India Post webhook: No matching order found for article ' + payload.article_number);
    }

    res.status(200).json({
      success: true,
      message: 'Event processed successfully',
      article_number: payload.article_number,
    });
  } catch (error: any) {
    logger.error('India Post Webhook Processing Error: ' + error.message);
    res.status(400).json({ success: false, message: error.message || 'Webhook processing failed' });
  }
};
