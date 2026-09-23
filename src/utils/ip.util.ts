import { Request } from 'express';

/**
 * Extracts the true originating client IP address across reverse proxies
 * (Render, Cloudflare, Hostinger, Nginx) or local development.
 */
export const getClientIp = (req: Request): string => {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cfConnectingIp.trim().replace(/^::ffff:/, '').split(':')[0];
  }

  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim().replace(/^::ffff:/, '').split(':')[0];
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Leftmost address in X-Forwarded-For is the real client public IP
    const firstIp = forwarded.split(',')[0].trim().replace(/^::ffff:/, '').split(':')[0];
    if (firstIp) return firstIp;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const firstIp = forwarded[0].split(',')[0].trim().replace(/^::ffff:/, '').split(':')[0];
    if (firstIp) return firstIp;
  }

  const remote = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return remote.replace(/^::ffff:/, '').split(':')[0].trim();
};
