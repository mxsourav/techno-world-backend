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

async function ensureTrigramIndexes() {
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE INDEX IF NOT EXISTS "Book_title_trgm_idx" ON "Book" USING GIN ("title" gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS "Author_name_trgm_idx" ON "Author" USING GIN ("name" gin_trgm_ops);
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Book' AND column_name='author') THEN
          CREATE INDEX IF NOT EXISTS "Book_author_trgm_idx" ON "Book" USING GIN ("author" gin_trgm_ops);
        END IF;
      EXCEPTION WHEN OTHERS THEN null;
      END $$;
    `);
    logger.info('[Bootstrap] Trigram GIN indexes verified/created successfully');
  } catch (err) {
    logger.warn('[Bootstrap] Non-critical error checking Trigram GIN indexes:', err);
  }
}

async function ensureMultiCategoryAndTrackingSchema() {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        -- 1. Ensure User columns
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='avatarKey') THEN
          ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='age') THEN
          ALTER TABLE "User" ADD COLUMN "age" INTEGER;
        END IF;

        -- 2. Ensure Order trackingToken
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Order' AND column_name='trackingToken') THEN
          ALTER TABLE "Order" ADD COLUMN "trackingToken" TEXT;
          UPDATE "Order" SET "trackingToken" = md5(random()::text || clock_timestamp()::text) WHERE "trackingToken" IS NULL;
          ALTER TABLE "Order" ALTER COLUMN "trackingToken" SET NOT NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS "Order_trackingToken_key" ON "Order"("trackingToken");
        END IF;

        -- 3. Ensure Many-to-Many _BookToCategory table
        CREATE TABLE IF NOT EXISTS "_BookToCategory" (
          "A" TEXT NOT NULL,
          "B" TEXT NOT NULL,
          CONSTRAINT "_BookToCategory_AB_pkey" PRIMARY KEY ("A","B")
        );
        CREATE INDEX IF NOT EXISTS "_BookToCategory_B_index" ON "_BookToCategory"("B");

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_BookToCategory_A_fkey') THEN
          ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_BookToCategory_B_fkey') THEN
          ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        -- 4. Backfill existing books categoryId into _BookToCategory
        INSERT INTO "_BookToCategory" ("A", "B")
        SELECT b."id", b."categoryId"
        FROM "Book" b
        WHERE b."categoryId" IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- 5. Ensure Science and Techno World Publication categories
        INSERT INTO "Category" ("id", "name", "slug", "description", "isActive", "createdAt", "updatedAt")
        VALUES 
          (md5(random()::text || clock_timestamp()::text), 'Science', 'science', 'Academic and scientific textbooks, reference manuals and research literature.', true, NOW(), NOW()),
          (md5(random()::text || clock_timestamp()::text), 'Techno World Publication', 'techno-world-publication', 'Official in-house academic publications, study guides, and solutions by Techno World Books.', true, NOW(), NOW())
        ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name";

      EXCEPTION WHEN OTHERS THEN null;
      END $$;
    `);
    logger.info('[Bootstrap] Multi-category relations, trackingToken, and categories verified/created successfully');
  } catch (err) {
    logger.warn('[Bootstrap] Non-critical error ensuring multi-category schema:', err);
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
    await ensureTrigramIndexes();
    await ensureMultiCategoryAndTrackingSchema();

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
