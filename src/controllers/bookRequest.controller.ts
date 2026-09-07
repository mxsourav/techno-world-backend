import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { emailService } from '../services/email.service.js';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

// POST /api/v1/book-requests (Public)
export const submitBookRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, author, email, phone, publisher, edition, notes, imageUrl } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ success: false, message: 'Book title is required.' });
      return;
    }

    if (!author || typeof author !== 'string' || !author.trim()) {
      res.status(400).json({ success: false, message: 'Author name is required.' });
      return;
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone && typeof phone === 'string' ? phone.trim() : null;
    const trimmedPublisher = publisher && typeof publisher === 'string' ? publisher.trim() : null;
    const trimmedEdition = edition && typeof edition === 'string' ? edition.trim() : null;
    const trimmedNotes = notes && typeof notes === 'string' ? notes.trim() : null;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || null;

    // 1. Create Book Request in DB
    const requestRecord = await prisma.bookRequest.create({
      data: {
        title: trimmedTitle,
        author: trimmedAuthor,
        email: trimmedEmail,
        phone: trimmedPhone,
        publisher: trimmedPublisher,
        edition: trimmedEdition,
        notes: trimmedNotes,
        imageUrl: imageUrl && typeof imageUrl === 'string' ? imageUrl : null,
        status: 'PENDING',
        ipAddress: typeof ipAddress === 'string' ? ipAddress : null,
      },
    });

    // 2. Notify Admins via In-App Notification
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true },
      });

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            title: `New Book Request: "${trimmedTitle}"`,
            message: `Customer ${trimmedEmail} requested "${trimmedTitle}" by ${trimmedAuthor}.${trimmedPhone ? ` Phone: ${trimmedPhone}` : ''}`,
            type: 'SUPPORT',
          })),
        });
      }
    } catch (err: any) {
      logger.warn(`Failed to create admin notification for book request: ${err.message}`);
    }

    // 3. Customer Acknowledgment Email
    const ackSubject = `We're sourcing your requested book: "${trimmedTitle}" — Techno World Books`;
    const ackMessage = `Hello,\n\nThank you for requesting "${trimmedTitle}" by ${trimmedAuthor}!\n\nOur College Street sourcing team has received your request and is checking our extensive publisher and distributor network across Kolkata and India.\n\nDetails Submitted:\n- Book: ${trimmedTitle}\n- Author: ${trimmedAuthor}\n${trimmedPublisher ? `- Publisher: ${trimmedPublisher}\n` : ''}${trimmedEdition ? `- Edition: ${trimmedEdition}\n` : ''}${trimmedNotes ? `- Notes: ${trimmedNotes}\n` : ''}\nAs soon as we locate copies or pricing, we will contact you directly via email or WhatsApp.\n\nWarm regards,\nTechno World Books\nCollege Street, Kolkata · Delivering Across India\nWhatsApp Support: +91 747 913 5626`;

    emailService
      .sendOrderNotification({
        recipientEmail: trimmedEmail,
        orderNumber: 'BOOK_REQ',
        subject: ackSubject,
        message: ackMessage,
      })
      .catch((err) => logger.warn(`Failed to send customer book request ack email: ${err.message}`));

    // 4. Admin Alert Email
    const adminAlertSubject = `📚 Customer Book Sourcing Request: "${trimmedTitle}" by ${trimmedAuthor}`;
    const adminAlertMessage = `A customer has requested a book not currently found on the website:\n\nTitle: ${trimmedTitle}\nAuthor: ${trimmedAuthor}\nCustomer Email: ${trimmedEmail}\nCustomer Phone: ${trimmedPhone || 'N/A'}\nPublisher: ${trimmedPublisher || 'N/A'}\nEdition: ${trimmedEdition || 'N/A'}\nNotes: ${trimmedNotes || 'None'}\nHas Image: ${imageUrl ? 'Yes' : 'No'}\nTime: ${new Date().toLocaleString('en-IN')}`;

    emailService
      .sendOrderNotification({
        recipientEmail: 'support@technoworldbooks.in',
        orderNumber: 'BOOK_REQ',
        subject: adminAlertSubject,
        message: adminAlertMessage,
      })
      .catch((err) => logger.warn(`Failed to send admin book request alert email: ${err.message}`));

    res.status(201).json({
      success: true,
      message: `Your request for "${trimmedTitle}" has been received! Our College Street team will check publisher availability and reach out to you shortly.`,
      data: requestRecord,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/book-requests (Admin)
export const getBookRequests = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
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
        { title: { contains: q } },
        { author: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { publisher: { contains: q } },
      ];
    }

    const [requests, total] = await Promise.all([
      prisma.bookRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bookRequest.count({ where }),
    ]);

    const pendingCount = await prisma.bookRequest.count({ where: { status: 'PENDING' } });

    res.status(200).json({
      success: true,
      data: requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        pendingCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/book-requests/:id (Admin)
export const updateBookRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const updated = await prisma.bookRequest.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Book request updated',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/book-requests/:id (Admin)
export const deleteBookRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.bookRequest.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Book request deleted' });
  } catch (error) {
    next(error);
  }
};
