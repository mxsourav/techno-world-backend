import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const promotions = await prisma.promotion.findMany({
      include: {
        campaign: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: promotions });
  } catch (error) {
    next(error);
  }
};

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { 
      name, code, description, promotionType, discountType, discountValue,
      isTemplate, status, validFrom, validUntil, priority,
      allowCombination, autoApply, rules, usageLimit, usageLimitPerUser, campaignId
    } = req.body;

    const uppercaseCode = code ? code.toUpperCase() : null;

    if (uppercaseCode && !isTemplate) {
      const existing = await prisma.promotion.findUnique({ where: { code: uppercaseCode } });
      if (existing) {
        res.status(400).json({ success: false, message: 'Promotion code already exists' });
        return;
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        name,
        code: uppercaseCode,
        description,
        promotionType: promotionType || 'UNIVERSAL',
        discountType: discountType || 'PERCENTAGE',
        discountValue: Number(discountValue),
        isTemplate: Boolean(isTemplate),
        status: status || 'DRAFT',
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        priority: Number(priority) || 0,
        allowCombination: Boolean(allowCombination),
        autoApply: Boolean(autoApply),
        rules: typeof rules === 'string' ? rules : JSON.stringify(rules || {}),
        usageLimit: usageLimit ? Number(usageLimit) : null,
        usageLimitPerUser: usageLimitPerUser ? Number(usageLimitPerUser) : 1,
        campaignId: campaignId || null,
      }
    });

    if (req.user?.userId) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.userId,
          action: 'CREATE',
          entity: 'PROMOTION',
          entityId: promotion.id,
          details: `Created promotion: ${name} (${status})`
        }
      });
    }

    res.status(201).json({ success: true, message: 'Promotion created', data: promotion });
  } catch (error) {
    next(error);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { 
      name, code, description, promotionType, discountType, discountValue,
      isTemplate, status, validFrom, validUntil, priority,
      allowCombination, autoApply, rules, usageLimit, usageLimitPerUser, campaignId
    } = req.body;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (promotionType !== undefined) data.promotionType = promotionType;
    if (discountType !== undefined) data.discountType = discountType;
    if (discountValue !== undefined) data.discountValue = Number(discountValue);
    if (isTemplate !== undefined) data.isTemplate = Boolean(isTemplate);
    if (status !== undefined) data.status = status;
    if (validFrom !== undefined) data.validFrom = validFrom ? new Date(validFrom) : null;
    if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null;
    if (priority !== undefined) data.priority = Number(priority);
    if (allowCombination !== undefined) data.allowCombination = Boolean(allowCombination);
    if (autoApply !== undefined) data.autoApply = Boolean(autoApply);
    if (rules !== undefined) data.rules = typeof rules === 'string' ? rules : JSON.stringify(rules || {});
    if (usageLimit !== undefined) data.usageLimit = usageLimit ? Number(usageLimit) : null;
    if (usageLimitPerUser !== undefined) data.usageLimitPerUser = Number(usageLimitPerUser);
    if (campaignId !== undefined) data.campaignId = campaignId || null;

    if (code) {
      const uppercaseCode = code.toUpperCase();
      const existing = await prisma.promotion.findUnique({ where: { code: uppercaseCode } });
      if (existing && existing.id !== id && !data.isTemplate) {
        res.status(400).json({ success: false, message: 'Promotion code already exists' });
        return;
      }
      data.code = uppercaseCode;
    } else if (code === null) {
      data.code = null;
    }

    const promotion = await prisma.promotion.update({ where: { id }, data });

    if (req.user?.userId) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE',
          entity: 'PROMOTION',
          entityId: promotion.id,
          details: `Updated promotion: ${promotion.name}`
        }
      });
    }

    res.status(200).json({ success: true, message: 'Promotion updated', data: promotion });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.promotion.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Promotion deleted' });
  } catch (error) {
    next(error);
  }
};

export const toggleActive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status: targetStatus } = req.body || {};
    const existing = await prisma.promotion.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Promotion not found' });
      return;
    }

    const newStatus = targetStatus ? targetStatus.toUpperCase() : (existing.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');

    const promotion = await prisma.promotion.update({
      where: { id },
      data: { status: newStatus }
    });

    if (req.user?.userId) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE',
          entity: 'PROMOTION',
          entityId: promotion.id,
          details: `Changed promotion ${promotion.name} status to ${newStatus}`
        }
      });
    }

    res.status(200).json({ success: true, message: `Promotion is now ${newStatus.toLowerCase()}`, data: promotion });
  } catch (error) {
    next(error);
  }
};
