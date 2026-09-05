import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const instantSearch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    // Split query into words to match multi-word keywords (e.g. "NEET Physics")
    const words = q.split(/\s+/).filter(w => w.length >= 2);

    const orClauses: any[] = [
      { title: { contains: q } },
      { isbn13: { contains: q } },
      { isbn10: { contains: q } },
      { bookCode: { contains: q } },
      { sku: { contains: q } },
      { seoKeywords: { contains: q } },
      { tags: { contains: q } },
      { authors: { some: { name: { contains: q } } } },
      { category: { name: { contains: q } } },
      { publisher: { name: { contains: q } } },
    ];

    // If query has multiple words, also match individual terms against seoKeywords, tags, and title
    if (words.length > 1) {
      words.forEach(w => {
        orClauses.push({ seoKeywords: { contains: w } });
        orClauses.push({ tags: { contains: w } });
        orClauses.push({ title: { contains: w } });
      });
    }

    const books = await prisma.book.findMany({
      where: {
        status: 'PUBLISHED',
        OR: orClauses,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        price: true,
        mrp: true,
        coverUrl: true,
        authors: { select: { name: true } },
        category: { select: { name: true } },
      },
      take: 10,
      orderBy: { isFeatured: 'desc' },
    });

    const results = books.map((b: any) => ({
      id: b.id,
      title: b.title,
      slug: b.slug,
      price: b.price,
      mrp: b.mrp,
      coverUrl: b.coverUrl,
      author: b.authors && b.authors.length > 0 ? b.authors.map((a: any) => a.name).join(', ') : 'Unknown',
      category: b.category?.name || '',
    }));

    // Asynchronously log search to SearchLog for admin analytics & exam season tracking
    const bookIds = books.map((b: any) => b.id).slice(0, 10).join(',');
    const userId = (req as any).user?.userId || (req as any).user?.id || null;
    prisma.searchLog.create({
      data: {
        query: q.toLowerCase(),
        resultsCount: results.length,
        source: 'instant',
        userId,
        matchedBookIds: bookIds || null,
      },
    }).catch(err => console.error('Failed to log search:', err));

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
