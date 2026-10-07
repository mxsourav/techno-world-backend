import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../config/logger.js';
import { whatsappService } from '../services/whatsapp.service.js';
import type { B2BEnquiryStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface AttachedCartItemSnapshot {
  bookId?: string | null;
  isbn?: string | null;
  title: string;
  requestedQuantity: number;
  currentRetailPrice: number;
}

// POST /api/v1/b2b-quotes (Public, rate-limited)
export const submitB2BEnquiry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      organizationName,
      representativeName,
      email,
      phone,
      timeline,
      requirements,
      attachedCartItems,
    } = req.body;

    // Validate Required Fields
    if (!organizationName || typeof organizationName !== 'string' || !organizationName.trim()) {
      res.status(400).json({ success: false, message: 'Please provide the Institute or Organization Name.' });
      return;
    }

    if (!representativeName || typeof representativeName !== 'string' || !representativeName.trim()) {
      res.status(400).json({ success: false, message: 'Please provide the Representative Contact Name.' });
      return;
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      return;
    }

    if (!phone || typeof phone !== 'string' || !phone.trim() || phone.trim().length < 7) {
      res.status(400).json({ success: false, message: 'Please provide a valid phone or WhatsApp number.' });
      return;
    }

    if (!requirements || typeof requirements !== 'string' || !requirements.trim()) {
      res.status(400).json({ success: false, message: 'Please provide your book requirements or syllabus details.' });
      return;
    }

    const trimmedOrg = organizationName.trim();
    const trimmedRep = representativeName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();
    const trimmedTimeline = timeline && typeof timeline === 'string' ? timeline.trim() : null;
    const trimmedRequirements = requirements.trim();

    // Sanitize Cart Snapshot
    let sanitizedCartItems: AttachedCartItemSnapshot[] = [];
    if (Array.isArray(attachedCartItems) && attachedCartItems.length > 0) {
      sanitizedCartItems = attachedCartItems.map((item: any) => ({
        bookId: item.bookId ? String(item.bookId).trim() : null,
        isbn: item.isbn ? String(item.isbn).trim() : null,
        title: String(item.title || 'Untitled Book').trim(),
        requestedQuantity: Math.max(1, parseInt(item.requestedQuantity || item.qty || 1, 10)),
        currentRetailPrice: Math.max(0, parseFloat(item.currentRetailPrice || item.price || 0)),
      }));
    }

    // 1. Create B2B Enquiry Record
    const enquiry = await prisma.b2BEnquiry.create({
      data: {
        organizationName: trimmedOrg,
        representativeName: trimmedRep,
        email: trimmedEmail,
        phone: trimmedPhone,
        timeline: trimmedTimeline,
        requirements: trimmedRequirements,
        attachedCartItems: sanitizedCartItems as unknown as Prisma.InputJsonValue,
        status: 'Pending',
        adminNotes: '',
      },
    });

    // 2. Notify Admins via In-App Notification
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true },
      });

      if (admins.length > 0) {
        const cartNotice = sanitizedCartItems.length > 0 ? ` (${sanitizedCartItems.length} books attached from cart)` : '';
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            title: `B2B Quote Request: ${trimmedOrg}`,
            message: `${trimmedRep} requested institutional quotation for ${trimmedOrg}${cartNotice}. Contact: ${trimmedPhone}`,
            type: 'SUPPORT',
          })),
        });
      }
    } catch (notifErr: any) {
      logger.warn(`Failed to create admin notification for B2B enquiry: ${notifErr.message}`);
    }

    // 3. Send Customer Confirmation Email (Asynchronous)
    const cartSummaryText = sanitizedCartItems.length > 0
      ? `\nAttached Cart Snapshot (${sanitizedCartItems.length} items):\n` +
        sanitizedCartItems.map((item, idx) => `  ${idx + 1}. ${item.title} (Qty: ${item.requestedQuantity}) - Retail: ₹${item.currentRetailPrice}`).join('\n')
      : '';

    const ackSubject = `Institutional Quote Request Received — ${trimmedOrg} | Techno World Books`;
    const ackMessage = `Dear ${trimmedRep},\n\nThank you for reaching out to Techno World Books College Street for institutional bulk purchasing.\n\nWe have received your quotation request for:\nOrganization: ${trimmedOrg}\nRepresentative: ${trimmedRep}\nPhone / WhatsApp: ${trimmedPhone}\nExpected Timeline: ${trimmedTimeline || 'Standard Requisition'}\n\nRequirements:\n"${trimmedRequirements}"\n${cartSummaryText}\n\nOur Institutional Sales Team (headed by Md. Washim Akram) is reviewing your requirements and will contact you with a formal quotation and institutional discount tier within 2–4 business hours.\n\nFor urgent queries:\nDirect Sales Desk: +91 747 913 5626\nOfficial Quotation Desk: team@technoworldbooks.in\n\nWarm regards,\nTechno World Books\nCollege Street, Kolkata 700007`;

    emailService
      .sendOrderNotification({
        recipientEmail: trimmedEmail,
        recipientName: trimmedRep,
        orderNumber: `B2B-${enquiry.id.slice(0, 8).toUpperCase()}`,
        subject: ackSubject,
        message: ackMessage,
        tier: 'TEAM',
        replyTo: 'team@technoworldbooks.in',
      })
      .catch((err) => logger.warn(`Failed to dispatch B2B customer ack email: ${err.message}`));

    // 4. Send Alert Email to Institutional Sales Inbox
    const alertSubject = `New B2B Quote Request: ${trimmedOrg} (${trimmedRep})`;
    const alertMessage = `A new institutional quote request has been submitted:\n\nOrganization: ${trimmedOrg}\nRepresentative: ${trimmedRep}\nEmail: ${trimmedEmail}\nPhone: ${trimmedPhone}\nTimeline: ${trimmedTimeline || 'None'}\n\nRequirements:\n${trimmedRequirements}\n${cartSummaryText}\n\nSubmitted At: ${new Date().toLocaleString('en-IN')}`;

    emailService
      .sendOrderNotification({
        recipientEmail: 'team@technoworldbooks.in',
        orderNumber: `B2B-${enquiry.id.slice(0, 8).toUpperCase()}`,
        subject: alertSubject,
        message: alertMessage,
        tier: 'TEAM',
      })
      .catch((err) => logger.warn(`Failed to dispatch B2B internal alert email: ${err.message}`));

    // 5. Notify the institutional sales admin on WhatsApp (best-effort)
    whatsappService
      .sendB2BEnquiryAlert({
        enquiryId: enquiry.id,
        organizationName: trimmedOrg,
        representativeName: trimmedRep,
        email: trimmedEmail,
        phone: trimmedPhone,
        timeline: trimmedTimeline,
        requirements: trimmedRequirements,
        attachedCartItemCount: sanitizedCartItems.length,
      })
      .catch((err) => logger.warn(`Failed to dispatch B2B WhatsApp alert: ${err.message}`));

    res.status(201).json({
      success: true,
      message: 'Thank you. Your inquiry has been logged. Our institutional sales team will review your requirements and contact you within 2–4 business hours.',
      data: {
        id: enquiry.id,
        createdAt: enquiry.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/b2b-quotes (Admin only)
export const getB2BEnquiries = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 25;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as B2BEnquiryStatus;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { organizationName: { contains: q, mode: 'insensitive' } },
        { representativeName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { requirements: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [enquiries, total, pendingCount, contactedCount, quotedCount, closedCount] = await Promise.all([
      prisma.b2BEnquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.b2BEnquiry.count({ where }),
      prisma.b2BEnquiry.count({ where: { status: 'Pending' } }),
      prisma.b2BEnquiry.count({ where: { status: 'Contacted' } }),
      prisma.b2BEnquiry.count({ where: { status: 'Quoted' } }),
      prisma.b2BEnquiry.count({ where: { status: 'Closed' } }),
    ]);

    res.status(200).json({
      success: true,
      data: enquiries,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        counts: {
          pending: pendingCount,
          contacted: contactedCount,
          quoted: quotedCount,
          closed: closedCount,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/b2b-quotes/:id (Admin only)
export const getB2BEnquiryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const enquiry = await prisma.b2BEnquiry.findUnique({
      where: { id },
    });

    if (!enquiry) {
      res.status(404).json({ success: false, message: 'Quote request not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: enquiry,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/b2b-quotes/:id (Admin only)
export const updateB2BEnquiry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updateData: any = {};
    if (status && ['Pending', 'Contacted', 'Quoted', 'Closed'].includes(status)) {
      updateData.status = status as B2BEnquiryStatus;
    }
    if (adminNotes !== undefined) {
      updateData.adminNotes = typeof adminNotes === 'string' ? adminNotes : '';
    }

    const updated = await prisma.b2BEnquiry.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Quote request updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/b2b-quotes/:id (Admin only)
export const deleteB2BEnquiry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.b2BEnquiry.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'Quote request deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
