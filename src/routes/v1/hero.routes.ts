import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import {
  getHeroConfig,
  uploadHeroCover,
  deleteHeroCover,
} from '../../controllers/hero.controller.js';

const router = Router();

// Memory storage so Sharp can process the buffer directly in RAM
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

// Public route to fetch active hero config & cover
router.get('/', getHeroConfig);

// Protected admin routes: Support both /admin/cover and /cover
router.post(
  '/admin/cover',
  requireAuth,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  upload.single('cover_image'),
  uploadHeroCover
);
router.post(
  '/cover',
  requireAuth,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  upload.single('cover_image'),
  uploadHeroCover
);

router.delete(
  '/admin/cover',
  requireAuth,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  deleteHeroCover
);
router.delete(
  '/cover',
  requireAuth,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  deleteHeroCover
);

export default router;
