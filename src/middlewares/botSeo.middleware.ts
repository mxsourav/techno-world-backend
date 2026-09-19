import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const BASE_URL = 'https://technoworldbooks.in';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-cover.png`;
const SITE_NAME = 'Techno World Books';

// ---------------------------------------------------------------------------
// In-memory HTML cache — 5 minute TTL per path
// ---------------------------------------------------------------------------
interface CacheEntry { html: string; expiry: number }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): string | null {
  const entry = _cache.get(key);
  if (entry && entry.expiry > Date.now()) return entry.html;
  _cache.delete(key);
  return null;
}

function setCache(key: string, html: string): void {
  _cache.set(key, { html, expiry: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Bot User-Agent detection — search engines, social scrapers, AI indexers
// ---------------------------------------------------------------------------
const BOT_PATTERN =
  /googlebot|google-inspectiontool|adsbot-google|bingbot|bingpreview|yandexbot|duckduckbot|slurp|baidu|facebookexternalhit|facebot|whatsapp|linkedinbot|pinterest|telegrambot|slackbot|discordbot|twitterbot|embedly|rogerbot|gptbot|chatgpt-user|perplexitybot|amazonbot|diffbot|semrushbot|ahrefsbot|mj12bot|dotbot|ia_archiver|applebot/i;

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return DEFAULT_OG_IMAGE;
  if (url.startsWith('http')) return url;
  return `${BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

// ---------------------------------------------------------------------------
// Core HTML shell builder — produces a fully-valid <head> for bots
// ---------------------------------------------------------------------------
function buildHtml(opts: {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType: 'website' | 'product' | 'article' | 'book';
  jsonLd: object | object[];
}): string {
  const { title, description, canonical, ogImage, ogType, jsonLd } = opts;
  const safeTitle = esc(title);
  const safeDesc = esc(description.slice(0, 300));
  const ldJson = JSON.stringify(Array.isArray(jsonLd) ? jsonLd : [jsonLd]);

  return `<!DOCTYPE html>
<html lang="en-IN" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <link rel="canonical" href="${canonical}" />
  <meta name="robots" content="index, follow" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:site_name" content="${esc(SITE_NAME)}" />
  <meta property="og:locale" content="en_IN" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <script type="application/ld+json">${ldJson}</script>
  <meta http-equiv="refresh" content="0; url=${canonical}" />
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeDesc}</p>
  <p><a href="${canonical}">View on Techno World Books</a></p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route renderers
// ---------------------------------------------------------------------------
async function renderHome(): Promise<string> {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      name: SITE_NAME,
      url: BASE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${BASE_URL}/listing?search={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: SITE_NAME,
      url: BASE_URL,
      logo: { '@type': 'ImageObject', url: `${BASE_URL}/techno_world.png`, width: 512, height: 512 },
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: '+91-747-913-5626',
        contactType: 'customer service',
        availableLanguage: ['en', 'hi', 'bn'],
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'College Street',
        addressLocality: 'Kolkata',
        addressRegion: 'West Bengal',
        postalCode: '700006',
        addressCountry: 'IN',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': ['LocalBusiness', 'BookStore'],
      '@id': `${BASE_URL}/#bookstore`,
      name: SITE_NAME,
      description: "India's trusted online bookstore from College Street, Kolkata.",
      url: BASE_URL,
      telephone: '+91-747-913-5626',
      image: DEFAULT_OG_IMAGE,
      currenciesAccepted: 'INR',
      paymentAccepted: 'UPI, Credit Card, Debit Card, Net Banking, COD',
      geo: { '@type': 'GeoCoordinates', latitude: '22.5744', longitude: '88.3639' },
      openingHoursSpecification: {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '09:00',
        closes: '21:00',
      },
      priceRange: 'INR',
    },
  ];

  return buildHtml({
    title: `${SITE_NAME} — Buy Books Online in India`,
    description: "India's trusted online bookstore from College Street, Kolkata. Buy school, college, NEET, JEE, UPSC, medical & engineering books. Free delivery above INR 999.",
    canonical: `${BASE_URL}/`,
    ogImage: DEFAULT_OG_IMAGE,
    ogType: 'website',
    jsonLd,
  });
}

