import { Router } from 'express';
import { getPublicSiteMedia } from '../../controllers/siteMedia.controller.js';

const router = Router();

// GET /api/v1/site-media
router.get('/', getPublicSiteMedia);

export default router;
