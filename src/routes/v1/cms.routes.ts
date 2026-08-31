import { Router } from 'express';
import { getSections, updateSection, toggleSection } from '../../controllers/cms.controller.js';

const router = Router();

router.get('/sections', getSections);
router.put('/sections/:key', updateSection);
router.patch('/sections/:key/toggle', toggleSection);

export default router;
