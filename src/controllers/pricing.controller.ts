import { Request, Response, NextFunction } from 'express';
import { PricingEngine } from '../services/pricing.service.js';
import { prisma } from '../config/database.js';

export const calculatePricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, couponCode, pincode, addressId, address, shippingMethod, paymentMethod, pointsUsed, walletUsed } = req.body;
    
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ success: false, message: 'Invalid items payload' });
      return;
    }

    // SECURITY LOCK: Only the verified JWT authenticated user's ID is accepted.
    // Unauthenticated callers cannot spoof or inspect any user's wallet/points.
    const authenticatedUserId = (req as any).user?.userId || (req as any).user?.id || null;

    const result = await PricingEngine.calculate({
      items,
      promotionCode: couponCode,
      userId: authenticatedUserId,
      pincode: pincode || address?.pincode,
      addressId,
      shippingMethod: shippingMethod || null,
      paymentMethod: paymentMethod || null,
      pointsUsed: authenticatedUserId ? (pointsUsed !== undefined ? Number(pointsUsed) : undefined) : 0,
      walletUsed: authenticatedUserId ? (walletUsed !== undefined ? Number(walletUsed) : undefined) : 0,
      address,
    });
    
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
