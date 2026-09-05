import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

// Helper to normalize payment method display
function normalizePaymentMethod(method?: string | null): string {
  if (!method) return 'COD';
  const m = method.toUpperCase().trim();
  if (m.includes('UPI')) return 'UPI';
  if (m.includes('CARD') || m.includes('CREDIT') || m.includes('DEBIT')) return 'CARD';
  if (m.includes('NET') || m.includes('BANK')) return 'NETBANKING';
  if (m.includes('COD') || m.includes('CASH')) return 'COD';
  if (m.includes('WALLET')) return 'WALLET';
  return m;
}

/**
 * GET /api/v1/payments/overview
 * Returns aggregated financial overview, settlement metrics, method breakdown,
 * and Razorpay connection health.
 */
export const getPaymentOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        subtotal: true,
        shippingCharge: true,
        discountAmount: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        notes: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        address: {
          select: {
            fullName: true,
            phone: true,
            city: true,
            state: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let grossVolume = 0;
    let settledVolume = 0;
    let pendingSettlements = 0;
    let refundedVolume = 0;
    let failedVolume = 0;
    let codPendingCollection = 0;

    let paidCount = 0;
    let pendingCount = 0;
    let refundedCount = 0;
    let failedCount = 0;

    const methodMap: Record<string, { count: number; volume: number }> = {
      UPI: { count: 0, volume: 0 },
      CARD: { count: 0, volume: 0 },
      NETBANKING: { count: 0, volume: 0 },
      COD: { count: 0, volume: 0 },
      OTHER: { count: 0, volume: 0 },
    };

    orders.forEach((ord) => {
      const amt = Number(ord.totalAmount) || 0;
      grossVolume += amt;

      const normMethod = normalizePaymentMethod(ord.paymentMethod);
      if (methodMap[normMethod]) {
        methodMap[normMethod].count += 1;
        methodMap[normMethod].volume += amt;
      } else {
        methodMap.OTHER.count += 1;
        methodMap.OTHER.volume += amt;
      }

      switch (ord.paymentStatus) {
        case PaymentStatus.PAID:
          settledVolume += amt;
          paidCount += 1;
          break;
        case PaymentStatus.PENDING:
          pendingSettlements += amt;
          pendingCount += 1;
          if (normMethod === 'COD') {
            codPendingCollection += amt;
          }
          break;
        case PaymentStatus.REFUNDED:
          refundedVolume += amt;
          refundedCount += 1;
          break;
        case PaymentStatus.FAILED:
          failedVolume += amt;
          failedCount += 1;
          break;
        default:
          pendingSettlements += amt;
          pendingCount += 1;
          break;
      }
    });

    // Compute estimated next payout date (T+2 working days)
    const nextPayout = new Date();
    nextPayout.setDate(nextPayout.getDate() + 2);
    if (nextPayout.getDay() === 0) nextPayout.setDate(nextPayout.getDate() + 1); // skip Sunday
    if (nextPayout.getDay() === 6) nextPayout.setDate(nextPayout.getDate() + 2); // skip Saturday

    const razorpayKeyId = (env as any).RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || '';
    const razorpayConfigured = Boolean(razorpayKeyId && ((env as any).RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET));

    const overview = {
      grossVolume: Math.round(grossVolume * 100) / 100,
      settledVolume: Math.round(settledVolume * 100) / 100,
      pendingSettlements: Math.round(pendingSettlements * 100) / 100,
      refundedVolume: Math.round(refundedVolume * 100) / 100,
      failedVolume: Math.round(failedVolume * 100) / 100,
      codPendingCollection: Math.round(codPendingCollection * 100) / 100,
      netEarnings: Math.round((settledVolume - refundedVolume) * 100) / 100,
      counts: {
        total: orders.length,
        paid: paidCount,
        pending: pendingCount,
        refunded: refundedCount,
        failed: failedCount,
      },
      methodBreakdown: methodMap,
      settlementCycle: {
        policy: 'T+2 Business Days Automatic Bank Settlement',
        nextEstimatedPayoutDate: nextPayout.toISOString().split('T')[0],
        bankAccountStatus: 'ACTIVE_LINKED',
        settlementFrequency: 'Daily (Cutoff 11:59 PM)',
      },
      razorpayIntegration: {
        isConfigured: razorpayConfigured,
        keyIdPrefix: razorpayKeyId ? `${razorpayKeyId.substring(0, 8)}...` : null,
        webhookReady: Boolean((env as any).RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET),
        webhookEndpoint: '/api/v1/payments/razorpay/webhook',
        supportedModes: ['UPI (Google Pay, PhonePe, Paytm, BHIM)', 'Credit/Debit Cards', 'Net Banking (50+ banks)', 'Cash on Delivery (COD)'],
      },
      recentTransactions: orders.slice(0, 10).map((ord) => ({
        id: ord.id,
        orderNumber: ord.orderNumber,
        totalAmount: ord.totalAmount,
        paymentStatus: ord.paymentStatus,
        paymentMethod: ord.paymentMethod || 'COD',
        paymentId: ord.paymentId || `REF-${ord.orderNumber.replace(/[^0-9]/g, '')}`,
        customerName: ord.address?.fullName || ord.user?.name || 'Guest Buyer',
        customerPhone: ord.address?.phone || ord.user?.phone || 'N/A',
        createdAt: ord.createdAt,
      })),
    };

    res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    logger.error('Error fetching payment overview:', error);
    next(error);
  }
};

