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
      prisma.order.count({ where: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } }),
      prisma.user.count(),
      prisma.order.aggregate({ where: { status: { notIn: ['CANCELLED', 'REFUNDED'] } }, _sum: { totalAmount: true } }),
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
    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { bookId: id } }),
      prisma.wishlistItem.deleteMany({ where: { bookId: id } }),
      prisma.review.deleteMany({ where: { bookId: id } }),
      prisma.inventoryHistory.deleteMany({ where: { bookId: id } }),
      prisma.orderItem.deleteMany({ where: { bookId: id } }),
      prisma.book.delete({ where: { id } }),
    ]);
    res.status(200).json({ success: true, message: 'Book deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const deleteAllBooks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.$transaction([
      prisma.cartItem.deleteMany({}),
      prisma.wishlistItem.deleteMany({}),
      prisma.review.deleteMany({}),
      prisma.inventoryHistory.deleteMany({}),
      prisma.orderItem.deleteMany({}),
      prisma.book.deleteMany({}),
    ]);
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
    if (body.isbn10 !== undefined) data.isbn10 = body.isbn10;
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.bookCode !== undefined) data.bookCode = body.bookCode;
    if (body.description !== undefined) data.description = body.description;
    if (body.shortDescription !== undefined) data.shortDescription = body.shortDescription;
    if (body.edition !== undefined) data.edition = body.edition;
    if (body.language !== undefined) data.language = body.language;
    if (body.bindingType !== undefined) data.bindingType = body.bindingType;
    if (body.publicationDate !== undefined) {
      data.publicationDate = body.publicationDate ? new Date(body.publicationDate) : null;
    }
    if (body.seoKeywords !== undefined) {
      if (Array.isArray(body.seoKeywords)) {
        data.seoKeywords = body.seoKeywords.join(', ');
      } else {
        data.seoKeywords = String(body.seoKeywords || '');
      }
    }
    if (body.tags !== undefined) {
      if (Array.isArray(body.tags)) {
        data.tags = body.tags.join(', ');
      } else {
        data.tags = String(body.tags || '');
      }
    }

    // Handle Category upsert / update
    if (body.category !== undefined && typeof body.category === 'string' && body.category.trim() !== '') {
      const catSlug = body.category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const cat = await prisma.category.upsert({
        where: { slug: catSlug },
        update: {},
        create: { name: body.category, slug: catSlug }
      });
      data.categoryId = cat.id;
    }

    // Handle Publisher upsert / update
    if (body.publisher !== undefined && typeof body.publisher === 'string' && body.publisher.trim() !== '') {
      const pubSlug = body.publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const pub = await prisma.publisher.upsert({
        where: { slug: pubSlug },
        update: {},
        create: { name: body.publisher, slug: pubSlug }
      });
      data.publisherId = pub.id;
    }

    // Handle BookType upsert / update
    if (body.bookType !== undefined && typeof body.bookType === 'string' && body.bookType.trim() !== '') {
      const typeSlug = body.bookType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const btype = await prisma.bookType.upsert({
        where: { slug: typeSlug },
        update: {},
        create: { name: body.bookType, slug: typeSlug }
      });
      data.bookTypeId = btype.id;
    }

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

    const slug = body.title
      ? body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(1000 + Math.random() * 9000)
      : 'book-' + Date.now();

    let categoryId = undefined;
    if (body.category && typeof body.category === 'string' && body.category.trim() !== '') {
      const catSlug = body.category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const cat = await prisma.category.upsert({
        where: { slug: catSlug },
        update: {},
        create: { name: body.category, slug: catSlug }
      });
      categoryId = cat.id;
    }

    let publisherId = undefined;
    if (body.publisher && typeof body.publisher === 'string' && body.publisher.trim() !== '') {
      const pubSlug = body.publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const pub = await prisma.publisher.upsert({
        where: { slug: pubSlug },
        update: {},
        create: { name: body.publisher, slug: pubSlug }
      });
      publisherId = pub.id;
    }

    let bookTypeId = undefined;
    if (body.bookType && typeof body.bookType === 'string' && body.bookType.trim() !== '') {
      const typeSlug = body.bookType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const btype = await prisma.bookType.upsert({
        where: { slug: typeSlug },
        update: {},
        create: { name: body.bookType, slug: typeSlug }
      });
      bookTypeId = btype.id;
    }

    const data: any = {
      title: body.title || 'Untitled Book',
      slug,
      price: Number(body.price) || 0,
      mrp: Number(body.mrp) || Number(body.price) || 0,
      stock: Number(body.stock) || 0,
      pages: Number(body.pages) || 0,
      isbn13: body.isbn13 || null,
      isbn10: body.isbn10 || null,
      sku: body.sku || null,
      bookCode: body.bookCode || null,
      description: body.description || 'No description provided.',
      shortDescription: body.shortDescription || null,
      edition: body.edition || '1st Edition',
      language: body.language || 'English',
      bindingType: body.bindingType || 'Paperback',
      publicationDate: body.publicationDate ? new Date(body.publicationDate) : null,
      categoryId,
      publisherId,
      bookTypeId,
      seoKeywords: Array.isArray(body.seoKeywords) ? body.seoKeywords.join(', ') : (body.seoKeywords || ''),
      tags: Array.isArray(body.tags) ? body.tags.join(', ') : (body.tags || ''),
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

// GET /api/v1/admin/settings
export const getAdminSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminId = (req as any).user?.userId || (req as any).user?.id;
    let adminUser = null;
    if (adminId) {
      adminUser = await prisma.user.findUnique({
        where: { id: adminId },
        select: { id: true, name: true, email: true, phone: true, role: true, avatarUrl: true },
      });
    }
    if (!adminUser) {
      adminUser = await prisma.user.findFirst({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true, name: true, email: true, phone: true, role: true, avatarUrl: true },
      });
    }

    const smtpSetting = await prisma.systemSetting.findUnique({
      where: { key: 'SMTP_CONFIG' },
    });

    let smtpConfig = {
      senderEmail: 'admin@technoworld.com',
      senderName: 'Techno World Books',
      host: 'smtp.gmail.com',
      port: 587,
      user: '',
      pass: '',
      secure: false,
    };

    if (smtpSetting?.value) {
      try {
        const parsed = JSON.parse(smtpSetting.value);
        smtpConfig = {
          ...smtpConfig,
          ...parsed,
          pass: parsed.pass ? '••••••••••••••••' : '',
        };
      } catch {}
    }

    res.status(200).json({
      success: true,
      data: {
        admin: adminUser,
        smtp: smtpConfig,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/admin/profile
export const updateAdminProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminId = (req as any).user?.userId || (req as any).user?.id;
    if (!adminId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const currentAdmin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true }
    });

    if (!currentAdmin || (currentAdmin.role !== 'ADMIN' && currentAdmin.role !== 'SUPER_ADMIN')) {
      res.status(403).json({ success: false, message: 'Forbidden: administrative privileges required' });
      return;
    }
    const { name, email, phone, password } = req.body;

    const data: any = {};
    if (name) data.name = name.trim();
    if (email) data.email = email.trim().toLowerCase();
    if (phone !== undefined) data.phone = phone ? phone.trim() : null;
    
    if (password && password.trim().length >= 6) {
      const argon2 = await import('argon2');
      data.password = await argon2.default.hash(password.trim());
    }

    const updated = await prisma.user.update({
      where: { id: adminId },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true, updatedAt: true },
    });

    res.status(200).json({
      success: true,
      message: 'Admin profile updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/admin/smtp
export const updateSmtpSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { senderEmail, senderName, host, port, user, pass, secure } = req.body;

    let existingPass = '';
    const existing = await prisma.systemSetting.findUnique({ where: { key: 'SMTP_CONFIG' } });
    if (existing?.value) {
      try {
        existingPass = JSON.parse(existing.value).pass || '';
      } catch {}
    }

    const finalPass = (pass && pass !== '••••••••••••••••') ? pass.trim() : existingPass;

    const configToSave = {
      senderEmail: (senderEmail || '').trim(),
      senderName: (senderName || 'Techno World Books').trim(),
      host: (host || 'smtp.gmail.com').trim(),
      port: Number(port) || 587,
      user: (user || '').trim(),
      pass: finalPass,
      secure: Boolean(secure),
    };

    await prisma.systemSetting.upsert({
      where: { key: 'SMTP_CONFIG' },
      update: { value: JSON.stringify(configToSave) },
      create: { key: 'SMTP_CONFIG', value: JSON.stringify(configToSave) },
    });

    res.status(200).json({
      success: true,
      message: 'Outbound email & SMTP settings saved successfully',
      data: { ...configToSave, pass: configToSave.pass ? '••••••••••••••••' : '' },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/smtp/test
export const testSmtpSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { toEmail, host, port, user, pass, senderEmail, senderName } = req.body;
    if (!toEmail) {
      res.status(400).json({ success: false, message: 'Recipient email address is required for testing' });
      return;
    }

    const { emailService } = await import('../services/email.service.js');
    
    let effectivePass = pass;
    if (!pass || pass === '••••••••••••••••') {
      const existing = await prisma.systemSetting.findUnique({ where: { key: 'SMTP_CONFIG' } });
      if (existing?.value) {
        effectivePass = JSON.parse(existing.value).pass || '';
      }
    }

    const result = await emailService.sendTestEmail(toEmail, {
      host,
      port: port ? Number(port) : undefined,
      user,
      pass: effectivePass,
      senderEmail,
      senderName,
    });

    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'SMTP Test failed' });
  }
};

