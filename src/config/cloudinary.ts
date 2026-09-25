import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const getCloudName = (): string =>
  process.env.CLOUDINARY_CLOUD_NAME || 'tcsmyxe2';
const getApiKey = (): string =>
  process.env.CLOUDINARY_API_KEY || '369481197139156';
const getApiSecret = (): string =>
  process.env.CLOUDINARY_API_SECRET || 'TzFuSl3HKQVmCxZ-UkF-sdpOhpo';

export const isCloudinaryConfigured = (): boolean => {
  return Boolean(getCloudName() && getApiKey() && getApiSecret());
};

export const configureCloudinary = () => {
  if (isCloudinaryConfigured()) {
    cloudinary.config({
      cloud_name: getCloudName(),
      api_key: getApiKey(),
      api_secret: getApiSecret(),
      secure: true,
    });
  }
};

configureCloudinary();

export { cloudinary };

