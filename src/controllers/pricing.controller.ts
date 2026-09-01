import { Request, Response, NextFunction } from 'express';
import { PricingEngine } from '../services/pricing.service.js';

export const calculatePricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, couponCode, userId, pincode, addressId } = req.body;
    
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ success: false, message: 'Invalid items payload' });
      return;
    }

    const result = await PricingEngine.calculate({
      items,
      promotionCode: couponCode,
      userId: userId || (req as any).user?.userId || (req as any).user?.id,
      pincode,
      addressId,
    });
    
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
