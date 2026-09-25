import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { ImportService } from '../services/import.service.js';
import { ExecutionService } from '../services/import/execution.service.js';
import { CloudinaryService } from '../services/cloudinary.service.js';
import { emailService } from '../services/email.service.js';
import { notifyBookUpdated, submitToIndexNow } from '../services/indexnow.service.js';
import { SalesReportService } from '../services/sales-report.service.js';


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

    const revenue = Number(ordersResult._sum.totalAmount || 0);
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
      include: {
        authors: true,
        publisher: true,
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
      }
    });
    
    if (!book) { res.status(404).json({ success: false, message: 'Book not found' }); return; }
    
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

    const book = await prisma.book.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    // 1. Delete all Cloudinary assets associated with this book
    try {
      if (book.images && book.images.length > 0) {
        for (const img of book.images) {
          if (img.publicId) {
            await CloudinaryService.deleteAsset(img.publicId, (img.resourceType as any) || 'image');
          }
        }
      }
      if (book.coverPublicId && !book.images?.some((img) => img.publicId === book.coverPublicId)) {
        await CloudinaryService.deleteAsset(book.coverPublicId, 'image');
      }
      if (book.previewPdfPublicId) {
        await CloudinaryService.deleteAsset(book.previewPdfPublicId, (book.previewPdfResourceType as any) || 'raw');
      }
      await CloudinaryService.deleteFolder(CloudinaryService.getBookImagesFolder(book.slug));
      await CloudinaryService.deleteFolder(CloudinaryService.getBookDocsFolder(book.slug));
      await CloudinaryService.deleteFolder(CloudinaryService.getBookRootFolder(book.slug));
    } catch (cleanupErr) {
      console.warn(`[Cloudinary] Asset cleanup warning for book ${book.slug}:`, cleanupErr);
    }

    // 2. Delete database records in transaction
    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { bookId: id } }),
      prisma.wishlistItem.deleteMany({ where: { bookId: id } }),
      prisma.review.deleteMany({ where: { bookId: id } }),
      prisma.inventoryHistory.deleteMany({ where: { bookId: id } }),
      prisma.orderItem.deleteMany({ where: { bookId: id } }),
      prisma.bookImage.deleteMany({ where: { bookId: id } }),
      prisma.book.delete({ where: { id } }),
    ]);

    res.status(200).json({ success: true, message: 'Book and associated media deleted successfully' });
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

// Helper: Sanitize unique identifier fields (empty strings -> null)
const sanitizeUniqueField = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
};

// Helper: Safely parse publication date
const parsePublicationDate = (val: any): Date | null => {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const dateStr = s.length === 7 ? `${s}-01T00:00:00.000Z` : s;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

// Helper: Normalize entity slug
const normalizeEntitySlug = (name: string): string => {
  const clean = (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || `entity-${Date.now()}`;
};

// Helper: Resolve / upsert Author records
const resolveAuthors = async (authorsInput: any): Promise<{ id: string }[]> => {
  const authorNames: string[] = [];
  if (Array.isArray(authorsInput)) {
    for (const a of authorsInput) {
      if (typeof a === 'string') {
        authorNames.push(...a.split(',').map((s) => s.trim()).filter(Boolean));
      } else if (a && typeof a === 'object' && a.name) {
        authorNames.push(String(a.name).trim());
      }
    }
  } else if (typeof authorsInput === 'string' && authorsInput.trim()) {
    authorNames.push(...authorsInput.split(',').map((s) => s.trim()).filter(Boolean));
  }

  const connectedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const name of authorNames) {
    if (!name) continue;
    const slug = normalizeEntitySlug(name);
    let author = await prisma.author.findFirst({
      where: { OR: [{ name }, { slug }] },
    });

    if (!author) {
      try {
        author = await prisma.author.create({
          data: { name, slug },
        });
      } catch {
        author = await prisma.author.findFirst({
          where: { OR: [{ name }, { slug }] },
        });
      }
    }

    if (author && !seenIds.has(author.id)) {
      seenIds.add(author.id);
      connectedIds.push(author.id);
    }
  }

  return connectedIds.map((id) => ({ id }));
};

// Helper: Resolve / upsert Subject records
const resolveSubjects = async (subjectsInput: any): Promise<{ id: string }[]> => {
  const subjectNames: string[] = [];
  if (Array.isArray(subjectsInput)) {
    for (const s of subjectsInput) {
      if (typeof s === 'string') {
        subjectNames.push(...s.split(',').map((str) => str.trim()).filter(Boolean));
      } else if (s && typeof s === 'object' && s.name) {
        subjectNames.push(String(s.name).trim());
      }
    }
  } else if (typeof subjectsInput === 'string' && subjectsInput.trim()) {
    subjectNames.push(...subjectsInput.split(',').map((s) => s.trim()).filter(Boolean));
  }

  const connectedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const name of subjectNames) {
    if (!name) continue;
    const slug = normalizeEntitySlug(name);
    let subject = await prisma.subject.findFirst({
      where: { OR: [{ name }, { slug }] },
    });

    if (!subject) {
      try {
        subject = await prisma.subject.create({
          data: { name, slug },
        });
      } catch {
        subject = await prisma.subject.findFirst({
          where: { OR: [{ name }, { slug }] },
        });
      }
    }

    if (subject && !seenIds.has(subject.id)) {
      seenIds.add(subject.id);
      connectedIds.push(subject.id);
    }
  }

  return connectedIds.map((id) => ({ id }));
};

