import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const generateTokens = (userId: string, role: string) => {
  const accessToken = jwt.sign(
    { userId, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRY as any }
  );

  const refreshToken = jwt.sign(
    { userId, role },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRY as any }
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
