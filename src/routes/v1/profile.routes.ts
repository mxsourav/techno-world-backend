import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  getSavedPaymentMethods,
  savePaymentMethod,
  deletePaymentMethod,
  getPointTransactions,
} from '../../controllers/profile.controller.js';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { validateRequest } from '../../middlewares/validate.middleware.js';
import {
  updateProfileSchema,
  createAddressSchema,
  updateAddressSchema,
  savePaymentMethodSchema,
} from '../../schemas/profile.schema.js';

const router = Router();

// All profile routes are strictly protected with JWT authentication
router.use(requireAuth);

router.get('/', getProfile);
router.patch('/', validateRequest(updateProfileSchema), updateProfile);

// Address Management & Deduplication
router.get('/address', getAddresses);
router.post('/address', validateRequest(createAddressSchema), createAddress);
router.patch('/address/:id', validateRequest(updateAddressSchema), updateAddress);
router.delete('/address/:id', deleteAddress);

// Payment Preferences (Dormant)
router.get('/payment-methods', getSavedPaymentMethods);
router.post('/payment-methods', validateRequest(savePaymentMethodSchema), savePaymentMethod);
router.delete('/payment-methods/:id', deletePaymentMethod);

// Techno Points Loyalty
router.get('/points', getPointTransactions);

export default router;
