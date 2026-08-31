import { Router } from 'express';
import { secureUpload as upload, secureDataUpload } from '../../middlewares/upload.middleware.js';
import { 
  getAdminStats, 
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

const router = Router();

// Stats
router.get('/stats', getAdminStats);

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
