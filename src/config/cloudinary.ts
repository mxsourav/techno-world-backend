import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const getCloudName = (): string =>
  process.env.CLOUDINARY_CLOUD_NAME || '';
const getApiKey = (): string =>
  process.env.CLOUDINARY_API_KEY || '';
const getApiSecret = (): string =>
  process.env.CLOUDINARY_API_SECRET || '';

export const isCloudinaryConfigured = (): boolean => {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  );
};

export const configureCloudinary = () => {
  if (isCloudinaryConfigured()) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    console.warn('[Cloudinary] Notice: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET not provided in environment variables.');
  }
};

configureCloudinary();

export { cloudinary };
