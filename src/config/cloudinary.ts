import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

const getCloudName = (): string =>
  process.env.CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME || '';
const getApiKey = (): string =>
  process.env.CLOUDINARY_API_KEY || env.CLOUDINARY_API_KEY || '';
const getApiSecret = (): string =>
  process.env.CLOUDINARY_API_SECRET || env.CLOUDINARY_API_SECRET || '';

export const isCloudinaryConfigured = (): boolean => {
  return Boolean(
    getCloudName() &&
    getApiKey() &&
    getApiSecret()
  );
};

export const configureCloudinary = () => {
  if (isCloudinaryConfigured()) {
    cloudinary.config({
      cloud_name: getCloudName(),
      api_key: getApiKey(),
      api_secret: getApiSecret(),
      secure: true,
    });
  } else {
    console.warn('[Cloudinary] Notice: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET not provided in environment variables.');
  }
};

configureCloudinary();

export { cloudinary };
