import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../config/logger.js';


// POST /api/v1/contact
export const submitContactMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, orderNumber, message } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Please provide your name.' });
      return;
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      return;
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, message: 'Please write your message or query.' });
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedOrderNumber = orderNumber && typeof orderNumber === 'string' ? orderNumber.trim() : null;
    const trimmedMessage = message.trim();
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || null;

    // 1. Save to Database
    const contactMessage = await prisma.contactMessage.create({
      data: {
        name: trimmedName,
        email: trimmedEmail,
        orderNumber: trimmedOrderNumber,
        message: trimmedMessage,
        status: 'UNREAD',
        ipAddress: typeof ipAddress === 'string' ? ipAddress : null,
      },
    });

    // 2. Notify Admins via In-App Notification if admin users exist
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true },
      });

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            title: `New Contact Inquiry: ${trimmedName}`,
            message: trimmedOrderNumber
              ? `Inquiry regarding order #${trimmedOrderNumber}: "${trimmedMessage.slice(0, 100)}..."`
              : `Customer query: "${trimmedMessage.slice(0, 100)}..."`,
            type: 'SUPPORT',
          })),
        });
      }
    } catch (notifErr: any) {
      logger.warn(`Failed to create admin notification for contact message: ${notifErr.message}`);
    }

    // 3. Send automated customer receipt acknowledgment email asynchronously
    const ackSubject = `We've received your message — Techno World Books`;
    const ackMessage = `Hello ${trimmedName},\n\nThank you for reaching out to Techno World Books! Our College Street customer service team has received your message.\n\n${
      trimmedOrderNumber ? `Order Reference: #${trimmedOrderNumber}\n\n` : ''
    }Your Message:\n"${trimmedMessage}"\n\nWe typically review and reply to all queries within business hours (Monday to Saturday, 10:00 AM – 8:00 PM).\n\nWarm regards,\nTechno World Books Team\n90/6A Mahatma Gandhi Rd, College Street, Kolkata 700007\nWhatsApp: +91 747 913 5626`;

    emailService
      .sendOrderNotification({
        recipientEmail: trimmedEmail,
        orderNumber: trimmedOrderNumber || 'INQUIRY',
        subject: ackSubject,
        message: ackMessage,
      })
      .catch((err) => logger.warn(`Failed to dispatch customer contact ack email: ${err.message}`));

    // 4. Send alert email to store support inbox
    const supportAlertSubject = `📩 New Website Inquiry from ${trimmedName}${trimmedOrderNumber ? ` (Order #${trimmedOrderNumber})` : ''}`;
    const supportAlertMessage = `New message received from the website contact form:\n\nName: ${trimmedName}\nEmail: ${trimmedEmail}\nOrder Number: ${trimmedOrderNumber || 'N/A'}\nIP: ${ipAddress || 'Unknown'}\nTime: ${new Date().toLocaleString('en-IN')}\n\nMessage:\n${trimmedMessage}`;

    emailService
      .sendOrderNotification({
        recipientEmail: 'support@technoworldbooks.in',
        orderNumber: trimmedOrderNumber || 'INQUIRY',
        subject: supportAlertSubject,
        message: supportAlertMessage,
      })
      .catch((err) => logger.warn(`Failed to dispatch admin contact alert email: ${err.message}`));

    res.status(201).json({
      success: true,
      message: 'Your message has been received! Our College Street team will reply within 24 hours.',
      data: {
        id: contactMessage.id,
        createdAt: contactMessage.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/contact (Admin only)
export const getContactMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { orderNumber: { contains: q } },
        { message: { contains: q } },
      ];
    }

    const [messages, total] = await Promise.all([
      prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contactMessage.count({ where }),
    ]);

    const unreadCount = await prisma.contactMessage.count({ where: { status: 'UNREAD' } });

    res.status(200).json({
      success: true,
      data: messages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/contact/:id (Admin only)
export const updateContactMessageStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reply } = req.body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (reply !== undefined) {
      updateData.reply = reply;
      updateData.repliedAt = new Date();
      updateData.status = 'REPLIED';
    }

    const updated = await prisma.contactMessage.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Message status updated',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};
