import { Request, Response, NextFunction } from 'express';
import { PricingEngine } from '../services/pricing.service.js';
import { prisma } from '../config/database.js';

export const calculatePricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, couponCode, userId, pincode, addressId, address, shippingMethod, paymentMethod, email, userEmail, phone, userPhone } = req.body;
    
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ success: false, message: 'Invalid items payload' });
      return;
    }

    let effectiveUserId = userId || (req as any).user?.userId || (req as any).user?.id || null;

    if (!effectiveUserId) {
      const searchEmail = email || userEmail || (req as any).user?.email || null;
      const searchPhone = phone || userPhone || (req as any).user?.phone || null;

      if (searchEmail || searchPhone) {
        try {
          const found = await prisma.user.findFirst({
            where: {
              OR: [
                ...(searchEmail ? [{ email: searchEmail }] : []),
                ...(searchPhone ? [{ phone: searchPhone }] : [])
              ]
            },
            select: { id: true }
          });
          if (found) {
            effectiveUserId = found.id;
          }
        } catch {
          // ignore lookup error
        }
      }
    }

    const result = await PricingEngine.calculate({
      items,
      promotionCode: couponCode,
      userId: effectiveUserId,
      pincode: pincode || address?.pincode,
      addressId,
      shippingMethod: shippingMethod || null,
      paymentMethod: paymentMethod || null,
      address,
    });
    
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
