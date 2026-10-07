import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const generateTokens = (userId: string, role: string) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  // 30-Day Session Mode: Keep users and admins logged in seamlessly for 30 days
  const accessExpiry = '30d';
  const refreshExpiry = '60d';

  const accessToken = jwt.sign(
    { userId, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: accessExpiry as any }
  );

  const refreshToken = jwt.sign(
    { userId, role },
    env.JWT_REFRESH_SECRET,
    { expiresIn: refreshExpiry as any }
  );

  return { accessToken, refreshToken };
};

export const verifyToken = (token: string, secret: string) => {
  try {
    return jwt.verify(token, secret) as { userId: string; role: string };
  } catch (error) {
    return null;
  }
};
