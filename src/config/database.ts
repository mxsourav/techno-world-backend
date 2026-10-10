import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Dynamically appends strict PostgreSQL connection pooling parameters.
 * Guarantees ?connection_limit=15&pool_timeout=10 to prevent max_connections exhaustion.
 */
function getPooledDatabaseUrl(rawUrl?: string): string {
  const connectionUrl = rawUrl || process.env.DATABASE_URL || env.DATABASE_URL || '';
  if (!connectionUrl) return connectionUrl;

  try {
    const parsed = new URL(connectionUrl);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '15');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '10');
    }
    return parsed.toString();
  } catch {
    const separator = connectionUrl.includes('?') ? '&' : '?';
    let url = connectionUrl;
    if (!url.includes('connection_limit=')) {
      url += `${separator}connection_limit=15`;
    }
    if (!url.includes('pool_timeout=')) {
      url += `&pool_timeout=10`;
    }
    return url;
  }
}

const pooledUrl = getPooledDatabaseUrl();
if (pooledUrl) {
  process.env.DATABASE_URL = pooledUrl;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: pooledUrl
      ? {
          db: {
            url: pooledUrl,
          },
        }
      : undefined,
    log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

globalForPrisma.prisma = prisma;

/**
 * Health-checks the active PostgreSQL database connection with latency measurement.
 */
export async function testDatabaseConnection(): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    logger.error(`PostgreSQL connection check failed: ${err.message}`);
    return { connected: false, latencyMs: Date.now() - start, error: err.message };
  }
}
