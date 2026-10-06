import { Router } from 'express';
import {
  submitB2BEnquiry,
  getB2BEnquiries,
  getB2BEnquiryById,
  updateB2BEnquiry,
  deleteB2BEnquiry,
} from '../../controllers/b2bEnquiry.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { formSubmissionLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Public: Submit B2B Institutional Quote Request (Protected by rate limiter)
router.post('/', formSubmissionLimiter, submitB2BEnquiry);

// Admin: Query, View, Update, and Delete Quote Requests
router.get('/', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getB2BEnquiries);
router.get('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getB2BEnquiryById);
router.patch('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateB2BEnquiry);
router.delete('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteB2BEnquiry);

export default router;
