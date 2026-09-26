import { Router, raw } from 'express';
import { razorpayWebhook } from '../../controllers/payment.controller.js';
import { handleIndiaPostWebhook } from '../../controllers/webhook.controller.js';

const router = Router();

// IMPORTANT: Webhook requires the raw unparsed body for cryptographic HMAC verification
router.post(
  '/razorpay',
  raw({ type: 'application/json' }), // Parses the incoming request into a Buffer
  razorpayWebhook
);

// India Post Tracking & Dispatch Event Webhook
router.post('/indiapost', handleIndiaPostWebhook);

export default router;