// Helper: Resolve / upsert Category record
const resolveCategoryId = async (categoryName: string): Promise<string | undefined> => {
  const name = categoryName.trim();
  if (!name) return undefined;
  const slug = normalizeEntitySlug(name);
  let cat = await prisma.category.findFirst({
    where: { OR: [{ name }, { slug }] },
  });
  if (!cat) {
    try {
      cat = await prisma.category.create({
        data: { name, slug },
      });
    } catch {
      cat = await prisma.category.findFirst({
        where: { OR: [{ name }, { slug }] },
      });
    }
  }
  return cat?.id;
};

// Helper: Resolve / upsert Publisher record
const resolvePublisherId = async (publisherName: string): Promise<string | undefined> => {
  const name = publisherName.trim();
  if (!name) return undefined;
  const slug = normalizeEntitySlug(name);
  let pub = await prisma.publisher.findFirst({
    where: { OR: [{ name }, { slug }] },
  });
  if (!pub) {
    try {
      pub = await prisma.publisher.create({
        data: { name, slug },
      });
    } catch {
      pub = await prisma.publisher.findFirst({
        where: { OR: [{ name }, { slug }] },
      });
    }
  }
  return pub?.id;
};

// Helper: Resolve / upsert BookType record
const resolveBookTypeId = async (bookTypeName: string): Promise<string | undefined> => {
  const name = bookTypeName.trim();
  if (!name) return undefined;
  const slug = normalizeEntitySlug(name);
  let bt = await prisma.bookType.findFirst({
    where: { OR: [{ name }, { slug }] },
  });
  if (!bt) {
    try {
      bt = await prisma.bookType.create({
        data: { name, slug },
      });
    } catch {
      bt = await prisma.bookType.findFirst({
        where: { OR: [{ name }, { slug }] },
      });
    }
  }
  return bt?.id;
};

