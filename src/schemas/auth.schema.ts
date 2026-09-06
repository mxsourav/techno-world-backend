import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(3, 'Username or email is required').max(255),
  password: z.string().min(1, 'Password is required')
}).strict(); // .strict() drops any extra fields sent by the client

export const registerSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50)
  // Notice we deliberately exclude 'role' so users cannot make themselves admins
}).strict();

export const devGoogleOAuthBypassSchema = z.object({
  email: z.string().email('Valid email address is required').max(255),
  name: z.string().min(1).max(100).optional(),
  googleId: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url('Invalid avatar URL').optional().nullable(),
}).strict();
