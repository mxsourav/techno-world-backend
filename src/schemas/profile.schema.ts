import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit mobile number').optional().nullable(),
  avatarUrl: z.string().url('Invalid avatar URL').optional().nullable(),
}).strict();

export const createAddressSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(80),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit mobile number'),
  addressLine1: z.string().trim().min(5, 'Address line is required').max(120),
  addressLine2: z.string().trim().max(120).optional().nullable(),
  postOffice: z.string().trim().max(100).optional().nullable().default(''),
  landmark: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2, 'City is required').max(60),
  state: z.string().trim().min(2, 'State is required').max(60),
  pincode: z.string().trim().regex(/^[1-8]\d{5}$/, 'Invalid 6-digit Indian PIN code'),
  type: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),
  isDefault: z.boolean().optional().default(false),
});

export const updateAddressSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/).optional(),
  addressLine1: z.string().trim().min(5).max(120).optional(),
  addressLine2: z.string().trim().max(120).optional().nullable(),
  postOffice: z.string().trim().max(100).optional().nullable().default(''),
  landmark: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2).max(60).optional(),
  state: z.string().trim().min(2).max(60).optional(),
  pincode: z.string().trim().regex(/^[1-8]\d{5}$/).optional(),
  type: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
  isDefault: z.boolean().optional(),
});

export const savePaymentMethodSchema = z.object({
  type: z.enum(['UPI', 'CARD', 'NETBANKING']),
  provider: z.string().trim().min(2).max(50).optional(),
  maskedData: z.string().trim().min(2).max(100),
  holderName: z.string().trim().max(80).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
}).strict();
