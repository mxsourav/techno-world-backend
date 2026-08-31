import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export const listMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { folder, type } = req.query;
    const where: any = {};
    if (folder) where.folder = folder as string;
    if (type) where.type = type as string;

    const media = await prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    res.status(200).json({ success: true, data: media });
  } catch (error) {
    next(error);
  }
};

export const uploadMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: 'No file uploaded' }); return; }
    
    const folder = (req.body.folder || '/') as string;
    const safeFolder = folder.replace(/\.\./g, '').replace(/^\/+/, '');
    const uploadsDir = path.resolve('uploads', safeFolder);
    if (!uploadsDir.startsWith(path.resolve('uploads'))) {
      res.status(403).json({ success: false, message: 'Invalid directory traversal attempted' });
      return;
    }
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    
    const filename = `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, file.buffer);
    
    const url = `/uploads/${folder.replace(/^\//, '')}${folder.endsWith('/') || folder === '/' ? '' : '/'}${filename}`;
    const mimeType = file.mimetype;
    const mediaType = mimeType.startsWith('image') ? 'IMAGE' : mimeType === 'application/pdf' ? 'PDF' : 'DOCUMENT';

    const media = await prisma.media.create({
      data: {
        filename,
        originalName: file.originalname,
        mimeType,
        size: file.size,
        url,
        folder,
        type: mediaType,
        altText: req.body.altText || null,
      },
    });

    res.status(201).json({ success: true, message: 'File uploaded', data: media });
  } catch (error) {
    next(error);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) { res.status(404).json({ success: false, message: 'Media not found' }); return; }
    
    const filepath = path.resolve(`.${media.url}`);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    
    await prisma.media.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Media deleted' });
  } catch (error) {
    next(error);
  }
};
