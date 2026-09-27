import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * GET /api/v1/cart
 * Fetches the authenticated user's database-persisted cart items
 */
export const getCart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const items = await prisma.cartItem.findMany({
      where: { userId },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            mrp: true,
            coverUrl: true,
            sku: true,
            stock: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = items.map((item) => ({
      bookId: item.bookId,
      qty: item.quantity,
      book: item.book,
      updatedAt: item.updatedAt,
    }));

    res.json({
      success: true,
      items: formatted,
    });
  } catch (error) {
    logger.error('Error in getCart:', error);
    next(error);
  }
};

/**
 * POST /api/v1/cart/sync
 * Merges guest cart items from browser localStorage into user's DB cart on login
 */
export const syncCart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { items } = req.body;
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const bookId = item.bookId || item.id;
        const qty = Math.min(Math.max(Number(item.qty || item.quantity || 1), 1), 10);
        if (!bookId || typeof bookId !== 'string') continue;

        // Verify book exists
        const bookExists = await prisma.book.findUnique({
          where: { id: bookId },
          select: { id: true },
        });
        if (!bookExists) continue;

        // Upsert into CartItem table
        const existing = await prisma.cartItem.findUnique({
          where: {
            userId_bookId: { userId, bookId },
          },
        });

        if (existing) {
          const mergedQty = Math.min(Math.max(existing.quantity, qty), 10);
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity: mergedQty },
          });
        } else {
          await prisma.cartItem.create({
            data: {
              userId,
              bookId,
              quantity: qty,
            },
          });
        }
      }
    }

    // Return current full cart after sync
    const updatedItems = await prisma.cartItem.findMany({
      where: { userId },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            mrp: true,
            coverUrl: true,
            sku: true,
            stock: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      items: updatedItems.map((item) => ({
        bookId: item.bookId,
        qty: item.quantity,
        book: item.book,
      })),
    });
  } catch (error) {
    logger.error('Error in syncCart:', error);
    next(error);
  }
};

/**
 * POST /api/v1/cart
 * Adds or updates an item's quantity in the cart
 */
export const updateCartItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { bookId, qty } = req.body;
    if (!bookId) {
      res.status(400).json({ success: false, message: 'Book ID is required' });
      return;
    }

    const quantity = Number(qty);

    if (quantity <= 0) {
      await prisma.cartItem.deleteMany({
        where: { userId, bookId },
      });
      res.json({ success: true, message: 'Item removed from cart' });
      return;
    }

    const cappedQty = Math.min(quantity, 10);

    // Verify book exists
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { id: true },
    });

    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const cartItem = await prisma.cartItem.upsert({
      where: {
        userId_bookId: { userId, bookId },
      },
      update: {
        quantity: cappedQty,
      },
      create: {
        userId,
        bookId,
        quantity: cappedQty,
      },
    });

    res.json({
      success: true,
      item: {
        bookId: cartItem.bookId,
        qty: cartItem.quantity,
      },
    });
  } catch (error) {
    logger.error('Error in updateCartItem:', error);
    next(error);
  }
};

/**
 * DELETE /api/v1/cart/:bookId
 * Removes a specific book from the user's cart
 */
export const removeCartItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { bookId } = req.params;
    await prisma.cartItem.deleteMany({
      where: { userId, bookId },
    });

    res.json({ success: true, message: 'Item removed' });
  } catch (error) {
    logger.error('Error in removeCartItem:', error);
    next(error);
  }
};

/**
 * DELETE /api/v1/cart
 * Clears the entire cart for the authenticated user
 */
export const clearCart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    await prisma.cartItem.deleteMany({
      where: { userId },
    });

    res.json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    logger.error('Error in clearCart:', error);
    next(error);
  }
};
