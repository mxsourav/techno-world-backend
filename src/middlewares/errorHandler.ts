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

  logger.error({
    requestId,
    message: err.message,
    stack: err.stack,
  });

  const response: any = {
    success: false,
    message: 'Internal Server Error',
    requestId,
  };

  if (env.NODE_ENV === 'development') {
    response.debug = err.message;
  }

  res.status(500).json(response);
}
