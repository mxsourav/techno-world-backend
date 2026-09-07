import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { generateTokens, verifyToken } from '../utils/jwt.js';
import { ensureUserTestingBonus } from '../services/loyalty.service.js';

const prisma = new PrismaClient();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, message: 'Email and password are required' });
    return;
  }

  const rawInput = String(email).trim();
  const normalized = rawInput.toLowerCase();

  try {
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: rawInput },
          { email: normalized },
          ...(normalized === 'admin' ? [
            { email: 'admin@technoworld.com' },
            { email: 'admin@example.com' },
            { role: Role.SUPER_ADMIN }
          ] : [])
        ]
      }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
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

    // Ensure testing bonus (at least 150 points & ₹50 cash)
    const bonus = await ensureUserTestingBonus(user.id);

    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      technoPoints: bonus.technoPoints,
      technoWallet: bonus.technoWallet,
    };

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: userPayload
      },
      user: userPayload
    });
  } catch (error) {
    console.error('[LOGIN_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.body?.refreshToken as string) || (req.headers['x-refresh-token'] as string) || req.cookies?.refreshToken;
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
        refreshToken: newRefreshToken,
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

// TODO: [OAUTH_REAL_KEYS_INJECTED] Remove Developer OAuth Bypass once client provides live Google Client ID & Secret
export const devGoogleOAuthBypass = async (req: Request, res: Response): Promise<void> => {
  try {
    if (env.NODE_ENV === 'production') {
      res.status(403).json({ success: false, message: 'Developer OAuth bypass is strictly disabled in production' });
      return;
    }

    const devGoogleEmail = (req.body.email || '').trim().toLowerCase();
    if (!devGoogleEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(devGoogleEmail)) {
      res.status(400).json({ success: false, message: 'Valid email address is required to sign in' });
      return;
    }
    const devGoogleName = req.body.name || devGoogleEmail.split('@')[0];
    const devGoogleId = req.body.googleId || 'google_dev_test_98765';
    const devAvatar = req.body.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80';

    // Upsert the test customer record in SQLite
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: devGoogleId },
          { email: devGoogleEmail },
        ],
      },
    });

    // SECURITY CHECK: Disallow administrative accounts from ever using developer OAuth bypass
    if (user && (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN)) {
      res.status(403).json({ success: false, message: 'Administrator accounts cannot be accessed via developer OAuth bypass' });
      return;
    }

    // SECURITY CHECK: If user exists with password credentials and is not linked to Google, block account takeover
    if (user && user.password !== 'GOOGLE_OAUTH_USER_NO_PASSWORD' && !user.googleId) {
      res.status(400).json({ success: false, message: 'This email is registered with password credentials. Please sign in using your password.' });
      return;
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: devGoogleEmail,
          name: devGoogleName,
          googleId: devGoogleId,
          avatarUrl: devAvatar,
          password: 'GOOGLE_OAUTH_USER_NO_PASSWORD',
          role: Role.CUSTOMER,
          technoPoints: 0,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: devGoogleId, avatarUrl: devAvatar },
      });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Save refresh session
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'] || 'Google OAuth Bypass Agent',
        ipAddress: req.ip || '127.0.0.1',
      },
    });

    // Exact Cookie Parity with standard login
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: (env.NODE_ENV as string) === 'production',
      sameSite: (env.NODE_ENV as string) === 'production' ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: (env.NODE_ENV as string) === 'production',
      sameSite: (env.NODE_ENV as string) === 'production' ? 'strict' : 'lax',
      path: '/api/v1/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Ensure testing bonus (at least 150 points & ₹50 cash)
    const bonus = await ensureUserTestingBonus(user.id);

    res.status(200).json({
      success: true,
      message: 'Developer Google OAuth bypass authentication successful',
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          avatarUrl: user.avatarUrl,
          technoPoints: bonus.technoPoints,
          technoWallet: bonus.technoWallet,
        },
      },
    });
  } catch (error) {
    console.error('[DEV_GOOGLE_OAUTH_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Developer OAuth bypass failed' });
  }
};

export const googleAuthCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.query;
    if (!code) {
      res.status(400).json({ success: false, message: 'Missing OAuth authorization code' });
      return;
    }
    // Production Google OAuth Token Exchange scaffolding
    res.status(501).json({
      success: false,
      message: 'Google Client Secret not configured on server. Use developer bypass endpoint.',
    });
  } catch (error) {
    console.error('[GOOGLE_OAUTH_CALLBACK_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Google OAuth callback failed' });
  }
};
