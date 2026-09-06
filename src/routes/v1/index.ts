import { Router } from 'express';
import authRoutes from './auth.routes.js';
import bookRoutes from './book.routes.js';
import categoryRoutes from './category.routes.js';
import adminRoutes from './admin.routes.js';
import searchRoutes from './search.routes.js';
import orderRoutes from './order.routes.js';
import mediaRoutes from './media.routes.js';
import cmsRoutes from './cms.routes.js';
import promotionRoutes from './promotion.routes.js';
import campaignRoutes from './campaign.routes.js';
import pricingRoutes from './pricing.routes.js';
import webhookRoutes from './webhook.routes.js';
import shippingRoutes from './shipping.routes.js';
import profileRoutes from './profile.routes.js';
import reviewRoutes from './review.routes.js';
import questionRoutes from './question.routes.js';
import paymentRoutes from './payment.routes.js';
import invoiceRoutes from './invoice.routes.js';

const router = Router();

// API Routes
router.get('/', (req, res) => {
  res.json({
    message: 'Techno World Books API v1',
    version: '1.0.0',
    documentation: '/docs',
  });
});

// API Routes
router.use('/auth', authRoutes);
router.use('/books', bookRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);
router.use('/search', searchRoutes);
router.use('/orders', orderRoutes);
router.use('/media', mediaRoutes);
router.use('/cms', cmsRoutes);
router.use('/promotions', promotionRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/pricing', pricingRoutes);
router.use('/webhook', webhookRoutes);
router.use('/shipping', shippingRoutes);
router.use('/profile', profileRoutes);
router.use('/reviews', reviewRoutes);
router.use('/questions', questionRoutes);
router.use('/payments', paymentRoutes);
router.use('/invoices', invoiceRoutes);

export default router;