export const updateBook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.id || null;
    
    const existingBook = await prisma.book.findUnique({
      where: { id },
      include: { authors: true, subjects: true },
    });
    if (!existingBook) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const data: any = {};
    if (body.title !== undefined) data.title = String(body.title).trim();
    if (body.price !== undefined) data.price = Number(body.price) || 0;
    if (body.mrp !== undefined) data.mrp = Number(body.mrp) || Number(body.price) || 0;
    if (body.costPrice !== undefined) {
      data.costPrice = body.costPrice !== null && body.costPrice !== '' ? Number(body.costPrice) : null;
    }
    if (body.stock !== undefined) data.stock = Number(body.stock) || 0;
    if (body.reservedStock !== undefined) data.reservedStock = Number(body.reservedStock) || 0;
    if (body.reorderLevel !== undefined) data.reorderLevel = Number(body.reorderLevel) || 20;
    if (body.warehouse !== undefined) data.warehouse = body.warehouse ? String(body.warehouse).trim() : 'Main Warehouse';
    if (body.pages !== undefined) data.pages = Number(body.pages) || 0;
    if (body.isbn13 !== undefined) data.isbn13 = sanitizeUniqueField(body.isbn13);
    if (body.isbn10 !== undefined) data.isbn10 = sanitizeUniqueField(body.isbn10);
    if (body.sku !== undefined) data.sku = sanitizeUniqueField(body.sku);
    if (body.bookCode !== undefined) data.bookCode = sanitizeUniqueField(body.bookCode);
    if (body.description !== undefined) data.description = body.description;
    if (body.shortDescription !== undefined) data.shortDescription = body.shortDescription;
    if (body.edition !== undefined) data.edition = body.edition ? String(body.edition).trim() : '1st Edition';
    if (body.language !== undefined) data.language = body.language ? String(body.language).trim() : 'English';
    if (body.bindingType !== undefined) data.bindingType = body.bindingType ? String(body.bindingType).trim() : 'Paperback';
    if (body.publicationDate !== undefined) {
      data.publicationDate = parsePublicationDate(body.publicationDate);
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

    // Handle Category update
    if (body.category !== undefined && typeof body.category === 'string') {
      data.categoryId = body.category.trim() !== '' ? await resolveCategoryId(body.category) : null;
    }

    // Handle Publisher update
    if (body.publisher !== undefined && typeof body.publisher === 'string') {
      data.publisherId = body.publisher.trim() !== '' ? await resolvePublisherId(body.publisher) : null;
    }

    // Handle BookType update
    if (body.bookType !== undefined && typeof body.bookType === 'string') {
      data.bookTypeId = body.bookType.trim() !== '' ? await resolveBookTypeId(body.bookType) : null;
    }

    // Handle Authors update
    if (body.authorsList !== undefined || body.authors !== undefined || body.author !== undefined) {
      const authors = await resolveAuthors(body.authorsList || body.authors || body.author);
      data.authors = { set: authors };
    }

    // Handle Subjects update
    if (body.subjects !== undefined) {
      const subjects = await resolveSubjects(body.subjects);
      data.subjects = { set: subjects };
    }

    const diffs: string[] = [];
    for (const key of Object.keys(data)) {
      if (key !== 'authors' && key !== 'subjects' && existingBook[key as keyof typeof existingBook] !== data[key]) {
        diffs.push(`${key} changed from '${existingBook[key as keyof typeof existingBook]}' to '${data[key]}'`);
      }
    }

    const book = await prisma.book.update({
      where: { id },
      data,
      include: {
        category: true,
        publisher: true,
        bookType: true,
        authors: true,
        subjects: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
    
    if (diffs.length > 0) {
      await prisma.activityLog.create({
        data: {
          userId,
          action: 'UPDATE',
          entity: 'Book',
          entityId: book.id,
          details: diffs.join('\n'),
          ipAddress: req.ip,
        },
      });
    }

    // Ping search engines via IndexNow if published and visible
    if (book.status === 'PUBLISHED' && book.visibility) {
      notifyBookUpdated(book.slug).catch((err) =>
        console.error('[IndexNow update error]:', err?.message || err)
      );
    }
    
    res.status(200).json({ success: true, message: 'Book updated successfully', data: book });
  } catch (error) {
    next(error);
  }
};

export const createBook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.id || null;

    const baseTitle = body.title ? String(body.title).trim() : 'book';
    const cleanTitleSlug = baseTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const slug = (cleanTitleSlug || 'book') + '-' + Math.floor(1000 + Math.random() * 9000);

    const [authors, subjects, categoryId, publisherId, bookTypeId] = await Promise.all([
      resolveAuthors(body.authorsList || body.authors || body.author),
      resolveSubjects(body.subjects),
      body.category && typeof body.category === 'string' && body.category.trim() !== ''
        ? resolveCategoryId(body.category)
        : Promise.resolve(undefined),
      body.publisher && typeof body.publisher === 'string' && body.publisher.trim() !== ''
        ? resolvePublisherId(body.publisher)
        : Promise.resolve(undefined),
      body.bookType && typeof body.bookType === 'string' && body.bookType.trim() !== ''
        ? resolveBookTypeId(body.bookType)
        : Promise.resolve(undefined),
    ]);

    const data: any = {
      title: body.title ? String(body.title).trim() : 'Untitled Book',
      slug,
      price: Number(body.price) || 0,
      mrp: Number(body.mrp) || Number(body.price) || 0,
      costPrice: body.costPrice !== null && body.costPrice !== undefined && body.costPrice !== '' ? Number(body.costPrice) : null,
      stock: Number(body.stock) || 0,
      reservedStock: Number(body.reservedStock) || 0,
      reorderLevel: Number(body.reorderLevel) || 20,
      warehouse: body.warehouse ? String(body.warehouse).trim() : 'Main Warehouse',
      pages: Number(body.pages) || 0,
      isbn13: sanitizeUniqueField(body.isbn13),
      isbn10: sanitizeUniqueField(body.isbn10),
      sku: sanitizeUniqueField(body.sku),
      bookCode: sanitizeUniqueField(body.bookCode),
      description: body.description ? String(body.description) : 'No description provided.',
      shortDescription: body.shortDescription ? String(body.shortDescription) : null,
      edition: body.edition ? String(body.edition).trim() : '1st Edition',
      language: body.language ? String(body.language).trim() : 'English',
      bindingType: body.bindingType ? String(body.bindingType).trim() : 'Paperback',
      publicationDate: parsePublicationDate(body.publicationDate),
      categoryId,
      publisherId,
      bookTypeId,
      seoKeywords: Array.isArray(body.seoKeywords) ? body.seoKeywords.join(', ') : (body.seoKeywords || ''),
      tags: Array.isArray(body.tags) ? body.tags.join(', ') : (body.tags || ''),
      status: body.status || 'PUBLISHED',
      visibility: body.visibility !== undefined ? Boolean(body.visibility) : true,
    };

    if (authors.length > 0) {
      data.authors = { connect: authors };
    }
    if (subjects.length > 0) {
      data.subjects = { connect: subjects };
    }

    const book = await prisma.book.create({
      data,
      include: {
        category: true,
        publisher: true,
        bookType: true,
        authors: true,
        subjects: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
    
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'CREATE',
        entity: 'Book',
        entityId: book.id,
        details: `Created new book: ${book.title}`,
        ipAddress: req.ip,
      },
    });

    // Ping search engines via IndexNow if published and visible
    if (book.status === 'PUBLISHED' && book.visibility) {
      notifyBookUpdated(book.slug).catch((err) =>
        console.error('[IndexNow create error]:', err?.message || err)
      );
    }

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
      senderEmail: '',
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
    const { search, status, page = 1, limit = 50 } = req.query;
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

    if (status === 'ACTIVE') {
      where.isActive = true;
    } else if (status === 'BLACKLISTED' || status === 'INACTIVE') {
      where.isActive = false;
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
          isActive: true,
          technoPoints: true,
          technoWallet: true,
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

// PATCH /api/v1/admin/customers/:id/status (Blacklist / Whitelist)
export const toggleCustomerStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isActive: true, tokenVersion: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    const newActiveState = typeof isActive === 'boolean' ? isActive : !user.isActive;

    // Update user: if blacklisting, increment tokenVersion and purge active sessions to invalidate JWT
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          isActive: newActiveState,
          tokenVersion: newActiveState ? user.tokenVersion : { increment: 1 },
        },
      });

      if (!newActiveState) {
        await tx.session.deleteMany({ where: { userId: id } });
      }
    });

    // Send activity notification email to customer
    try {
      await emailService.sendAccountStatusEmail({
        recipientEmail: user.email,
        recipientName: user.name,
        status: newActiveState ? 'ACTIVATED' : 'SUSPENDED',
        reason: reason?.trim() || (newActiveState ? 'Administrative review passed' : 'Administrative compliance review'),
      });
    } catch (emailErr: any) {
      console.warn(`[toggleCustomerStatus] Failed to send status email: ${emailErr.message}`);
    }

    res.status(200).json({
      success: true,
      message: newActiveState ? 'Customer account re-activated successfully' : 'Customer blacklisted and sessions terminated',
      data: {
        id: user.id,
        isActive: newActiveState,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/customers/:id/points (Manual Loyalty Points Grant / Deduct - Points ONLY)
export const adjustCustomerPoints = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const targetIdentifier = (req.params.id || req.body.id || req.body.userId || req.body.email || '').trim();
    const { points, type = 'CREDIT', reason } = req.body;

    if (!targetIdentifier || targetIdentifier === 'undefined' || targetIdentifier === 'null') {
      res.status(400).json({ success: false, message: 'Valid customer ID or email is required' });
      return;
    }

    const pointsNum = Math.abs(parseInt(points, 10));
    if (isNaN(pointsNum) || pointsNum <= 0) {
      res.status(400).json({ success: false, message: 'Points amount must be a positive whole number' });
      return;
    }

    const isCredit = type.toUpperCase() === 'CREDIT';
    const auditReason = (reason || '').trim() || (isCredit ? 'Manual loyalty reward granted by store admin' : 'Points deduction adjustment by store admin');

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: targetIdentifier },
          { email: targetIdentifier }
        ]
      },
      select: { id: true, name: true, email: true, technoPoints: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: `Customer not found for identifier "${targetIdentifier}"` });
      return;
    }

    if (!isCredit && user.technoPoints < pointsNum) {
      res.status(400).json({
        success: false,
        message: `Cannot deduct ${pointsNum} points. Customer currently only has ${user.technoPoints} points.`,
      });
      return;
    }

    const newBalance = isCredit ? user.technoPoints + pointsNum : user.technoPoints - pointsNum;

    // Execute atomic transaction for points adjustment
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          technoPoints: newBalance,
        },
      });

      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      await tx.pointTransaction.create({
        data: {
          userId: user.id,
          points: pointsNum,
          type: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
          status: 'COMPLETED',
          description: auditReason,
          expiresAt: expiryDate,
        },
      });
    });

    // Dispatch automated email notification
    try {
      await emailService.sendPointsAdjustedEmail({
        recipientEmail: user.email,
        recipientName: user.name,
        points: pointsNum,
        type: isCredit ? 'CREDIT' : 'DEBIT',
        newBalance,
        reason: auditReason,
      });
    } catch (emailErr: any) {
      console.warn(`[adjustCustomerPoints] Failed to dispatch points email: ${emailErr.message}`);
    }

    res.status(200).json({
      success: true,
      message: `${pointsNum} TechnoPoints ${isCredit ? 'credited' : 'deducted'} successfully`,
      data: {
        id: user.id,
        technoPoints: newBalance,
        pointsAdjusted: pointsNum,
        type: isCredit ? 'CREDIT' : 'DEBIT',
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/customers/:id/details (Detailed Order History & Purchased Books)
export const getCustomerDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        technoPoints: true,
        technoWallet: true,
        createdAt: true,
        updatedAt: true,
        addresses: {
          orderBy: { isDefault: 'desc' },
        },
        orders: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            subtotal: true,
            shippingCharge: true,
            discountAmount: true,
            totalAmount: true,
            shippingCarrier: true,
            trackingNumber: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                quantity: true,
                priceAtPurchase: true,
                book: {
                  select: {
                    id: true,
                    title: true,
                    slug: true,
                    edition: true,
                    isbn13: true,
                    isbn10: true,
                    price: true,
                    mrp: true,
                    images: {
                      where: { isCover: true },
                      take: 1,
                      select: { secureUrl: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        pointTransactions: {
          select: {
            id: true,
            points: true,
            type: true,
            status: true,
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    // Compile comprehensive book purchase statistics
    const bookPurchaseMap = new Map<string, any>();
    user.orders.forEach((ord: any) => {
      ord.items.forEach((it: any) => {
        const bookId = it.book?.id;
        if (!bookId) return;

        if (bookPurchaseMap.has(bookId)) {
          const existing = bookPurchaseMap.get(bookId);
          existing.totalQuantity += it.quantity;
          existing.totalSpent += it.quantity * it.priceAtPurchase;
          existing.orderReferences.push({
            orderNumber: ord.orderNumber,
            date: ord.createdAt,
            status: ord.status,
          });
        } else {
          bookPurchaseMap.set(bookId, {
            bookId,
            title: it.book.title,
            slug: it.book.slug,
            edition: it.book.edition,
            isbn: it.book.isbn13 || it.book.isbn10 || 'N/A',
            coverImage: it.book.images?.[0]?.secureUrl || '',
            unitPrice: it.priceAtPurchase,
            totalQuantity: it.quantity,
            totalSpent: it.quantity * it.priceAtPurchase,
            lastPurchasedAt: ord.createdAt,
            orderReferences: [{
              orderNumber: ord.orderNumber,
              date: ord.createdAt,
              status: ord.status,
            }],
          });
        }
      });
    });

    const purchasedBooks = Array.from(bookPurchaseMap.values()).sort(
      (a, b) => new Date(b.lastPurchasedAt).getTime() - new Date(a.lastPurchasedAt).getTime()
    );

    const totalSpent = user.orders
      .filter((o: any) => o.status !== 'CANCELLED' && o.status !== 'REFUNDED')
      .reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

    res.status(200).json({
      success: true,
      message: 'Customer details fetched successfully',
      data: {
        customer: {
          ...user,
          totalSpent,
          totalOrders: user.orders.length,
          purchasedBooks,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/customers/export (Export CSV / Excel / SQL)
export const exportCustomerData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { format = 'csv' } = req.query;

    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        technoPoints: true,
        technoWallet: true,
        createdAt: true,
        addresses: {
          where: { isDefault: true },
          take: 1,
          select: {
            addressLine1: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        orders: {
          select: {
            totalAmount: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const exportRows = customers.map((c) => {
      const addr = c.addresses[0] || {};
      const totalOrders = c.orders.length;
      const totalSpent = c.orders
        .filter((o) => o.status !== 'CANCELLED' && o.status !== 'REFUNDED')
        .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

      return {
        id: c.id,
        name: c.name || 'Anonymous',
        email: c.email,
        phone: c.phone || 'N/A',
        status: c.isActive ? 'ACTIVE' : 'BLACKLISTED',
        technoPoints: c.technoPoints,
        technoWallet: c.technoWallet,
        totalOrders,
        totalSpent: totalSpent.toFixed(2),
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || '',
        address: addr.addressLine1 ? `"${addr.addressLine1.replace(/"/g, '""')}"` : '',
        createdAt: new Date(c.createdAt).toISOString().split('T')[0],
      };
    });

    const dateStr = new Date().toISOString().split('T')[0];

    if (format === 'sql') {
      let sqlContent = `-- Techno World Books Customer Export\n-- Generated on: ${new Date().toISOString()}\n-- Total Records: ${exportRows.length}\n\n`;
      sqlContent += `CREATE TABLE IF NOT EXISTS customer_exports (\n  id VARCHAR(64) PRIMARY KEY,\n  name VARCHAR(255),\n  email VARCHAR(255),\n  phone VARCHAR(50),\n  status VARCHAR(30),\n  techno_points INT,\n  techno_wallet DECIMAL(10,2),\n  total_orders INT,\n  total_spent DECIMAL(10,2),\n  city VARCHAR(100),\n  state VARCHAR(100),\n  pincode VARCHAR(20),\n  created_at DATE\n);\n\n`;

      if (exportRows.length > 0) {
        sqlContent += `INSERT INTO customer_exports (id, name, email, phone, status, techno_points, techno_wallet, total_orders, total_spent, city, state, pincode, created_at) VALUES\n`;
        const values = exportRows.map((r) => {
          const cleanName = (r.name || '').replace(/'/g, "''");
          const cleanEmail = (r.email || '').replace(/'/g, "''");
          const cleanPhone = (r.phone || '').replace(/'/g, "''");
          const cleanCity = (r.city || '').replace(/'/g, "''");
          const cleanState = (r.state || '').replace(/'/g, "''");
          const cleanPincode = (r.pincode || '').replace(/'/g, "''");
          return `  ('${r.id}', '${cleanName}', '${cleanEmail}', '${cleanPhone}', '${r.status}', ${r.technoPoints}, ${r.technoWallet}, ${r.totalOrders}, ${r.totalSpent}, '${cleanCity}', '${cleanState}', '${cleanPincode}', '${r.createdAt}')`;
        });
        sqlContent += values.join(',\n') + ';\n';
      }

      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename="techno_customers_${dateStr}.sql"`);
      res.send(sqlContent);
      return;
    }

    // Default: CSV format (compatible with Microsoft Excel, Google Sheets)
    const headers = [
      'Customer ID',
      'Full Name',
      'Email Address',
      'Phone Number',
      'Account Status',
      'TechnoPoints',
      'TechnoWallet (INR)',
      'Total Orders Placed',
      'Total Lifetime Spend (INR)',
      'City',
      'State',
      'Pincode',
      'Street Address',
      'Registration Date',
    ];

    const csvLines = [headers.join(',')];
    for (const r of exportRows) {
      const cleanName = `"${r.name.replace(/"/g, '""')}"`;
      const cleanEmail = `"${r.email.replace(/"/g, '""')}"`;
      const cleanPhone = `"${r.phone}"`;
      const line = [
        r.id,
        cleanName,
        cleanEmail,
        cleanPhone,
        r.status,
        r.technoPoints,
        r.technoWallet,
        r.totalOrders,
        r.totalSpent,
        `"${r.city}"`,
        `"${r.state}"`,
        `"${r.pincode}"`,
        r.address,
        r.createdAt,
      ].join(',');
      csvLines.push(line);
    }

    const csvContent = '\uFEFF' + csvLines.join('\n'); // UTF-8 BOM for Excel compatibility
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="techno_customers_${dateStr}.csv"`);
    res.send(csvContent);
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
      const itemRev = item.quantity * Number(item.priceAtPurchase);
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

// GET /api/v1/admin/settings/auto-accept
export const getAutoAcceptSetting = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'AUTO_ACCEPT_ORDERS' } });
    // Default is true (ON) as requested
    const enabled = setting ? setting.value === 'true' : true;
    res.status(200).json({
      success: true,
      enabled,
      message: `Auto-accept orders is currently ${enabled ? 'ENABLED (ON)' : 'DISABLED (OFF)'}`,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/settings/auto-accept
export const updateAutoAcceptSetting = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { enabled } = req.body;
    const isEnabled = Boolean(enabled);

    await prisma.systemSetting.upsert({
      where: { key: 'AUTO_ACCEPT_ORDERS' },
      update: { value: isEnabled ? 'true' : 'false' },
      create: { key: 'AUTO_ACCEPT_ORDERS', value: isEnabled ? 'true' : 'false' },
    });

    res.status(200).json({
      success: true,
      enabled: isEnabled,
      message: `Auto-accept orders successfully turned ${isEnabled ? 'ON' : 'OFF'}`,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/abandoned-carts
export const getAbandonedCarts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cartItems = await prisma.cartItem.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true },
        },
        book: {
          select: { id: true, title: true, price: true, mrp: true, coverUrl: true, sku: true, stock: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const userCartMap = new Map<string, {
      user: any;
      items: any[];
      totalAmount: number;
      lastActivityAt: Date;
    }>();

    for (const item of (cartItems as any[])) {
      if (!item.user) continue;
      const existing = userCartMap.get(item.userId);
      const itemPrice = item.book ? item.book.price : 0;
      const itemTotal = itemPrice * item.quantity;

      if (!existing) {
        userCartMap.set(item.userId, {
          user: item.user,
          items: [item],
          totalAmount: itemTotal,
          lastActivityAt: item.updatedAt,
        });
      } else {
        existing.items.push(item);
        existing.totalAmount += itemTotal;
        if (item.updatedAt > existing.lastActivityAt) {
          existing.lastActivityAt = item.updatedAt;
        }
      }
    }

    const now = new Date();
    const abandonedCarts = Array.from(userCartMap.values()).map(entry => {
      const diffMs = now.getTime() - entry.lastActivityAt.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let timeAgo = '';
      if (diffMinutes < 60) {
        timeAgo = `${diffMinutes} min ago`;
      } else if (diffHours < 24) {
        timeAgo = `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
      } else {
        timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      }

      const primaryBook = entry.items[0]?.book?.title || 'Selected Books';
      const cleanPhone = (entry.user.phone || '').replace(/\D/g, '').slice(-10);
      const whatsappText = encodeURIComponent(
        `Hello ${entry.user.name || 'there'}! We noticed you left "${primaryBook}" in your cart at Techno World Books. Complete your order today to reserve your copy with fast India Post delivery: https://technoworldbooks.in/cart`
      );

      return {
        userId: entry.user.id,
        customerName: entry.user.name || 'Customer',
        customerEmail: entry.user.email,
        customerPhone: entry.user.phone || '',
        cleanPhone,
        whatsappUrl: cleanPhone ? `https://wa.me/91${cleanPhone}?text=${whatsappText}` : null,
        itemCount: entry.items.reduce((s: number, i: any) => s + i.quantity, 0),
        totalAmount: entry.totalAmount,
        lastActivityAt: entry.lastActivityAt.toISOString(),
        timeAgo,
        items: entry.items.map((i: any) => ({
          id: i.id,
          bookId: i.bookId,
          title: i.book?.title || 'Unknown Book',
          coverImage: i.book?.coverUrl,
          price: i.book?.price || 0,
          quantity: i.quantity,
          inStock: (i.book?.stock || 0) > 0,
        })),
      };
    });

    res.status(200).json({
      success: true,
      count: abandonedCarts.length,
      data: abandonedCarts,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/orders/:id/rto
export const processRtoRestock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (order.status === 'CANCELLED' && order.notes?.includes('RTO RESTOCKED')) {
      res.status(400).json({ success: false, message: 'Order has already been processed for RTO Restock' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.book.update({
          where: { id: item.bookId },
          data: {
            stock: { increment: item.quantity },
          },
        });
      }

      const rtoNote = `\n[RTO RESTOCKED: ${new Date().toLocaleString('en-IN')}] Reason: ${reason || 'Consignment returned undelivered by India Post / RTO'}. Restocked ${order.items.length} items.`;
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          notes: (order.notes || '') + rtoNote,
        },
      });
    });

    res.status(200).json({
      success: true,
      message: `Order #${order.orderNumber} successfully marked as RTO and ${order.items.length} item(s) restocked to inventory.`,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/reports/gstr1
export const exportGstr1Report = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { month, year } = req.query;

    const queryYear = year ? Number(year) : new Date().getFullYear();
    const queryMonth = month ? Number(month) - 1 : new Date().getMonth();

    const startDate = new Date(queryYear, queryMonth, 1);
    const endDate = new Date(queryYear, queryMonth + 1, 0, 23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
      include: {
        address: true,
        user: { select: { name: true, email: true, phone: true } },
        items: {
          include: {
            book: { select: { title: true, price: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'Order Number',
      'Invoice Number',
      'Invoice Date',
      'Recipient Name',
      'Recipient State',
      'Place of Supply',
      'Customer Phone',
      'Payment Mode',
      'Book Sales (HSN 4901 - Exempt 0%)',
      'Shipping Value (Taxable 18%)',
      'CGST (9%)',
      'SGST (9%)',
      'IGST (18%)',
      'Total Tax',
      'Total Invoice Value',
      'Fulfillment Status',
    ];

    const rows = orders.map((ord) => {
      const state = ord.address?.state || 'West Bengal';
      const isIntraState = state.toLowerCase().includes('bengal') || state.toLowerCase().includes('wb');
      const invoiceNo = ord.invoiceNumber || `TW-${ord.orderNumber}`;
      const invDate = ord.createdAt.toISOString().slice(0, 10);
      const recipientName = (ord.address?.fullName || ord.user?.name || 'Customer').replace(/,/g, ' ');
      const phone = ord.address?.phone || ord.user?.phone || '';
      
      const bookExemptValue = ord.subtotal;
      const shippingTaxable = Number(ord.shippingCharge || 0);
      
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (shippingTaxable > 0) {
        if (isIntraState) {
          cgst = Number((shippingTaxable * 0.09).toFixed(2));
          sgst = Number((shippingTaxable * 0.09).toFixed(2));
        } else {
          igst = Number((shippingTaxable * 0.18).toFixed(2));
        }
      }

      const totalTax = Number((cgst + sgst + igst).toFixed(2));
      const totalInv = Number((ord.totalAmount).toFixed(2));

      return [
        ord.orderNumber,
        invoiceNo,
        invDate,
        `"${recipientName}"`,
        `"${state}"`,
        `"${state}"`,
        `"${phone}"`,
        ord.paymentMethod || 'PREPAID',
        bookExemptValue.toFixed(2),
        shippingTaxable.toFixed(2),
        cgst.toFixed(2),
        sgst.toFixed(2),
        igst.toFixed(2),
        totalTax.toFixed(2),
        totalInv.toFixed(2),
        ord.status,
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1_Report_${queryYear}_${queryMonth + 1}.csv"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/indexnow/submit
 * Triggers on-demand IndexNow ping for specific URLs or entire catalog.
 */
export const triggerIndexNowSubmission = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { urls } = req.body;
    if (Array.isArray(urls) && urls.length > 0) {
      const result = await submitToIndexNow(urls);
      res.status(200).json(result);
      return;
    }

    // Default: Batch submit all published books + active categories + active blogs + core pages
    const [books, categories, blogPosts] = await Promise.all([
      prisma.book.findMany({
        where: { status: 'PUBLISHED', visibility: true },
        select: { slug: true },
        take: 10000,
      }),
      prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true },
      }),
      prisma.blogPost.findMany({
        where: { isActive: true },
        select: { slug: true },
      }),
    ]);

    const urlList: string[] = [
      'https://technoworldbooks.in/',
      'https://technoworldbooks.in/search',
      'https://technoworldbooks.in/blog',
      'https://technoworldbooks.in/about',
      'https://technoworldbooks.in/contact',
      'https://technoworldbooks.in/llms.txt',
      ...categories.map((c) => `https://technoworldbooks.in/category/${c.slug}`),
      ...blogPosts.map((b) => `https://technoworldbooks.in/blog/${b.slug}`),
      ...books.map((b) => `https://technoworldbooks.in/book/${b.slug}`),
    ];

    const result = await submitToIndexNow(urlList);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Main sales report data handler
 * GET /api/v1/admin/sales-report
 */
export const getSalesReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as {
      period?: '1month' | '3months' | '6months' | '1year' | 'custom';
      startDate?: string;
      endDate?: string;
    };

    const data = await SalesReportService.getSalesReport({ period, startDate, endDate });
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Tally-compatible CSV export handler
 * GET /api/v1/admin/sales-report/export
 */
export const exportSalesReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { period, startDate, endDate } = req.query as {
      period?: '1month' | '3months' | '6months' | '1year' | 'custom';
      startDate?: string;
      endDate?: string;
    };

    const { filename, content } = await SalesReportService.generateTallyCSV({ period, startDate, endDate });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(content);
  } catch (error) {
    next(error);
  }
};

/**
 * Current vs previous month sales comparison
 * GET /api/v1/admin/sales-report/monthly-summary
 */
export const getSalesMonthlyComparison = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await SalesReportService.getMonthlyComparison();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh historical sales snapshots
 * POST /api/v1/admin/sales-report/refresh-snapshots
 */
export const refreshSalesSnapshots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const months = req.query.months ? Number(req.query.months) : 12;
    const result = await SalesReportService.backfillSnapshots(months);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
