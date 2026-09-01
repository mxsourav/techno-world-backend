import { Router } from 'express';
import { login, refresh, logout, devGoogleOAuthBypass, googleAuthCallback } from '../../controllers/auth.controller.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { loginSchema } from '../../schemas/auth.schema.js';

const router = Router();

// Standard Password Login
router.post('/login', validateRequest(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Google OAuth Scaffolding & Developer Bypass
// TODO: [OAUTH_REAL_KEYS_INJECTED] Remove dev-bypass route once live Google OAuth keys are provided
router.post('/google/dev-bypass', devGoogleOAuthBypass);
router.get('/google/callback', googleAuthCallback);

export default router;
