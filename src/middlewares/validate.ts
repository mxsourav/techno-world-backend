import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';
import { AppError } from './errorHandler.js';

export function validate(schema: ZodType<any>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return next(new AppError(message, 400));
    }
    
    req[source] = result.data;
    next();
  };
}
