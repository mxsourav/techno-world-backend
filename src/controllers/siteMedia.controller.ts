import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { CloudinaryService } from '../services/cloudinary.service.js';
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary.js';
import { SiteMediaType } from '@prisma/client';

/**
 * GET /api/v1/admin/site-media
 * Aggregates all media assets across the platform stored in Cloudinary:
 * - Books covers, gallery images, sample/preview PDFs
 * - Promotional banners and site banners
 * - Fixed brand assets, hero 3D models, category banners
 * - Direct live Cloudinary assets with real-time metadata
 */
export const listSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type, search, isActive } = req.query;

    // 1. Fetch site media records
    const siteMediaWhere: any = {};
    if (isActive !== undefined) {
      siteMediaWhere.isActive = isActive === 'true';
    }
    const siteMediaList = await prisma.siteMedia.findMany({
      where: siteMediaWhere,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    // 2. Fetch Books with media
    const books = await prisma.book.findMany({
      where: {
        isDeleted: false,
        OR: [
          { coverUrl: { not: null } },
          { previewPdfUrl: { not: null } },
          { galleryUrls: { not: '[]' } },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        coverUrl: true,
        coverPublicId: true,
        previewPdfUrl: true,
        previewPdfPublicId: true,
        galleryUrls: true,
        createdAt: true,
        updatedAt: true,
        visibility: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Fetch BookImage records
    const bookImages = await prisma.bookImage.findMany({
      include: {
        book: {
          select: { id: true, title: true, slug: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 4. Fetch HeroConfig
    const heroConfig = await prisma.heroConfig.findFirst({
      where: { hero_book_cover_url: { not: null } },
    });

    // 5. Fetch Categories with images
    const categories = await prisma.category.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, name: true, slug: true, imageUrl: true, createdAt: true, updatedAt: true, isActive: true },
    });

    // 6. Query Cloudinary Admin API for live assets & metadata if configured
    let cldResources: any[] = [];
    if (isCloudinaryConfigured()) {
      try {
        const [imagesRes, rawRes] = await Promise.all([
          cloudinary.api.resources({ type: 'upload', resource_type: 'image', max_results: 300, direction: 'desc' }).catch(() => null),
          cloudinary.api.resources({ type: 'upload', resource_type: 'raw', max_results: 150, direction: 'desc' }).catch(() => null),
        ]);
        if (imagesRes && Array.isArray(imagesRes.resources)) cldResources.push(...imagesRes.resources);
        if (rawRes && Array.isArray(rawRes.resources)) cldResources.push(...rawRes.resources);
      } catch (err) {
        // Fall back to database records gracefully
      }
    }

    const cldLookup = new Map<string, any>();
    for (const r of cldResources) {
      if (r.public_id) cldLookup.set(r.public_id, r);
      if (r.secure_url) cldLookup.set(r.secure_url, r);
    }

    const aggregated: any[] = [];
    const seenUrls = new Set<string>();

    // A. Add SiteMedia records
    for (const m of siteMediaList) {
      if (m.secureUrl) seenUrls.add(m.secureUrl);
      const cld = (m.publicId && cldLookup.get(m.publicId)) || (m.secureUrl && cldLookup.get(m.secureUrl));
      aggregated.push({
        id: m.id,
        type: m.type,
        role: m.type === 'BANNER' ? 'Site Banner' : m.type === 'PROMOTIONAL' ? 'Promotional Banner' : m.type === 'VIDEO' ? 'Promotional Video' : 'Fixed Brand Asset',
        name: m.name,
        publicId: m.publicId,
        secureUrl: m.secureUrl,
        resourceType: m.resourceType,
        format: m.format || cld?.format || null,
        width: m.width || cld?.width || null,
        height: m.height || cld?.height || null,
        bytes: m.bytes || cld?.bytes || null,
        duration: m.duration || cld?.duration || null,
        isActive: m.isActive,
        sortOrder: m.sortOrder,
        altText: m.altText,
        targetUrl: m.targetUrl,
        parentTitle: null,
        parentId: null,
        parentSlug: null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      });
    }

    // B. Add Book Covers
    for (const book of books) {
      if (book.coverUrl && !seenUrls.has(book.coverUrl)) {
        seenUrls.add(book.coverUrl);
        const cld = (book.coverPublicId && cldLookup.get(book.coverPublicId)) || cldLookup.get(book.coverUrl);
        aggregated.push({
          id: `book-cover-${book.id}`,
          type: 'BOOK_COVER',
          role: 'Book Cover',
          name: `Cover - ${book.title}`,
          publicId: book.coverPublicId || CloudinaryService.extractPublicIdFromUrl(book.coverUrl)?.publicId || '',
          secureUrl: book.coverUrl,
          resourceType: 'image',
          format: cld?.format || 'jpg',
          width: cld?.width || null,
          height: cld?.height || null,
          bytes: cld?.bytes || null,
          duration: null,
          isActive: book.visibility,
          sortOrder: 0,
          altText: `Cover of ${book.title}`,
          targetUrl: `/book/${book.slug}`,
          parentTitle: book.title,
          parentId: book.id,
          parentSlug: book.slug,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
        });
      }

      // C. Add Book Preview / Look-Inside PDFs
      if (book.previewPdfUrl && !seenUrls.has(book.previewPdfUrl)) {
        seenUrls.add(book.previewPdfUrl);
        const cld = (book.previewPdfPublicId && cldLookup.get(book.previewPdfPublicId)) || cldLookup.get(book.previewPdfUrl);
        aggregated.push({
          id: `book-pdf-${book.id}`,
          type: 'PDF',
          role: 'Sample / Look Inside PDF',
          name: `Sample PDF - ${book.title}`,
          publicId: book.previewPdfPublicId || CloudinaryService.extractPublicIdFromUrl(book.previewPdfUrl)?.publicId || '',
          secureUrl: book.previewPdfUrl,
          resourceType: 'raw',
          format: 'pdf',
          width: null,
          height: null,
          bytes: cld?.bytes || null,
          duration: null,
          isActive: book.visibility,
          sortOrder: 0,
          altText: `Preview PDF for ${book.title}`,
          targetUrl: `/book/${book.slug}`,
          parentTitle: book.title,
          parentId: book.id,
          parentSlug: book.slug,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
        });
      }

      // D. Add gallery URLs if present
      if (book.galleryUrls) {
        try {
          const parsed = typeof book.galleryUrls === 'string' ? JSON.parse(book.galleryUrls) : book.galleryUrls;
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string, idx: number) => {
              if (url && typeof url === 'string' && !seenUrls.has(url)) {
                seenUrls.add(url);
                const cld = cldLookup.get(url);
                aggregated.push({
                  id: `book-gallery-${book.id}-${idx}`,
                  type: 'BOOK_GALLERY',
                  role: 'Book Gallery Image',
                  name: `Gallery Image ${idx + 1} - ${book.title}`,
                  publicId: CloudinaryService.extractPublicIdFromUrl(url)?.publicId || '',
                  secureUrl: url,
                  resourceType: 'image',
                  format: cld?.format || 'jpg',
                  width: cld?.width || null,
                  height: cld?.height || null,
                  bytes: cld?.bytes || null,
                  duration: null,
                  isActive: book.visibility,
                  sortOrder: idx,
                  altText: `Gallery image for ${book.title}`,
                  targetUrl: `/book/${book.slug}`,
                  parentTitle: book.title,
                  parentId: book.id,
                  parentSlug: book.slug,
                  createdAt: book.createdAt,
                  updatedAt: book.updatedAt,
                });
              }
            });
          }
        } catch {}
      }
    }

    // E. Add BookImage records
    for (const img of bookImages) {
      if (img.secureUrl && !seenUrls.has(img.secureUrl)) {
        seenUrls.add(img.secureUrl);
        const cld = (img.publicId && cldLookup.get(img.publicId)) || cldLookup.get(img.secureUrl);
        aggregated.push({
          id: `book-img-${img.id}`,
          type: img.isCover ? 'BOOK_COVER' : 'BOOK_GALLERY',
          role: img.isCover ? 'Book Cover' : 'Book Gallery Image',
          name: `${img.isCover ? 'Cover' : 'Gallery'} - ${img.book?.title || 'Book'}`,
          publicId: img.publicId,
          secureUrl: img.secureUrl,
          resourceType: img.resourceType || 'image',
          format: img.format || cld?.format || 'jpg',
          width: img.width || cld?.width || null,
          height: img.height || cld?.height || null,
          bytes: img.bytes || cld?.bytes || null,
          duration: null,
          isActive: true,
          sortOrder: img.sortOrder,
          altText: img.altText || null,
          targetUrl: img.book ? `/book/${img.book.slug}` : null,
          parentTitle: img.book?.title || null,
          parentId: img.book?.id || null,
          parentSlug: img.book?.slug || null,
          createdAt: img.createdAt,
          updatedAt: img.updatedAt,
        });
      }
    }

    // F. Add HeroConfig
    if (heroConfig?.hero_book_cover_url && !seenUrls.has(heroConfig.hero_book_cover_url)) {
      seenUrls.add(heroConfig.hero_book_cover_url);
      const cld = cldLookup.get(heroConfig.hero_book_cover_url);
      aggregated.push({
        id: 'hero-3d-cover',
        type: 'FIXED',
        role: 'Hero 3D Book Cover',
        name: 'Hero 3D Showcase Cover',
        publicId: CloudinaryService.extractPublicIdFromUrl(heroConfig.hero_book_cover_url)?.publicId || '',
        secureUrl: heroConfig.hero_book_cover_url,
        resourceType: 'image',
        format: cld?.format || 'png',
        width: cld?.width || null,
        height: cld?.height || null,
        bytes: cld?.bytes || null,
        duration: null,
        isActive: true,
        sortOrder: 0,
        altText: 'Hero 3D Book Cover',
        targetUrl: '/',
        parentTitle: 'Hero Section',
        parentId: null,
        parentSlug: null,
        createdAt: heroConfig.hero_book_cover_updated_at || heroConfig.createdAt,
        updatedAt: heroConfig.updatedAt,
      });
    }

    // G. Add Category Images
    for (const cat of categories) {
      if (cat.imageUrl && !seenUrls.has(cat.imageUrl)) {
        seenUrls.add(cat.imageUrl);
        const cld = cldLookup.get(cat.imageUrl);
        aggregated.push({
          id: `cat-img-${cat.id}`,
          type: 'FIXED',
          role: 'Category Banner',
          name: `Category - ${cat.name}`,
          publicId: CloudinaryService.extractPublicIdFromUrl(cat.imageUrl)?.publicId || '',
          secureUrl: cat.imageUrl,
          resourceType: 'image',
          format: cld?.format || 'jpg',
          width: cld?.width || null,
          height: cld?.height || null,
          bytes: cld?.bytes || null,
          duration: null,
          isActive: cat.isActive,
          sortOrder: 0,
          altText: `Category ${cat.name}`,
          targetUrl: `/category/${cat.slug}`,
          parentTitle: cat.name,
          parentId: cat.id,
          parentSlug: cat.slug,
          createdAt: cat.createdAt,
          updatedAt: cat.updatedAt,
        });
      }
    }

    // H. Add any remaining live Cloudinary resources not already mapped to database
    for (const r of cldResources) {
      if (r.secure_url && !seenUrls.has(r.secure_url)) {
        seenUrls.add(r.secure_url);
        const isPdf = r.format === 'pdf' || r.resource_type === 'raw';
        const isVideo = r.resource_type === 'video';
        const folder = r.public_id || '';
        let detectedType = 'FIXED';
        let detectedRole = 'Cloudinary Asset';

        if (isPdf) {
          detectedType = 'PDF';
          detectedRole = 'Cloudinary Document (PDF)';
        } else if (isVideo) {
          detectedType = 'VIDEO';
          detectedRole = 'Cloudinary Video';
        } else if (folder.includes('/banners') || folder.includes('banner')) {
          detectedType = 'BANNER';
          detectedRole = 'Cloudinary Banner';
        } else if (folder.includes('/promotional') || folder.includes('promo')) {
          detectedType = 'PROMOTIONAL';
          detectedRole = 'Cloudinary Promo Graphic';
        } else if (folder.includes('/books/') || folder.includes('books')) {
          detectedType = folder.includes('/images') ? 'BOOK_GALLERY' : 'BOOK_COVER';
          detectedRole = folder.includes('/images') ? 'Cloudinary Book Gallery' : 'Cloudinary Book Cover';
        }

        const fileName = (r.public_id.split('/').pop() || 'asset').replace(/_/g, ' ');

        aggregated.push({
          id: `cld-${r.public_id}`,
          type: detectedType,
          role: detectedRole,
          name: fileName,
          publicId: r.public_id,
          secureUrl: r.secure_url,
          resourceType: r.resource_type || (isPdf ? 'raw' : isVideo ? 'video' : 'image'),
          format: r.format || (isPdf ? 'pdf' : 'jpg'),
          width: r.width || null,
          height: r.height || null,
          bytes: r.bytes || null,
          duration: r.duration || null,
          isActive: true,
          sortOrder: 0,
          altText: fileName,
          targetUrl: null,
          parentTitle: null,
          parentId: null,
          parentSlug: null,
          createdAt: new Date(r.created_at || Date.now()),
          updatedAt: new Date(r.created_at || Date.now()),
        });
      }
    }

    // Filter by type if provided and not ALL
    let filtered = aggregated;
    if (type && type !== 'ALL') {
      filtered = filtered.filter((item) => item.type === type);
    }

    // Filter by search keyword
    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.role && item.role.toLowerCase().includes(q)) ||
          (item.parentTitle && item.parentTitle.toLowerCase().includes(q)) ||
          (item.format && item.format.toLowerCase().includes(q)) ||
          (item.publicId && item.publicId.toLowerCase().includes(q)) ||
          (item.secureUrl && item.secureUrl.toLowerCase().includes(q))
      );
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.status(200).json({ success: true, data: filtered });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/site-media
 * Uploads a site media asset to the correct category folder in Cloudinary
 * - BANNER -> Home/site/banners
 * - PROMOTIONAL -> Home/site/promotional
 * - FIXED -> Home/site/fixed
 * - VIDEO -> Home/site/videos
 */
export const uploadSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, message: 'No media file uploaded' });
      return;
    }

    const { type = 'BANNER', name, altText, targetUrl, sortOrder } = req.body;

    const validTypes = Object.values(SiteMediaType);
    const mediaType: SiteMediaType = validTypes.includes(type as SiteMediaType)
      ? (type as SiteMediaType)
      : SiteMediaType.BANNER;

    const folder = CloudinaryService.getSiteMediaFolder(mediaType);
    const isVideo = mediaType === SiteMediaType.VIDEO || file.mimetype.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';

    const safeBaseName = (name || file.originalname.split('.')[0] || 'asset')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .slice(0, 40);
    const publicId = `${safeBaseName}_${Date.now()}`;

    const uploadResult = await CloudinaryService.uploadBuffer(file.buffer, {
      folder,
      publicId,
      resourceType,
    });

    const newMedia = await prisma.siteMedia.create({
      data: {
        type: mediaType,
        name: name?.trim() || file.originalname,
        publicId: uploadResult.publicId,
        secureUrl: uploadResult.secureUrl,
        resourceType: uploadResult.resourceType || resourceType,
        format: uploadResult.format,
        width: uploadResult.width,
        height: uploadResult.height,
        bytes: uploadResult.bytes,
        duration: uploadResult.duration,
        altText: altText?.trim() || null,
        targetUrl: targetUrl?.trim() || null,
        sortOrder: sortOrder ? parseInt(sortOrder, 10) : 0,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Site media uploaded successfully',
      data: newMedia,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/admin/site-media/:id/replace
 * Replaces the file of an existing site media asset while preserving its ID and settings
 */
export const replaceSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ success: false, message: 'No replacement file uploaded' });
      return;
    }

    const existingMedia = await prisma.siteMedia.findUnique({ where: { id } });
    if (!existingMedia) {
      res.status(404).json({ success: false, message: 'Site media not found' });
      return;
    }

    const folder = CloudinaryService.getSiteMediaFolder(existingMedia.type);
    const isVideo = existingMedia.type === SiteMediaType.VIDEO || file.mimetype.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';

    const safeBaseName = (existingMedia.name || 'asset')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .slice(0, 40);
    const publicId = `${safeBaseName}_${Date.now()}`;

    const uploadResult = await CloudinaryService.uploadBuffer(file.buffer, {
      folder,
      publicId,
      resourceType,
    });

    // Delete old asset from Cloudinary
    try {
      await CloudinaryService.deleteAsset(
        existingMedia.publicId,
        (existingMedia.resourceType as any) || 'image'
      );
    } catch (err) {
      console.warn(`[SiteMedia] Failed to delete replaced asset ${existingMedia.publicId}:`, err);
    }

    // Update database record
    const updatedMedia = await prisma.siteMedia.update({
      where: { id },
      data: {
        publicId: uploadResult.publicId,
        secureUrl: uploadResult.secureUrl,
        resourceType: uploadResult.resourceType || resourceType,
        format: uploadResult.format,
        width: uploadResult.width,
        height: uploadResult.height,
        bytes: uploadResult.bytes,
        duration: uploadResult.duration,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Site media replaced successfully',
      data: updatedMedia,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/site-media/:id
 * Updates metadata (name, altText, targetUrl, sortOrder, isActive)
 */
export const updateSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, altText, targetUrl, sortOrder, isActive, type } = req.body;

    const existing = await prisma.siteMedia.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Site media not found' });
      return;
    }

    const data: any = {};
    if (name !== undefined) data.name = name.trim();
    if (altText !== undefined) data.altText = altText ? altText.trim() : null;
    if (targetUrl !== undefined) data.targetUrl = targetUrl ? targetUrl.trim() : null;
    if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder, 10) || 0;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (type && Object.values(SiteMediaType).includes(type)) data.type = type;

    const updated = await prisma.siteMedia.update({
      where: { id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Site media updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/site-media/:id
 * Removes site media from Cloudinary and deletes database record
 */
export const deleteSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (id.startsWith('book-img-')) {
      const imgId = id.replace('book-img-', '');
      const img = await prisma.bookImage.findUnique({ where: { id: imgId } });
      if (img) {
        if (img.publicId) {
          try {
            await CloudinaryService.deleteAsset(img.publicId, (img.resourceType as any) || 'image');
          } catch {}
        }
        await prisma.bookImage.delete({ where: { id: imgId } });
        res.status(200).json({ success: true, message: 'Book gallery image deleted successfully' });
        return;
      }
    }

    if (id.startsWith('book-pdf-')) {
      const bookId = id.replace('book-pdf-', '');
      const book = await prisma.book.findUnique({ where: { id: bookId } });
      if (book) {
        if (book.previewPdfPublicId) {
          try {
            await CloudinaryService.deleteAsset(book.previewPdfPublicId, 'raw');
          } catch {}
        }
        await prisma.book.update({
          where: { id: bookId },
          data: { previewPdfUrl: null, previewPdfPublicId: null },
        });
        res.status(200).json({ success: true, message: 'Book sample PDF deleted successfully' });
        return;
      }
    }

    if (id.startsWith('book-cover-')) {
      const bookId = id.replace('book-cover-', '');
      const book = await prisma.book.findUnique({ where: { id: bookId } });
      if (book) {
        if (book.coverPublicId) {
          try {
            await CloudinaryService.deleteAsset(book.coverPublicId, 'image');
          } catch {}
        }
        await prisma.book.update({
          where: { id: bookId },
          data: { coverUrl: null, coverPublicId: null },
        });
        res.status(200).json({ success: true, message: 'Book cover deleted successfully' });
        return;
      }
    }

    if (id.startsWith('cld-')) {
      const publicId = id.replace('cld-', '');
      try {
        await CloudinaryService.deleteAsset(publicId, 'image');
      } catch {}
      res.status(200).json({ success: true, message: 'Cloudinary asset deleted successfully' });
      return;
    }

    const media = await prisma.siteMedia.findUnique({ where: { id } });
    if (!media) {
      res.status(404).json({ success: false, message: 'Site media not found' });
      return;
    }

    try {
      await CloudinaryService.deleteAsset(
        media.publicId,
        (media.resourceType as any) || 'image'
      );
    } catch (err) {
      console.warn(`[SiteMedia] Error deleting asset from Cloudinary ${media.publicId}:`, err);
    }

    await prisma.siteMedia.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Site media deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/site-media (Public)
 * Returns active site media for banners/promos on the storefront
 */
export const getPublicSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.query;
    const where: any = { isActive: true };

    if (type && Object.values(SiteMediaType).includes(type as SiteMediaType)) {
      where.type = type as SiteMediaType;
    }

    const items = await prisma.siteMedia.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        type: true,
        name: true,
        secureUrl: true,
        resourceType: true,
        altText: true,
        targetUrl: true,
        sortOrder: true,
      },
    });

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};
