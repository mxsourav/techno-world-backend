import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * Ensures a user receives a one-time testing bonus of 150 TechnoPoints and ₹50.00 TechnoWallet cash.
 * Once granted, it is permanently recorded in the ledger and will never re-credit
 * or auto-refill when points/wallet cash are legitimately spent.
 */
export async function ensureUserTestingBonus(userId: string, externalTx?: any): Promise<{ technoPoints: number; technoWallet: number }> {
  try {
    const runInTx = async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, technoPoints: true, technoWallet: true }
      });

      if (!user) return { technoPoints: 0, technoWallet: 0 };

      // Check if user has already received the Testing Bonus
      const existingBonus = await tx.pointTransaction.findFirst({
        where: {
          userId,
          type: 'EARNED',
          description: { contains: 'Testing Bonus' }
        }
      });

      if (existingBonus) {
        // Bonus already granted; return live balances without refilling
        return {
          technoPoints: user.technoPoints ?? 0,
          technoWallet: user.technoWallet ?? 0
        };
      }

      const TARGET_TEST_POINTS = 150;
      const TARGET_TEST_WALLET = 50.0;

      const currentPoints = user.technoPoints ?? 0;
      const currentWallet = user.technoWallet ?? 0;

      const pointsToCredit = Math.max(0, TARGET_TEST_POINTS - currentPoints);
      const walletToCredit = Math.max(0, TARGET_TEST_WALLET - currentWallet);

      // Even if user already had some points/wallet, ensure they reach at least the target
      const finalPointsCredit = pointsToCredit > 0 ? pointsToCredit : 0;
      const finalWalletCredit = walletToCredit > 0 ? walletToCredit : 0;

      if (finalPointsCredit > 0 || finalWalletCredit > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(finalPointsCredit > 0 ? { technoPoints: { increment: finalPointsCredit } } : {}),
            ...(finalWalletCredit > 0 ? { technoWallet: { increment: finalWalletCredit } } : {}),
          }
        });
      }

      const oneYearExpiry = new Date();
      oneYearExpiry.setFullYear(oneYearExpiry.getFullYear() + 1);

      // Record point transaction
      await tx.pointTransaction.create({
        data: {
          userId,
          points: finalPointsCredit > 0 ? finalPointsCredit : TARGET_TEST_POINTS,
          type: 'EARNED',
          status: 'CREDITED',
          description: `Testing Bonus: Credited ${finalPointsCredit > 0 ? finalPointsCredit : TARGET_TEST_POINTS} Techno Points (One-Time Guarantee)`,
          expiresAt: oneYearExpiry,
        }
      });

      // Record wallet transaction
      await tx.walletTransaction.create({
        data: {
          userId,
          amount: finalWalletCredit > 0 ? finalWalletCredit : TARGET_TEST_WALLET,
          type: 'CREDIT',
          status: 'COMPLETED',
          description: `Testing Bonus: Credited ₹${(finalWalletCredit > 0 ? finalWalletCredit : TARGET_TEST_WALLET).toFixed(2)} TechnoWallet Cash (One-Time Guarantee)`,
        }
      });

      const finalPoints = currentPoints + finalPointsCredit;
      const finalWallet = currentWallet + finalWalletCredit;

      logger.info(`[TESTING_BONUS] Granted one-time testing bonus to user ${userId}: +${finalPointsCredit} points (balance: ${finalPoints}), +₹${finalWalletCredit.toFixed(2)} cash (balance: ₹${finalWallet.toFixed(2)})`);

      return {
        technoPoints: finalPoints,
        technoWallet: finalWallet
      };
    };

    if (externalTx) {
      return await runInTx(externalTx);
    } else {
      return await prisma.$transaction(runInTx);
    }
  } catch (err) {
    logger.error(`[TESTING_BONUS_ERROR] Failed ensuring testing bonus for user ${userId}:`, err);
    return { technoPoints: 0, technoWallet: 0 };
  }
}
