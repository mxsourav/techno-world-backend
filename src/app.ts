import express from 'express';
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

const app = express();

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
        origin.startsWith('http://localhost:') ||
        origin.startsWith('https://localhost:') ||
        origin.includes('vercel.app') ||
        origin.includes('onrender.com') ||
        origin.includes('technoworld') ||
        origin.includes('techno-world');

      if (isAllowed) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
  })
);
app.use(compression());
// Exclude webhooks from global express.json because they need the raw Buffer for signature verification
app.use((req, res, next) => {
  // Use startsWith to safeguard against trailing slashes or query parameters
  if (req.originalUrl.startsWith('/api/v1/webhook/razorpay')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(generalLimiter);

// Anti-caching headers for API responses to guarantee immediate frontend reflection
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

import path from 'path';

// ...
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Techno World Books API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  })
);

app.use('/uploads', express.static(path.resolve('uploads')));
app.use(routes);

app.use(errorHandler);

export default app;
