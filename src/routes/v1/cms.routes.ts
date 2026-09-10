import { Router } from 'express';
import {
  getSections,
  updateSection,
  toggleSection,
  getUiContent,
  publishUiContent,
  resetUiContentKey
} from '../../controllers/cms.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Homepage Sections
router.get('/sections', getSections);
router.put('/sections/:key', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateSection);
router.patch('/sections/:key/toggle', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), toggleSection);

// Visual Live On-Page CMS Text Content
router.get('/ui-content', getUiContent);
router.put('/ui-content', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), publishUiContent);
router.delete('/ui-content/:key', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), resetUiContentKey);

export default router;

