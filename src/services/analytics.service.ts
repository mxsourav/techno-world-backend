import { prisma } from '../config/database.js';


interface VisitorSession {
  sessionId: string;
  ip: string;
  userAgent: string;
  currentPath: string;
  pageTitle: string;
  referrer?: string;
  deviceType: 'mobile' | 'desktop' | 'tablet';
  lastSeen: number;
}

interface BlogEventRecord {
  blogSlug: string;
  eventType: 'VIEW' | 'READ_TIME' | 'BOOK_CLICK' | 'CART_ADD' | 'PURCHASE';
  bookId?: string;
  bookTitle?: string;
  durationSeconds?: number;
  timestamp: number;
}

class AnalyticsService {
  private visitors: Map<string, VisitorSession> = new Map();
  private todayUniqueVisitors: Set<string> = new Set();
  private todayPageviews: number = 0;
  private currentDay: string = new Date().toISOString().slice(0, 10);

  // Blog engagement metrics map (blogSlug -> metrics)
  private blogMetrics: Map<
    string,
    {
      readSessions: number;
      totalReadSeconds: number;
      bookClicks: Record<string, number>;
      cartAdds: Record<string, number>;
      purchases: number;
      revenue: number;
    }
  > = new Map();

  // Book interest map (bookId -> { clicks: number, title?: string })
  private bookInterestMap: Map<string, { clicks: number; title: string }> = new Map();

  constructor() {
    // Purge inactive sessions every 2 minutes (inactive > 5 minutes)
    setInterval(() => {
      this.cleanupSessions();
      this.checkDayReset();
    }, 2 * 60 * 1000);
  }

