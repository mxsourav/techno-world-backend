import { Router } from 'express';
import { login, refresh, logout } from '../../controllers/auth.controller.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { loginSchema } from '../../schemas/auth.schema.js';

const router = Router();

// Payload is strictly validated BEFORE the controller executes
router.post('/login', validateRequest(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
