import { Router } from 'express';
import {
  recordPulse,
  recordBlogEvent,
  getLiveAnalytics,
  getBlogAnalytics,
  getAnalyticsOverview,
} from '../../controllers/analytics.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public heartbeat & telemetry
router.post('/pulse', recordPulse);
router.post('/blog-event', recordBlogEvent);

// Admin-only endpoints
router.get('/live', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getLiveAnalytics);
router.get('/blog-performance', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getBlogAnalytics);
router.get('/overview', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAnalyticsOverview);

export default router;
