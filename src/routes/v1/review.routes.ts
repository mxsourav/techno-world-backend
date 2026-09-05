import { Router } from 'express';
import {
  getReviews,
  createReview,
  getAdminReviews,
  updateReviewStatus,
  deleteReview,
  clearOldReviews,
} from '../../controllers/review.controller.js';
import { requireAuth, requireRole, optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

// Storefront routes
router.get('/', getReviews);
router.post('/', optionalAuth, createReview);

// Admin moderation routes
router.get('/admin', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAdminReviews);
router.patch('/admin/:id/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateReviewStatus);
router.delete('/admin/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteReview);
router.post('/admin/clear-old', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), clearOldReviews);

export default router;
