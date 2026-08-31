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

    const books = await prisma.book.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { title: { contains: q } },
          { isbn13: { contains: q } },
          { tags: { contains: q } },
          { authors: { some: { name: { contains: q } } } },
          { category: { name: { contains: q } } },
        ],
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

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
