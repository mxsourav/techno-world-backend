import { z } from 'zod';

export const createBookSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  author: z.string().min(1, 'Author is required').max(255),
  description: z.string().max(2000).optional(),
  price: z.number().positive('Price must be greater than 0'),
  stock: z.number().int().nonnegative('Stock cannot be negative'),
  categoryId: z.string().uuid('Invalid category ID'),
  publishedDate: z.string().datetime().optional()
}).strict();

// partial() makes all fields optional for PATCH requests, but still enforces type rules if present
export const updateBookSchema = createBookSchema.partial().extend({
  id: z.string().uuid('Invalid book ID to update')
}).strict();
