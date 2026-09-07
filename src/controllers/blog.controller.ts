import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function calculatePostStatus(post: any): 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'HIDDEN' {
  if (!post.isActive) return 'HIDDEN';
  const now = new Date();
  if (post.scheduledAt && new Date(post.scheduledAt) > now) return 'SCHEDULED';
  if (post.expiresAt && new Date(post.expiresAt) <= now) return 'EXPIRED';
  return 'ACTIVE';
}

// GET /api/v1/blog
export const getBlogPosts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category, search, limit = 20, page = 1 } = req.query;
    const now = new Date();

    const whereClause: any = {
      isActive: true,
      OR: [
        { scheduledAt: null },
        { scheduledAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
      ],
    };

    if (category && typeof category === 'string' && category !== 'All') {
      whereClause.category = category;
    }

    if (search && typeof search === 'string') {
      whereClause.OR = [
        { title: { contains: search } },
        { excerpt: { contains: search } },
        { content: { contains: search } },
      ];
    }

    const take = Math.min(Number(limit) || 20, 50);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.blogPost.count({ where: whereClause }),
    ]);

    // Format posts
    const formatted = posts.map(p => ({
      ...p,
      computedStatus: calculatePostStatus(p),
    }));

    res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: Number(page) || 1,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/blog/:slug
export const getBlogPostBySlug = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;

    const post = await prisma.blogPost.findUnique({
      where: { slug },
    });

    if (!post) {
      res.status(404).json({ success: false, message: 'Blog post not found' });
      return;
    }

    // Increment views asynchronously
    prisma.blogPost.update({
      where: { id: post.id },
      data: { views: { increment: 1 } },
    }).catch(() => {});

    // Fetch related books if configured
    let relatedBooks: any[] = [];
    const bookIds = Array.isArray(post.relatedBookIds) ? (post.relatedBookIds as string[]) : [];

    if (bookIds.length > 0) {
      relatedBooks = await prisma.book.findMany({
        where: { id: { in: bookIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          coverUrl: true,
          price: true,
          mrp: true,
          authors: true,
          stock: true,
          discount: true,
        },
        take: 12,
      });
    } else if (post.relatedCategory) {
      relatedBooks = await prisma.book.findMany({
        where: {
          OR: [
            { category: { name: { contains: post.relatedCategory } } },
            { category: { slug: { contains: post.relatedCategory.toLowerCase() } } },
            { description: { contains: post.relatedCategory } },
          ],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          coverUrl: true,
          price: true,
          mrp: true,
          authors: true,
          stock: true,
          discount: true,
        },
        take: 8,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...post,
        computedStatus: calculatePostStatus(post),
        relatedBooks,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/blog/admin/all
export const getAdminBlogPosts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, category, search } = req.query;
    const now = new Date();

    const whereClause: any = {};

    if (category && typeof category === 'string' && category !== 'All') {
      whereClause.category = category;
    }

    if (search && typeof search === 'string') {
      whereClause.OR = [
        { title: { contains: search } },
        { excerpt: { contains: search } },
        { slug: { contains: search } },
      ];
    }

    const posts = await prisma.blogPost.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    // Add computed status
    const allWithStatus = posts.map(p => ({
      ...p,
      computedStatus: calculatePostStatus(p),
    }));

    // Filter by status if specified
    let filtered = allWithStatus;
    if (status && typeof status === 'string' && status !== 'all') {
      const upper = status.toUpperCase();
      filtered = allWithStatus.filter(p => p.computedStatus === upper);
    }

    // Counts summary for dashboard tabs
    const counts = {
      all: allWithStatus.length,
      active: allWithStatus.filter(p => p.computedStatus === 'ACTIVE').length,
      scheduled: allWithStatus.filter(p => p.computedStatus === 'SCHEDULED').length,
      expired: allWithStatus.filter(p => p.computedStatus === 'EXPIRED').length,
      hidden: allWithStatus.filter(p => p.computedStatus === 'HIDDEN').length,
    };

    res.status(200).json({
      success: true,
      data: filtered,
      counts,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/blog/admin
export const createBlogPost = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      title,
      slug,
      excerpt,
      content,
      category,
      thumbnailUrl,
      readTime,
      hue,
      relatedCategory,
      relatedBookIds,
      scheduledAt,
      expiresAt,
      isActive = true,
      authorName = 'Techno World Editorial',
    } = req.body;

    if (!title || !content || !category) {
      res.status(400).json({
        success: false,
        message: 'Title, category, and content are required.',
      });
      return;
    }

    let finalSlug = slug ? slugify(slug) : slugify(title);
    // Ensure uniqueness
    let conflict = await prisma.blogPost.findUnique({ where: { slug: finalSlug } });
    if (conflict) {
      finalSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
    }

    const newPost = await prisma.blogPost.create({
      data: {
        title,
        slug: finalSlug,
        excerpt: excerpt || title,
        content,
        category,
        thumbnailUrl: thumbnailUrl || null,
        readTime: readTime || '5 min read',
        hue: Number(hue) || 160,
        relatedCategory: relatedCategory || null,
        relatedBookIds: Array.isArray(relatedBookIds) ? relatedBookIds : [],
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: Boolean(isActive),
        authorName: authorName || 'Techno World Editorial',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Blog post created successfully',
      data: {
        ...newPost,
        computedStatus: calculatePostStatus(newPost),
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/blog/admin/:id
export const updateBlogPost = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      title,
      slug,
      excerpt,
      content,
      category,
      thumbnailUrl,
      readTime,
      hue,
      relatedCategory,
      relatedBookIds,
      scheduledAt,
      expiresAt,
      isActive,
      authorName,
    } = req.body;

    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Blog post not found' });
      return;
    }

    let finalSlug = existing.slug;
    if (slug && slug !== existing.slug) {
      finalSlug = slugify(slug);
      const conflict = await prisma.blogPost.findUnique({ where: { slug: finalSlug } });
      if (conflict && conflict.id !== id) {
        finalSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
      }
    }

    const updated = await prisma.blogPost.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug: finalSlug }),
        ...(excerpt !== undefined && { excerpt }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
        ...(thumbnailUrl !== undefined && { thumbnailUrl }),
        ...(readTime !== undefined && { readTime }),
        ...(hue !== undefined && { hue: Number(hue) }),
        ...(relatedCategory !== undefined && { relatedCategory }),
        ...(relatedBookIds !== undefined && { relatedBookIds: Array.isArray(relatedBookIds) ? relatedBookIds : [] }),
        ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(authorName !== undefined && { authorName }),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Blog post updated successfully',
      data: {
        ...updated,
        computedStatus: calculatePostStatus(updated),
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/blog/admin/:id/toggle-status
export const toggleBlogPostStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Blog post not found' });
      return;
    }

    const updated = await prisma.blogPost.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    res.status(200).json({
      success: true,
      message: `Post ${updated.isActive ? 'activated' : 'hidden'}`,
      data: {
        ...updated,
        computedStatus: calculatePostStatus(updated),
      },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/blog/admin/:id
export const deleteBlogPost = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Blog post not found' });
      return;
    }

    await prisma.blogPost.delete({ where: { id } });

    res.status(200).json({
      success: true,
      message: 'Blog post deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
