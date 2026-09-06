import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * Ensures a user receives at least 150 TechnoPoints and ₹50.00 TechnoWallet cash for testing.
 * If user has less than the target amount, the difference is credited automatically
 * and recorded in PointTransaction / WalletTransaction ledgers.
 */
export async function ensureUserTestingBonus(userId: string, tx?: any): Promise<{ technoPoints: number; technoWallet: number }> {
  try {
    const db = tx || prisma;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, technoPoints: true, technoWallet: true }
    });

    if (!user) return { technoPoints: 0, technoWallet: 0 };

    const TARGET_TEST_POINTS = 150;
    const TARGET_TEST_WALLET = 50.0;

    let currentPoints = user.technoPoints ?? 0;
    let currentWallet = user.technoWallet ?? 0;

    const pointsDiff = TARGET_TEST_POINTS - currentPoints;
    const walletDiff = TARGET_TEST_WALLET - currentWallet;

    if (pointsDiff > 0 || walletDiff > 0) {
      const updateData: any = {};
      if (pointsDiff > 0) {
        updateData.technoPoints = { increment: pointsDiff };
      }
      if (walletDiff > 0) {
        updateData.technoWallet = { increment: walletDiff };
      }

      await db.user.update({
        where: { id: userId },
        data: updateData
      });

      if (pointsDiff > 0) {
        const oneYearExpiry = new Date();
        oneYearExpiry.setFullYear(oneYearExpiry.getFullYear() + 1);
        await db.pointTransaction.create({
          data: {
            userId,
            points: pointsDiff,
            type: 'EARNED',
            status: 'CREDITED',
            description: `Testing Bonus: Credited ${pointsDiff} Techno Points (Min. 150 Points Guarantee)`,
            expiresAt: oneYearExpiry,
          }
        });
        currentPoints += pointsDiff;
      }

      if (walletDiff > 0) {
        await db.walletTransaction.create({
          data: {
            userId,
            amount: walletDiff,
            type: 'CREDIT',
            status: 'COMPLETED',
            description: `Testing Bonus: Credited ₹${walletDiff.toFixed(2)} TechnoWallet Cash (Min. ₹50 Guarantee)`,
          }
        });
        currentWallet += walletDiff;
      }

      logger.info(`[TESTING_BONUS] Credited user ${userId}: +${Math.max(0, pointsDiff)} points (total: ${currentPoints}), +₹${Math.max(0, walletDiff).toFixed(2)} wallet (total: ₹${currentWallet.toFixed(2)})`);
    }

    return {
      technoPoints: currentPoints,
      technoWallet: currentWallet
    };
  } catch (err) {
    logger.error(`[TESTING_BONUS_ERROR] Failed ensuring testing bonus for user ${userId}:`, err);
    return { technoPoints: 0, technoWallet: 0 };
  }
}
