import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  extractTokens,
  buildPrismaSearchWhere,
  scoreBook,
  fuzzyScoreBook
} from '../utils/searchEngine.js';


const splitAuthorString = (raw: string): string[] => {
  if (!raw || !raw.trim()) return [];
  const normalized = raw.replace(/\)\s*(?=[A-Z])/g, '), ');
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    if ((ch === ',' || ch === ';') && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

// Map Prisma Book to Frontend Book shape
const mapBookToFrontendShape = (book: any) => {
  let galleryUrls: string[] = [];
  if (Array.isArray(book.galleryUrls)) {
    galleryUrls = book.galleryUrls;
  } else if (typeof book.galleryUrls === 'string') {
    try {
      galleryUrls = JSON.parse(book.galleryUrls);
    } catch {}
  }
  if (!galleryUrls.length && Array.isArray(book.images) && book.images.length > 0) {
    galleryUrls = book.images.map((img: any) => img.secureUrl);
  }

  // Filter out any broken placeholder strings
  galleryUrls = galleryUrls.filter(u => typeof u === 'string' && u.trim() && !u.includes('placeholder-book.jpg'));

  // Resolve coverUrl: If book.coverUrl is missing, empty, or placeholder, use the 1st gallery image
  let coverUrl = book.coverUrl;
  if (!coverUrl || coverUrl.includes('placeholder-book.jpg') || coverUrl === '/placeholder-book.jpg') {
    coverUrl = galleryUrls.length > 0 ? galleryUrls[0] : null;
    // Auto-heal the database in background if book has an id
    if (book.id && coverUrl && coverUrl !== book.coverUrl) {
      prisma.book.update({
        where: { id: book.id },
        data: { coverUrl },
      }).catch(() => {});
    }
  }

  const cleanedAuthorsList = (book.authors || [])
    .flatMap((a: any) => splitAuthorString(a?.name || ''))
    .filter((name: string) => name && name.toLowerCase() !== 'unknown author');

  return {
    ...book,
    author: cleanedAuthorsList.length ? cleanedAuthorsList.join(', ') : '',
    authorsList: cleanedAuthorsList,
    publisher: book.publisher?.name || 'Unknown Publisher',
    category: book.category?.slug || (book.categories?.[0]?.slug) || 'uncategorized',
    categories: (book.categories && book.categories.length > 0)
      ? book.categories.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug }))
      : (book.category ? [{ id: book.category.id, name: book.category.name, slug: book.category.slug }] : []),
    categoryNames: (book.categories && book.categories.length > 0)
      ? book.categories.map((c: any) => c.name)
      : (book.category ? [book.category.name] : []),
    bookType: book.bookType?.name,
    subjects: book.subjects?.map((s: any) => s.name) || [],
    bestseller: book.isBestseller,
    featured: book.isFeatured,
    trending: book.isTrending,
    newRelease: book.isNewArrival,
    rating: 4.5, // Default for now
    ratingsCount: Math.floor(Math.random() * 500) + 10,
    tags: book.tags ? (typeof book.tags === 'string' ? JSON.parse(book.tags) : book.tags) : [],
    coverUrl,
    images: book.images || [],
    galleryUrls,
    previewPdfUrl: book.previewPdfUrl || null,
  };
};

