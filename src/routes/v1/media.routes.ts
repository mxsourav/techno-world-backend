import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { listMedia, uploadMedia, deleteMedia } from '../../controllers/media.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const mediaFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedMimes.includes(file.mimetype) || !allowedExts.includes(ext)) {
    return cb(new Error('Invalid file type. Only JPG, PNG, WEBP, GIF, and PDF files are allowed.'));
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: mediaFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

const router = Router();

// Protect all media endpoints with Admin/Super Admin authentication
router.use(requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']));

router.get('/', listMedia);
router.post('/upload', upload.single('file'), uploadMedia);
router.delete('/:id', deleteMedia);

export default router;
