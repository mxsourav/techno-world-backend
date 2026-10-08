import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';
import { startInvoiceCron, stopInvoiceCron } from './cron/invoice.cron.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

import crypto from 'crypto';
import { ensureCustomerIds } from './utils/customerId.util.js';
import { imapService } from './services/imap.service.js';

async function ensureDefaultAdminUser(): Promise<void> {
  try {
    const adminCount = await prisma.user.count({
      where: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] } },
    });

    if (adminCount === 0) {
      logger.info('No admin user found. Initializing Super Admin...');
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(initialPassword, 10);
      await prisma.user.create({
        data: {
          email: 'admin@technoworldbooks.in',
          name: 'Super Admin',
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          isActive: true,
        },
      });
      if (!process.env.INITIAL_ADMIN_PASSWORD) {
        logger.warn(`[SECURITY NOTICE] Initial Super Admin created with one-time generated password: ${initialPassword}`);
        logger.warn('[SECURITY NOTICE] Please log in and change this password immediately.');
      } else {
        logger.info('Initial Super Admin created using INITIAL_ADMIN_PASSWORD.');
      }
    } else {
      // If admin user exists, unlock any potential DB-level lockouts
      await prisma.user.updateMany({
        where: { email: { in: ['admin', 'admin@technoworldbooks.in'] } },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }
  } catch (err) {
    logger.warn('Error checking/initializing default admin user:', err);
  }
}

async function autoHealPlaceholderCovers(): Promise<void> {
  try {
    const booksToHeal = await prisma.book.findMany({
      where: {
        coverUrl: { contains: 'placeholder-book.jpg' },
      },
      select: {
        id: true,
        galleryUrls: true,
      },
    });

    if (booksToHeal.length > 0) {
      logger.info(`[AutoHeal] Found ${booksToHeal.length} books with placeholder coverUrl. Healing...`);
      for (const book of booksToHeal) {
        let realCover: string | null = null;
        if (book.galleryUrls) {
          try {
            const parsed = typeof book.galleryUrls === 'string' ? JSON.parse(book.galleryUrls) : book.galleryUrls;
            if (Array.isArray(parsed)) {
              realCover = parsed.find(u => typeof u === 'string' && u.trim() && !u.includes('placeholder-book.jpg')) || null;
            }
          } catch {}
        }
        await prisma.book.update({
          where: { id: book.id },
          data: { coverUrl: realCover },
        });
      }
      logger.info(`[AutoHeal] Successfully healed ${booksToHeal.length} book cover URLs.`);
    }
  } catch (err) {
    logger.warn('[AutoHeal] Non-critical error during cover auto-heal:', err);
  }
}

async function ensureSupportTables(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'SOLVED', 'DISCARDED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "TicketDepartment" AS ENUM ('SUPPORT', 'TEAM');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "TicketSender" AS ENUM ('CUSTOMER', 'ADMIN');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Ticket" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "ticketId" TEXT NOT NULL UNIQUE,
        "customerId" TEXT,
        "customerEmail" TEXT NOT NULL,
        "customerName" TEXT,
        "department" "TicketDepartment" NOT NULL DEFAULT 'SUPPORT',
        "subject" TEXT NOT NULL,
        "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
        "closureReason" TEXT,
        "orderNumber" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TicketMessage" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
        "sender" "TicketSender" NOT NULL,
        "body" TEXT NOT NULL,
        "htmlBody" TEXT,
        "messageId" TEXT UNIQUE,
        "adminUserId" TEXT,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE INDEX IF NOT EXISTS "Ticket_customerId_idx" ON "Ticket"("customerId");
        CREATE INDEX IF NOT EXISTS "Ticket_customerEmail_idx" ON "Ticket"("customerEmail");
        CREATE INDEX IF NOT EXISTS "Ticket_status_idx" ON "Ticket"("status");
        CREATE INDEX IF NOT EXISTS "Ticket_department_idx" ON "Ticket"("department");
        CREATE INDEX IF NOT EXISTS "Ticket_ticketId_idx" ON "Ticket"("ticketId");
        CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt");
        CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_idx" ON "TicketMessage"("ticketId");
        CREATE INDEX IF NOT EXISTS "TicketMessage_messageId_idx" ON "TicketMessage"("messageId");
        CREATE INDEX IF NOT EXISTS "TicketMessage_timestamp_idx" ON "TicketMessage"("timestamp");
      EXCEPTION WHEN OTHERS THEN null;
      END $$;
    `);
    logger.info('[Bootstrap] Support Ticket tables verified/created successfully');
  } catch (err) {
    logger.warn('[Bootstrap] Non-critical error checking Ticket tables:', err);
  }
}

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('DB connected successfully');

    await ensureDefaultAdminUser();
    await autoHealPlaceholderCovers();
    await ensureCustomerIds();
    await ensureSupportTables();

    startInvoiceCron();
    imapService.startPolling();

    app.listen(env.PORT, () => {
      logger.info(`Server is running on port ${env.PORT}`);
      logger.info(`API Documentation available at http://localhost:${env.PORT}/docs`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  stopInvoiceCron();
  imapService.stopPolling();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  stopInvoiceCron();
  imapService.stopPolling();
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
