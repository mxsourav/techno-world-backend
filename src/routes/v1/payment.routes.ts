import { Router } from 'express';
import {
  getPaymentOverview,
  getPaymentTransactions,
  updatePaymentStatus,
  verifyPayment,
  razorpayWebhook,
} from '../../controllers/payment.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Customer & Admin payment verification
router.post('/verify', requireAuth, verifyPayment);

// Admin routes
router.get('/overview', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getPaymentOverview);
router.get('/transactions', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getPaymentTransactions);
router.patch('/:orderId/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updatePaymentStatus);

// Razorpay Webhook listener (Signature verified inside controller)
router.post('/razorpay/webhook', razorpayWebhook);

export default router;
