import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

const CUSTOMER_ID_PREFIX = 'TWC-';
const BASE_NUMBER = 10000; // First customer will be TWC-10001

/**
 * Generates the next sequential unique Customer ID (e.g. TWC-10001, TWC-10002).
 */
export async function generateNextCustomerId(): Promise<string> {
  try {
    // Find the latest user with a customerId matching TWC-
    const latestUser = await prisma.user.findFirst({
      where: {
        customerId: {
          startsWith: CUSTOMER_ID_PREFIX,
        },
      },
      orderBy: {
        customerId: 'desc',
      },
      select: {
        customerId: true,
      },
    });

    if (latestUser?.customerId) {
      const match = latestUser.customerId.match(/^TWC-(\d+)$/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        return `${CUSTOMER_ID_PREFIX}${nextNum}`;
      }
    }

    // If no existing TWC- ID, count total existing users to offset or start at BASE_NUMBER + 1
    const totalUsers = await prisma.user.count();
    const startNum = BASE_NUMBER + totalUsers + 1;
    return `${CUSTOMER_ID_PREFIX}${startNum}`;
  } catch (err: any) {
    logger.warn('[CUSTOMER_ID] Error generating sequential customerId, falling back to random:', err.message);
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    return `${CUSTOMER_ID_PREFIX}${randomSuffix}`;
  }
}

/**
 * Ensures all existing users in the database have a unique customerId assigned.
 * Called during bootstrap / startup.
 */
export async function ensureCustomerIds(): Promise<void> {
  try {
    const usersWithoutId = await prisma.user.findMany({
      where: {
        OR: [
          { customerId: null },
          { customerId: '' },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (usersWithoutId.length === 0) {
      return;
    }

    logger.info(`[CUSTOMER_ID] Backfilling customerId for ${usersWithoutId.length} users...`);

    // Find the current highest customerId number
    const latestUser = await prisma.user.findFirst({
      where: {
        customerId: {
          startsWith: CUSTOMER_ID_PREFIX,
        },
      },
      orderBy: {
        customerId: 'desc',
      },
      select: {
        customerId: true,
      },
    });

    let currentNum = BASE_NUMBER;
    if (latestUser?.customerId) {
      const match = latestUser.customerId.match(/^TWC-(\d+)$/);
      if (match) {
        currentNum = Math.max(currentNum, parseInt(match[1], 10));
      }
    }

    for (const u of usersWithoutId) {
      currentNum += 1;
      const newId = `${CUSTOMER_ID_PREFIX}${currentNum}`;
      await prisma.user.update({
        where: { id: u.id },
        data: { customerId: newId },
      });
    }

    logger.info(`[CUSTOMER_ID] Successfully backfilled ${usersWithoutId.length} customer IDs (up to ${CUSTOMER_ID_PREFIX}${currentNum}).`);
  } catch (err: any) {
    logger.error('[CUSTOMER_ID] Failed to backfill customer IDs:', err.message);
  }
}
