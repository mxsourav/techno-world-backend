import { Router } from 'express';
import { calculatePricing } from '../../controllers/pricing.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting to prevent brute-forcing coupon codes and pricing endpoint
const pricingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many pricing requests, please try again later.' }
});

router.post('/calculate', optionalAuth, calculatePricing);

export default router;
