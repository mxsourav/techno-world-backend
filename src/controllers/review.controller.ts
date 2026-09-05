import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get approved reviews for storefront
export const getReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookId, limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10) || 50;
    const skip = ((parseInt(page as string, 10) || 1) - 1) * take;

    const where: any = { isApproved: true };
    if (bookId && typeof bookId === 'string') {
      where.bookId = bookId;
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          book: {
            select: { id: true, title: true, slug: true, coverUrl: true },
          },
          user: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);

    const formatted = reviews.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      bookTitle: r.book?.title,
      bookSlug: r.book?.slug,
      bookCover: r.book?.coverUrl,
      userId: r.userId,
      userName: r.userName || r.user?.name || 'Verified Customer',
      rating: r.rating,
      title: r.title || '',
      content: r.content,
      body: r.content,
      isApproved: r.isApproved,
      createdAt: r.createdAt,
      date: r.createdAt,
      verified: true,
    }));

    res.status(200).json({
      success: true,
      data: formatted,
      meta: {
        total,
        page: parseInt(page as string, 10) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Customer submits a review (Comment is strictly mandatory when rating with stars)
export const createReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookId, rating, title, content, userName, userEmail } = req.body;
    const loggedInUser = (req as any).user;

    if (!bookId) {
      res.status(400).json({ success: false, message: 'Book ID is required' });
      return;
    }

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5 stars' });
      return;
    }

    // MANDATORY COMMENT VALIDATION: User must provide comment if star rating is given
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: 'Review comment is mandatory when providing a star rating. Please share your feedback.',
      });
      return;
    }

    // Verify book exists
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const reviewerName = (userName && userName.trim()) || loggedInUser?.name || 'Verified Reader';
    const reviewerEmail = (userEmail && userEmail.trim()) || loggedInUser?.email || null;

    const newReview = await prisma.review.create({
      data: {
        bookId,
        userId: loggedInUser?.id || null,
        userName: reviewerName,
        userEmail: reviewerEmail,
        rating: Math.round(numRating),
        title: title && typeof title === 'string' ? title.trim() : null,
        content: content.trim(),
        isApproved: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! Your review has been submitted successfully.',
      data: newReview,
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all reviews for moderation
export const getAdminReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, rating, status } = req.query;

    const where: any = {};
    if (rating) {
      where.rating = Number(rating);
    }
    if (status === 'approved') where.isApproved = true;
    if (status === 'pending') where.isApproved = false;

    if (search && typeof search === 'string') {
      where.OR = [
        { userName: { contains: search } },
        { title: { contains: search } },
        { content: { contains: search } },
        { book: { title: { contains: search } } },
      ];
    }

    const reviews = await prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        book: {
          select: { id: true, title: true, slug: true, coverUrl: true, isbn13: true },
        },
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 200,
    });

    res.status(200).json({
      success: true,
      data: reviews.map((r) => ({
        id: r.id,
        bookId: r.bookId,
        bookTitle: r.book?.title || 'Unknown Title',
        bookCover: r.book?.coverUrl,
        bookSlug: r.book?.slug,
        userName: r.userName || r.user?.name || 'Guest User',
        userEmail: r.userEmail || r.user?.email || 'N/A',
        rating: r.rating,
        title: r.title || 'Reader Review',
        content: r.content,
        isApproved: r.isApproved,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Toggle approval status
export const updateReviewStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;

    const updated = await prisma.review.update({
      where: { id },
      data: { isApproved: Boolean(isApproved) },
    });

    res.status(200).json({
      success: true,
      message: `Review ${updated.isApproved ? 'approved' : 'hidden'} successfully`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete review
export const deleteReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.review.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Auto-delete / clear reviews or review logs older than 24 hours
export const clearOldReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hours = Number(req.body.hours) || 24;
    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const result = await prisma.review.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: `Cleared ${result.count} review records older than ${hours} hours.`,
      count: result.count,
    });
  } catch (error) {
    next(error);
  }
};
