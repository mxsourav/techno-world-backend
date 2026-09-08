import { Router } from 'express';
import { login, refresh, logout, devGoogleOAuthBypass, googleAuthCallback, googleAuth } from '../../controllers/auth.controller.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { loginSchema, devGoogleOAuthBypassSchema, googleAuthSchema } from '../../schemas/auth.schema.js';

const router = Router();

// Standard Password Login
router.post('/login', validateRequest(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Google Identity Services (GIS) Official Token Verification
router.post('/google', validateRequest(googleAuthSchema), googleAuth);

// Google OAuth Scaffolding & Developer Bypass
router.post('/google/dev-bypass', validateRequest(devGoogleOAuthBypassSchema), devGoogleOAuthBypass);
router.get('/google/callback', googleAuthCallback);

export default router;
