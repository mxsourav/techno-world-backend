import { Request, Response, NextFunction } from 'express';
import { analyticsService } from '../services/analytics.service.js';
import { getClientIp } from '../utils/ip.util.js';

// POST /api/v1/analytics/pulse (Public heartbeat)
export const recordPulse = (req: Request, res: Response): void => {
  try {
    const { deviceId, sessionId, path, pageTitle, referrer, deviceType, screenWidth, isPageview } = req.body;
    const userAgent = req.headers['user-agent'];
    const clientIp = getClientIp(req);

    const result = analyticsService.recordPulse({
      deviceId,
      sessionId,
      path,
      pageTitle,
      referrer,
      deviceType,
      screenWidth,
      userAgent,
      ip: clientIp,
      isPageview: Boolean(isPageview),
    });

    res.status(200).json({ success: true, data: result });
  } catch {
    res.status(200).json({ success: true, data: { activeNow: 0 } });
  }
};

// POST /api/v1/analytics/blog-event (Public event tracking)
export const recordBlogEvent = (req: Request, res: Response): void => {
  try {
    const { blogSlug, eventType, bookId, bookTitle, durationSeconds } = req.body;

    analyticsService.recordBlogEvent({
      blogSlug,
      eventType: eventType || 'VIEW',
      bookId,
      bookTitle,
      durationSeconds: Number(durationSeconds) || 0,
      timestamp: Date.now(),
    });

    res.status(200).json({ success: true, message: 'Event tracked' });
  } catch {
    res.status(200).json({ success: true, message: 'Event logged' });
  }
};

// GET /api/v1/analytics/live (Admin only)
export const getLiveAnalytics = (req: Request, res: Response): void => {
  try {
    const data = analyticsService.getLiveVisitors();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch live analytics' });
  }
};

// GET /api/v1/analytics/blog-performance (Admin only)
export const getBlogAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await analyticsService.getBlogPerformance();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/analytics/overview (Admin only)
export const getAnalyticsOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await analyticsService.getOverview();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
