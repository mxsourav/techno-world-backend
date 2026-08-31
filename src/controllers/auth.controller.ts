import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { generateTokens, verifyToken } from '../utils/jwt.js';

const prisma = new PrismaClient();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(403).json({ success: false, message: 'Account locked due to suspicious activity. Try again later.' });
      return;
    }

    let isValid = false;
    try {
        isValid = await argon2.verify(user.password, password);
    } catch (e) {
        const bcrypt = await import('bcrypt');
        isValid = await bcrypt.default.compare(password, user.password);
    }

    if (!isValid) {
      const attempts = (user.failedLogins || 0) + 1;
      const updates: any = { failedLogins: attempts };
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        updates.lockedUntil = new Date(Date.now() + LOCK_TIME_MS);
      }
      await prisma.user.update({ where: { id: user.id }, data: updates });
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { failedLogins: 0, lockedUntil: null } 
    });

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Save refresh token to database
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || 'Unknown'
      }
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/api/v1/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user: { id: user.id, email: user.email, role: user.role, name: user.name }
      },
      user: { id: user.id, email: user.email, role: user.role, name: user.name }
    });
  } catch (error) {
    console.error('[LOGIN_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      res.status(401).json({ success: false, message: 'No refresh token provided' });
      return;
    }

    const decoded = verifyToken(token, env.JWT_REFRESH_SECRET);
    if (!decoded) {
      res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
      return;
    }

    const session = await prisma.session.findUnique({ where: { refreshToken: token } });
    if (!session || session.expiresAt < new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      res.status(401).json({ success: false, message: 'Session expired or invalid' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User account inactive or missing' });
      return;
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role);

    await prisma.$transaction([
      prisma.session.delete({ where: { id: session.id } }),
      prisma.session.create({
        data: {
          userId: user.id,
          refreshToken: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          userAgent: req.headers['user-agent'] || 'Unknown',
          ipAddress: req.ip || 'Unknown'
        }
      })
    ]);

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/api/v1/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed',
      data: {
        accessToken,
        user: { id: user.id, email: user.email, role: user.role, name: user.name }
      }
    });
  } catch (error) {
    console.error('[REFRESH_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await prisma.session.deleteMany({ where: { refreshToken: token } });
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[LOGOUT_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
