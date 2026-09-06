import { Router } from 'express';
import {
  getReviews,
  createReview,
  getAdminReviews,
  updateReviewStatus,
  deleteReview,
  clearOldReviews,
  adminCreateReview,
  toggleReviewVerified,
} from '../../controllers/review.controller.js';
import { requireAuth, requireRole, optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

// Storefront routes
router.get('/', getReviews);
router.post('/', optionalAuth, createReview);

// Admin moderation routes
router.get('/admin', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAdminReviews);
router.post('/admin', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), adminCreateReview);
router.patch('/admin/:id/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateReviewStatus);
router.patch('/admin/:id/verify', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), toggleReviewVerified);
router.delete('/admin/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteReview);
router.post('/admin/clear-old', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), clearOldReviews);

export default router;
