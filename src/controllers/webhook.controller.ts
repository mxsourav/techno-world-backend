import { Request, Response } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

const prisma = new PrismaClient();

export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).json({ success: false, message: 'Webhook secret not configured' });
    return;
  }

  // The 'x-razorpay-signature' header contains the HMAC hex digest
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    res.status(400).json({ success: false, message: 'Missing signature' });
    return;
  }

  // When configured correctly, req.body should be the raw Buffer of the request body
  // We compute the HMAC digest using the raw body and the webhook secret
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(req.body) // req.body must be the raw buffer here!
    .digest('hex');

  if (expectedSignature !== signature) {
    console.error('Invalid Razorpay webhook signature');
    res.status(400).json({ success: false, message: 'Invalid signature' });
    return;
  }

  // Now we can safely parse the body to JSON
  let payload: any;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    return;
  }

  // Process the event
  const event = payload.event;
  if (event === 'payment.captured' || event === 'order.paid') {
    const paymentEntity = payload.payload.payment.entity;
    const razorpayOrderId = paymentEntity.order_id;

    if (razorpayOrderId) {
      // Find the order and update status to PAID
      try {
        await prisma.order.updateMany({
          where: { razorpayOrderId },
          data: { paymentStatus: 'PAID' }
        });
        console.log(`Order ${razorpayOrderId} marked as PAID via webhook`);
      } catch (error) {
        console.error(`Failed to update order ${razorpayOrderId} status`, error);
        // We still return 200 to acknowledge receipt of the webhook
      }
    }
  }

  res.status(200).json({ success: true });
};
