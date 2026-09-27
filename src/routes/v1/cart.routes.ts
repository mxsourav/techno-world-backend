import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  getCart,
  syncCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} from '../../controllers/cart.controller.js';

const router = Router();

// All cart database sync operations require authentication
router.use(requireAuth);

router.get('/', getCart);
router.post('/sync', syncCart);
router.post('/', updateCartItem);
router.delete('/:bookId', removeCartItem);
router.delete('/', clearCart);

export default router;
