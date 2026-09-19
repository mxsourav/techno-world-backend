import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const BASE_URL = 'https://technoworldbooks.in';

const escapeXml = (unsafe: string): string => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

const formatIso = (date?: Date | string | null): string => {
  const d = date ? new Date(date) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  return validDate.toISOString().replace(/\.\d{3}Z$/, '+00:00');
};

/**
 * Generates a dynamic XML sitemap from the database with Google Image Sitemap extensions.
 * Includes: home page, published books (with book cover images), active categories, active blog posts, and static pages.
 * All timestamps strictly adhere to ISO-8601 W3C Datetime format (+00:00).
 */
export const generateSitemap = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const buildTimestamp = formatIso(new Date());

    // Fetch all published books with cover image info
    const books = await prisma.book.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, updatedAt: true, title: true, coverUrl: true },
    });

    // Fetch all active categories
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true, name: true },
    });

    // Fetch all active blog posts
    const blogPosts = await prisma.blogPost.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true, title: true, thumbnailUrl: true },
    });

    // High-value Static pages with priority and changefreq
    const staticPages = [
      { path: 'search', priority: '0.8', changefreq: 'daily' },
      { path: 'blog', priority: '0.7', changefreq: 'weekly' },
      { path: 'track', priority: '0.5', changefreq: 'monthly' },
      { path: 'about', priority: '0.5', changefreq: 'monthly' },
      { path: 'contact', priority: '0.5', changefreq: 'monthly' },
      { path: 'help', priority: '0.4', changefreq: 'monthly' },
      { path: 'terms', priority: '0.3', changefreq: 'monthly' },
      { path: 'shipping-policy', priority: '0.3', changefreq: 'monthly' },
      { path: 'refund-policy', priority: '0.3', changefreq: 'monthly' },
      { path: 'privacy-policy', priority: '0.3', changefreq: 'monthly' },
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

    // Home page
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}/</loc>\n`;
    xml += `    <lastmod>${buildTimestamp}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;
    xml += `  </url>\n`;

    // Published books with Google Image search markup
    for (const book of books) {
      const lastmod = formatIso(book.updatedAt);
      const cover = book.coverUrl;

      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/book/${escapeXml(book.slug)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;

      if (cover) {
        const fullCover = cover.startsWith('http') ? cover : `${BASE_URL}${cover.startsWith('/') ? cover : '/' + cover}`;
        xml += `    <image:image>\n`;
        xml += `      <image:loc>${escapeXml(fullCover)}</image:loc>\n`;
        xml += `      <image:title>${escapeXml(book.title || 'Book Cover')}</image:title>\n`;
        xml += `    </image:image>\n`;
      }

      xml += `  </url>\n`;
    }

    // Categories
    for (const category of categories) {
      const lastmod = formatIso(category.updatedAt);
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/category/${escapeXml(category.slug)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }

    // Blog posts
    for (const post of blogPosts) {
      const lastmod = formatIso(post.updatedAt);
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/blog/${escapeXml(post.slug)}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.5</priority>\n`;
      if (post.thumbnailUrl) {
        const fullImg = post.thumbnailUrl.startsWith('http') ? post.thumbnailUrl : `${BASE_URL}${post.thumbnailUrl.startsWith('/') ? post.thumbnailUrl : '/' + post.thumbnailUrl}`;
        xml += `    <image:image>\n`;
        xml += `      <image:loc>${escapeXml(fullImg)}</image:loc>\n`;
        xml += `      <image:title>${escapeXml(post.title || 'Blog Cover')}</image:title>\n`;
        xml += `    </image:image>\n`;
      }
      xml += `  </url>\n`;
    }

    // Static pages
    for (const page of staticPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/${page.path}</loc>\n`;
      xml += `    <lastmod>${buildTimestamp}</lastmod>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += `</urlset>\n`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(200).send(xml);
  } catch (error) {
    next(error);
  }
};
