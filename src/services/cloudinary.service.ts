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
      let cleanPublicId = publicId.trim();
      if (cleanPublicId.startsWith('http://') || cleanPublicId.startsWith('https://')) {
        const extracted = this.extractPublicIdFromUrl(cleanPublicId);
        if (extracted) {
          cleanPublicId = extracted.publicId;
          resourceType = extracted.resourceType;
        }
      }

      // For image/video, Cloudinary public_id must not include file extension
      if (resourceType !== 'raw') {
        cleanPublicId = cleanPublicId.replace(/\.(jpe?g|png|webp|gif|svg|avif|mp4|mov)$/i, '');
      }

      const res = await cloudinary.uploader.destroy(cleanPublicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      return res;
    } catch (err: any) {
      console.error(`[Cloudinary] Error deleting asset ${publicId}:`, err?.message || err);
      return { result: 'error' };
    }
  }

  /**
   * Extracts publicId and resourceType from any Cloudinary URL
   */
  public static extractPublicIdFromUrl(url: string): { publicId: string; resourceType: 'image' | 'raw' | 'video' } | null {
    if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const uploadIndex = parts.indexOf('upload');
      if (uploadIndex === -1 || uploadIndex >= parts.length - 1) return null;

      const resourceType: 'image' | 'raw' | 'video' =
        parts[uploadIndex - 1] === 'raw' ? 'raw' :
        parts[uploadIndex - 1] === 'video' ? 'video' : 'image';

      let rest = parts.slice(uploadIndex + 1);
      if (rest[0] && /^v\d+$/.test(rest[0])) {
        rest = rest.slice(1);
      }
      const fullPath = decodeURIComponent(rest.join('/'));
      if (resourceType === 'raw') {
        return { publicId: fullPath, resourceType };
      } else {
        const lastDot = fullPath.lastIndexOf('.');
        const publicId = lastDot > 0 ? fullPath.substring(0, lastDot) : fullPath;
        return { publicId, resourceType };
      }
    } catch {
      return null;
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
   * Thoroughly deletes all assets under a folder prefix and then removes the folders
   */
  public static async deleteFolderRecursively(folderPath: string): Promise<boolean> {
    if (!isCloudinaryConfigured()) return false;
    try {
      const cleanPath = folderPath.replace(/^\/+|\/+$/g, '');
      // 1. Delete all image assets under prefix
      try {
        await cloudinary.api.delete_resources_by_prefix(cleanPath, { resource_type: 'image' });
      } catch {}
      // 2. Delete all raw files (e.g. PDFs)
      try {
        await cloudinary.api.delete_resources_by_prefix(cleanPath, { resource_type: 'raw' });
      } catch {}
      // 3. Delete all video files
      try {
        await cloudinary.api.delete_resources_by_prefix(cleanPath, { resource_type: 'video' });
      } catch {}

      // 4. Try deleting subfolders
      try {
        await cloudinary.api.delete_folder(`${cleanPath}/images`);
      } catch {}
      try {
        await cloudinary.api.delete_folder(`${cleanPath}/documents`);
      } catch {}

      // 5. Delete root folder
      try {
        await cloudinary.api.delete_folder(cleanPath);
      } catch {}

      return true;
    } catch (err: any) {
      console.warn(`[Cloudinary] deleteFolderRecursively warning for '${folderPath}':`, err?.message || err);
      return false;
    }
  }

  /**
   * Completely cleans up all Cloudinary assets, folders, and URLs associated with a book
   */
  public static async deleteBookMedia(book: {
    slug: string;
    coverPublicId?: string | null;
    coverUrl?: string | null;
    previewPdfPublicId?: string | null;
    previewPdfUrl?: string | null;
    previewPdfResourceType?: string | null;
    galleryUrls?: string | null;
    images?: Array<{ publicId?: string | null; resourceType?: string | null }>;
  }): Promise<void> {
    if (!isCloudinaryConfigured() || !book) return;

    const cleanSlug = (book.slug || '').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();

    // 1. Delete by prefix (catches all assets under Home/books/{slug} and books/{slug})
    if (cleanSlug) {
      await this.deleteFolderRecursively(`Home/books/${cleanSlug}`);
      await this.deleteFolderRecursively(`books/${cleanSlug}`);
    }

    // 2. Delete explicit public IDs from BookImage records
    if (book.images && Array.isArray(book.images)) {
      for (const img of book.images) {
        if (img?.publicId) {
          try {
            await this.deleteAsset(img.publicId, (img.resourceType as any) || 'image');
          } catch {}
        }
      }
    }

    // 3. Delete cover public ID
    if (book.coverPublicId) {
      try {
        await this.deleteAsset(book.coverPublicId, 'image');
      } catch {}
    }

    // 4. Delete preview PDF public ID
    if (book.previewPdfPublicId) {
      try {
        await this.deleteAsset(book.previewPdfPublicId, (book.previewPdfResourceType as any) || 'raw');
      } catch {}
    }

    // 5. Extract and delete any Cloudinary URLs that might not have matching public IDs stored
    const urlsToCheck: string[] = [];
    if (book.coverUrl) urlsToCheck.push(book.coverUrl);
    if (book.previewPdfUrl) urlsToCheck.push(book.previewPdfUrl);
    if (book.galleryUrls) {
      try {
        const parsed = typeof book.galleryUrls === 'string' ? JSON.parse(book.galleryUrls) : book.galleryUrls;
        if (Array.isArray(parsed)) {
          for (const u of parsed) {
            if (typeof u === 'string') urlsToCheck.push(u);
          }
        }
      } catch {}
    }

    for (const url of urlsToCheck) {
      const extracted = this.extractPublicIdFromUrl(url);
      if (extracted) {
        try {
          await this.deleteAsset(extracted.publicId, extracted.resourceType);
        } catch {}
      }
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
