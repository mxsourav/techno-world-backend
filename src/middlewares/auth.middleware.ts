import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { generateTokens, verifyToken } from '../utils/jwt.js';
import { env } from '../config/env.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        sessionId?: string;
      };
      sessionId?: string;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

  // If access token is expired or invalid, attempt seamless refresh via refresh token
  if (!decoded) {
    const refToken = (req.headers['x-refresh-token'] as string) || req.cookies?.refreshToken;
    if (refToken) {
      try {
        const refDecoded = verifyToken(refToken, env.JWT_REFRESH_SECRET);
        if (refDecoded) {
          const session = await prisma.session.findUnique({ where: { refreshToken: refToken } });
          if (session && session.expiresAt > new Date()) {
            const user = await prisma.user.findUnique({ where: { id: refDecoded.userId } });
            if (user && user.isActive) {
              const { accessToken: freshAccess } = generateTokens(user.id, user.role, session.id);
              res.setHeader('x-new-access-token', freshAccess);
              decoded = { userId: user.id, role: user.role, sessionId: session.id };
            }
          }
        }
      } catch (err) {
        // Fall through to 401
      }
    }
  }

  if (!decoded) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
    return;
  }

  // Active Session / Device Limit Verification for Admins
  if (decoded && (decoded.role === 'ADMIN' || decoded.role === 'SUPER_ADMIN') && decoded.sessionId) {
    const activeSession = await prisma.session.findUnique({
      where: { id: decoded.sessionId },
      select: { id: true, expiresAt: true }
    });

    if (!activeSession || activeSession.expiresAt <= new Date()) {
      res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Your active session has ended because this account logged in on another device or the active session limit was exceeded.'
      });
      return;
    }
  }

  req.user = decoded;
  req.sessionId = decoded.sessionId;
  next();
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.role !== 'SUPER_ADMIN' && !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }

    next();
  };
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

  if (token) {
    let decoded = verifyToken(token, env.JWT_ACCESS_SECRET);
    if (!decoded) {
      const refToken = (req.headers['x-refresh-token'] as string) || req.cookies?.refreshToken;
      if (refToken) {
        try {
          const refDecoded = verifyToken(refToken, env.JWT_REFRESH_SECRET);
          if (refDecoded) {
            const session = await prisma.session.findUnique({ where: { refreshToken: refToken } });
            if (session && session.expiresAt > new Date()) {
              const user = await prisma.user.findUnique({ where: { id: refDecoded.userId } });
              if (user && user.isActive) {
                const { accessToken: freshAccess } = generateTokens(user.id, user.role, session.id);
                res.setHeader('x-new-access-token', freshAccess);
                decoded = { userId: user.id, role: user.role, sessionId: session.id };
              }
            }
          }
        } catch (err) {}
      }
    }
    if (decoded) {
      req.user = decoded;
      req.sessionId = decoded.sessionId;
    }
  }
  next();
};
