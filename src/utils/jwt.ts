import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface TokenPayload {
  userId: string;
  role: string;
  sessionId?: string;
}

export const generateTokens = (userId: string, role: string, sessionId?: string) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  // 30-Day Session Mode: Keep users and admins logged in seamlessly for 30 days
  const accessExpiry = '30d';
  const refreshExpiry = '60d';

  const payload: TokenPayload = { userId, role };
  if (sessionId) {
    payload.sessionId = sessionId;
  }

  const accessToken = jwt.sign(
    payload,
    env.JWT_ACCESS_SECRET,
    { expiresIn: accessExpiry as any }
  );

  const refreshToken = jwt.sign(
    payload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: refreshExpiry as any }
  );

  return { accessToken, refreshToken };
};

export const verifyToken = (token: string, secret: string): TokenPayload | null => {
  try {
    return jwt.verify(token, secret) as TokenPayload;
  } catch (error) {
    return null;
  }
};
