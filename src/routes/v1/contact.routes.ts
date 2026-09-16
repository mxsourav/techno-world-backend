import { Router } from 'express';
import {
  submitContactMessage,
  getContactMessages,
  updateContactMessageStatus,
} from '../../controllers/contact.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { formSubmissionLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Public: Submit a message/query (Throttled to prevent spam)
router.post('/', formSubmissionLimiter, submitContactMessage);

// Admin: View & manage contact inquiries
router.get('/', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getContactMessages);
router.patch('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateContactMessageStatus);

export default router;
