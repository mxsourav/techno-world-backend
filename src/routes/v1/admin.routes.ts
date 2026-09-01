import { Router } from 'express';
import { secureUpload as upload, secureDataUpload } from '../../middlewares/upload.middleware.js';
import { 
  getAdminStats, 
  getAdminSettings,
  updateAdminProfile,
  updateSmtpSettings,
  testSmtpSettings,
  analyzeImportBookCatalog, 
  executeImportBookCatalog,
  getBookPreview,
  uploadBookCover,
  uploadBookPdf,
  deleteBook,
  deleteAllBooks,
  updateBook,
  createBook,
  getActivityLogs
} from '../../controllers/admin.controller.js';

import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Protect all admin endpoints with requireAuth and requireRole
router.use(requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']));

// Stats & Settings
router.get('/stats', getAdminStats);
router.get('/settings', getAdminSettings);
router.patch('/profile', updateAdminProfile);
router.put('/smtp', updateSmtpSettings);
router.post('/smtp/test', testSmtpSettings);

// Logs
router.get('/books/:id/logs', getActivityLogs);

// Import Catalog
router.post('/import/analyze', secureDataUpload.single('file'), analyzeImportBookCatalog);
router.post('/import/execute', executeImportBookCatalog);

import { getAdminCatalog, quickUpdateStock } from '../../controllers/admin.catalog.js';

// Book Management
router.get('/books/catalog', getAdminCatalog);
router.patch('/books/:id/stock', quickUpdateStock);
router.delete('/books/all', deleteAllBooks);
router.post('/books', createBook);
router.delete('/books/:id', deleteBook);
router.patch('/books/:id', updateBook);

// Book Media/Preview
router.get('/books/:id/preview', getBookPreview);
router.post('/books/:id/cover', upload.single('file'), uploadBookCover);
router.post('/books/:id/pdf', upload.single('file'), uploadBookPdf);

export default router;
