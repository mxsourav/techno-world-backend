import { Router } from 'express';
import { getCategories, getCategoryBySlug, reorderCategories } from '../../controllers/category.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

router.get('/', getCategories);
router.get('/:slug', getCategoryBySlug);
router.patch('/reorder', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), reorderCategories);

export default router;
