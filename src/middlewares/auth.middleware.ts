import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { env } from '../config/env.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
      };
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.split(' ')[1];
    if (raw && raw !== 'undefined' && raw !== 'null') {
      token = raw;
    }
  }

  if (!token && req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  let decoded = verifyToken(token, env.JWT_ACCESS_SECRET);

  // If header token failed/expired, try cookie as fallback
  if (!decoded && req.cookies?.accessToken && req.cookies.accessToken !== token) {
    token = req.cookies.accessToken;
    decoded = verifyToken(token, env.JWT_ACCESS_SECRET);
  }

  if (!decoded) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
    return;
  }

  req.user = decoded;
  next();
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.role !== 'SUPER_ADMIN' && !roles.includes(req.user.role)) {
      if (env.NODE_ENV === 'development') {
        next();
        return;
      }
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }

    next();
  };
};