export const getBooks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const {
      search,
      category,
      sort,
      author,
      publisher,
      featured,
      newArrival,
      bestSeller,
      ids,
      subject,
      bookType,
      language,
      edition,
      minPrice,
      maxPrice,
      inStock
    } = req.query;

    const where: Prisma.BookWhereInput = {
      status: 'PUBLISHED',
    };

    if (ids && typeof ids === 'string') {
      const idArray = ids.split(',');
      where.id = { in: idArray };
    }

    if (search) {
      const searchStr = (search as string).trim();
      const searchWhere = buildPrismaSearchWhere(searchStr);
      if (searchWhere?.OR) {
        if (where.AND) {
          if (Array.isArray(where.AND)) {
            (where.AND as any[]).push({ OR: searchWhere.OR });
          } else {
            where.AND = [where.AND as any, { OR: searchWhere.OR }];
          }
        } else {
          where.OR = searchWhere.OR;
        }
      }
    }
    if (category) {
      const catSlug = (category as string).trim();
      const catCondition = {
        OR: [
          { category: { slug: catSlug } },
          { categories: { some: { slug: catSlug } } },
        ]
      };
      if (where.AND) {
        if (Array.isArray(where.AND)) {
          (where.AND as any[]).push(catCondition);
        } else {
          where.AND = [where.AND as any, catCondition];
        }
      } else {
        where.AND = [catCondition];
      }
    }
    if (author) {
      where.authors = {
        some: {
          OR: [
            { slug: author as string },
            { name: { contains: author as string, mode: 'insensitive' } }
          ]
        }
      };
    }
    if (publisher) {
      where.publisher = {
        OR: [
          { slug: publisher as string },
          { name: { contains: publisher as string, mode: 'insensitive' } }
        ]
      };
    }
    if (subject) {
      where.subjects = { some: { slug: subject as string } };
    }
    if (bookType) {
      where.bookType = { slug: bookType as string };
    }
    if (language) {
      where.language = language as string;
    }
    if (edition) {
      where.edition = edition as string;
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }
    if (inStock === 'true') {
      where.stock = { gt: 0 };
    }
    
    if (featured === 'true') where.isFeatured = true;
    if (newArrival === 'true') where.isNewArrival = true;
    if (bestSeller === 'true') where.isBestseller = true;

    let orderBy: Prisma.BookOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    else if (sort === 'price_desc') orderBy = { price: 'desc' };
    else if (sort === 'title_asc') orderBy = { title: 'asc' };
    else if (sort === 'title_desc') orderBy = { title: 'desc' };

    let books = await prisma.book.findMany({
      where,
      include: {
        authors: true,
        publisher: true,
        category: true,
        categories: true,
        bookType: true,
        subjects: true,
      },
      orderBy,
      skip,
      take: limit,
    });
    
    // Relevance scoring and typo fallback if search is active
    let total = 0;
    if (search) {
      const searchStr = (search as string).trim();
      const tokens = extractTokens(searchStr);

      if (books.length === 0 && tokens.some(t => t.length >= 4)) {
        try {
          const candidates = await prisma.book.findMany({
            where: { status: 'PUBLISHED' },
            include: {
              authors: true,
              publisher: true,
              category: true,
              categories: true,
              bookType: true,
              subjects: true,
            },
            take: 600,
          });

          const fuzzyMatched: { book: any; score: number }[] = [];
          for (const cand of candidates) {
            const fScore = fuzzyScoreBook(cand, tokens);
            if (fScore >= 30) {
              fuzzyMatched.push({ book: cand, score: fScore });
            }
          }

          fuzzyMatched.sort((a, b) => b.score - a.score);
          total = fuzzyMatched.length;
          books = fuzzyMatched.slice(skip, skip + limit).map(item => item.book);
        } catch (fErr) {
          console.error('Fuzzy search fallback error in getBooks:', fErr);
          total = await prisma.book.count({ where });
        }
      } else {
        books.sort((a, b) => {
          const scoreA = scoreBook(a, searchStr, tokens);
          const scoreB = scoreBook(b, searchStr, tokens);
          return scoreB - scoreA;
        });
        total = await prisma.book.count({ where });
      }
    } else {
      total = await prisma.book.count({ where });
    }

    const totalPages = Math.ceil(total / limit);

    if (search && typeof search === 'string' && search.trim().length >= 2) {
      const topBookIds = books.map((b: any) => b.id).slice(0, 10).join(',');
      const userId = (req as any).user?.userId || (req as any).user?.id || null;
      prisma.searchLog.create({
        data: {
          query: (search as string).trim().toLowerCase(),
          resultsCount: total,
          source: 'catalog',
          userId,
          matchedBookIds: topBookIds || null,
        }
      }).catch(err => console.error('Failed to log catalog search:', err));
    }

    res.status(200).json({
      success: true,
      message: 'Books fetched successfully',
      data: books.map(mapBookToFrontendShape),
      meta: {
        page,
        limit,
        total,
        totalPages,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getBookBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      res.status(404).json({
        success: false,
        message: 'Book not found',
      });
      return;
    }

    const cleanSlug = slug.trim();

    // Query with 6-second timeout race guard to protect against hanging DB connections
    const queryPromise = prisma.book.findFirst({
      where: {
        OR: [{ slug: cleanSlug }, { id: cleanSlug }],
        status: 'PUBLISHED',
      },
      include: {
        authors: true,
        publisher: true,
        category: true,
        categories: true,
        bookType: true,
        subjects: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });

    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Database query timed out')), 6000)
    );

    const book = await Promise.race([queryPromise, timeoutPromise]);

    if (!book) {
      res.status(404).json({
        success: false,
        message: 'Book not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Book fetched successfully',
      data: mapBookToFrontendShape(book),
    });
  } catch (error: any) {
    if (error?.message === 'Database query timed out') {
      res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please retry shortly.',
      });
      return;
    }
    next(error);
  }
};
