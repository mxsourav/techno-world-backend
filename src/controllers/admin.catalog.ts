import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAdminCatalog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const { search, tab, category, publisher } = req.query;

    const where: Prisma.BookWhereInput = {};

    // Filter by Tab
    if (tab && tab !== 'all') {
      switch (tab) {
        case 'published':
          where.status = 'PUBLISHED';
          break;
        case 'draft':
          where.status = 'DRAFT';
          break;
        case 'archived':
          where.status = 'ARCHIVED';
          break;
        case 'low_stock':
          where.stock = { lte: 20, gt: 0 }; // Simplified low stock
          break;
        case 'out_of_stock':
          where.stock = 0;
          break;
      }
    }

    if (search) {
      const searchStr = search as string;
      where.OR = [
        { title: { contains: searchStr } },
        { isbn13: { contains: searchStr } },
        { isbn10: { contains: searchStr } },
        { sku: { contains: searchStr } },
      ];
    }
    
    if (category) {
      where.category = { slug: category as string };
    }
    
    if (publisher) {
      where.publisher = { slug: publisher as string };
    }

    const [books, totalCount] = await Promise.all([
      prisma.book.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          category: true,
          publisher: true,
        }
      }),
      prisma.book.count({ where })
    ]);

    // Calculate Health Score dynamically and map results
    const mappedBooks = books.map(book => {
      let score = 100;
      if (!book.coverUrl) score -= 20;
      if (!book.isbn13 && !book.isbn10) score -= 20;
      if (!book.description) score -= 15;
      if (!book.categoryId) score -= 10;
      
      let health = 'Excellent';
      if (score < 60) health = 'Needs Attention';
      else if (score < 90) health = 'Good';

      return {
        ...book,
        health,
        healthScore: score,
        categoryName: book.category?.name,
        publisherName: book.publisher?.name,
      };
    });

    // Get KPIs for Smart Header
    const [totalProducts, activeProducts, draftProducts, outOfStockProducts] = await Promise.all([
      prisma.book.count(),
      prisma.book.count({ where: { status: 'PUBLISHED' } }),
      prisma.book.count({ where: { status: 'DRAFT' } }),
      prisma.book.count({ where: { stock: 0 } })
    ]);

    // Fast estimation of inventory value using raw SQL or Prisma aggregate
    const inventoryAggr = await prisma.book.aggregate({
      _sum: {
        price: true, // we can't cleanly do sum(stock * price) in prisma without raw query, so we'll approximate or use a raw query
      }
    });
    
    // For exact calculation, raw query is needed
    const rawInvValue: any[] = await prisma.$queryRaw`SELECT SUM(stock * COALESCE(costPrice, price)) as totalValue FROM Book`;
    const inventoryValue = rawInvValue[0]?.totalValue || 0;

    res.status(200).json({
      success: true,
      message: 'Catalog fetched',
      data: mappedBooks,
      meta: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
      kpis: {
        totalProducts,
        activeProducts,
        draftProducts,
        outOfStockProducts,
        inventoryValue: Number(inventoryValue)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const quickUpdateStock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { stock, reservedStock } = req.body;
    
    const data: any = {};
    if (typeof stock === 'number') data.stock = stock;
    if (typeof reservedStock === 'number') data.reservedStock = reservedStock;

    const book = await prisma.book.update({
      where: { id },
      data
    });

    res.status(200).json({ success: true, data: book });
  } catch (error) {
    next(error);
  }
};
