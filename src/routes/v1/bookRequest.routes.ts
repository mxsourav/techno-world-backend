import { Router } from 'express';
import {
  submitBookRequest,
  getBookRequests,
  updateBookRequest,
  deleteBookRequest,
} from '../../controllers/bookRequest.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { formSubmissionLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Public: Submit a book request (Throttled to prevent spam)
router.post('/', formSubmissionLimiter, submitBookRequest);

// Admin: Review & manage book sourcing requests
router.get('/', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getBookRequests);
router.patch('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateBookRequest);
router.delete('/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteBookRequest);

export default router;
