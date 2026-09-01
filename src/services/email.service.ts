import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export interface SendOrderEmailParams {
  orderId: string;
  orderNumber: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  templateType?: 'DELAY_NOTICE' | 'REJECT_NOTICE' | 'ACCEPT_NOTICE' | 'CUSTOM';
  adminSender?: string;
}

export class EmailService {
  private static instance: EmailService;

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  public async sendOrderEmail(params: SendOrderEmailParams): Promise<{ success: boolean; messageId: string; timestamp: string }> {
    const sender = params.adminSender || 'admin@technoworld.com';
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();

    logger.info(`[EMAIL_DISPATCH] From: ${sender} | To: ${params.recipientEmail} (${params.recipientName}) | Order: #${params.orderNumber} | Subject: "${params.subject}"`);
    logger.info(`[EMAIL_BODY_PREVIEW]\n${params.message}`);

    return {
      success: true,
      messageId,
      timestamp,
    };
  }
}

export const emailService = EmailService.getInstance();