  private checkDayReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.todayUniqueVisitors.clear();
      this.todayPageviews = 0;
      this.dailyDevices = { desktop: 0, mobile: 0, tablet: 0 };
    }
  }

  private cleanupSessions() {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
    for (const [key, session] of this.visitors.entries()) {
      if (session.lastSeen < cutoff) {
        this.visitors.delete(key);
      }
    }
  }

  private dailyDevices = {
    desktop: 0,
    mobile: 0,
    tablet: 0,
  };

  private detectDevice(ua: string, clientHint?: string, screenWidth?: number): 'mobile' | 'desktop' | 'tablet' {
    if (clientHint === 'mobile' || clientHint === 'tablet' || clientHint === 'desktop') {
      return clientHint;
    }
    if (screenWidth && screenWidth > 0) {
      if (screenWidth < 768) return 'mobile';
      if (screenWidth < 1024) return 'tablet';
      return 'desktop';
    }
    if (!ua) return 'desktop';
    const lower = ua.toLowerCase();
    if (/tablet|ipad|playbook|silk/i.test(lower)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(lower)) return 'mobile';
    return 'desktop';
  }

  // Record visitor pulse/heartbeat
  public recordPulse(data: {
    deviceId?: string;
    sessionId: string;
    path: string;
    pageTitle?: string;
    referrer?: string;
    userAgent?: string;
    ip?: string;
    deviceType?: string;
    screenWidth?: number;
    isPageview?: boolean;
  }) {
    this.checkDayReset();

    const ua = data.userAgent || '';
    const ip = data.ip || '127.0.0.1';
    const deviceType = this.detectDevice(ua, data.deviceType, data.screenWidth);

    // 1. UNIQUE VISITOR DEDUPLICATION:
    // Prefer persistent deviceId from client (localStorage / 1-year cookie).
    // Fall back to IP + device + userAgent signature if deviceId is missing.
    // One physical device can visit 100 times in a day — it is counted ONCE as a unique shopper today.
    const visitorKey = data.deviceId && data.deviceId.trim() !== ''
      ? data.deviceId
      : `anon_${ip}_${deviceType}_${ua.slice(0, 60)}`;

    const isNewVisitor = !this.todayUniqueVisitors.has(visitorKey);
    if (isNewVisitor) {
      this.todayUniqueVisitors.add(visitorKey);
      this.dailyDevices[deviceType] = (this.dailyDevices[deviceType] || 0) + 1;
    }

    // 2. PAGEVIEWS:
    // Only increment when explicitly flagged as a genuine pageview or when path changed.
    // Idle 25-second heartbeats on the same URL do NOT increment pageviews.
    const sessionId = data.sessionId || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const existingSession = this.visitors.get(sessionId);
    const isNewPage = !existingSession || existingSession.currentPath !== (data.path || '/');

    if (data.isPageview || isNewPage) {
      this.todayPageviews += 1;
    }

    // 3. ACTIVE SESSIONS (sliding 5-minute heartbeat window):
    this.visitors.set(sessionId, {
      sessionId,
      ip,
      userAgent: ua,
      currentPath: data.path || '/',
      pageTitle: data.pageTitle || 'Techno World Books',
      referrer: data.referrer,
      deviceType,
      lastSeen: Date.now(),
    });

    return {
      activeNow: this.getActiveCount(),
      sessionId,
    };
  }

  public getActiveCount(): number {
    this.cleanupSessions();
    return this.visitors.size;
  }

  // Record blog events (reading time, attached book clicks, cart additions)
  public recordBlogEvent(data: BlogEventRecord) {
    const { blogSlug, eventType, bookId, bookTitle, durationSeconds } = data;
    if (!blogSlug) return;

    let metric = this.blogMetrics.get(blogSlug);
    if (!metric) {
      metric = {
        readSessions: 0,
        totalReadSeconds: 0,
        bookClicks: {},
        cartAdds: {},
        purchases: 0,
        revenue: 0,
      };
      this.blogMetrics.set(blogSlug, metric);
    }

    if (eventType === 'READ_TIME' && durationSeconds) {
      metric.readSessions += 1;
      metric.totalReadSeconds += Math.min(durationSeconds, 1800); // cap at 30 min per ping
    } else if (eventType === 'BOOK_CLICK' && bookId) {
      metric.bookClicks[bookId] = (metric.bookClicks[bookId] || 0) + 1;
      const cur = this.bookInterestMap.get(bookId) || { clicks: 0, title: bookTitle || 'Book' };
      cur.clicks += 1;
      if (bookTitle) cur.title = bookTitle;
      this.bookInterestMap.set(bookId, cur);
    } else if (eventType === 'CART_ADD' && bookId) {
      metric.cartAdds[bookId] = (metric.cartAdds[bookId] || 0) + 1;
    } else if (eventType === 'PURCHASE') {
      metric.purchases += 1;
    }
  }

  // Get Live Real-time Visitors Dossier
  public getLiveVisitors() {
    this.cleanupSessions();

    const activeList = Array.from(this.visitors.values());
    const pathCounts: Record<string, { count: number; title: string }> = {};
    let mobile = 0;
    let desktop = 0;
    let tablet = 0;

    for (const v of activeList) {
      const p = v.currentPath || '/';
      if (!pathCounts[p]) {
        pathCounts[p] = { count: 0, title: v.pageTitle || p };
      }
      pathCounts[p].count += 1;

      if (v.deviceType === 'mobile') mobile += 1;
      else if (v.deviceType === 'tablet') tablet += 1;
      else desktop += 1;
    }

    const livePages = Object.entries(pathCounts)
      .map(([path, info]) => ({
        path,
        title: info.title,
        viewers: info.count,
        isBlog: path.startsWith('/blog'),
        isCheckout: path.includes('cart') || path.includes('checkout'),
      }))
      .sort((a, b) => b.viewers - a.viewers);

    const activeNow = activeList.length;
    const todayVisitors = this.todayUniqueVisitors.size;
    const todayPageviews = this.todayPageviews;

    const cumulativeMobile = Math.max(this.dailyDevices.mobile, mobile);
    const cumulativeDesktop = Math.max(this.dailyDevices.desktop, desktop);
    const cumulativeTablet = Math.max(this.dailyDevices.tablet, tablet);
    const totalDevices = cumulativeMobile + cumulativeDesktop + cumulativeTablet;

    const mobilePercent = totalDevices > 0 ? Math.round((cumulativeMobile / totalDevices) * 100) : (mobile > 0 ? 100 : 0);
    const desktopPercent = totalDevices > 0 ? Math.round((cumulativeDesktop / totalDevices) * 100) : (desktop > 0 ? 100 : 0);
    const tabletPercent = totalDevices > 0 ? Math.max(100 - mobilePercent - desktopPercent, 0) : 0;

    return {
      activeNow,
      todayVisitors,
      todayPageviews,
      livePages,
      deviceDistribution: {
        desktop,
        mobile,
        tablet,
        cumulativeDesktop,
        cumulativeMobile,
        cumulativeTablet,
        desktopPercent,
        mobilePercent,
        tabletPercent,
        totalSessions: totalDevices,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  // Get Blog Editorial Performance & Conversion Funnel
  public async getBlogPerformance() {
    // 1. Load all posts from database
    const posts = await prisma.blogPost.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
        views: true,
        readTime: true,
        relatedBookIds: true,
        thumbnailUrl: true,
        createdAt: true,
      },
      orderBy: { views: 'desc' },
    });

    let totalViews = 0;
    let totalReadSessions = 0;
    let totalReadSeconds = 0;
    let totalBookClicks = 0;
    let totalCartAdds = 0;
    let totalPurchases = 0;

    const detailedPosts = posts.map((p) => {
      const metric = this.blogMetrics.get(p.slug) || {
        readSessions: 0,
        totalReadSeconds: 0,
        bookClicks: {},
        cartAdds: {},
        purchases: 0,
        revenue: 0,
      };

      const clicks = Object.values(metric.bookClicks).reduce((a, b) => a + b, 0);
      const cartAdds = Object.values(metric.cartAdds).reduce((a, b) => a + b, 0);

      // Baseline reading time if not enough session data yet
      const avgReadDurationSec =
        metric.readSessions > 0
          ? Math.round(metric.totalReadSeconds / metric.readSessions)
          : (parseInt(p.readTime || '5') || 5) * 45; // ~75% of estimated read time

      totalViews += p.views || 0;
      totalReadSessions += metric.readSessions;
      totalReadSeconds += metric.totalReadSeconds;
      totalBookClicks += clicks;
      totalCartAdds += cartAdds;
      totalPurchases += metric.purchases;

      const attachedCount = Array.isArray(p.relatedBookIds) ? (p.relatedBookIds as string[]).length : 0;
      const clickThroughRate = p.views > 0 ? Number(((clicks / p.views) * 100).toFixed(1)) : 0;

      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        category: p.category,
        views: p.views || 0,
        readTime: p.readTime || '5 min read',
        avgReadDurationSec,
        bookClicks: clicks,
        cartAdds,
        purchases: metric.purchases,
        clickThroughRate,
        attachedBooksCount: attachedCount,
        thumbnailUrl: p.thumbnailUrl,
        createdAt: p.createdAt,
      };
    });

    // Top books interested from blog
    const topInterestedBooks = Array.from(this.bookInterestMap.entries())
      .map(([bookId, data]) => ({
        bookId,
        title: data.title,
        clicks: data.clicks,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    const conversionRate = totalViews > 0 ? Number(((totalBookClicks / totalViews) * 100).toFixed(1)) : 0;

    return {
      summary: {
        totalArticles: posts.length,
        totalViews,
        avgReadDurationSeconds: totalReadSessions > 0 ? Math.round(totalReadSeconds / totalReadSessions) : 210,
        totalBookClicks,
        totalCartAdds,
        totalPurchases,
        conversionRate,
      },
      topArticles: detailedPosts,
      topInterestedBooks,
    };
  }

  // High-level overview
  public async getOverview() {
    const live = this.getLiveVisitors();
    const blog = await this.getBlogPerformance();

    // Order stats today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startOfToday },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { totalAmount: true },
    });

    const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    return {
      live,
      blogSummary: blog.summary,
      todaySales: {
        ordersCount: todayOrders.length,
        revenue: todayRevenue,
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
