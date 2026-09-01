import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // India Post Integration Configuration
  INDIAPOST_BASE_URL: z.string().default('https://test.cept.gov.in'),
  INDIAPOST_CUSTOMER_ID: z.string().default('3000064781'),
  INDIAPOST_CONTRACT_ID: z.string().default('41585456'),
  INDIAPOST_USERNAME: z.string().default('9999999999'),
  INDIAPOST_PASSWORD: z.string().default('Dop@1234'),
  INDIAPOST_WEBHOOK_SECRET: z.string().optional(),
  INDIAPOST_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),
  INDIAPOST_USE_SANDBOX_FALLBACK: z.string().default('true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment variable validation failed:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
