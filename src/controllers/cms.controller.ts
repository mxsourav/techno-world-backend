import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sections = await prisma.homepageCMS.findMany({ orderBy: { sortOrder: 'asc' } });
    const parsed = sections.map(s => ({ ...s, configData: JSON.parse(s.configData) }));
    res.status(200).json({ success: true, data: parsed });
  } catch (error) {
    next(error);
  }
};

export const updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { key } = req.params;
    const { title, configData, isEnabled } = req.body;
    
    const section = await prisma.homepageCMS.update({
      where: { sectionKey: key },
      data: {
        ...(title !== undefined && { title }),
        ...(configData !== undefined && { configData: JSON.stringify(configData) }),
        ...(isEnabled !== undefined && { isEnabled }),
      },
    });
    
    res.status(200).json({ success: true, message: 'Section updated', data: { ...section, configData: JSON.parse(section.configData) } });
  } catch (error) {
    next(error);
  }
};

export const toggleSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { key } = req.params;
    const section = await prisma.homepageCMS.findUnique({ where: { sectionKey: key } });
    if (!section) { res.status(404).json({ success: false, message: 'Section not found' }); return; }
    
    const updated = await prisma.homepageCMS.update({
      where: { sectionKey: key },
      data: { isEnabled: !section.isEnabled },
    });
    
    res.status(200).json({ success: true, message: `Section ${updated.isEnabled ? 'enabled' : 'disabled'}`, data: { ...updated, configData: JSON.parse(updated.configData) } });
  } catch (error) {
    next(error);
  }
};
