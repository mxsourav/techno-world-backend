import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        _count: {
          select: { promotions: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: campaigns });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        promotions: true
      }
    });

    if (!campaign) {
      res.status(404).json({ success: false, message: 'Campaign not found' });
      return;
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { 
      name, description, status, startDate, endDate, budget, priority, marketingNotes 
    } = req.body;

    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        status: status || 'DRAFT',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        budget: budget ? Number(budget) : null,
        priority: priority ? Number(priority) : 0,
        marketingNotes,
      }
    });

    res.status(201).json({ success: true, message: 'Campaign created', data: campaign });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { 
      name, description, status, startDate, endDate, budget, priority, marketingNotes 
    } = req.body;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (budget !== undefined) data.budget = budget ? Number(budget) : null;
    if (priority !== undefined) data.priority = priority ? Number(priority) : 0;
    if (marketingNotes !== undefined) data.marketingNotes = marketingNotes;

    const campaign = await prisma.campaign.update({ where: { id }, data });
    res.status(200).json({ success: true, message: 'Campaign updated', data: campaign });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.campaign.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    next(error);
  }
};
