import { Router } from 'express';
import * as promotionController from '../../controllers/promotion.controller';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';

const router = Router();

const requireAdmin = requireRole(['ADMIN', 'SUPER_ADMIN']);

router.get('/', requireAuth, requireAdmin, promotionController.getAll);
router.post('/', requireAuth, requireAdmin, promotionController.create);
router.put('/:id', requireAuth, requireAdmin, promotionController.update);
router.delete('/:id', requireAuth, requireAdmin, promotionController.remove);
router.patch('/:id/toggle', requireAuth, requireAdmin, promotionController.toggleActive);

export default router;
