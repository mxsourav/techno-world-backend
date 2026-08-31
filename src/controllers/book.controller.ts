import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Map Prisma Book to Frontend Book shape
const mapBookToFrontendShape = (book: any) => ({
  ...book,
  author: book.authors?.length ? book.authors.map((a: any) => a.name).join(', ') : 'Unknown Author',
  authorsList: book.authors?.map((a: any) => a.name) || [],
  publisher: book.publisher?.name || 'Unknown Publisher',
  category: book.category?.slug || 'uncategorized',
  bookType: book.bookType?.name,
  subjects: book.subjects?.map((s: any) => s.name) || [],
  bestseller: book.isBestseller,
  featured: book.isFeatured,
  trending: book.isTrending,
  newRelease: book.isNewArrival,
  rating: 4.5, // Default for now
  ratingsCount: Math.floor(Math.random() * 500) + 10,
  tags: book.tags ? (typeof book.tags === 'string' ? JSON.parse(book.tags) : book.tags) : [],
  coverUrl: book.coverUrl,
});

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
      const searchStr = search as string;
      // SQLite Prisma doesn't support full-text search out of the box, so we use OR with contains
      // Advanced search: Title, Author, ISBN, Code, Publisher, Subject, Tags
      where.OR = [
        { title: { contains: searchStr } },
        { isbn13: { contains: searchStr } },
        { isbn10: { contains: searchStr } },
        { bookCode: { contains: searchStr } },
        { tags: { contains: searchStr } }, // if stored as JSON string
        { authors: { some: { name: { contains: searchStr } } } },
        { publisher: { name: { contains: searchStr } } },
        { subjects: { some: { name: { contains: searchStr } } } }
      ];
    }
    if (category) {
      where.category = { slug: category as string };
    }
    if (author) {
      where.authors = { some: { slug: author as string } };
    }
    if (publisher) {
      where.publisher = { slug: publisher as string };
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
        bookType: true,
        subjects: true,
      },
      orderBy,
      skip,
      take: limit,
    });
    
    // Sort by exact match if search is active (pseudo ranking)
    if (search) {
      const s = (search as string).toLowerCase();
      books.sort((a, b) => {
        const aExact = a.title.toLowerCase() === s || a.isbn13 === s || a.isbn10 === s || a.bookCode === s;
        const bExact = b.title.toLowerCase() === s || b.isbn13 === s || b.isbn10 === s || b.bookCode === s;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      });
    }

    const total = await prisma.book.count({ where });

    const totalPages = Math.ceil(total / limit);

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
    const book = await prisma.book.findUnique({
      where: { slug, status: 'PUBLISHED' },
      include: {
        authors: true,
        publisher: true,
        category: true,
        bookType: true,
        subjects: true,
      },
    });

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
  } catch (error) {
    next(error);
  }
};
