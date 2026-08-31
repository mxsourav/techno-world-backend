import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';

const prisma = new PrismaClient();

function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TW-${dateStr}-${rand}`;
}

import { PricingEngine } from '../services/pricing.service.js';

export const createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items, addressId, paymentMethod, couponCode } = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.id;
    
    if (!userId) {
      res.status(401).json({ success: false, message: 'Valid authentication required to checkout' });
      return;
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Items are required' });
      return;
    }

    // 1. Validate via Pricing Engine
    const pricingResult = await PricingEngine.calculate({
      items,
      promotionCode: couponCode, // For backward compatibility with frontend cart
      userId
    });

    if (!pricingResult.isValid) {
      res.status(400).json({ success: false, message: pricingResult.errors[0] || 'Pricing validation failed' });
      return;
    }
    
    if (pricingResult.promotionError) {
      res.status(400).json({ success: false, message: pricingResult.promotionError });
      return;
    }

    const order = await prisma.$transaction(async (tx) => {
      const orderItems: any[] = [];
      
      for (const item of pricingResult.items) {
        orderItems.push({ bookId: item.bookId, quantity: item.quantity, priceAtPurchase: item.unitPrice });
        
        // Controlled Overselling Check: allow up to 5 items of backorder buffer
        const ALLOWED_NEGATIVE_STOCK_BUFFER = -5;
        const minStockAllowed = item.quantity + ALLOWED_NEGATIVE_STOCK_BUFFER;

        // Atomically verify and decrement stock
        const stockUpdate = await tx.book.updateMany({
          where: { 
            id: item.bookId,
            stock: { gte: minStockAllowed } // Concurrency lock with buffer
          },
          data: {
            stock: { decrement: item.quantity }
          }
        });

        if (stockUpdate.count === 0) {
          throw new Error(`Maximum backorder limit reached for book ID: ${item.bookId}. Cannot fulfill at this moment.`);
        }
      }

      const created = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: userId || 'guest',
          addressId: addressId || null,
          status: 'PENDING',
          paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID',
          paymentMethod: paymentMethod || 'COD',
          subtotal: pricingResult.subtotal,
          discountAmount: pricingResult.promotionDiscount,
          shippingCharge: pricingResult.shippingCharge,
          taxAmount: pricingResult.taxAmount,
          totalAmount: pricingResult.totalAmount,
          promotionId: pricingResult.promotionId,
          items: { create: orderItems },
        },
        include: { items: { include: { book: true } } },
      });

      // Update promotion usage if applicable
      if (pricingResult.promotionId && userId) {
        await tx.promotion.update({
          where: { id: pricingResult.promotionId },
          data: { usedCount: { increment: 1 } }
        });
        
        await tx.promotionUsage.create({
          data: {
            promotionId: pricingResult.promotionId,
            userId: userId,
            orderId: created.id
          }
        });
      }

      return created;
    });

    // If Razorpay keys are configured and it's not COD, create Razorpay Order
    let razorpayOrder = null;
    if (paymentMethod !== 'COD' && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
      const razorpay = new Razorpay({
        key_id: env.RAZORPAY_KEY_ID,
        key_secret: env.RAZORPAY_KEY_SECRET
      });

      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(order.totalAmount * 100), // Amount in paise
        currency: 'INR',
        receipt: order.id
      });
      
      // Update order with razorpayOrderId in db
      await prisma.order.update({
        where: { id: order.id },
        data: { razorpayOrderId: razorpayOrder.id }
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Order placed successfully', 
      data: {
        ...order,
        razorpayOrderId: razorpayOrder?.id
      }
    });
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('Insufficient') || error.message?.includes('backorder')) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
};

export const getMyOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        items: { include: { book: { select: { id: true, title: true, slug: true, coverUrl: true, authors: { select: { name: true } } } } } },
        address: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[GET_MY_ORDERS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
  }
};

export const getAllOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    
    const queryStatus = typeof status === 'string' ? status : undefined;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where = queryStatus ? { status: queryStatus as any } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { book: { select: { id: true, title: true, coverUrl: true } } } },
          user: { select: { id: true, name: true, email: true } },
          address: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.order.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: orders,
      meta: {
        total,
        page: Number(page),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('[GET_ALL_ORDERS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Validated by Zod

    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: { items: { include: { book: true } }, user: true },
    });

    res.status(200).json({ success: true, message: 'Order status updated successfully', data: order });
  } catch (error) {
    console.error('[UPDATE_ORDER_STATUS_ERROR]', error instanceof Error ? error.message : 'Unknown');
    if ((error as any).code === 'P2025') {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};
