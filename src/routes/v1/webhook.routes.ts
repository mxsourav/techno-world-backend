import { Router, raw } from 'express';
import { handleRazorpayWebhook, handleIndiaPostWebhook } from '../../controllers/webhook.controller.js';

const router = Router();

// IMPORTANT: Webhook requires the raw unparsed body for cryptographic HMAC verification
router.post(
  '/razorpay',
  raw({ type: 'application/json' }), // Parses the incoming request into a Buffer
  handleRazorpayWebhook
);

// India Post Tracking & Dispatch Event Webhook
router.post('/indiapost', handleIndiaPostWebhook);

export default router;
