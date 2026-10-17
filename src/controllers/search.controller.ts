import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import {
  extractTokens,
  buildPrismaSearchWhere,
  scoreBook,
  fuzzyScoreBook
} from '../utils/searchEngine.js';

export const instantSearch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const tokens = extractTokens(q);
    const searchWhere = buildPrismaSearchWhere(q);

    // 1. Primary DB query using case-insensitive contains across all relevant fields
    const primaryBooks = await prisma.book.findMany({
      where: {
        status: 'PUBLISHED',
        ...searchWhere,
      },
      select: {
        id: true,
        title: true,
        subtitle: true,
        slug: true,
        price: true,
        mrp: true,
        coverUrl: true,
        galleryUrls: true,
        seoKeywords: true,
        tags: true,
        isFeatured: true,
        isBestseller: true,
        authors: { select: { name: true } },
        category: { select: { name: true } },
        categories: { select: { name: true } },
        publisher: { select: { name: true } },
      },
      take: 40,
    });

    const resultMap = new Map<string, any>();

    // Add and score primary matches
    for (const book of primaryBooks) {
      const score = scoreBook(book, q, tokens);
      resultMap.set(book.id, { book, score });
    }

    // 2. If results are few (< 5) or tokens are long (e.g. potential typos like "bactriology"),
    // perform typo-tolerant fuzzy fallback scan across published books
    if (resultMap.size < 8 && tokens.some(t => t.length >= 4)) {
      try {
        const candidateBooks = await prisma.book.findMany({
          where: { status: 'PUBLISHED' },
          select: {
            id: true,
            title: true,
            subtitle: true,
            slug: true,
            price: true,
            mrp: true,
            coverUrl: true,
            galleryUrls: true,
            seoKeywords: true,
            tags: true,
            isFeatured: true,
            isBestseller: true,
            authors: { select: { name: true } },
            category: { select: { name: true } },
            categories: { select: { name: true } },
            publisher: { select: { name: true } },
          },
          take: 600, // fast in-memory comparison
        });

        for (const candidate of candidateBooks) {
          if (resultMap.has(candidate.id)) continue;

          const fuzzyScore = fuzzyScoreBook(candidate, tokens);
          if (fuzzyScore >= 30) {
            resultMap.set(candidate.id, { book: candidate, score: fuzzyScore });
          }
        }
      } catch (fuzzyErr) {
        console.error('Fuzzy search fallback error:', fuzzyErr);
      }
    }

    // Sort descending by score
    const sorted = Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    const results = sorted.map(({ book: b }) => {
      let cover = b.coverUrl;
      if (!cover && b.galleryUrls) {
        try {
          const parsed = typeof b.galleryUrls === 'string' ? JSON.parse(b.galleryUrls) : b.galleryUrls;
          if (Array.isArray(parsed) && parsed[0]) cover = parsed[0];
        } catch {}
      }

      const authorNames = b.authors && b.authors.length > 0
        ? b.authors.map((a: any) => a.name).filter(Boolean).join(', ')
        : '';

      const categoryName = b.category?.name || b.categories?.[0]?.name || '';

      return {
        id: b.id,
        title: b.title,
        slug: b.slug,
        price: b.price,
        mrp: b.mrp,
        coverUrl: cover,
        author: authorNames || 'Techno World',
        category: categoryName,
        categories: b.categories?.map((c: any) => c.name) || (b.category ? [b.category.name] : []),
        publisher: b.publisher?.name || 'Techno World',
      };
    });

    // Asynchronously log search
    const bookIds = results.map((b: any) => b.id).slice(0, 10).join(',');
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
