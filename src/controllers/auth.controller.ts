import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/database.js';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { generateTokens, verifyToken } from '../utils/jwt.js';
import { ensureUserTestingBonus } from '../services/loyalty.service.js';

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
    if (user.password.startsWith('$argon2')) {
      try {
        isValid = await argon2.verify(user.password, password);
      } catch (e) {
        isValid = false;
      }
    } else if (
      user.password.startsWith('$2a$') ||
      user.password.startsWith('$2b$') ||
      user.password.startsWith('$2y$')
    ) {
      try {
        const bcrypt = await import('bcrypt');
        const compareFn = bcrypt.default?.compare || bcrypt.compare;
        isValid = await compareFn(password, user.password);
      } catch (e) {
        isValid = false;
      }
    } else {
      try {
        isValid = await argon2.verify(user.password, password);
      } catch (e) {}
      if (!isValid) {
        try {
          const bcrypt = await import('bcrypt');
          const compareFn = bcrypt.default?.compare || bcrypt.compare;
          isValid = await compareFn(password, user.password);
        } catch (e) {}
      }
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

// TODO: [OAUTH_REAL_KEYS_INJECTED] Transition to real Google OAuth token exchange once live Google Client ID & Secret are configured
export const devGoogleOAuthBypass = async (req: Request, res: Response): Promise<void> => {
  try {
    const devGoogleEmail = (req.body.email || '').trim().toLowerCase();
    if (!devGoogleEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(devGoogleEmail)) {
      res.status(400).json({ success: false, message: 'Valid email address is required to sign in' });
      return;
    }
    const devGoogleName = req.body.name || devGoogleEmail.split('@')[0];
    // Generate a unique deterministic Google ID for this email address to avoid collision
    const devGoogleId = req.body.googleId || `dev_google_${Buffer.from(devGoogleEmail).toString('hex')}`;
    const devAvatar = req.body.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80';

    // Query strictly by email so different entered emails always access or create their own distinct user account
    let user = await prisma.user.findFirst({
      where: {
        email: devGoogleEmail,
      },
    });

    // SECURITY CHECK: Disallow administrative accounts from ever using developer OAuth bypass
    if (user && (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN)) {
      res.status(403).json({ success: false, message: 'Administrator accounts cannot be accessed via developer OAuth bypass' });
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
        data: { googleId: devGoogleId, avatarUrl: user.avatarUrl || devAvatar },
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

/**
 * Production Google Sign-In with Google Identity Services (GIS)
 * Verifies the Google ID token cryptographically using google-auth-library,
 * matches client audience, performs safe user lookup / registration / account linking,
 * and issues standard application JWT & HTTP-only cookies.
 */
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { credential } = req.body;
    if (!credential || typeof credential !== 'string') {
      res.status(400).json({ success: false, message: 'Google credential (ID token) is required' });
      return;
    }

    const clientId =
      env.GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      '285337463761-2ag5qau6mv0ilqac6n8upplrdus4o6l4.apps.googleusercontent.com';
    if (!clientId) {
      res.status(500).json({
        success: false,
        message: 'Google Client ID is not configured on the server.',
      });
      return;
    }

    const client = new OAuth2Client(clientId);
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
    } catch (verifyErr: any) {
      console.error('[GOOGLE_ID_TOKEN_VERIFY_FAILED]', verifyErr.message);
      res.status(401).json({
        success: false,
        message: 'Invalid or expired Google credential token',
      });
      return;
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      res.status(401).json({
        success: false,
        message: 'Malformed Google ID token: missing user identifier or email',
      });
      return;
    }

    if (!payload.email_verified) {
      res.status(401).json({
        success: false,
        message: 'Google email address is not verified by Google',
      });
      return;
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const name = payload.name || payload.given_name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    // Look for existing user by googleId OR by email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId },
          { email },
        ],
      },
    });

    // SECURITY CHECK: Protect administrative accounts from automatic OAuth access
    if (user && (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN)) {
      res.status(403).json({
        success: false,
        message: 'Administrator accounts must sign in using password credentials',
      });
      return;
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          googleId,
          avatarUrl,
          password: 'GOOGLE_OAUTH_USER_NO_PASSWORD',
          role: Role.CUSTOMER,
          technoPoints: 0,
        },
      });
    } else {
      // Safe account linking: link googleId and update avatar if not yet present
      const updates: any = {};
      if (!user.googleId) {
        updates.googleId = googleId;
      }
      if (!user.avatarUrl && avatarUrl) {
        updates.avatarUrl = avatarUrl;
      }
      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates,
        });
      }
    }

    // Generate standard application JWT tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Save refresh session in database
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent: req.headers['user-agent'] || 'Google GIS Client',
        ipAddress: req.ip || '127.0.0.1',
      },
    });

    // Set HTTP-only secure cookies with matching parity
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

    const bonus = await ensureUserTestingBonus(user.id);

    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: {
        accessToken,
        refreshToken,
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
    console.error('[GOOGLE_AUTH_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Google authentication failed' });
  }
};

