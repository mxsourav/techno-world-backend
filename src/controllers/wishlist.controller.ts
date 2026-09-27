import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * GET /api/v1/wishlist
 * Fetches the authenticated user's wishlist book IDs
 */
export const getWishlist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const items = await prisma.wishlistItem.findMany({
      where: { userId },
      select: { bookId: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      bookIds: items.map((i) => i.bookId),
    });
  } catch (error) {
    logger.error('Error in getWishlist:', error);
    next(error);
  }
};

/**
 * POST /api/v1/wishlist/sync
 * Merges guest wishlist book IDs from browser localStorage into user's DB wishlist on login
 */
export const syncWishlist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { bookIds } = req.body;
    if (Array.isArray(bookIds) && bookIds.length > 0) {
      for (const rawId of bookIds) {
        const bookId = typeof rawId === 'string' ? rawId : rawId?.id || rawId?.bookId;
        if (!bookId || typeof bookId !== 'string') continue;

        // Check if book exists
        const book = await prisma.book.findUnique({
          where: { id: bookId },
          select: { id: true },
        });
        if (!book) continue;

        // Insert if not already in wishlist
        const existing = await prisma.wishlistItem.findUnique({
          where: {
            userId_bookId: { userId, bookId },
          },
        });

        if (!existing) {
          await prisma.wishlistItem.create({
            data: {
              userId,
              bookId,
            },
          });
        }
      }
    }

    const updated = await prisma.wishlistItem.findMany({
      where: { userId },
      select: { bookId: true },
    });

    res.json({
      success: true,
      bookIds: updated.map((i) => i.bookId),
    });
  } catch (error) {
    logger.error('Error in syncWishlist:', error);
    next(error);
  }
};

/**
 * POST /api/v1/wishlist/toggle
 * Toggles a book in/out of the user's wishlist
 */
export const toggleWishlistItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { bookId } = req.body;
    if (!bookId) {
      res.status(400).json({ success: false, message: 'Book ID is required' });
      return;
    }

    const existing = await prisma.wishlistItem.findUnique({
      where: {
        userId_bookId: { userId, bookId },
      },
    });

    if (existing) {
      await prisma.wishlistItem.delete({
        where: { id: existing.id },
      });
      res.json({
        success: true,
        isWishlisted: false,
        bookId,
      });
    } else {
      // Verify book exists
      const book = await prisma.book.findUnique({
        where: { id: bookId },
        select: { id: true },
      });

      if (!book) {
        res.status(404).json({ success: false, message: 'Book not found' });
        return;
      }

      await prisma.wishlistItem.create({
        data: {
          userId,
          bookId,
        },
      });

      res.json({
        success: true,
        isWishlisted: true,
        bookId,
      });
    }
  } catch (error) {
    logger.error('Error in toggleWishlistItem:', error);
    next(error);
  }
};

/**
 * DELETE /api/v1/wishlist/:bookId
 * Removes a book from the user's wishlist
 */
export const removeWishlistItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { bookId } = req.params;
    await prisma.wishlistItem.deleteMany({
      where: { userId, bookId },
    });

    res.json({ success: true, message: 'Removed from wishlist' });
  } catch (error) {
    logger.error('Error in removeWishlistItem:', error);
    next(error);
  }
};
