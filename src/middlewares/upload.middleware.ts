import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Strict Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Resolve strictly to a defined local folder
    cb(null, path.resolve(__dirname, '../../uploads')); 
  },
  filename: (req, file, cb) => {
    // Completely discard the user-provided filename to kill path traversal
    const fileExt = path.extname(file.originalname).toLowerCase();
    const safeName = crypto.randomBytes(16).toString('hex') + fileExt;
    cb(null, safeName);
  }
});

// 2. Dual-Layer Type Validation
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedMimeTypes.includes(file.mimetype) || !allowedExtensions.includes(ext)) {
    return cb(new Error('Invalid file type. Only JPG, PNG, WEBP, and PDF are allowed.'));
  }

  cb(null, true);
};

// 3. Size Limits (5MB max)
export const secureUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// 4. Data Import Upload (Memory Storage for Excel/CSV parsing)
const dataFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls
    'text/csv' // csv
  ];
  const allowedExtensions = ['.xlsx', '.xls', '.csv'];

  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedMimeTypes.includes(file.mimetype) || !allowedExtensions.includes(ext)) {
    return cb(new Error('Invalid file type. Only Excel (XLSX) and CSV files are allowed.'));
  }

  cb(null, true);
};

export const secureDataUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: dataFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for bulk catalogs
});

// 5. Cloudinary Media Upload Middlewares (Memory Storage for buffer streaming)
const imageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'];

const bookImageFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!imageMimes.includes(file.mimetype) || !imageExtensions.includes(ext)) {
    return cb(new Error('Invalid image type. Only JPG, PNG, WEBP, GIF, SVG, and AVIF are allowed.'));
  }
  cb(null, true);
};

export const cloudinaryImageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: bookImageFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

const pdfFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype !== 'application/pdf' || ext !== '.pdf') {
    return cb(new Error('Invalid document type. Only PDF files are allowed.'));
  }
  cb(null, true);
};

export const cloudinaryPdfUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: pdfFileFilter,
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

const siteMediaFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const videoMimes = ['video/mp4', 'video/webm', 'video/quicktime'];
  const videoExtensions = ['.mp4', '.webm', '.mov'];

  const ext = path.extname(file.originalname).toLowerCase();
  const isImage = imageMimes.includes(file.mimetype) && imageExtensions.includes(ext);
  const isVideo = videoMimes.includes(file.mimetype) && videoExtensions.includes(ext);

  if (!isImage && !isVideo) {
    return cb(new Error('Invalid media type. Only standard images (JPG, PNG, WEBP, GIF, SVG) and videos (MP4, WEBM, MOV) are allowed.'));
  }
  cb(null, true);
};

export const cloudinarySiteMediaUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: siteMediaFileFilter,
  limits: { fileSize: 60 * 1024 * 1024 } // 60MB max for video
});
