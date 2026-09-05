import { Router } from 'express';
import {
  getQuestions,
  askQuestion,
  getAdminQuestions,
  answerQuestion,
  deleteQuestion,
  clearOldQuestions,
} from '../../controllers/question.controller.js';
import { requireAuth, requireRole, optionalAuth } from '../../middlewares/auth.middleware.js';

const router = Router();

// Storefront routes
router.get('/', getQuestions);
router.post('/', optionalAuth, askQuestion);

// Admin moderation routes
router.get('/admin', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAdminQuestions);
router.patch('/admin/:id/answer', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), answerQuestion);
router.delete('/admin/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteQuestion);
router.post('/admin/clear-old', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), clearOldQuestions);

export default router;
