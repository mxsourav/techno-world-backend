import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class PromotionCacheService {
  private static instance: PromotionCacheService;
  private codeCache: Map<string, CacheEntry<any>> = new Map();
  private idCache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL_MS = 60 * 1000; // 60 seconds TTL
  private readonly NEGATIVE_TTL_MS = 15 * 1000; // 15 seconds for non-existent promotions to avoid DB hammering

  private constructor() {}

  public static getInstance(): PromotionCacheService {
    if (!PromotionCacheService.instance) {
      PromotionCacheService.instance = new PromotionCacheService();
    }
    return PromotionCacheService.instance;
  }

  /**
   * Retrieves an active promotion by coupon code using an in-memory cache.
   * On cache miss, queries database and caches the record with a 60-second TTL.
   */
  public async getByCode(code: string): Promise<any | null> {
    const key = code.trim().toUpperCase();
    const now = Date.now();
    const cached = this.codeCache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const promotion = await prisma.promotion.findUnique({
        where: { code: key },
      });

      const ttl = promotion ? this.DEFAULT_TTL_MS : this.NEGATIVE_TTL_MS;
      const entry: CacheEntry<any> = {
        data: promotion,
        expiresAt: now + ttl,
      };

      this.codeCache.set(key, entry);
      if (promotion && promotion.id) {
        this.idCache.set(promotion.id, entry);
      }

      return promotion;
    } catch (err: any) {
      logger.warn(`[PROMOTION_CACHE] Database query error for code "${key}": ${err.message}`);
      if (cached) return cached.data;
      throw err;
    }
  }

  /**
   * Retrieves a promotion by its primary ID using the in-memory cache.
   */
  public async getById(id: string): Promise<any | null> {
    const key = id.trim();
    const now = Date.now();
    const cached = this.idCache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const promotion = await prisma.promotion.findUnique({
        where: { id: key },
      });

      const ttl = promotion ? this.DEFAULT_TTL_MS : this.NEGATIVE_TTL_MS;
      const entry: CacheEntry<any> = {
        data: promotion,
        expiresAt: now + ttl,
      };

      this.idCache.set(key, entry);
      if (promotion && promotion.code) {
        this.codeCache.set(promotion.code.toUpperCase(), entry);
      }

      return promotion;
    } catch (err: any) {
      logger.warn(`[PROMOTION_CACHE] Database query error for id "${key}": ${err.message}`);
      if (cached) return cached.data;
      throw err;
    }
  }

  /**
   * Invalidates specific promotion or clears entire cache upon admin modifications.
   */
  public invalidate(codeOrId?: string): void {
    if (!codeOrId) {
      this.clear();
      return;
    }
    const key = codeOrId.trim();
    this.codeCache.delete(key.toUpperCase());
    this.idCache.delete(key);
  }

  /**
   * Purges all cached entries.
   */
  public clear(): void {
    this.codeCache.clear();
    this.idCache.clear();
  }
}

export const promotionCache = PromotionCacheService.getInstance();
