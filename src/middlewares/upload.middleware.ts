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
