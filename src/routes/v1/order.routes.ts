import { Router } from 'express';
import { createOrder, getMyOrders, getAllOrders, updateOrderStatus } from '../../controllers/order.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { updateOrderStatusSchema, createOrderSchema } from '../../schemas/order.schema.js';

const router = Router();

// Customer checkout (protected to prevent inventory exhaustion attacks)
router.post('/', requireAuth, validateRequest(createOrderSchema), createOrder);

// Customer endpoints
router.get('/my-orders', requireAuth, getMyOrders);

// Admin endpoints
router.get('/admin/all', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAllOrders);
router.patch('/admin/:id/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), validateRequest(updateOrderStatusSchema), updateOrderStatus);

export default router;