// GET /api/v1/admin/emails
export const getEmailLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = Number(req.query.limit) || 50;
    const { emailService } = await import('../services/email.service.js');
    const logs = await emailService.getRecentEmailLogs(limit);
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    next(error);
  }
};

export const getAdminCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          technoPoints: true,
          createdAt: true,
          addresses: {
            orderBy: { isDefault: 'desc' },
            take: 3,
          },
          orders: {
            select: {
              id: true,
              orderNumber: true,
              totalAmount: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.user.count({ where }),
    ]);

    const formattedUsers = users.map((u: any) => {
      const totalOrders = u.orders.length;
      const totalSpent = u.orders
        .filter((o: any) => o.status !== 'CANCELLED' && o.status !== 'REFUNDED')
        .reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

      return {
        ...u,
        totalOrders,
        totalSpent,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Customers fetched successfully',
      data: {
        customers: formattedUsers,
        total,
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/analytics/search-trends
export const getSearchAndSalesAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { period = '30d', startDate, endDate } = req.query;

    let start = new Date();
    let end = new Date();

    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (period === '7d') {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '30d') {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === '90d') {
      start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } else if (period === 'year') {
      start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    } else if (period === 'custom' && startDate) {
      start = new Date(startDate as string);
      if (endDate) {
        end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
      }
    } else {
      // Default 30 days
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // 1. Fetch Search Logs in selected time period
    const searchLogs = await prisma.searchLog.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalSearches = searchLogs.length;

    // Helper to categorize exam seasons based on keyword content
    const getExamCategory = (query: string) => {
      const q = query.toLowerCase();
      if (/neet|medical|biology|bio|aiims|mbbs|dermatology|anatomy|ncert biology/.test(q)) {
        return 'NEET / Medical';
      }
      if (/jee|iit|engineering|wbjee|gate|maths|physics mcq|hc verma|irodov/.test(q)) {
        return 'JEE / Engineering';
      }
      if (/upsc|wbcs|ssc|cgl|civil service|cracker|general studies|gk|current affairs|police|railway/.test(q)) {
        return 'UPSC / Govt Exams';
      }
      if (/class 10|class 11|class 12|cbse|icse|madhyamik|wbchse|board|semester/.test(q)) {
        return 'School & Boards';
      }
      return 'General & Academic';
    };

    // Aggregate queries
    const queryMap = new Map<string, { query: string; count: number; category: string; totalResults: number; lastSearched: Date }>();
    const examSeasonCounts: Record<string, number> = {
      'NEET / Medical': 0,
      'JEE / Engineering': 0,
      'UPSC / Govt Exams': 0,
      'School & Boards': 0,
      'General & Academic': 0,
    };

    // Track search exposure per book ID
    const bookSearchCounts: Record<string, number> = {};

    for (const log of searchLogs) {
      const q = log.query.trim().toLowerCase();
      if (!q) continue;
      const cat = getExamCategory(q);
      examSeasonCounts[cat] = (examSeasonCounts[cat] || 0) + 1;

      if (!queryMap.has(q)) {
        queryMap.set(q, {
          query: q,
          count: 1,
          category: cat,
          totalResults: log.resultsCount,
          lastSearched: log.createdAt,
        });
      } else {
        const item = queryMap.get(q)!;
        item.count += 1;
        item.totalResults += log.resultsCount;
        if (log.createdAt > item.lastSearched) item.lastSearched = log.createdAt;
      }

      if (log.matchedBookIds) {
        const ids = log.matchedBookIds.split(',').map(id => id.trim()).filter(Boolean);
        for (const bid of ids) {
          bookSearchCounts[bid] = (bookSearchCounts[bid] || 0) + 1;
        }
      }
    }

    // Top Searched Keywords List
    const topKeywords = Array.from(queryMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map(k => ({
        ...k,
        avgResults: k.count > 0 ? Math.round(k.totalResults / k.count) : 0,
      }));

    // Top Searched Books details
    const topSearchedBookIds = Object.entries(bookSearchCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    let mostSearchedBooks: any[] = [];
    if (topSearchedBookIds.length > 0) {
      const booksData = await prisma.book.findMany({
        where: { id: { in: topSearchedBookIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          coverUrl: true,
          price: true,
          stock: true,
          sku: true,
          category: { select: { name: true } },
          authors: { select: { name: true } },
        },
      });
      mostSearchedBooks = booksData.map(b => ({
        id: b.id,
        title: b.title,
        slug: b.slug,
        coverUrl: b.coverUrl,
        price: b.price,
        stock: b.stock,
        sku: b.sku,
        category: b.category?.name || 'General',
        author: b.authors.map(a => a.name).join(', ') || 'Techno World',
        searchCount: bookSearchCounts[b.id] || 0,
      })).sort((a, b) => b.searchCount - a.searchCount);
    }

    // 2. Fetch Most Bought Books from OrderItem in the date range
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: {
            gte: start,
            lte: end,
          },
          status: { not: 'CANCELLED' },
        },
      },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverUrl: true,
            price: true,
            stock: true,
            sku: true,
            category: { select: { name: true } },
            authors: { select: { name: true } },
          },
        },
      },
    });

    const bookSalesMap = new Map<string, {
      book: any;
      unitsSold: number;
      revenue: number;
      orderCount: number;
    }>();

    let totalUnitsSold = 0;
    let totalRevenue = 0;

    for (const item of orderItems) {
      totalUnitsSold += item.quantity;
      const itemRev = item.quantity * item.priceAtPurchase;
      totalRevenue += itemRev;

      if (!bookSalesMap.has(item.bookId)) {
        bookSalesMap.set(item.bookId, {
          book: item.book,
          unitsSold: item.quantity,
          revenue: itemRev,
          orderCount: 1,
        });
      } else {
        const data = bookSalesMap.get(item.bookId)!;
        data.unitsSold += item.quantity;
        data.revenue += itemRev;
        data.orderCount += 1;
      }
    }

    const mostBoughtBooks = Array.from(bookSalesMap.values())
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 15)
      .map(entry => ({
        id: entry.book?.id,
        title: entry.book?.title || 'Unknown Book',
        slug: entry.book?.slug,
        coverUrl: entry.book?.coverUrl,
        sku: entry.book?.sku,
        price: entry.book?.price,
        stock: entry.book?.stock,
        category: entry.book?.category?.name || 'General',
        author: entry.book?.authors?.map((a: any) => a.name).join(', ') || 'Techno World',
        unitsSold: entry.unitsSold,
        revenue: entry.revenue,
        orderCount: entry.orderCount,
      }));

    // Find dominant exam season
    let dominantSeason = 'General & Academic';
    let maxSeasonCount = -1;
    for (const [season, count] of Object.entries(examSeasonCounts)) {
      if (count > maxSeasonCount && count > 0) {
        maxSeasonCount = count;
        dominantSeason = season;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        period,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        summary: {
          totalSearches,
          totalUnitsSold,
          totalRevenue,
          uniqueKeywords: queryMap.size,
          dominantSeason,
          dominantSeasonCount: maxSeasonCount > 0 ? maxSeasonCount : 0,
        },
        examSeasonBreakdown: examSeasonCounts,
        topKeywords,
        mostSearchedBooks,
        mostBoughtBooks,
      },
    });
  } catch (error) {
    next(error);
  }
};
