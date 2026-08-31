import { Router, raw } from 'express';
import { handleRazorpayWebhook } from '../../controllers/webhook.controller.js';

const router = Router();

// IMPORTANT: Webhook requires the raw unparsed body for cryptographic HMAC verification
router.post(
  '/razorpay',
  raw({ type: 'application/json' }), // Parses the incoming request into a Buffer
  handleRazorpayWebhook
);

export default router;
