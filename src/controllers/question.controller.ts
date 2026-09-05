import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get questions for storefront (user name is hidden per privacy & design spec)
export const getQuestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookId, limit = '50', page = '1' } = req.query;
    const take = parseInt(limit as string, 10) || 50;
    const skip = ((parseInt(page as string, 10) || 1) - 1) * take;

    const where: any = { isApproved: true };
    if (bookId && typeof bookId === 'string') {
      where.bookId = bookId;
    }

    const [questions, total] = await Promise.all([
      prisma.bookQuestion.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          book: {
            select: { id: true, title: true, slug: true, coverUrl: true },
          },
        },
      }),
      prisma.bookQuestion.count({ where }),
    ]);

    // Format for storefront: ONLY show Question, Answer, and Verified Answerer (No customer name on website)
    const formatted = questions.map((q) => ({
      id: q.id,
      bookId: q.bookId,
      bookTitle: q.book?.title,
      question: q.question,
      answer: q.answer,
      answeredBy: q.answeredBy || 'Techno World Direct · Verified Seller',
      answeredAt: q.answeredAt || q.createdAt,
      status: q.status,
      createdAt: q.createdAt,
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

// Customer submits a question on product page
export const askQuestion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookId, question, userName, userEmail } = req.body;
    const loggedInUser = (req as any).user;

    if (!bookId) {
      res.status(400).json({ success: false, message: 'Book ID is required' });
      return;
    }

    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      res.status(400).json({
        success: false,
        message: 'Please provide a meaningful question (at least 5 characters).',
      });
      return;
    }

    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const askerName = (userName && userName.trim()) || loggedInUser?.name || 'Customer';
    const askerEmail = (userEmail && userEmail.trim()) || loggedInUser?.email || null;

    const newQuestion = await prisma.bookQuestion.create({
      data: {
        bookId,
        userId: loggedInUser?.id || null,
        userName: askerName,
        userEmail: askerEmail,
        question: question.trim(),
        status: 'PENDING',
        isApproved: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Question submitted! Our editorial and seller team will review and reply shortly.',
      data: {
        id: newQuestion.id,
        bookId: newQuestion.bookId,
        question: newQuestion.question,
        status: newQuestion.status,
        createdAt: newQuestion.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all customer questions across books for moderation and replies
export const getAdminQuestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { question: { contains: search } },
        { answer: { contains: search } },
        { userName: { contains: search } },
        { book: { title: { contains: search } } },
      ];
    }

    const questions = await prisma.bookQuestion.findMany({
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
      data: questions.map((q) => ({
        id: q.id,
        bookId: q.bookId,
        bookTitle: q.book?.title || 'Unknown Title',
        bookCover: q.book?.coverUrl,
        bookSlug: q.book?.slug,
        userName: q.userName || q.user?.name || 'Guest Customer',
        userEmail: q.userEmail || q.user?.email || 'N/A',
        question: q.question,
        answer: q.answer,
        answeredBy: q.answeredBy,
        answeredAt: q.answeredAt,
        status: q.status,
        isApproved: q.isApproved,
        createdAt: q.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Reply / Answer a customer question
export const answerQuestion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { answer, answeredBy } = req.body;

    if (!answer || typeof answer !== 'string' || answer.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Answer text is required' });
      return;
    }

    const signature = (answeredBy && answeredBy.trim()) || 'Techno World Direct · Verified Seller';

    const updated = await prisma.bookQuestion.update({
      where: { id },
      data: {
        answer: answer.trim(),
        answeredBy: signature,
        answeredAt: new Date(),
        status: 'ANSWERED',
        isApproved: true,
      },
      include: {
        book: { select: { title: true } },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Answer published successfully to the product page.',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete a question
export const deleteQuestion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.bookQuestion.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Clear / auto-delete questions older than 24 hours
export const clearOldQuestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hours = Number(req.body.hours) || 24;
    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const result = await prisma.bookQuestion.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: `Cleared ${result.count} question records older than ${hours} hours.`,
      count: result.count,
    });
  } catch (error) {
    next(error);
  }
};
