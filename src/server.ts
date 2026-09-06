// Deploy trigger: v1.0.3 - reviews, questions, multi-order consignment & zero child delivery release
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';
import { startInvoiceCron, stopInvoiceCron } from './cron/invoice.cron.js';

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('DB connected successfully');

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
