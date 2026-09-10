import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';


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

// GET /api/v1/cms/ui-content (Public endpoint for frontend hydration)
export const getUiContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'CMS_UI_CONTENT' } });
    let content: Record<string, string> = {};
    if (setting?.value) {
      try {
        content = JSON.parse(setting.value);
      } catch {
        content = {};
      }
    }
    res.status(200).json({
      success: true,
      data: content,
      updatedAt: setting?.updatedAt || null,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/cms/ui-content (Admin endpoint to publish text overrides)
export const publishUiContent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'object') {
      res.status(400).json({ success: false, message: 'Invalid content payload: must be a key-value object' });
      return;
    }

    // Retrieve existing to merge
    const existing = await prisma.systemSetting.findUnique({ where: { key: 'CMS_UI_CONTENT' } });
    let existingMap: Record<string, string> = {};
    if (existing?.value) {
      try {
        existingMap = JSON.parse(existing.value);
      } catch {
        existingMap = {};
      }
    }

    const merged = { ...existingMap, ...content };

    const saved = await prisma.systemSetting.upsert({
      where: { key: 'CMS_UI_CONTENT' },
      update: { value: JSON.stringify(merged) },
      create: { key: 'CMS_UI_CONTENT', value: JSON.stringify(merged) },
    });

    res.status(200).json({
      success: true,
      message: 'Website UI content successfully published live!',
      data: merged,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/cms/ui-content/:key (Reset single key to default)
export const resetUiContentKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { key } = req.params;
    const existing = await prisma.systemSetting.findUnique({ where: { key: 'CMS_UI_CONTENT' } });
    if (!existing?.value) {
      res.status(200).json({ success: true, message: 'Key reset to default', data: {} });
      return;
    }

    const currentMap = JSON.parse(existing.value);
    delete currentMap[key];

    await prisma.systemSetting.update({
      where: { key: 'CMS_UI_CONTENT' },
      data: { value: JSON.stringify(currentMap) },
    });

    res.status(200).json({
      success: true,
      message: `Key "${key}" successfully reset to system default`,
      data: currentMap,
    });
  } catch (error) {
    next(error);
  }
};

