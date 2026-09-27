import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  getWishlist,
  syncWishlist,
  toggleWishlistItem,
  removeWishlistItem,
} from '../../controllers/wishlist.controller.js';

const router = Router();

// All wishlist database sync operations require authentication
router.use(requireAuth);

router.get('/', getWishlist);
router.post('/sync', syncWishlist);
router.post('/toggle', toggleWishlistItem);
router.delete('/:bookId', removeWishlistItem);

export default router;
