import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as any).requestId;

  if (err instanceof AppError) {
    logger.warn({
      requestId,
      statusCode: err.statusCode,
      message: err.message,
    });

    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      requestId,
    });
    return;
  }

  // 1. Prisma Unique Constraint Error (P2002)
  if ((err as any).code === 'P2002') {
    const rawTarget = (err as any).meta?.target;
    let field = 'identifier';
    if (Array.isArray(rawTarget)) {
      field = rawTarget.join(', ');
    } else if (typeof rawTarget === 'string') {
      field = rawTarget;
    }
    const message = `A record with this ${field} already exists. Please choose a unique value.`;
    logger.warn({ requestId, statusCode: 409, message, code: 'P2002' });
    res.status(409).json({ success: false, message, requestId });
    return;
  }

  // 2. Prisma Foreign Key Constraint Error (P2003)
  if ((err as any).code === 'P2003') {
    const field = (err as any).meta?.field_name || 'referenced record';
    const message = `Invalid reference: the associated ${field} does not exist.`;
    logger.warn({ requestId, statusCode: 400, message, code: 'P2003' });
    res.status(400).json({ success: false, message, requestId });
    return;
  }

  // 3. Prisma Record Not Found (P2025)
  if ((err as any).code === 'P2025') {
    const message = (err as any).meta?.cause || 'Record not found.';
    logger.warn({ requestId, statusCode: 404, message, code: 'P2025' });
    res.status(404).json({ success: false, message, requestId });
    return;
  }

  // 4. Prisma Validation Error
  if (err.name === 'PrismaClientValidationError') {
    logger.warn({ requestId, statusCode: 400, message: err.message });
    res.status(400).json({
      success: false,
      message: 'Invalid data format provided for database operation.',
      requestId,
    });
    return;
  }

  // 5. Multer / File Upload Validation Errors
  if (
    err.name === 'MulterError' ||
    err.message?.includes('Invalid image type') ||
    err.message?.includes('Invalid document type') ||
    err.message?.includes('Invalid file type')
  ) {
    logger.warn({ requestId, statusCode: 400, message: err.message });
    res.status(400).json({
      success: false,
      message: err.message,
      requestId,
    });
    return;
  }

  // 6. Cloudinary Configuration or API Error
  if (err.message?.toLowerCase().includes('cloudinary')) {
    logger.warn({ requestId, statusCode: 400, message: err.message });
    res.status(400).json({
      success: false,
      message: err.message,
      requestId,
    });
    return;
  }

  logger.error({
    requestId,
    message: err.message,
    stack: err.stack,
  });

  const response: any = {
    success: false,
    message: err.message || 'Internal Server Error',
    requestId,
  };

  if (env.NODE_ENV === 'development') {
    response.debug = err.message;
  }

  res.status(500).json(response);
}
