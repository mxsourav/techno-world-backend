import { Router } from 'express';
import * as shippingController from '../../controllers/shipping.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();
const requireAdmin = requireRole(['ADMIN', 'SUPER_ADMIN']);

// Public routes
router.get('/pincode/:pincode', shippingController.searchPincode);
router.post('/tariff', shippingController.calculateTariff);
router.get('/track/:identifier', shippingController.trackShipment);

// Admin-only fulfillment routes
router.post('/book/:orderId', requireAuth, requireAdmin, shippingController.bookOrderShipment);
router.get('/label/:orderId', requireAuth, requireAdmin, shippingController.getShippingLabel);

export default router;
