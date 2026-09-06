import { Router } from 'express';
import {
  downloadInvoice,
  adminDownloadInvoice,
  adminGenerateInvoice,
  adminBatchGenerate,
  adminBatchDownload,
} from '../../controllers/invoice.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Customer endpoints
router.get('/:orderId/download', requireAuth, downloadInvoice);

// Admin endpoints
router.get('/admin/:orderId/download', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), adminDownloadInvoice);
router.post('/admin/:orderId/generate', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), adminGenerateInvoice);
router.post('/admin/batch-generate', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), adminBatchGenerate);
router.post('/admin/batch-download', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), adminBatchDownload);

export default router;
