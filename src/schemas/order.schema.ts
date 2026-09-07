import { z } from 'zod';
import { OrderStatus } from '@prisma/client';

export const updateOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'], {
    required_error: 'Status is required',
    invalid_type_error: 'Invalid order status',
  })
}).strict();

export const createOrderSchema = z.object({
  items: z.array(z.object({
    bookId: z.string().min(1, 'Book ID is required'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  })).min(1, 'Cart cannot be empty'),
  addressId: z.string().optional().nullable(),
  address: z.object({
    fullName: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    addressLine1: z.string().optional().nullable(),
    line1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    line2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    pincode: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
  }).passthrough().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  couponCode: z.string().optional().nullable(),
  shippingMethod: z.string().optional().nullable(),
  pointsUsed: z.number().int('Points must be an integer').min(0, 'Points used cannot be negative').optional().nullable(),
  walletUsed: z.number().min(0, 'Wallet cash used cannot be negative').finite('Wallet amount must be finite').optional().nullable(),
  pickupName: z.string().optional().nullable(),
  pickupPhone: z.string().optional().nullable(),
  pickupEmail: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
}).passthrough();