/**
 * GET /api/v1/payments/transactions
 * Returns a detailed list of all payment transactions and order settlements with search and status filters.
 */
export const getPaymentTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, method, search, page = '1', limit = '50' } = req.query;

    const whereClause: any = {};

    if (status && status !== 'ALL') {
      whereClause.paymentStatus = status as PaymentStatus;
    }

    if (method && method !== 'ALL') {
      const mStr = String(method).toUpperCase();
      whereClause.paymentMethod = {
        contains: mStr,
      };
    }

    if (search) {
      const q = String(search).trim();
      whereClause.OR = [
        { orderNumber: { contains: q } },
        { paymentId: { contains: q } },
        { user: { name: { contains: q } } },
        { user: { email: { contains: q } } },
        { address: { fullName: { contains: q } } },
        { address: { phone: { contains: q } } },
      ];
    }

    const take = parseInt(String(limit), 10) || 50;
    const skip = (Math.max(1, parseInt(String(page), 10)) - 1) * take;

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        address: {
          select: { fullName: true, phone: true, city: true, state: true, pincode: true },
        },
        items: {
          include: {
            book: {
              select: { id: true, title: true, isbn13: true, price: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    const total = await prisma.order.count({ where: whereClause });

    const formattedTransactions = orders.map((ord) => {
      const normMethod = normalizePaymentMethod(ord.paymentMethod);
      const isOnline = normMethod !== 'COD';
      // Standard estimated gateway fee (2% for online, 0 for COD)
      const estimatedGatewayFee = isOnline && ord.paymentStatus === 'PAID'
        ? Math.round(ord.totalAmount * 0.02 * 100) / 100
        : 0;
      const netSettled = ord.paymentStatus === 'PAID'
        ? Math.max(0, Math.round((ord.totalAmount - estimatedGatewayFee) * 100) / 100)
        : 0;

      // Extract refund reason or notes if present
      let refundReason: string | null = null;
      let refundDate: string | null = null;
      if (ord.notes && ord.notes.includes('REFUNDED')) {
        const match = ord.notes.match(/\[(.*?)\] Status changed to REFUNDED:?(.*)/i);
        if (match) {
          refundDate = match[1] || null;
          refundReason = match[2]?.trim() || null;
        }
      }

      return {
        id: ord.id,
        orderId: ord.id,
        orderNumber: ord.orderNumber,
        paymentId: ord.paymentId || (ord.paymentMethod === 'COD' ? `COD-${ord.orderNumber.replace(/[^0-9]/g, '')}` : `PAY-${ord.orderNumber.replace(/[^0-9]/g, '')}`),
        paymentStatus: ord.paymentStatus,
        orderStatus: ord.status,
        paymentMethod: ord.paymentMethod || 'COD',
        normalizedMethod: normMethod,
        subtotal: ord.subtotal,
        shippingCharge: ord.shippingCharge,
        discountAmount: ord.discountAmount,
        grossAmount: ord.totalAmount,
        estimatedGatewayFee,
        netSettled,
        createdAt: ord.createdAt,
        updatedAt: ord.updatedAt,
        customer: {
          name: ord.address?.fullName || ord.user?.name || 'Guest Buyer',
          email: ord.user?.email || 'N/A',
          phone: ord.address?.phone || ord.user?.phone || 'N/A',
          city: ord.address?.city || '',
          state: ord.address?.state || '',
        },
        itemsCount: ord.items?.reduce((sum, it) => sum + it.quantity, 0) || 0,
        itemsSummary: ord.items?.map((it) => `${it.book?.title || 'Book'} (x${it.quantity})`).join(', ') || '',
        notes: ord.notes || '',
        refundInfo: ord.paymentStatus === 'REFUNDED' ? {
          refundDate: refundDate || ord.updatedAt.toISOString(),
          refundReason: refundReason || 'Refund processed by Admin',
          refundAmount: ord.totalAmount,
        } : null,
      };
    });

    res.status(200).json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: parseInt(String(page), 10) || 1,
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    logger.error('Error fetching payment transactions:', error);
    next(error);
  }
};

/**
 * PATCH /api/v1/payments/:orderId/status
 * Updates payment status (PAID, PENDING, FAILED, REFUNDED) and records refund reasons/amounts.
 */
export const updatePaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { paymentStatus, paymentId, paymentMethod, refundAmount, refundReason, notes } = req.body;

    if (!paymentStatus || !['PAID', 'PENDING', 'FAILED', 'REFUNDED'].includes(paymentStatus)) {
      res.status(400).json({
        success: false,
        message: 'Invalid paymentStatus. Allowed values: PAID, PENDING, FAILED, REFUNDED',
      });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, address: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const nowStr = new Date().toISOString();
    let auditNote = `[${nowStr}] Payment Status changed from ${order.paymentStatus} to ${paymentStatus}`;

    if (paymentStatus === 'REFUNDED') {
      const rAmt = refundAmount ? `₹${refundAmount}` : `₹${order.totalAmount}`;
      const rReas = refundReason ? ` (Reason: ${refundReason})` : '';
      auditNote += ` | Refund Processed: ${rAmt}${rReas}`;
    }

    if (notes) {
      auditNote += ` | Note: ${notes}`;
    }

    const updatedNotes = order.notes ? `${order.notes}\n${auditNote}` : auditNote;

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: paymentStatus as PaymentStatus,
        paymentId: paymentId !== undefined ? paymentId : order.paymentId,
        paymentMethod: paymentMethod !== undefined ? paymentMethod : order.paymentMethod,
        notes: updatedNotes,
      },
      include: { user: true, address: true },
    });

    // Dispatch in-app customer notification
    try {
      if (order.userId) {
        if (paymentStatus === 'PAID') {
          await prisma.notification.create({
            data: {
              userId: order.userId,
              title: `💳 Payment Confirmed (Order #${order.orderNumber})`,
              message: `Payment of ₹${order.totalAmount} for your order #${order.orderNumber} has been successfully verified.`,
              type: 'payment',
              link: `/profile?tab=orders`,
            },
          });
        } else if (paymentStatus === 'REFUNDED') {
          await prisma.notification.create({
            data: {
              userId: order.userId,
              title: `💸 Refund Initiated (Order #${order.orderNumber})`,
              message: `A refund of ${refundAmount ? `₹${refundAmount}` : `₹${order.totalAmount}`} has been initiated for order #${order.orderNumber}. Reason: ${refundReason || 'Order return/cancellation'}.`,
              type: 'refund',
              link: `/profile?tab=orders`,
            },
          });
        }
      }
    } catch (notifErr) {
      logger.warn('Failed to send notification for payment update:', notifErr);
    }

    res.status(200).json({
      success: true,
      message: `Payment status updated to ${paymentStatus} successfully!`,
      data: updatedOrder,
    });
  } catch (error) {
    logger.error('Error updating payment status:', error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/razorpay/webhook
 * Webhook handler ready for live Razorpay events.
 */
export const razorpayWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const webhookSecret = (env as any).RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const signature = req.headers['x-razorpay-signature'] as string;
      if (!signature) {
        res.status(400).json({ success: false, message: 'Missing Razorpay webhook signature header' });
        return;
      }
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');

      if (digest !== signature) {
        res.status(400).json({ success: false, message: 'Invalid webhook signature' });
        return;
      }
    }

    const event = req.body.event;
    const payload = req.body.payload;

    logger.info(`Razorpay Webhook Event received: ${event}`);

    if (event === 'payment.captured' && payload?.payment?.entity) {
      const p = payload.payment.entity;
      const orderId = p.notes?.order_id || p.order_id;
      const paymentId = p.id;
      const method = p.method ? String(p.method).toUpperCase() : 'ONLINE';

      if (orderId) {
        const existingOrder = await prisma.order.findFirst({
          where: {
            OR: [
              { id: orderId },
              { orderNumber: orderId },
              { paymentId: paymentId },
            ],
          },
        });

        if (existingOrder) {
          await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              paymentStatus: PaymentStatus.PAID,
              paymentId,
              paymentMethod: method,
              notes: existingOrder.notes
                ? `${existingOrder.notes}\n[${new Date().toISOString()}] Razorpay Webhook captured: ${paymentId}`
                : `[${new Date().toISOString()}] Razorpay Webhook captured: ${paymentId}`,
            },
          });
        }
      }
    } else if (event === 'refund.processed' && payload?.refund?.entity) {
      const r = payload.refund.entity;
      const paymentId = r.payment_id;
      if (paymentId) {
        const existingOrder = await prisma.order.findFirst({
          where: { paymentId },
        });
        if (existingOrder) {
          await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
              notes: existingOrder.notes
                ? `${existingOrder.notes}\n[${new Date().toISOString()}] Razorpay Webhook refund: ₹${(r.amount || 0) / 100}`
                : `[${new Date().toISOString()}] Razorpay Webhook refund: ₹${(r.amount || 0) / 100}`,
            },
          });
        }
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Error handling Razorpay webhook:', error);
    next(error);
  }
};