async function renderBook(slug: string): Promise<string | null> {
  const book = await prisma.book.findUnique({
    where: { slug },
    select: {
      title: true,
      seoTitle: true,
      description: true,
      seoDescription: true,
      shortDescription: true,
      coverUrl: true,
      price: true,
      mrp: true,
      stock: true,
      language: true,
      edition: true,
      isbn10: true,
      isbn13: true,
      slug: true,
      authors: { select: { name: true } },
      publisher: { select: { name: true } },
      reviews: { where: { isApproved: true }, select: { rating: true } },
    },
  });

  if (!book) return null;

  const canonical = `${BASE_URL}/book/${slug}`;
  const ogImage = resolveImageUrl(book.coverUrl);
  const authorNames = book.authors.map((a) => a.name);
  const primaryAuthor = authorNames[0] ?? null;

  const reviewCount = book.reviews.length;
  const avgRating =
    reviewCount > 0
      ? Math.round((book.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
      : null;

  const titleStr = book.seoTitle ?? `${book.title}${primaryAuthor ? ` by ${primaryAuthor}` : ''} — ${SITE_NAME}`;
  const descStr =
    book.seoDescription ??
    book.shortDescription ??
    book.description ??
    `Buy ${book.title}${primaryAuthor ? ` by ${primaryAuthor}` : ''} online at Techno World Books. Price INR ${book.price}.`;

  const jsonLd: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Book',
      '@id': canonical,
      name: book.title,
      url: canonical,
      image: ogImage,
      ...(primaryAuthor ? { author: { '@type': 'Person', name: primaryAuthor } } : {}),
      ...(book.isbn13 ? { isbn: book.isbn13 } : book.isbn10 ? { isbn: book.isbn10 } : {}),
      ...(book.publisher?.name ? { publisher: { '@type': 'Organization', name: book.publisher.name } } : {}),
      ...(book.language ? { inLanguage: book.language } : {}),
      ...(book.edition ? { bookEdition: book.edition } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: book.title,
      image: ogImage,
      description: descStr.slice(0, 500),
      brand: { '@type': 'Organization', name: SITE_NAME },
      offers: {
        '@type': 'Offer',
        price: book.price,
        priceCurrency: 'INR',
        availability:
          (book.stock ?? 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: canonical,
        seller: { '@type': 'Organization', name: SITE_NAME },
      },
      ...(avgRating && reviewCount
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: avgRating, reviewCount, bestRating: 5, worstRating: 1 } }
        : {}),
    },
  ];

  return buildHtml({ title: titleStr, description: descStr, canonical, ogImage, ogType: 'book', jsonLd });
}

async function renderCategory(slug: string): Promise<string | null> {
  const category = await prisma.category.findUnique({
    where: { slug },
    select: {
      name: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      imageUrl: true,
      slug: true,
      _count: { select: { books: true } },
    },
  });

  if (!category) return null;

  const canonical = `${BASE_URL}/category/${slug}`;
  const ogImage = resolveImageUrl(category.imageUrl);
  const titleStr = category.seoTitle ?? `${category.name} Books — Buy Online | ${SITE_NAME}`;
  const descStr =
    category.seoDescription ??
    category.description ??
    `Browse ${category._count.books}+ ${category.name} books at Techno World Books. Best prices, fast delivery across India.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonical,
    name: titleStr,
    description: descStr,
    url: canonical,
    isPartOf: { '@id': `${BASE_URL}/#website` },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
        { '@type': 'ListItem', position: 2, name: category.name, item: canonical },
      ],
    },
  };

  return buildHtml({ title: titleStr, description: descStr, canonical, ogImage, ogType: 'website', jsonLd });
}

async function renderBlog(slug: string): Promise<string | null> {
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    select: {
      title: true,
      excerpt: true,
      content: true,
      thumbnailUrl: true,
      authorName: true,
      slug: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!post || !post.isActive) return null;

  const canonical = `${BASE_URL}/blog/${slug}`;
  const ogImage = resolveImageUrl(post.thumbnailUrl);
  const descStr =
    post.excerpt ??
    post.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': canonical,
    headline: post.title,
    image: ogImage,
    url: canonical,
    datePublished: post.createdAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: post.authorName ?? 'Techno World Editorial' },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: `${BASE_URL}/techno_world.png` },
    },
    description: descStr,
    isPartOf: { '@id': `${BASE_URL}/#website` },
  };

  return buildHtml({ title: `${post.title} | ${SITE_NAME} Blog`, description: descStr, canonical, ogImage, ogType: 'article', jsonLd });
}

// ---------------------------------------------------------------------------
// Exported middleware
// ---------------------------------------------------------------------------
export async function botSeoMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const ua = req.headers['user-agent'] ?? '';
  if (req.method !== 'GET' || !BOT_PATTERN.test(ua)) {
    return next();
  }

  const pathname = req.path;
  const cacheKey = pathname.toLowerCase();

  const cached = getCached(cacheKey);
  if (cached) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Bot-SEO', 'CACHED');
    res.status(200).send(cached);
    return;
  }

  try {
    let html: string | null = null;

    if (pathname === '/' || pathname === '') {
      html = await renderHome();
    } else {
      const bookSlug = pathname.match(/^\/book\/([^/?#]+)$/)?.[1];
      const categorySlug = pathname.match(/^\/category\/([^/?#]+)$/)?.[1];
      const blogSlug = pathname.match(/^\/blog\/([^/?#]+)$/)?.[1];

      if (bookSlug) html = await renderBook(decodeURIComponent(bookSlug));
      else if (categorySlug) html = await renderCategory(decodeURIComponent(categorySlug));
      else if (blogSlug) html = await renderBlog(decodeURIComponent(blogSlug));
    }

    if (!html) return next();

    setCache(cacheKey, html);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Bot-SEO', 'RENDERED');
    res.status(200).send(html);
  } catch (_err) {
    // DB errors must never break normal user traffic
    return next();
  }
}
