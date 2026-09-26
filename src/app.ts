import express from 'express';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middlewares/requestId.js';
import { generalLimiter } from './middlewares/rateLimiter.js';
import { errorHandler } from './middlewares/errorHandler.js';
import routes from './routes/index.js';
import { generateSitemap } from './controllers/sitemap.controller.js';
import { botSeoMiddleware } from './middlewares/botSeo.middleware.js';
import { INDEXNOW_KEY } from './services/indexnow.service.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Trust reverse proxy (Cloudflare, Render, Vercel, Hostinger, Nginx) so req.ip and secure cookies work reliably
app.set('trust proxy', true);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  ...env.CORS_ORIGIN.split(',').map(url => url.trim()).filter(Boolean)
];

const trustedProductionDomains = [
  'https://technoworldbooks.in',
  'https://www.technoworldbooks.in',
  'https://admin.technoworldbooks.in',
];

const isAllowedVercelOrRender = (origin: string): boolean => {
  return (
    /^https:\/\/techno-world[a-z0-9-]*\.vercel\.app$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+-mxsouravs-projects\.vercel\.app$/.test(origin) ||
    /^https:\/\/techno-world[a-z0-9-]*\.onrender\.com$/.test(origin)
  );
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      // Wildcard or developer mode
      if (env.CORS_ORIGIN === '*' || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      // Explicit match or local / cloud domain patterns
      const isAllowed =
        allowedOrigins.includes(origin) ||
        trustedProductionDomains.includes(origin) ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        isAllowedVercelOrRender(origin);

      if (isAllowed) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Cookie', 'Cache-Control', 'Pragma', 'Expires'],
    exposedHeaders: ['Set-Cookie'],
  })
);
app.use(compression());
// Exclude webhooks from global express.json because they need the raw Buffer for signature verification
app.use((req, res, next) => {
  // Use startsWith to safeguard against trailing slashes or query parameters
  if (req.originalUrl.startsWith('/api/v1/webhook/razorpay') || req.originalUrl.startsWith('/api/v1/payments/razorpay/webhook')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(generalLimiter);

// Anti-caching and noindex headers for API responses to guarantee immediate frontend reflection
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// ...
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Techno World Books API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  })
);

app.use(
  '/uploads',
  express.static(path.resolve('uploads'), {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    },
  })
);
// Bot SEO: intercept known crawler User-Agents and return server-rendered OG HTML
// This must be mounted BEFORE static serving and SPA routes.
app.use(botSeoMiddleware);
app.get('/sitemap.xml', generateSitemap);
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send(
`# Techno World Books API Server
User-agent: *
Allow: /api/v1/books
Allow: /api/v1/categories
Allow: /api/v1/cms
Allow: /api/v1/analytics/pulse
Allow: /sitemap.xml
Allow: /health
Disallow: /api/v1/admin
Disallow: /api/v1/orders
Disallow: /api/v1/profile
Disallow: /api/v1/auth
Disallow: /docs
`
  );
});
app.get('/llms.txt', (_req, res) => {
  const filePath = path.resolve('../app/public/llms.txt');
  if (fs.existsSync(filePath)) {
    res.type('text/plain; charset=utf-8');
    return res.sendFile(filePath);
  }
  res.status(404).send('Not Found');
});
app.get('/llms-full.txt', (_req, res) => {
  const filePath = path.resolve('../app/public/llms-full.txt');
  if (fs.existsSync(filePath)) {
    res.type('text/plain; charset=utf-8');
    return res.sendFile(filePath);
  }
  res.status(404).send('Not Found');
});
// IndexNow protocol token verification endpoint
app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => {
  res.type('text/plain; charset=utf-8');
  res.send(INDEXNOW_KEY);
});
app.use(routes);

app.use(errorHandler);

export default app;
