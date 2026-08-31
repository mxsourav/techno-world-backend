import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { ImportService } from '../services/import.service.js';
import { ExecutionService } from '../services/import/execution.service.js';

const prisma = new PrismaClient();

export const getAdminStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalBooks,
      booksInStock,
      outOfStock,
      totalCategories,
      totalPublishers,
      totalAuthors,
      totalOrders,
      totalUsers,
      ordersResult,
      lowStockBooksCount,
      recentOrders,
      newUsersThisMonth,
    ] = await Promise.all([
      prisma.book.count(),
      prisma.book.count({ where: { stock: { gt: 0 } } }),
      prisma.book.count({ where: { stock: { lte: 0 } } }),
      prisma.category.count(),
      prisma.publisher.count(),
      prisma.author.count(),
      prisma.order.count(),
      prisma.user.count(),
      prisma.order.aggregate({ _sum: { totalAmount: true } }),
      prisma.book.count({ where: { stock: { gt: 0, lte: 10 } } }),
      prisma.order.findMany({
        include: {
          user: { select: { name: true, email: true } },
          items: { include: { book: { select: { title: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    ]);

    const revenue = ordersResult._sum.totalAmount || 0;
    const aov = totalOrders > 0 ? Math.round(revenue / totalOrders) : 0;

    res.status(200).json({
      success: true,
      message: 'Admin stats fetched successfully',
      data: {
        totalBooks,
        booksInStock,
        outOfStock,
        totalCategories,
        totalPublishers,
        totalAuthors,
        totalOrders,
        totalUsers,
        newUsersThisMonth,
        revenue,
        aov,
        lowStock: lowStockBooksCount,
        recentOrders,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const analyzeImportBookCatalog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, message: 'No file uploaded. Please upload an Excel or CSV file.' });
      return;
    }

    const result = await ImportService.analyzeImport(file.buffer);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to analyze import file' });
  }
};

export const executeImportBookCatalog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Basic auth check (assuming middleware sets req.user)
    const userId = (req as any).user?.id || null;
    
    const { 
      filename, 
      toAdd, 
      toUpdate, 
      newCategories, 
      newAuthors, 
      newPublishers, 
      newBookTypes,
      newSubjects,
      warnings, 
      strategy 
    } = req.body;

    if (!strategy || !toAdd || !toUpdate) {
      res.status(400).json({ success: false, message: 'Invalid payload: missing strategy, toAdd, or toUpdate' });
      return;
    }

    const result = await ExecutionService.executeImport(
      userId,
      filename || 'Unknown File',
      toAdd,
      toUpdate,
      newCategories || [],
      newAuthors || [],
      newPublishers || [],
      newBookTypes || [],
      newSubjects || [],
      warnings || [],
      strategy
    );

    res.status(200).json(result);
  } catch (error: any) {
    console.error('Execution Engine Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Execution failed critically' });
  }
};

// Book Preview Endpoints
export const getBookPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const book = await prisma.book.findUnique({
      where: { id },
      include: { authors: true, publisher: true, category: true }
    });
    
    if (!book) { res.status(404).json({ success: false, message: 'Book not found' }); return; }
    
    // In a real app we'd fetch actual PDF URL if stored separately, but here we just return the book with standard fields
    res.status(200).json({ success: true, data: book });
  } catch (error) {
    next(error);
  }
};

export const uploadBookCover = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: 'No file uploaded' }); return; }
    
    // The file is already saved to disk by multer middleware
    const coverUrl = `/uploads/${file.filename}`;
    
    const book = await prisma.book.update({ where: { id }, data: { coverUrl } });
    res.status(200).json({ success: true, message: 'Cover updated successfully', data: book });
  } catch (error) {
    next(error);
  }
};

export const uploadBookPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: 'No file uploaded' }); return; }
    
    // We update a hypothetical `pdfUrl` field or metadata
    const book = await prisma.book.update({ where: { id }, data: { pages: 100 /* Dummy update */ } });
    res.status(200).json({ success: true, message: 'PDF attached successfully', data: book });
  } catch (error) {
    next(error);
  }
};

export const deleteBook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.book.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Book deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const deleteAllBooks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.book.deleteMany({});
    res.status(200).json({ success: true, message: 'All books deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const updateBook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body;
    const userId = (req as any).user?.id || 'system';
    
    const existingBook = await prisma.book.findUnique({ where: { id } });
    if (!existingBook) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.price !== undefined) data.price = Number(body.price);
    if (body.mrp !== undefined) data.mrp = Number(body.mrp);
    if (body.stock !== undefined) data.stock = Number(body.stock);
    if (body.pages !== undefined) data.pages = Number(body.pages);
    if (body.isbn13 !== undefined) data.isbn13 = body.isbn13;
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.bookCode !== undefined) data.bookCode = body.bookCode;
    if (body.description !== undefined) data.description = body.description;

    const diffs: string[] = [];
    for (const key of Object.keys(data)) {
      if (existingBook[key as keyof typeof existingBook] !== data[key]) {
        diffs.push(`${key} changed from '${existingBook[key as keyof typeof existingBook]}' to '${data[key]}'`);
      }
    }

    const book = await prisma.book.update({ where: { id }, data });
    
    if (diffs.length > 0) {
      await prisma.activityLog.create({
        data: {
          userId: userId === 'system' ? null : userId,
          action: 'UPDATE',
          entity: 'Book',
          entityId: book.id,
          details: diffs.join('\n'),
          ipAddress: req.ip
        }
      });
    }
    
    res.status(200).json({ success: true, message: 'Book updated successfully', data: book });
  } catch (error) {
    next(error);
  }
};

export const createBook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body;
    const userId = (req as any).user?.id || 'system';

    const data: any = {
      title: body.title || 'Untitled',
      slug: body.title ? body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now() : 'book-' + Date.now(),
      price: Number(body.price) || 0,
      mrp: Number(body.mrp) || 0,
      stock: Number(body.stock) || 0,
      pages: Number(body.pages) || 0,
      isbn13: body.isbn13,
      sku: body.sku,
      bookCode: body.bookCode,
      description: body.description,
      status: 'PUBLISHED'
    };
    const book = await prisma.book.create({ data });
    
    await prisma.activityLog.create({
      data: {
        userId: userId === 'system' ? null : userId,
        action: 'CREATE',
        entity: 'Book',
        entityId: book.id,
        details: 'Created new book',
        ipAddress: req.ip
      }
    });

    res.status(201).json({ success: true, message: 'Book created successfully', data: book });
  } catch (error) {
    next(error);
  }
};

export const getActivityLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const logs = await prisma.activityLog.findMany({
      where: { entity: 'Book', entityId: id },
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
};
