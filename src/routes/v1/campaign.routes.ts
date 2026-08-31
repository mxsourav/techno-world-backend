import { Router } from 'express';
import * as campaignController from '../../controllers/campaign.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();
const requireAdmin = requireRole(['ADMIN', 'SUPER_ADMIN']);

router.get('/', requireAuth, requireAdmin, campaignController.getAll);
router.get('/:id', requireAuth, requireAdmin, campaignController.getById);
router.post('/', requireAuth, requireAdmin, campaignController.create);
router.put('/:id', requireAuth, requireAdmin, campaignController.update);
router.delete('/:id', requireAuth, requireAdmin, campaignController.remove);

export default router;
