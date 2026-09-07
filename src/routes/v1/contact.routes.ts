import { Router } from 'express';
import {
  submitContactMessage,
  getContactMessages,
  updateContactMessageStatus,
} from '../../controllers/contact.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public: Submit a message/query
router.post('/', submitContactMessage);

// Admin: View & manage contact inquiries
router.get('/', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getContactMessages);
router.patch('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateContactMessageStatus);

export default router;
