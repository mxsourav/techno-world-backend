import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const prisma = new PrismaClient();

/**
 * Public endpoint: Retrieve hero configuration including active book cover URL.
 */
export const getHeroConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await prisma.heroConfig.findUnique({
      where: { id: 'default' },
    });

    if (!config) {
      res.status(200).json({
        success: true,
        data: {
          id: 'default',
          hero_book_cover_url: null,
          hero_book_cover_updated_at: null,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin protected endpoint: Upload, optimize (Sharp WebP standard book ratio),
 * store and assign new hero 3D book cover image.
 */
export const uploadHeroCover = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, message: 'No image file uploaded' });
      return;
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPG, PNG, and WebP are allowed.',
      });
      return;
    }

    // Read metadata to determine aspect ratio and best matching 3D book preset
    const metadata = await sharp(file.buffer).metadata();
    const width = metadata.width || 600;
    const height = metadata.height || 900;
    const ratio = height / width;

    // Determine 3D book model preset:
    // User can optionally specify req.body.hero_book_model ('academic' | 'novel' | 'reference')
    // Otherwise auto-detect based on physical publishing ratios:
    let detectedModel: 'academic' | 'novel' | 'reference' = 'academic';
    if (ratio < 1.42) {
      detectedModel = 'novel';
    } else if (ratio > 1.58) {
      detectedModel = 'reference';
    } else {
      detectedModel = 'academic';
    }

    const hero_book_model = (req.body.hero_book_model && ['academic', 'novel', 'reference'].includes(req.body.hero_book_model))
      ? req.body.hero_book_model
      : detectedModel;

    // Process image through Sharp pipeline:
    // 1. Auto-rotate based on EXIF orientation
    // 2. Resize within 800x1200 maintaining 100% of the artwork without cropping
    // 3. Compress to modern WebP (quality 90)
    const optimizedBuffer = await sharp(file.buffer)
      .rotate()
      .resize(800, 1200, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();

    // Prepare uploads directory
    const heroUploadDir = path.resolve('uploads', 'hero');
    if (!fs.existsSync(heroUploadDir)) {
      fs.mkdirSync(heroUploadDir, { recursive: true });
    }

    // Generate unique timestamped filename
    const filename = `hero-book-cover-${Date.now()}.webp`;
    const filepath = path.join(heroUploadDir, filename);

    // Write optimized image to disk
    fs.writeFileSync(filepath, optimizedBuffer);

    // Clean up previous cover file if exists
    const previousConfig = await prisma.heroConfig.findUnique({
      where: { id: 'default' },
    });

    if (previousConfig?.hero_book_cover_url) {
      try {
        const oldFilename = path.basename(previousConfig.hero_book_cover_url);
        const oldFilePath = path.join(heroUploadDir, oldFilename);
        if (fs.existsSync(oldFilePath) && oldFilename !== filename) {
          fs.unlinkSync(oldFilePath);
        }
      } catch (cleanupErr) {
        console.warn('Failed to clean up old hero book cover file:', cleanupErr);
      }
    }

    const relativeUrl = `/uploads/hero/${filename}`;
    const now = new Date();

    const updatedConfig = await prisma.heroConfig.upsert({
      where: { id: 'default' },
      update: {
        hero_book_cover_url: relativeUrl,
        hero_book_cover_updated_at: now,
        hero_book_model,
      },
      create: {
        id: 'default',
        hero_book_cover_url: relativeUrl,
        hero_book_cover_updated_at: now,
        hero_book_model,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Hero 3D book cover updated successfully',
      data: updatedConfig,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin protected endpoint: Reset hero book cover to default mockup.
 */
export const deleteHeroCover = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const heroUploadDir = path.resolve('uploads', 'hero');
    const existingConfig = await prisma.heroConfig.findUnique({
      where: { id: 'default' },
    });

    if (existingConfig?.hero_book_cover_url) {
      try {
        const oldFilename = path.basename(existingConfig.hero_book_cover_url);
        const oldFilePath = path.join(heroUploadDir, oldFilename);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      } catch (cleanupErr) {
        console.warn('Failed to delete hero book cover file:', cleanupErr);
      }
    }

    const now = new Date();
    const updatedConfig = await prisma.heroConfig.upsert({
      where: { id: 'default' },
      update: {
        hero_book_cover_url: null,
        hero_book_cover_updated_at: now,
      },
      create: {
        id: 'default',
        hero_book_cover_url: null,
        hero_book_cover_updated_at: now,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Hero book cover reset to default mockup',
      data: updatedConfig,
    });
  } catch (error) {
    next(error);
  }
};
