import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';


const BASE_URL = 'https://technoworldbooks.in';

/**
 * Generates a dynamic XML sitemap from the database.
 * Includes: home page, published books, active categories, active blog posts, and static pages.
 */
export const generateSitemap = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Fetch all published books
    const books = await prisma.book.findMany({
      where: { status: 'PUBLISHED' },
      select: { slug: true, updatedAt: true },
    });

    // Fetch all active categories
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
    });

    // Fetch all active blog posts
    const blogPosts = await prisma.blogPost.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
    });

    // Static pages
    const staticPages = [
      'about',
      'help',
      'contact',
      'terms',
      'shipping-policy',
      'refund-policy',
      'privacy-policy',
    ];

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Home page
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}/</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;
    xml += `  </url>\n`;

    // Published books
    for (const book of books) {
      const lastmod = book.updatedAt.toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/book/${book.slug}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;
      xml += `  </url>\n`;
    }

    // Categories
    for (const category of categories) {
      const lastmod = category.updatedAt.toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/category/${category.slug}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }

    // Blog posts
    for (const post of blogPosts) {
      const lastmod = post.updatedAt.toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/blog/${post.slug}</loc>\n`;
      xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.5</priority>\n`;
      xml += `  </url>\n`;
    }

    // Static pages
    for (const page of staticPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${BASE_URL}/${page}</loc>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.3</priority>\n`;
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
