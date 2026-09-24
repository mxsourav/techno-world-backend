import { Router } from 'express';
import { login, refresh, logout, devGoogleOAuthBypass, googleAuthCallback, googleAuth, sendOtp, verifyOtp } from '../../controllers/auth.controller.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { authLimiter } from '../../middlewares/rateLimiter.js';
import { loginSchema, devGoogleOAuthBypassSchema, googleAuthSchema } from '../../schemas/auth.schema.js';

const router = Router();

// Standard Password Login with Brute-Force Protection
router.post('/login', authLimiter, validateRequest(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Mobile OTP Authentication (for Customers and Admins)
router.post('/otp/send', authLimiter, sendOtp);
router.post('/otp/verify', authLimiter, verifyOtp);

// Google Identity Services (GIS) Official Token Verification
router.post('/google', authLimiter, validateRequest(googleAuthSchema), googleAuth);

// Google OAuth Scaffolding & Developer Bypass
router.post('/google/dev-bypass', authLimiter, validateRequest(devGoogleOAuthBypassSchema), devGoogleOAuthBypass);
router.get('/google/callback', googleAuthCallback);

export default router;
