import { Router } from 'express';
import multer from 'multer';
import { listMedia, uploadMedia, deleteMedia } from '../../controllers/media.controller.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.get('/', listMedia);
router.post('/upload', upload.single('file'), uploadMedia);
router.delete('/:id', deleteMedia);

export default router;
