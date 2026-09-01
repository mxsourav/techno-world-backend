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
    fullName: z.string().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    addressLine1: z.string().optional(),
    line1: z.string().optional(),
    addressLine2: z.string().optional().nullable(),
    line2: z.string().optional().nullable(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
  }).optional().nullable(),
  paymentMethod: z.string().optional(),
  couponCode: z.string().optional(),
});
