import { Request, Response } from 'express';
import crypto from 'crypto';
import { PrismaClient, OrderStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { indiaPostWebhookPayloadSchema } from '../schemas/indiapost.schema.js';

const prisma = new PrismaClient();

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

  if (expectedSignature !== signature) {
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
    // 1. IP Whitelisting & Subnet Verification
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const allowedIps = env.INDIAPOST_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean);

    const isIpAllowed =
      allowedIps.includes('*') ||
      allowedIps.includes(clientIp) ||
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp.startsWith('192.168.') ||
      clientIp.startsWith('10.');

    if (!isIpAllowed) {
      logger.warn('Unauthorized India Post Webhook IP attempt: ' + clientIp);
      res.status(403).json({ success: false, message: 'Forbidden: IP not whitelisted' });
      return;
    }

    // 2. Optional Webhook Secret Verification
    if (env.INDIAPOST_WEBHOOK_SECRET) {
      const secretHeader = req.headers['x-indiapost-secret'] || req.headers['x-webhook-secret'];
      if (secretHeader !== env.INDIAPOST_WEBHOOK_SECRET) {
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
      if (newStatus && matchedOrder.status !== OrderStatus.DELIVERED) {
        updateData.status = newStatus;
      }
      
      const eventNote = '[' + (payload.event_date || new Date().toISOString()) + '] ' + (payload.event_description || payload.event_code) + ' at ' + (payload.event_office_name || 'Postal Hub');
      updateData.notes = (matchedOrder.notes ? matchedOrder.notes + ' | ' : '') + eventNote;

      await prisma.order.update({
        where: { id: matchedOrder.id },
        data: updateData,
      });

      logger.info('Order ' + matchedOrder.orderNumber + ' updated to status ' + (newStatus || matchedOrder.status));
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
