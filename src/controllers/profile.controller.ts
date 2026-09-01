import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

// GET /api/v1/profile
export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        technoPoints: true,
        pendingPoints: true,
        createdAt: true,
        addresses: {
          orderBy: { createdAt: 'desc' },
        },
        savedPaymentMethods: {
          orderBy: { isDefault: 'desc' },
        },
        orders: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            items: { include: { book: { select: { id: true, title: true, coverUrl: true } } } },
          },
        },
        pointTransactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
    });
  } catch (error) {
    logger.error('Error fetching profile:', error);
    next(error);
  }
};

// PATCH /api/v1/profile
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { name, phone, avatarUrl } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        technoPoints: true,
        pendingPoints: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    logger.error('Error updating profile:', error);
    next(error);
  }
};

// GET /api/v1/profile/address
export const getAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    res.status(200).json({
      success: true,
      data: addresses || [],
    });
  } catch (error) {
    logger.error('Error fetching addresses:', error);
    next(error);
  }
};

// POST /api/v1/profile/address (With strict deduplication)
export const createAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { fullName, phone, addressLine1, addressLine2, city, state, pincode, type = 'HOME', isDefault = false } = req.body;

    // Deduplication check: does an identical address already exist for this user?
    const existing = await prisma.address.findFirst({
      where: {
        userId,
        addressLine1: addressLine1.trim(),
        pincode: pincode.trim(),
      },
    });

    if (existing) {
      // Update the existing address rather than creating a duplicate!
      const updated = await prisma.address.update({
        where: { id: existing.id },
        data: {
          fullName,
          phone,
          addressLine2: addressLine2 || null,
          city,
          state,
          type,
          isDefault: isDefault ? true : existing.isDefault,
        },
      });

      if (isDefault) {
        await prisma.address.updateMany({
          where: { userId, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }

      res.status(200).json({
        success: true,
        message: 'Existing address updated and deduplicated',
        data: updated,
      });
      return;
    }

    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const newAddress = await prisma.address.create({
      data: {
        userId,
        fullName,
        phone,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2?.trim() || null,
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        type,
        isDefault,
        country: 'India',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Address saved successfully',
      data: newAddress,
    });
  } catch (error) {
    logger.error('Error creating address:', error);
    next(error);
  }
};

// PATCH /api/v1/profile/address/:id (In-place modification)
export const updateAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // BOLA/IDOR protection: verify ownership
    const existing = await prisma.address.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Address not found or unauthorized' });
      return;
    }

    const { fullName, phone, addressLine1, addressLine2, city, state, pincode, type, isDefault } = req.body;

    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.address.update({
      where: { id },
      data: {
        ...(fullName ? { fullName } : {}),
        ...(phone ? { phone } : {}),
        ...(addressLine1 ? { addressLine1: addressLine1.trim() } : {}),
        ...(addressLine2 !== undefined ? { addressLine2: addressLine2?.trim() || null } : {}),
        ...(city ? { city: city.trim() } : {}),
        ...(state ? { state: state.trim() } : {}),
        ...(pincode ? { pincode: pincode.trim() } : {}),
        ...(type ? { type } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: updated,
    });
  } catch (error) {
    logger.error('Error updating address:', error);
    next(error);
  }
};

// DELETE /api/v1/profile/address/:id
export const deleteAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // BOLA/IDOR check
    const existing = await prisma.address.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Address not found or unauthorized' });
      return;
    }

    await prisma.address.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Address removed successfully',
    });
  } catch (error) {
    logger.error('Error deleting address:', error);
    next(error);
  }
};

// GET /api/v1/profile/payment-methods
export const getSavedPaymentMethods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const methods = await prisma.savedPaymentMethod.findMany({
      where: { userId },
      orderBy: { isDefault: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: methods || [],
    });
  } catch (error) {
    logger.error('Error fetching payment methods:', error);
    next(error);
  }
};

// POST /api/v1/profile/payment-methods (Dormant preference storage)
export const savePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { type, provider, maskedData, holderName, isDefault = false } = req.body;

    if (isDefault) {
      await prisma.savedPaymentMethod.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const created = await prisma.savedPaymentMethod.create({
      data: {
        userId,
        type,
        provider: provider || null,
        maskedData,
        holderName: holderName || null,
        isDefault,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Payment method preference saved (External processing dormant)',
      data: created,
    });
  } catch (error) {
    logger.error('Error saving payment method:', error);
    next(error);
  }
};

// DELETE /api/v1/profile/payment-methods/:id
export const deletePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const existing = await prisma.savedPaymentMethod.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Payment method not found or unauthorized' });
      return;
    }

    await prisma.savedPaymentMethod.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Payment method removed successfully',
    });
  } catch (error) {
    logger.error('Error deleting payment method:', error);
    next(error);
  }
};

// GET /api/v1/profile/points
export const getPointTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { technoPoints: true, pendingPoints: true },
      }),
      prisma.pointTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        technoPoints: user?.technoPoints || 0,
        pendingPoints: user?.pendingPoints || 0,
        terms: {
          rate: '1 Techno Point = ₹1.00 (Awarded at 1 point per ₹100 spent)',
          creditTiming: 'Points are credited after the 7-day return window concludes',
          expiryDays: 365,
          expiryNote: 'Points expire 1 year from credit date',
          redemptionLimit: 'Up to 20% of cart total per checkout',
        },
        transactions: transactions || [],
      },
    });
  } catch (error) {
    logger.error('Error fetching point transactions:', error);
    next(error);
  }
};

// GET /api/v1/profile/orders
export const getUserOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            book: {
              select: {
                id: true,
                title: true,
                slug: true,
                coverUrl: true,
                price: true,
                mrp: true,
                authors: true,
              },
            },
          },
        },
        address: true,
      },
    });

    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/profile/notifications
export const getUserNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.status(200).json({ success: true, count: notifications.length, data: notifications });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/profile/notifications/:id/read
export const markNotificationRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.userId || (req as any).user?.id;
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
};
