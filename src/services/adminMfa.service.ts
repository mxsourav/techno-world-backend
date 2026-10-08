import crypto from 'crypto';
import { emailService } from './email.service.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/database.js';

interface MfaChallenge {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

// In-memory store for active MFA challenges: userId -> Challenge
const mfaStore = new Map<string, MfaChallenge>();

// Verified elevated session timestamps: userId -> expiry timestamp
const verifiedSessions = new Map<string, number>();

export class AdminMfaService {
  private static readonly CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly SESSION_ELEVATION_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Generates a cryptographically secure 6-digit numeric OTP
   */
  public static generateOtp(): string {
    const num = crypto.randomInt(100000, 999999);
    return num.toString();
  }

  /**
   * Hashes the code with SHA-256 for secure in-memory storage
   */
  private static hashCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim()).digest('hex');
  }

  /**
   * Initiates MFA challenge: generates OTP, saves hash, and sends email to Admin
   */
  public static async requestMfaOtp(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return { success: false, message: 'Only administrative accounts can request MFA challenges.' };
    }

    const otp = this.generateOtp();
    const codeHash = this.hashCode(otp);

    mfaStore.set(userId, {
      codeHash,
      expiresAt: Date.now() + this.CODE_EXPIRY_MS,
      attempts: 0,
    });

    const emailSubject = `[SECURITY] Your Techno World Admin Verification Code: ${otp}`;
    const emailMessage = `Hello ${user.name},\n\nA login or sensitive administrative action requires two-factor verification.\n\nYour 6-digit verification code is:\n\n${otp}\n\nThis code will expire in 5 minutes. If you did not request this, please verify your server credentials immediately.`;

    try {
      await emailService.sendSupportEmail({
        recipientEmail: user.email,
        recipientName: user.name,
        subject: emailSubject,
        message: emailMessage,
      });
      logger.info(`[AdminMFA] OTP challenge dispatched to ${user.email} for admin ${userId}`);
      return { success: true, message: `Verification code sent to ${user.email}` };
    } catch (err: any) {
      logger.error(`[AdminMFA] Failed to send MFA email: ${err.message}`);
      return { success: false, message: 'Failed to dispatch verification email.' };
    }
  }

  /**
   * Validates submitted OTP using timing-safe comparison
   */
  public static verifyMfaOtp(userId: string, code: string): { success: boolean; message: string } {
    const challenge = mfaStore.get(userId);
    if (!challenge) {
      return { success: false, message: 'No active verification challenge found. Please request a new code.' };
    }

    if (Date.now() > challenge.expiresAt) {
      mfaStore.delete(userId);
      return { success: false, message: 'Verification code has expired. Please request a new code.' };
    }

    if (challenge.attempts >= this.MAX_ATTEMPTS) {
      mfaStore.delete(userId);
      return { success: false, message: 'Maximum attempts exceeded. Please request a new code.' };
    }

    challenge.attempts += 1;
    const providedHash = this.hashCode(code);

    const expectedBuf = Buffer.from(challenge.codeHash, 'hex');
    const providedBuf = Buffer.from(providedHash, 'hex');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { success: false, message: 'Invalid verification code.' };
    }

    // Success: Clear challenge and mark session as elevated
    mfaStore.delete(userId);
    verifiedSessions.set(userId, Date.now() + this.SESSION_ELEVATION_MS);
    logger.info(`[AdminMFA] Admin ${userId} successfully completed MFA verification`);

    return { success: true, message: 'Two-factor verification successful.' };
  }

  /**
   * Checks whether the current admin session is MFA-verified
   */
  public static isSessionVerified(userId: string): boolean {
    const expiry = verifiedSessions.get(userId);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      verifiedSessions.delete(userId);
      return false;
    }
    return true;
  }
}
