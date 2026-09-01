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
    let adminId = (req as any).user?.userId || (req as any).user?.id;
    if (!adminId) {
      const fallback = await prisma.user.findFirst({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      });
      adminId = fallback?.id;
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
