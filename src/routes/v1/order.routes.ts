import { Router } from 'express';
import {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderNotifications,
  sendOrderCustomEmail,
  batchUpdateOrderStatus,
  batchSendOrderEmail,
  updateBookDimensions,
  setPickupSlots,
  confirmPickupSlot,
  markOrderCollected,
} from '../../controllers/order.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import { createOrderSchema } from '../../schemas/order.schema.js';

const router = Router();

// Customer checkout
router.post('/', requireAuth, validateRequest(createOrderSchema), createOrder);

// Customer endpoints
router.get('/my-orders', requireAuth, getMyOrders);
router.post('/:id/confirm-pickup-slot', requireAuth, confirmPickupSlot);

// Admin endpoints
router.get('/admin/all', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAllOrders);
router.get('/admin/notifications', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getOrderNotifications);
router.patch('/admin/batch-status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), batchUpdateOrderStatus);
router.post('/admin/batch-email', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), batchSendOrderEmail);
router.patch('/admin/book/:id/dimensions', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateBookDimensions);
router.patch('/admin/:id/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateOrderStatus);
router.put('/admin/:id/status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateOrderStatus);
router.post('/admin/:id/email', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), sendOrderCustomEmail);
router.post('/admin/:id/pickup-slots', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), setPickupSlots);
router.post('/admin/:id/mark-collected', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), markOrderCollected);
router.post('/:id/pickup-slots', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), setPickupSlots);
router.post('/:id/mark-collected', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), markOrderCollected);

export default router;
