import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { imapService } from '../services/imap.service.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../config/logger.js';
import { TicketStatus, TicketDepartment } from '@prisma/client';

/**
 * GET /api/v1/support/tickets
 * Lists tickets with status/department filters, search query, and pagination
 */
export const listTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const skip = (page - 1) * limit;

    const statusParam = req.query.status as string | undefined;
    const deptParam = req.query.department as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();

    const where: any = {};

    if (statusParam && statusParam !== 'ALL') {
      const normalizedStatus = statusParam.toUpperCase() as TicketStatus;
      if (['OPEN', 'PENDING', 'SOLVED', 'DISCARDED'].includes(normalizedStatus)) {
        where.status = normalizedStatus;
      }
    }

    if (deptParam && deptParam !== 'ALL') {
      const normalizedDept = deptParam.toUpperCase() as TicketDepartment;
      if (['SUPPORT', 'TEAM'].includes(normalizedDept)) {
        where.department = normalizedDept;
      }
    }

    if (q) {
      where.OR = [
        { ticketId: { contains: q, mode: 'insensitive' } },
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [tickets, total, statusCounts] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, customerId: true, email: true },
          },
          _count: {
            select: { messages: true },
          },
          messages: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { body: true, timestamp: true, sender: true },
          },
        },
      }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const stats = {
      all: 0,
      open: 0,
      pending: 0,
      solved: 0,
      discarded: 0,
    };

    statusCounts.forEach((sc) => {
      const count = sc._count._all;
      stats.all += count;
      if (sc.status === 'OPEN') stats.open = count;
      if (sc.status === 'PENDING') stats.pending = count;
      if (sc.status === 'SOLVED') stats.solved = count;
      if (sc.status === 'DISCARDED') stats.discarded = count;
    });

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats,
      },
    });
  } catch (error: any) {
    if (error && (error.code === 'P2021' || String(error.message).includes('does not exist') || String(error).includes('Ticket'))) {
      logger.warn('[TicketController] Ticket table not initialized in database, returning empty list');
      res.json({
        success: true,
        data: {
          tickets: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
          stats: {
            all: 0,
            open: 0,
            pending: 0,
            solved: 0,
            discarded: 0,
          },
        },
      });
      return;
    }
    next(error);
  }
};

/**
 * GET /api/v1/support/tickets/:id
 * Fetches single ticket with full message history and customer context
 */
export const getTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id }, { ticketId: id }],
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            customerId: true,
            technoPoints: true,
            technoWallet: true,
            createdAt: true,
          },
        },
        messages: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }

    // If customer linked, fetch their recent orders
    let recentOrders: any[] = [];
    if (ticket.customerId) {
      recentOrders = await prisma.order.findMany({
        where: { userId: ticket.customerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          paymentMethod: true,
          trackingNumber: true,
          shippingCarrier: true,
        },
      });
    }

    res.json({
      success: true,
      data: {
        ticket,
        recentOrders,
      },
    });
  } catch (error: any) {
    if (error && (error.code === 'P2021' || String(error.message).includes('does not exist'))) {
      res.status(404).json({ success: false, message: 'Support desk not yet initialized in database' });
      return;
    }
    next(error);
  }
};

/**
 * POST /api/v1/support/tickets/:id/reply
 * Dispatches admin reply via Nodemailer and records in database
 */
export const replyTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { body, htmlBody, markAsPending } = req.body;

    if (!body || !body.trim()) {
      res.status(400).json({ success: false, message: 'Reply message body cannot be empty' });
      return;
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id }, { ticketId: id }],
      },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }

    const adminUserId = (req as any).user?.id || null;
    const customerMessages = ticket.messages.filter((m) => m.sender === 'CUSTOMER');
    const latestCustomerMsg = customerMessages[0];

    const inReplyTo = latestCustomerMsg?.messageId || undefined;
    const references = ticket.messages
      .map((m) => m.messageId)
      .filter(Boolean) as string[];

    // Send email to customer via Nodemailer
    const emailResult = await emailService.sendTicketReply({
      toEmail: ticket.customerEmail,
      department: ticket.department,
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      bodyText: body.trim(),
      bodyHtml: htmlBody,
      inReplyTo,
      references,
    });

    // Generate a unique RFC message ID for our outbound admin reply
    const adminMessageId =
      emailResult.messageId || `<twb-admin-${ticket.ticketId}-${Date.now()}@technoworldbooks.in>`;

    // Persist reply and update ticket status
    const newStatus: TicketStatus = markAsPending === false ? 'OPEN' : 'PENDING';

    const [newMessage] = await prisma.$transaction([
      prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          sender: 'ADMIN',
          body: body.trim(),
          htmlBody,
          messageId: adminMessageId,
          adminUserId,
          timestamp: new Date(),
        },
      }),
      prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      }),
    ]);

    res.json({
      success: true,
      message: emailResult.success
        ? 'Reply dispatched to customer and saved to thread'
        : 'Reply saved, but outbound email delivery encountered an issue',
      data: {
        message: newMessage,
        emailDelivered: emailResult.success,
        emailError: emailResult.error,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/support/tickets/:id/status
 * Updates ticket status (e.g. Mark as Solved, Discard) with optional closure reason
 */
export const updateTicketStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, closureReason } = req.body;

    if (!status || !['OPEN', 'PENDING', 'SOLVED', 'DISCARDED'].includes(status.toUpperCase())) {
      res.status(400).json({ success: false, message: 'Invalid ticket status' });
      return;
    }

    const normalizedStatus = status.toUpperCase() as TicketStatus;

    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id }, { ticketId: id }],
      },
    });

    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: normalizedStatus,
        closureReason: closureReason !== undefined ? closureReason : ticket.closureReason,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: `Ticket marked as ${normalizedStatus}`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/support/sync
 * Manually triggers IMAP inbox check for support@ and team@
 */
export const triggerSync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const syncResult = await imapService.syncInboxes();
    res.json({
      success: true,
      message: `IMAP synchronization complete. Processed ${syncResult.processedCount} new email(s).`,
      data: syncResult,
    });
  } catch (error) {
    next(error);
  }
};
