import streamifier from 'node:stream';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary.js';

export interface CloudinaryUploadOptions {
  folder: string;
  publicId?: string;
  resourceType?: 'image' | 'video' | 'raw' | 'auto';
  overwrite?: boolean;
  tags?: string[];
}

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format?: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
}

export class CloudinaryService {
  /**
   * Uploads a file buffer directly to Cloudinary using upload_stream
   */
  public static async uploadBuffer(
    buffer: Buffer,
    options: CloudinaryUploadOptions
  ): Promise<CloudinaryUploadResult> {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary is not configured. Please define CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: options.publicId,
          resource_type: options.resourceType || 'auto',
          overwrite: options.overwrite ?? true,
          tags: options.tags,
        },
        (error, result) => {
          if (error || !result) {
            return reject(error || new Error('Upload to Cloudinary failed with empty result.'));
          }
          resolve({
            publicId: result.public_id,
            secureUrl: result.secure_url,
            resourceType: result.resource_type,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
            duration: result.duration,
          });
        }
      );

      const readableStream = new streamifier.Readable();
      readableStream._read = () => {};
      readableStream.push(buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  /**
   * Deletes an asset by public ID from Cloudinary
   */
  public static async deleteAsset(
    publicId: string,
    resourceType: 'image' | 'video' | 'raw' = 'image'
  ): Promise<{ result: string }> {
    if (!isCloudinaryConfigured()) {
      console.warn(`[Cloudinary] Cannot delete asset ${publicId}: Cloudinary not configured.`);
      return { result: 'not_configured' };
    }

    try {
      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      return res;
    } catch (err: any) {
      console.error(`[Cloudinary] Error deleting asset ${publicId}:`, err?.message || err);
      throw err;
    }
  }

  /**
   * Deletes a folder in Cloudinary. The folder must be empty first.
   */
  public static async deleteFolder(folderPath: string): Promise<boolean> {
    if (!isCloudinaryConfigured()) {
      return false;
    }

    try {
      await cloudinary.api.delete_folder(folderPath);
      return true;
    } catch (err: any) {
      // Cloudinary will return error if folder does not exist or is not empty
      console.warn(`[Cloudinary] Folder deletion skipped for '${folderPath}':`, err?.message || err);
      return false;
    }
  }

  /**
   * Generates a transformed/optimized CDN delivery URL
   */
  public static getOptimizedUrl(
    publicId: string,
    options: {
      width?: number;
      height?: number;
      crop?: string;
      quality?: string | number;
      format?: string;
    } = {}
  ): string {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) {
      return `https://res.cloudinary.com/placeholder/image/upload/${publicId}`;
    }

    return cloudinary.url(publicId, {
      secure: true,
      fetch_format: options.format || 'auto',
      quality: options.quality || 'auto',
      width: options.width,
      height: options.height,
      crop: options.crop || (options.width && options.height ? 'fill' : undefined),
    });
  }

  /**
   * Path resolution helpers matching requirements:
   * Home/books/{slug}/images/
   * Home/books/{slug}/documents/
   */
  public static getBookImagesFolder(slug: string): string {
    const cleanSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    return `Home/books/${cleanSlug}/images`;
  }

  public static getBookDocsFolder(slug: string): string {
    const cleanSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    return `Home/books/${cleanSlug}/documents`;
  }

  public static getBookRootFolder(slug: string): string {
    const cleanSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    return `Home/books/${cleanSlug}`;
  }

  /**
   * Site media category folders matching requirements:
   * Home/site/banners
   * Home/site/promotional
   * Home/site/fixed
   * Home/site/videos
   */
  public static getSiteMediaFolder(type: 'BANNER' | 'PROMOTIONAL' | 'FIXED' | 'VIDEO'): string {
    switch (type) {
      case 'BANNER':
        return 'Home/site/banners';
      case 'PROMOTIONAL':
        return 'Home/site/promotional';
      case 'FIXED':
        return 'Home/site/fixed';
      case 'VIDEO':
        return 'Home/site/videos';
      default:
        return 'Home/site/fixed';
    }
  }
}
