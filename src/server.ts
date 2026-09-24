import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';
import { startInvoiceCron, stopInvoiceCron } from './cron/invoice.cron.js';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

async function ensureDefaultAdminUser(): Promise<void> {
  try {
    const adminCount = await prisma.user.count({
      where: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] } },
    });

    if (adminCount === 0) {
      logger.info('No admin user found. Creating default Super Admin...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.user.upsert({
        where: { email: 'admin' },
        update: {
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          isActive: true,
          failedLogins: 0,
          lockedUntil: null,
        },
        create: {
          email: 'admin',
          name: 'Super Admin',
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          isActive: true,
        },
      });
      await prisma.user.upsert({
        where: { email: 'admin@technoworldbooks.in' },
        update: {
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          isActive: true,
          failedLogins: 0,
          lockedUntil: null,
        },
        create: {
          email: 'admin@technoworldbooks.in',
          name: 'Super Admin',
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          isActive: true,
        },
      });
      logger.info('Default Super Admin successfully initialized');
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

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('DB connected successfully');

    await ensureDefaultAdminUser();

    startInvoiceCron();

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
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  stopInvoiceCron();
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
