import { Router } from 'express';
import {
  secureUpload as upload,
  secureDataUpload,
  cloudinaryImageUpload,
  cloudinaryPdfUpload,
  cloudinarySiteMediaUpload,
} from '../../middlewares/upload.middleware.js';
import {
  getAdminStats,
  getAdminCustomers,
  toggleCustomerStatus,
  adjustCustomerPoints,
  getCustomerDetails,
  exportCustomerData,
  getAdminSettings,
  updateAdminProfile,
  updateSmtpSettings,
  testSmtpSettings,
  getEmailLogs,
  analyzeImportBookCatalog, 
  executeImportBookCatalog,
  getBookPreview,
  deleteBook,
  deleteAllBooks,
  updateBook,
  createBook,
  getActivityLogs,
  getSearchAndSalesAnalytics,
  getAutoAcceptSetting,
  updateAutoAcceptSetting
} from '../../controllers/admin.controller.js';

import {
  getBookImages,
  uploadBookCover as uploadCloudinaryBookCover,
  uploadBookGalleryImages,
  deleteBookImage,
  reorderBookImages,
  setBookCoverImage,
  uploadBookPdf as uploadCloudinaryBookPdf,
  deleteBookPdf,
} from '../../controllers/admin.bookMedia.controller.js';

import {
  listSiteMedia,
  uploadSiteMedia,
  replaceSiteMedia,
  updateSiteMedia,
  deleteSiteMedia,
} from '../../controllers/siteMedia.controller.js';

import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { getAdminCatalog, quickUpdateStock } from '../../controllers/admin.catalog.js';
import {
  getAllCategoriesAdmin,
  reorderCategories,
  updateCategory,
} from '../../controllers/category.controller.js';

const router = Router();

// Protect all admin endpoints with requireAuth and requireRole
router.use(requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']));

// Stats, Analytics & Settings
router.get('/stats', getAdminStats);
router.get('/analytics/search-trends', getSearchAndSalesAnalytics);
router.get('/customers', getAdminCustomers);
router.get('/customers/export', exportCustomerData);
router.get('/customers/:id/details', getCustomerDetails);
router.patch('/customers/:id/status', toggleCustomerStatus);
router.post('/customers/:id/points', adjustCustomerPoints);
router.get('/settings', getAdminSettings);
router.get('/settings/auto-accept', getAutoAcceptSetting);
router.post('/settings/auto-accept', updateAutoAcceptSetting);
router.patch('/profile', updateAdminProfile);
router.put('/smtp', updateSmtpSettings);
router.post('/smtp/test', testSmtpSettings);
router.get('/emails', getEmailLogs);

// Logs
router.get('/books/:id/logs', getActivityLogs);

// Import Catalog
router.post('/import/analyze', secureDataUpload.single('file'), analyzeImportBookCatalog);
router.post('/import/execute', executeImportBookCatalog);

// Book Management
router.get('/books/catalog', getAdminCatalog);
router.patch('/books/:id/stock', quickUpdateStock);
router.delete('/books/all', deleteAllBooks);
router.post('/books', createBook);
router.delete('/books/:id', deleteBook);
router.patch('/books/:id', updateBook);

// Book Media & Documents (Cloudinary Managed)
router.get('/books/:id/preview', getBookPreview);
router.get('/books/:id/images', getBookImages);
router.post('/books/:id/cover', cloudinaryImageUpload.single('file'), uploadCloudinaryBookCover);
router.post('/books/:id/images', cloudinaryImageUpload.array('files', 10), uploadBookGalleryImages);
router.delete('/books/:id/images/:imageId', deleteBookImage);
router.patch('/books/:id/images/reorder', reorderBookImages);
router.patch('/books/:id/images/:imageId/cover', setBookCoverImage);
router.post('/books/:id/pdf', cloudinaryPdfUpload.single('file'), uploadCloudinaryBookPdf);
router.delete('/books/:id/pdf', deleteBookPdf);

// Site Media Management (Banners, Promotional, Fixed Assets, Videos)
router.get('/site-media', listSiteMedia);
router.post('/site-media', cloudinarySiteMediaUpload.single('file'), uploadSiteMedia);
router.put('/site-media/:id/replace', cloudinarySiteMediaUpload.single('file'), replaceSiteMedia);
router.patch('/site-media/:id', updateSiteMedia);
router.delete('/site-media/:id', deleteSiteMedia);

// Category Management (Ordering & CMS)
router.get('/categories', getAllCategoriesAdmin);
router.patch('/categories/reorder', reorderCategories);
router.patch('/categories/:id', updateCategory);

export default router;

