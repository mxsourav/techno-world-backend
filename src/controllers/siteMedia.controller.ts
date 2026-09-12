import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { CloudinaryService } from '../services/cloudinary.service.js';
import { SiteMediaType } from '@prisma/client';

/**
 * GET /api/v1/admin/site-media
 * Lists all site media with optional filter by type and search keyword
 */
export const listSiteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type, search, isActive } = req.query;

    const where: any = {};

    if (type && Object.values(SiteMediaType).includes(type as SiteMediaType)) {
      where.type = type as SiteMediaType;
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search } },
        { altText: { contains: search } },
        { targetUrl: { contains: search } },
      ];
    }

    const mediaList = await prisma.siteMedia.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    res.status(200).json({ success: true, data: mediaList });
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
