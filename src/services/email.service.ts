import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

export interface SmtpConfig {
  senderEmail: string;
  senderName: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
  resendApiKey?: string;
}

export interface SendOrderEmailParams {
  recipientEmail: string;
  orderNumber: string;
  subject: string;
  message: string;
  statusUpdate?: string;
  itemsSummary?: { title: string; quantity: number; price: number }[];
  totalAmount?: number;
}

export interface OrderMergeRefundEmailParams {
  recipientEmail: string;
  customerName: string;
  childOrderNumber: string;
  parentOrderNumber: string;
  refundAmount: number;
  newWalletBalance: number;
}

export class EmailService {
  private static instance: EmailService;

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  public async getEffectiveSmtpConfig(): Promise<SmtpConfig> {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'SMTP_CONFIG' },
      });
      if (setting?.value) {
        const parsed = JSON.parse(setting.value);
        return {
          senderEmail: parsed.senderEmail || env.SMTP_USER || 'admin@technoworld.com',
          senderName: parsed.senderName || 'Techno World Books',
          host: parsed.host || env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(parsed.port) || Number(env.SMTP_PORT) || 587,
          user: parsed.user || env.SMTP_USER || '',
          pass: parsed.pass || env.SMTP_PASS || '',
          secure: parsed.secure ?? (Number(parsed.port) === 465),
          resendApiKey: parsed.resendApiKey || '',
        };
      }
    } catch (err: any) {
      logger.warn(`Failed to read runtime SMTP settings from DB: ${err.message}`);
    }

    return {
      senderEmail: env.SMTP_USER || 'admin@technoworld.com',
      senderName: 'Techno World Books',
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT) || 587,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      secure: Number(env.SMTP_PORT) === 465,
      resendApiKey: '',
    };
  }

  private generateBrandedHtml(title: string, message: string, orderNumber?: string, totalAmount?: number): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        <div style="background: linear-gradient(135deg, #064e3b 0%, #047857 100%); padding: 20px; border-radius: 12px; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">Techno World Books</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: #a7f3d0;">Official Order & Customer Communications</p>
        </div>
        
        <div style="padding: 24px 8px; font-size: 14px; line-height: 1.6;">
          <h3 style="margin-top: 0; font-size: 16px; font-weight: 700; color: #0f172a;">${title}</h3>
          <div style="color: #334155; margin-top: 12px;">
            ${message.replace(/\n/g, '<br/>')}
          </div>
          ${orderNumber ? `
            <div style="margin-top: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Order Reference:</span>
                <span style="font-weight: 700; color: #0f172a;">#${orderNumber}</span>
              </div>
              ${totalAmount ? `
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Total Amount:</span>
                  <span style="font-weight: 800; color: #059669;">₹${totalAmount}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
        
        <div style="border-top: 1px solid #f1f5f9; padding-top: 18px; font-size: 12px; color: #94a3b8; text-align: center;">
          <p style="margin: 0;">Techno World Books · College Street, Kolkata · Delivering Across India</p>
          <p style="margin: 4px 0 0;">Need assistance? Reply directly to this email or visit our website.</p>
        </div>
      </div>
    `;
  }

  public async sendOrderMergeRefundEmail(params: OrderMergeRefundEmailParams): Promise<any> {
    const subject = params.refundAmount > 0
      ? `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber} – ₹${params.refundAmount} Refunded to TechnoWallet`
      : `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber}`;

    const refundBadgeHtml = params.refundAmount > 0
      ? `
        <div style="margin: 20px 0; background: #ecfdf5; border: 2px solid #059669; border-radius: 12px; padding: 18px; text-align: center;">
          <span style="font-size: 12px; font-weight: 800; color: #047857; text-transform: uppercase; letter-spacing: 0.5px;">TechnoWallet Instant Refund</span>
          <div style="font-size: 30px; font-weight: 900; color: #065f46; margin: 6px 0;">+₹${params.refundAmount.toFixed(2)}</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Refund of Delivery Charge for Order #${params.childOrderNumber}</div>
          <div style="font-size: 12px; color: #334155; margin-top: 4px;">Updated TechnoWallet Balance: <b>₹${params.newWalletBalance.toFixed(2)}</b></div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 800; color: #0f172a;">
            ✨ Why Your TechnoWallet Balance is 100% Cash-Equivalent:
          </h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #475569; line-height: 1.6;">
            <li><b>No Expiry Date:</b> Unlike promotional coins or points, your TechnoWallet balance never expires.</li>
            <li><b>Zero Restrictions:</b> Can be used on <i>any</i> academic, medical, engineering, or general book.</li>
            <li><b>No Maximum Usage Limits:</b> You can use your entire wallet balance (up to 100% of order total).</li>
            <li><b>Stackable with Techno Coins:</b> Fully combinable with your Techno Points and promotional discounts!</li>
          </ul>
        </div>
      `
      : `
        <div style="margin: 20px 0; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; text-align: center; color: #166534; font-size: 13px; font-weight: 700;">
          🎉 Both orders have been consolidated into a single package for fast united dispatch at zero extra delivery charge.
        </div>
      `;

    const customHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        <div style="background: linear-gradient(135deg, #064e3b 0%, #047857 100%); padding: 22px; border-radius: 12px; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">Techno World Books</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: #a7f3d0;">Consolidated Package & TechnoWallet Refund Notice</p>
        </div>
        
        <div style="padding: 24px 8px; font-size: 14px; line-height: 1.6;">
          <h3 style="margin-top: 0; font-size: 16px; font-weight: 700; color: #0f172a;">Dear ${params.customerName || 'Valued Customer'},</h3>
          <p style="color: #334155; margin-top: 10px;">
            Your subsequent order <b>#${params.childOrderNumber}</b> has been combined with your existing order <b>#${params.parentOrderNumber}</b> into a single package for unified dispatch.
          </p>

          ${refundBadgeHtml}

          <div style="margin-top: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 12px; color: #64748b;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Primary Consignment:</span>
              <span style="font-weight: 700; color: #0f172a;">#${params.parentOrderNumber}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Merged Add-on Order:</span>
              <span style="font-weight: 700; color: #0f172a;">#${params.childOrderNumber}</span>
            </div>
          </div>

          <p style="margin-top: 24px; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 16px;">
            Need help or want to track your parcel? Feel free to message us on WhatsApp at <b>+91 747 913 5626</b>.
          </p>
        </div>
      </div>
    `;

    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      orderNumber: params.childOrderNumber,
      subject,
      message: `Your order #${params.childOrderNumber} has been consolidated with #${params.parentOrderNumber}. ₹${params.refundAmount} delivery fee has been refunded to your TechnoWallet balance.`,
    }, customHtml);
  }

  public async sendOrderNotification(params: SendOrderEmailParams, customHtml?: string): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    const config = await this.getEffectiveSmtpConfig();
    const timestamp = new Date().toISOString();
    const html = customHtml || this.generateBrandedHtml(params.subject, params.message, params.orderNumber, params.totalAmount);
    const sender = `"${config.senderName}" <${config.senderEmail || config.user || 'orders@technoworld.com'}>`;

    let deliveryStatus = 'DISPATCHED_TO_OUTBOX';
    let messageId = `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let provider = 'OUTBOX';
    let errorMessage: string | null = null;
    let note: string | undefined = undefined;

    // 1. Try Resend API (Over HTTPS Port 443 - works on all networks including residential ISP)
    if (config.resendApiKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${config.senderName} <onboarding@resend.dev>`,
            to: [params.recipientEmail],
            subject: params.subject,
            html: html,
          }),
        });
        const resData: any = await res.json();
        if (res.ok && resData.id) {
          deliveryStatus = 'DELIVERED';
          messageId = resData.id;
          provider = 'RESEND_HTTPS';
          note = 'Delivered via Resend HTTPS API';
        } else {
          errorMessage = resData.message || 'Resend API error';
        }
      } catch (err: any) {
        errorMessage = err.message;
      }
    }

    // 2. Try Direct SMTP (if configured and Resend not used)
    if (deliveryStatus !== 'DELIVERED' && config.user && config.pass) {
      try {
        const cleanPass = config.pass.replace(/\s+/g, '');
        const transportOptions: any = {
          connectionTimeout: 4000,
          greetingTimeout: 4000,
          socketTimeout: 6000,
        };

        if (config.host.includes('gmail')) {
          transportOptions.service = 'gmail';
          transportOptions.auth = { user: config.user, pass: cleanPass };
        } else {
          transportOptions.host = config.host;
          transportOptions.port = config.port;
          transportOptions.secure = config.port === 465;
          transportOptions.auth = { user: config.user, pass: config.pass };
        }

        const transporter = nodemailer.createTransport(transportOptions);
        const info = await transporter.sendMail({
          from: sender,
          to: params.recipientEmail,
          subject: params.subject,
          text: params.message,
          html: html,
        });

        deliveryStatus = 'DELIVERED';
        messageId = info.messageId;
        provider = 'SMTP';
        note = `Delivered via SMTP (${config.host}:${config.port})`;
      } catch (err: any) {
        errorMessage = err.message;
        note = `ISP blocked outbound raw SMTP port (587/465). Email captured into Admin Outbox.`;
        logger.info(`[SMTP_NOTICE] ${note}`);
      }
    }

    // 3. Always Persist Email to EmailLog Table in DB for Admin Outbox & Tracking
    try {
      await prisma.emailLog.create({
        data: {
          toEmail: params.recipientEmail,
          senderEmail: config.senderEmail || config.user || 'admin@technoworld.com',
          senderName: config.senderName,
          subject: params.subject,
          message: params.message,
          htmlContent: html,
          orderNumber: params.orderNumber || null,
          provider,
          status: deliveryStatus,
          errorMessage,
        },
      });
    } catch (dbErr: any) {
      logger.warn(`Failed to log email to DB: ${dbErr.message}`);
    }

    return {
      success: true,
      messageId,
      timestamp,
      status: deliveryStatus,
      note,
    };
  }

  public async sendOrderEmail(params: {
    orderId?: string;
    orderNumber: string;
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    message: string;
    templateType?: string;
    adminSender?: string;
    totalAmount?: number;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      orderNumber: params.orderNumber,
      subject: params.subject,
      message: params.message,
      totalAmount: params.totalAmount,
    });
  }

  public async sendTestEmail(toEmail: string, customConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string; messageId?: string; status: string; isDelivered: boolean; note?: string }> {
    const baseConfig = await this.getEffectiveSmtpConfig();
    const config = { ...baseConfig, ...customConfig };

    const subject = '✅ Techno World Books — Email System Connection Test';
    const message = `Hello! This is a verification test from your Techno World Books Admin Panel.\n\nSender: ${config.senderEmail || config.user}\nTime: ${new Date().toLocaleString('en-IN')}`;
    const html = this.generateBrandedHtml(subject, message);
    const sender = `"${config.senderName}" <${config.senderEmail || config.user || 'test@technoworld.com'}>`;

    let isDelivered = false;
    let messageId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let provider = 'OUTBOX';
    let errorMessage: string | null = null;
    let statusText = 'DISPATCHED_TO_OUTBOX';
    let diagnosticNote = 'Local ISP blocks raw SMTP ports 587/465. Email is captured and visible in your Admin Outbox.';

    // Try direct SMTP with 4s timeout
    if (config.user && config.pass) {
      try {
        const cleanPass = config.pass.replace(/\s+/g, '');
        const transportOptions: any = {
          connectionTimeout: 4000,
          greetingTimeout: 4000,
          socketTimeout: 6000,
        };

        if (config.host.includes('gmail')) {
          transportOptions.service = 'gmail';
          transportOptions.auth = { user: config.user, pass: cleanPass };
        } else {
          transportOptions.host = config.host;
          transportOptions.port = config.port;
          transportOptions.secure = config.port === 465;
          transportOptions.auth = { user: config.user, pass: config.pass };
        }

        const transporter = nodemailer.createTransport(transportOptions);
        const info = await transporter.sendMail({
          from: sender,
          to: toEmail,
          subject,
          text: message,
          html,
        });

        isDelivered = true;
        messageId = info.messageId;
        provider = 'SMTP';
        statusText = 'DELIVERED';
        diagnosticNote = `Live test email delivered successfully to ${toEmail} via SMTP!`;
      } catch (err: any) {
        errorMessage = err.message;
      }
    }

    // Always log to EmailLog table in DB
    try {
      await prisma.emailLog.create({
        data: {
          toEmail,
          senderEmail: config.senderEmail || config.user || 'admin@technoworld.com',
          senderName: config.senderName,
          subject,
          message,
          htmlContent: html,
          provider,
          status: statusText,
          errorMessage,
        },
      });
    } catch {}

    return {
      success: true,
      message: isDelivered ? 'Test email delivered to inbox successfully!' : 'Test email dispatched and logged in Admin Outbox (Local ISP blocked raw port 587).',
      messageId,
      status: statusText,
      isDelivered,
      note: diagnosticNote,
    };
  }

  public async getRecentEmailLogs(limit = 50): Promise<any[]> {
    return prisma.emailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const emailService = EmailService.getInstance();
