import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedLogoBase64: string | null = null;
function getWhiteLogoBase64(): string {
  if (cachedLogoBase64) return cachedLogoBase64;
  try {
    const candidatePaths = [
      path.resolve(__dirname, '../assets/icon.png'),
      path.resolve(__dirname, '../../src/assets/icon.png'),
      path.resolve(process.cwd(), 'src/assets/icon.png'),
      path.resolve(process.cwd(), 'dist/assets/icon.png'),
      path.resolve(process.cwd(), 'app/public/icon.png'),
      path.resolve(process.cwd(), '../app/public/icon.png'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedLogoBase64 = fs.readFileSync(p).toString('base64');
        return cachedLogoBase64;
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to read white logo file: ${err.message}`);
  }
  return '';
}

export interface SmtpConfig {
  senderEmail: string;
  senderName: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
  resendApiKey?: string;
  logoUrl?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendOrderEmailParams {
  recipientEmail: string;
  recipientName?: string;
  orderNumber: string;
  subject: string;
  message: string;
  statusUpdate?: string;
  itemsSummary?: { title: string; quantity: number; price: number; sku?: string }[];
  totalAmount?: number;
  trackingNumber?: string | null;
  shippingMethod?: string | null;
  attachments?: EmailAttachment[];
  replyTo?: string;
  canReply?: boolean;
}

export interface OrderMergeRefundEmailParams {
  recipientEmail: string;
  customerName: string;
  childOrderNumber: string;
  parentOrderNumber: string;
  refundAmount: number;
  newWalletBalance: number;
  attachments?: EmailAttachment[];
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
          senderEmail: parsed.senderEmail || parsed.user || env.SMTP_USER || 'orders@technoworldbooks.in',
          senderName: parsed.senderName || 'Techno World Books',
          host: parsed.host || env.SMTP_HOST || 'smtp.hostinger.com',
          port: Number(parsed.port) || Number(env.SMTP_PORT) || 465,
          user: parsed.user || env.SMTP_USER || 'orders@technoworldbooks.in',
          pass: parsed.pass || env.SMTP_PASS || 'Aksad@301206',
          secure: parsed.secure ?? (Number(parsed.port) === 465 || true),
          resendApiKey: parsed.resendApiKey || '',
          logoUrl: parsed.logoUrl || '',
        };
      }
    } catch (err: any) {
      logger.warn(`Failed to read runtime SMTP settings from DB: ${err.message}`);
    }

    return {
      senderEmail: env.SMTP_USER || 'orders@technoworldbooks.in',
      senderName: 'Techno World Books',
      host: env.SMTP_HOST || 'smtp.hostinger.com',
      port: Number(env.SMTP_PORT) || 465,
      user: env.SMTP_USER || 'orders@technoworldbooks.in',
      pass: env.SMTP_PASS || 'Aksad@301206',
      secure: Number(env.SMTP_PORT) === 465 || true,
      resendApiKey: '',
      logoUrl: '',
    };
  }

  public wrapInDocument(
    title: string,
    contentHtml: string,
    subtitle = 'Official Order Communication',
    logoUrl?: string,
    canReply = true,
    replyEmail = 'orders@technoworldbooks.in'
  ): string {
    return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Dark mode overrides for clients that support it */
    @media (prefers-color-scheme: dark) {
      body, table, td { background-color: #121212 !important; color: #E4E4E7 !important; }
      .email-bg { background-color: #121212 !important; }
      .card { background-color: #1E1E1E !important; border-color: #333333 !important; }
      .text-muted { color: #A1A1AA !important; }
      .text-primary { color: #F4F4F5 !important; }
      .footer-note { background-color: #000000 !important; color: #FFFFFF !important; }
      .sub-badge { background-color: #27272A !important; border-color: #3F3F46 !important; color: #E4E4E7 !important; }
      .item-row { border-color: #27272A !important; }
      .order-table-head { background-color: #262626 !important; border-color: #333333 !important; color: #A1A1AA !important; }
      .order-table-totals { background-color: #1E1E1E !important; border-color: #333333 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F9F8F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color: #F9F8F6; padding: 32px 12px; margin: 0;">
    <tr>
      <td align="center" style="padding: 0;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto;">
          ${this.generateBrandedHeader(subtitle, logoUrl)}
          <tr>
            <td style="padding: 0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; border-collapse: separate; overflow: hidden;">
                <tr>
                  <td style="padding: 28px 24px; text-align: left;">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${this.generateBrandedFooter(canReply, replyEmail)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  public renderStatusPill(statusText: string, bg = '#E0EEFF', color = '#104E9F'): string {
    return `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 18px 0;">
        <tr>
          <td style="background-color: ${bg}; color: ${color}; padding: 4px 14px; border-radius: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 600; line-height: 1.4; text-align: left;">
            ${statusText}
          </td>
        </tr>
      </table>
    `;
  }

  public generateBrandedHeader(subtitle = 'Official Order Communication', logoUrl?: string): string {
    const effectiveLogoUrl = logoUrl || 'https://res.cloudinary.com/tcsmyxe2/image/upload/v1789254075/techno_world_white_logo.png';
    return `
      <tr>
        <td align="center" style="padding: 0 0 20px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
            <tr>
              <td align="center" valign="middle" style="width: 56px; height: 56px; background-color: #14432B; border-radius: 50%; text-align: center; vertical-align: middle; padding: 0;">
                <img src="${effectiveLogoUrl}" alt="Techno World Books" width="44" height="44" style="display: block; width: 44px; height: 44px; margin: 0 auto; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" />
              </td>
            </tr>
          </table>
          <div style="height: 12px; line-height: 12px; font-size: 12px;">&nbsp;</div>
          <div class="text-primary" style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #262524; letter-spacing: 1px; text-transform: uppercase; text-align: center;">
            TECHNO WORLD BOOKS
          </div>
          <div style="height: 8px; line-height: 8px; font-size: 8px;">&nbsp;</div>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
            <tr>
              <td class="sub-badge" style="background-color: #F2F0E9; border: 1px solid #EAE8E2; border-radius: 12px; padding: 4px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 600; color: #6E6D68; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">
                ${subtitle}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }

  public generateBrandedFooter(canReply = true, replyEmail = 'orders@technoworldbooks.in'): string {
    const feedbackBox = canReply ? `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto; max-width: 500px; width: 100%;">
        <tr>
          <td class="footer-note" style="background-color: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; border-radius: 8px; padding: 12px 18px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; line-height: 1.5;">
            <div style="font-weight: 700; letter-spacing: 0.3px; margin-bottom: 3px; color: #14532D;">
              ✉ Need Help or Have Questions?
            </div>
            <div style="color: #166534; font-size: 11px;">
              You can <b>reply directly to this email</b> to reach our desk at <a href="mailto:${replyEmail}" style="color: #15803D; font-weight: 600; text-decoration: underline;">${replyEmail}</a>, or message on WhatsApp: <a href="https://wa.me/917479135626" style="color: #15803D; font-weight: 600; text-decoration: underline;">+91 747 913 5626</a>.
            </div>
          </td>
        </tr>
      </table>
    ` : `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto; max-width: 500px; width: 100%;">
        <tr>
          <td class="footer-note" style="background-color: #18181B; color: #FFFFFF; border-radius: 8px; padding: 12px 18px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; line-height: 1.5;">
            <div style="font-weight: 700; letter-spacing: 0.3px; margin-bottom: 3px; color: #FFFFFF;">
              Automated Notification
            </div>
            <div style="color: #D4D4D8; font-size: 10.5px;">
              For customer support or order assistance, write directly to <a href="mailto:support@technoworldbooks.in" style="color: #86EFAC; text-decoration: none; font-weight: 600;">support@technoworldbooks.in</a>.
            </div>
          </td>
        </tr>
      </table>
    `;

    return `
      <tr>
        <td align="center" style="padding: 24px 10px 8px 10px;">
          <p class="text-muted" style="margin: 0 0 6px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 13px; font-weight: 600; color: #262524;">
            Techno World Books &bull; College Street, Kolkata &bull; Delivering Across India
          </p>
          <p class="text-muted" style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #6E6D68; line-height: 1.6;">
            Office: 90/6A, Mahatma Gandhi Rd, College Street, Kolkata, WB 700007<br/>
            Direct Phone: <a href="tel:+917479135626" style="color: #14432B; text-decoration: none; font-weight: 600;">+91 747 913 5626</a> &bull; 
            WhatsApp: <a href="https://wa.me/917479135626" style="color: #14432B; text-decoration: none; font-weight: 600;">Chat on WhatsApp</a> &bull; 
            Official Store: <a href="https://technoworldbooks.in" style="color: #14432B; text-decoration: none; font-weight: 600;">technoworldbooks.in</a>
          </p>

          ${feedbackBox}

          <p class="text-muted" style="margin: 14px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 10.5px; color: #A1A1AA;">
            You received this email regarding your order or inquiry on <a href="https://technoworldbooks.in" style="color: #6E6D68; text-decoration: underline;">technoworldbooks.in</a>.
          </p>
        </td>
      </tr>
    `;
  }

  public generateBrandedHtml(
    title: string,
    message: string,
    orderNumber?: string,
    totalAmount?: number,
    logoUrl?: string,
    canReply = true,
    replyEmail = 'orders@technoworldbooks.in'
  ): string {
    const isTestEmail = title.includes('Test') || message.includes('verification test');
    const statusPill = isTestEmail
      ? this.renderStatusPill('Status: System Verified & Active', '#DEF7EC', '#03543F')
      : '';

    const orderBox = orderNumber ? `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; margin: 20px 0; overflow: hidden;">
        <tr>
          <td style="padding: 14px 18px; background-color: #FAF9F5; border-bottom: 1px solid #EAE8E2;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td class="text-muted" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
                  Order Reference:
                </td>
                <td align="right" class="text-primary" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 700; color: #262524;">
                  #${orderNumber}
                </td>
              </tr>
              ${totalAmount !== undefined ? `
                <tr>
                  <td class="text-muted" style="padding-top: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
                    Total Amount:
                  </td>
                  <td align="right" style="padding-top: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 800; color: #14432B;">
                    ₹${Number(totalAmount).toFixed(2)}
                  </td>
                </tr>
              ` : ''}
            </table>
          </td>
        </tr>
      </table>
    ` : '';

    const content = `
      <h1 class="text-primary" style="margin: 0 0 14px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #262524; line-height: 1.35;">
        ${title}
      </h1>
      ${statusPill}
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.55; color: #262524; text-align: left;">
        ${message.replace(/\n/g, '<br/>')}
      </div>
      ${orderBox}
    `;

    return this.wrapInDocument(title, content, orderNumber ? `Order #${orderNumber}` : 'Official Order Communication', logoUrl, canReply, replyEmail);
  }

  public generateLifecycleEmailHtml(params: {
    status: 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'PENDING';
    orderNumber: string;
    customerName: string;
    items: Array<{ title: string; quantity: number; price: number; sku?: string }>;
    totalAmount: number;
    subtotal?: number;
    shippingCharge?: number;
    discountAmount?: number;
    trackingNumber?: string | null;
    shippingCarrier?: string | null;
    shippingMethod?: string | null;
    cancelReason?: string | null;
    deliveryAddress?: string | null;
    paymentMethod?: string | null;
    hasInvoiceAttachment?: boolean;
  }): { subject: string; html: string; text: string } {
    const {
      status,
      orderNumber,
      customerName,
      items = [],
      totalAmount,
      subtotal = totalAmount,
      shippingCharge = 0,
      discountAmount = 0,
      trackingNumber,
      shippingMethod,
      cancelReason,
      deliveryAddress,
      paymentMethod,
      hasInvoiceAttachment = false,
    } = params;

    const safeName = customerName && customerName !== 'Customer' ? customerName : 'Valued Reader';

    const itemsHtml = items.length > 0
      ? `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; margin: 22px 0; border-collapse: separate; overflow: hidden;">
          <tr>
            <td colspan="3" class="order-table-head" style="background-color: #FAF9F5; padding: 10px 16px; border-bottom: 1px solid #EAE8E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; color: #6E6D68; text-transform: uppercase; letter-spacing: 0.5px;">
              Order Items &bull; #${orderNumber}
            </td>
          </tr>
          ${items.map((it, idx) => `
            <tr class="item-row">
              <td width="58" valign="top" style="padding: 14px 10px 14px 16px; border-bottom: ${idx === items.length - 1 ? '1px solid #EAE8E2' : '1px solid #F2F0E9'};">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="46" style="background-color: #F2F0E9; border-radius: 4px; border: 1px solid #EAE8E2; text-align: center;">
                  <tr>
                    <td height="54" align="center" valign="middle" style="font-family: 'Georgia', serif; font-size: 20px; color: #14432B; line-height: 54px;">
                      📖
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="top" style="padding: 14px 12px; border-bottom: ${idx === items.length - 1 ? '1px solid #EAE8E2' : '1px solid #F2F0E9'};">
                <div class="text-primary" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 700; color: #262524; line-height: 1.4;">
                  ${it.title}
                </div>
                ${it.sku ? `
                  <div class="text-muted" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #6E6D68; margin-top: 3px;">
                    SKU: ${it.sku}
                  </div>
                ` : ''}
              </td>
              <td valign="top" align="right" style="padding: 14px 16px 14px 12px; border-bottom: ${idx === items.length - 1 ? '1px solid #EAE8E2' : '1px solid #F2F0E9'}; white-space: nowrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #262524;">
                ${it.quantity} &times; ₹${it.price.toFixed(2)}
              </td>
            </tr>
          `).join('')}
          
          <tr>
            <td colspan="3" class="order-table-totals" style="padding: 16px; background-color: #FAF9F5;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td class="text-muted" style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
                    Subtotal:
                  </td>
                  <td align="right" class="text-muted" style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
                    ₹${subtotal.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td class="text-muted" style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
                    Delivery:
                  </td>
                  <td align="right" style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: ${shippingCharge > 0 ? '#6E6D68' : '#14432B'}; font-weight: ${shippingCharge > 0 ? 'normal' : '600'};">
                    ${shippingCharge > 0 ? `₹${shippingCharge.toFixed(2)}` : 'FREE'}
                  </td>
                </tr>
                ${discountAmount > 0 ? `
                  <tr>
                    <td style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #14432B; font-weight: 600;">
                      Discounts & Rewards:
                    </td>
                    <td align="right" style="padding: 3px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #14432B; font-weight: 600;">
                      -₹${discountAmount.toFixed(2)}
                    </td>
                  </tr>
                ` : ''}
                <tr>
                  <td style="padding-top: 8px; border-top: 1px solid #EAE8E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 800; color: #262524;">
                    Total Paid / Payable:
                  </td>
                  <td align="right" style="padding-top: 8px; border-top: 1px solid #EAE8E2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 800; color: #14432B;">
                    ₹${totalAmount.toFixed(2)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `
      : '';

    let subject = '';
    let headline = '';
    let messageBody = '';
    let actionBadge = '';
    let plainTextMessage = '';

    switch (status) {
      case 'CONFIRMED':
        subject = `Order Confirmed: #${orderNumber} — Techno World Books`;
        headline = `Thank you for your order, ${safeName}!`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            We have received your order <b>#${orderNumber}</b> and it is confirmed. Our team at College Street has initiated procurement and stock verification.
          </p>
          ${paymentMethod ? `<p class="text-muted" style="margin: 0 0 8px; font-size: 12.5px; color: #6E6D68;">Payment Method: <b style="color: #262524;">${paymentMethod}</b></p>` : ''}
          ${deliveryAddress ? `<p class="text-muted" style="margin: 0 0 8px; font-size: 12.5px; color: #6E6D68;">Shipping to: <b style="color: #262524;">${deliveryAddress}</b></p>` : ''}
          <p style="margin: 12px 0 0; color: #262524; line-height: 1.6;">
            You will receive another update as soon as your package moves to our packing and dispatch counter.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: Order Confirmed &bull; Preparing for Packing', '#E6F4EA', '#137333');
        plainTextMessage = `Hello ${safeName},\n\nYour order #${orderNumber} has been received and confirmed. Total: ₹${totalAmount.toFixed(2)}.\nOur College Street team is preparing your books.`;
        break;

      case 'PROCESSING':
        subject = `Packing in Progress: Order #${orderNumber} — Techno World Books`;
        headline = `We are packing your books, ${safeName}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Your order <b>#${orderNumber}</b> is currently being packed at our College Street dispatch desk.
          </p>
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Each book is inspected for physical condition and carefully wrapped to protect corners and binding during transit.
          </p>
          <p style="margin: 0; color: #262524; line-height: 1.6;">
            Once handed over for delivery, we will send your consignment tracking number.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: Packing & Inspection', '#E0EEFF', '#104E9F');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} is now being packed at our dispatch counter.`;
        break;

      case 'SHIPPED':
        subject = `Dispatched: Order #${orderNumber} is on its way! — Techno World Books`;
        headline = `Your books are on the way, ${safeName}!`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Great news! Order <b>#${orderNumber}</b> has been handed over for delivery.
          </p>
          ${trackingNumber ? `
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; margin: 18px 0; overflow: hidden;">
              <tr>
                <td style="padding: 16px 18px; background-color: #FAF9F5; border-bottom: 1px solid #EAE8E2;">
                  <span style="font-size: 11px; font-weight: 700; color: #14432B; text-transform: uppercase; letter-spacing: 0.5px;">Consignment Details</span>
                  <p class="text-primary" style="margin: 6px 0 0; font-size: 16px; font-weight: 700; color: #262524; font-family: monospace;">
                    Tracking No: ${trackingNumber}
                  </p>
                  <p class="text-muted" style="margin: 4px 0 0; font-size: 12px; color: #6E6D68;">
                    Carrier: <b>India Post / Postal Network</b> &bull; Service: <b>${shippingMethod || 'Standard Post'}</b>
                  </p>
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
                    <tr>
                      <td align="center" style="background-color: #14432B; border-radius: 6px;">
                        <a href="https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx" target="_blank" style="display: inline-block; padding: 8px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 700; color: #FFFFFF; text-decoration: none;">
                          Track on India Post Portal &rarr;
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          ` : `
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FAF9F5; border: 1px solid #EAE8E2; border-radius: 8px; margin: 14px 0;">
              <tr>
                <td class="text-muted" style="padding: 12px 14px; font-size: 12.5px; color: #6E6D68;">
                  Dispatched via postal service. Tracking details will update once scanned by the transit hub.
                </td>
              </tr>
            </table>
          `}
          ${hasInvoiceAttachment ? `
            <p class="text-muted" style="margin: 12px 0 0; font-size: 12px; color: #6E6D68;">
              &bull; <i>Official Tax Invoice (PDF) is attached to this email for your records.</i>
            </p>
          ` : ''}
        `;
        actionBadge = this.renderStatusPill('Status: Dispatched &bull; In Transit', '#F3E8FF', '#6B21A8');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been dispatched.${trackingNumber ? ` Tracking Number: ${trackingNumber}` : ''}`;
        break;

      case 'DELIVERED':
        subject = `Delivered: Order #${orderNumber} — Enjoy your reading!`;
        headline = `Package Delivered, ${safeName}!`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Our records indicate that your package for order <b>#${orderNumber}</b> has been delivered. We hope the books reached you in excellent condition!
          </p>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FAF9F5; border: 1px solid #EAE8E2; border-radius: 8px; margin: 18px 0; overflow: hidden; text-align: center;">
            <tr>
              <td style="padding: 18px; text-align: center;">
                <p style="margin: 0 0 6px; font-family: 'Georgia', 'Times New Roman', serif; font-size: 15px; font-weight: 700; color: #14432B;">
                  &starf;&starf;&starf;&starf;&starf; How was your book delivery experience?
                </p>
                <p class="text-muted" style="margin: 0 0 14px; font-size: 12px; color: #6E6D68; line-height: 1.5;">
                  As an independent academic bookstore, your honest review helps fellow students and readers discover genuine editions.
                </p>
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                  <tr>
                    <td align="center" style="background-color: #14432B; border-radius: 6px;">
                      <a href="https://maps.google.com/?q=Techno+World+Books+College+Street+Kolkata" target="_blank" style="display: inline-block; padding: 8px 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 700; color: #FFFFFF; text-decoration: none;">
                        Leave a Google Review &rarr;
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; margin: 16px 0;">
            <tr>
              <td style="padding: 14px 16px;">
                <h4 class="text-primary" style="margin: 0 0 6px; font-family: 'Georgia', serif; font-size: 13px; font-weight: 700; color: #262524;">Any concern with your parcel?</h4>
                <p class="text-muted" style="margin: 0; font-size: 12px; color: #6E6D68; line-height: 1.5;">
                  If any title arrived damaged, missing, or requires assistance, please message our support desk immediately via WhatsApp at <b>+91 747 913 5626</b> with your order reference. We are committed to making it right.
                </p>
              </td>
            </tr>
          </table>

          ${hasInvoiceAttachment ? `
            <p class="text-muted" style="margin: 12px 0 0; font-size: 12px; color: #6E6D68;">
              &bull; <i>Final Tax Invoice (PDF) is attached to this email.</i>
            </p>
          ` : ''}
        `;
        actionBadge = this.renderStatusPill('Status: Successfully Delivered', '#DEF7EC', '#03543F');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been delivered. If you have any questions or concerns, reach our desk on WhatsApp: +91 747 913 5626.`;
        break;

      case 'CANCELLED':
        subject = `Order Cancellation Notice: #${orderNumber} — Techno World Books`;
        headline = `Notice regarding Order #${orderNumber}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Dear ${safeName}, we are writing to inform you that order <b>#${orderNumber}</b> has been cancelled.
          </p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; margin: 14px 0;">
            <tr>
              <td style="padding: 12px 14px; font-size: 12.5px; color: #991B1B;">
                <b>Reason:</b> ${cancelReason || 'Fulfillment unavailable from publisher stock at this time.'}
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            <b>Refund Policy:</b> If any online payment was deducted, a 100% full refund has been initiated to your original payment method. Depending on your bank or UPI provider, the credited amount reflects in 3–5 business days. Any Techno Points or TechnoWallet balance used has been restored to your account.
          </p>
          <p style="margin: 0; color: #262524; line-height: 1.6;">
            If you have any questions or feel this was in error, please contact our team directly on WhatsApp: <b>+91 747 913 5626</b>.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: Cancelled &bull; Refund Initiated', '#FDE8E8', '#9B1C1C');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} was cancelled. Reason: ${cancelReason || 'Fulfillment unavailable'}. Any deducted payment will be refunded in 3-5 business days.`;
        break;

      default:
        subject = `Order Received: #${orderNumber} (Pending Review) — Techno World Books`;
        headline = `We have received your order, ${safeName}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Thank you for shopping with Techno World Books! Your order <b>#${orderNumber}</b> has been received and placed in our verification queue.
          </p>
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Our store managers review edition availability and dispatch schedules before confirming. You will receive an email confirmation as soon as your order is approved.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: Awaiting Store Confirmation', '#FEF3C7', '#92400E');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been received and is pending store confirmation.`;
        break;
    }

    const contentHtml = `
      <h1 class="text-primary" style="margin: 0 0 14px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #262524; line-height: 1.35;">
        ${headline}
      </h1>
      
      ${actionBadge}
      
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #262524; text-align: left;">
        ${messageBody}
      </div>
      
      ${itemsHtml}
    `;

    const html = this.wrapInDocument(subject, contentHtml, `Order #${orderNumber}`);

    return { subject, html, text: plainTextMessage };
  }

  public async sendOrderMergeRefundEmail(params: OrderMergeRefundEmailParams): Promise<any> {
    const subject = params.refundAmount > 0
      ? `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber} – ₹${params.refundAmount.toFixed(2)} Refunded to TechnoWallet`
      : `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber}`;

    const refundBadgeHtml = params.refundAmount > 0
      ? `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F2F9F5; border: 1px solid #B8E0CB; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td align="center" style="padding: 18px 14px; text-align: center;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; color: #14432B; text-transform: uppercase; letter-spacing: 0.5px;">TechnoWallet Instant Refund</div>
              <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 28px; font-weight: 700; color: #14432B; margin: 6px 0;">+₹${params.refundAmount.toFixed(2)}</div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #262524;">Refund of Delivery Charge for Order #${params.childOrderNumber}</div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68; margin-top: 4px;">Updated TechnoWallet Balance: <strong style="color: #262524;">₹${params.newWalletBalance.toFixed(2)}</strong></div>
            </td>
          </tr>
        </table>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F9F8F6; border: 1px solid #EAE8E2; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td style="padding: 14px 16px;">
              <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 13px; font-weight: 700; color: #262524; margin-bottom: 6px;">Why Your TechnoWallet Balance is 100% Cash-Equivalent:</div>
              <ul style="margin: 0; padding-left: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68; line-height: 1.6;">
                <li><strong style="color: #262524;">No Expiry Date:</strong> Unlike promotional coins, your TechnoWallet balance never expires.</li>
                <li><strong style="color: #262524;">Zero Restrictions:</strong> Usable on any academic, medical, engineering, or competitive book.</li>
                <li><strong style="color: #262524;">100% Usable:</strong> You can use your entire balance toward any future purchase.</li>
              </ul>
            </td>
          </tr>
        </table>
      `
      : `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F2F9F5; border: 1px solid #B8E0CB; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td align="center" style="padding: 14px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #14432B; text-align: center;">
              Both orders have been combined into a single parcel for united dispatch at zero extra delivery charge.
            </td>
          </tr>
        </table>
      `;

    const contentHtml = `
      <h2 class="text-primary" style="margin: 0 0 12px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #262524;">
        Dear ${params.customerName || 'Valued Customer'},
      </h2>
      <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #44423E; margin: 0 0 16px 0;">
        Your subsequent order <strong style="color: #262524;">#${params.childOrderNumber}</strong> has been combined with your existing order <strong style="color: #262524;">#${params.parentOrderNumber}</strong> into a single package for unified dispatch.
      </p>

      ${refundBadgeHtml}

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F9F8F6; border: 1px solid #EAE8E2; border-radius: 6px; margin: 0 0 16px 0;">
        <tr>
          <td style="padding: 12px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
            Primary Consignment:
          </td>
          <td align="right" style="padding: 12px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 700; color: #262524;">
            #${params.parentOrderNumber}
          </td>
        </tr>
        <tr>
          <td style="padding: 0 16px 12px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
            Merged Add-on Order:
          </td>
          <td align="right" style="padding: 0 16px 12px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 700; color: #262524;">
            #${params.childOrderNumber}
          </td>
        </tr>
      </table>

      ${params.attachments && params.attachments.length > 0 ? `
        <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68; font-style: italic;">
          &bull; Combined Tax Invoice (PDF) is attached to this email.
        </p>
      ` : ''}
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, 'Consolidated Parcel Notice');

    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      orderNumber: params.childOrderNumber,
      subject,
      message: `Your order #${params.childOrderNumber} has been consolidated with #${params.parentOrderNumber}. ₹${params.refundAmount.toFixed(2)} delivery fee has been refunded to your TechnoWallet balance.`,
      attachments: params.attachments,
    }, customHtml);
  }

  public async sendOrderNotification(params: SendOrderEmailParams, customHtml?: string): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    const targetEmail = (params.recipientEmail || '').trim();
    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('@example.com') || targetEmail.includes('@technoworld.com')) {
      logger.warn(`[EMAIL_SKIPPED] Refusing to send email to invalid/placeholder recipient: "${targetEmail}" for Order #${params.orderNumber}`);
      return {
        success: false,
        messageId: 'skipped_invalid_recipient',
        timestamp: new Date().toISOString(),
        status: 'SKIPPED_INVALID_RECIPIENT',
        note: `Invalid recipient address: ${targetEmail}`,
      };
    }

    const config = await this.getEffectiveSmtpConfig();
    const timestamp = new Date().toISOString();
    const effectiveSenderEmail = config.senderEmail || config.user;
    const canReply = params.canReply ?? true;
    const effectiveReplyTo = params.replyTo || (
      effectiveSenderEmail && effectiveSenderEmail.includes('support')
        ? 'support@technoworldbooks.in'
        : 'orders@technoworldbooks.in'
    );
    const html = customHtml || this.generateBrandedHtml(params.subject, params.message, params.orderNumber, params.totalAmount, config.logoUrl, canReply, effectiveReplyTo);
    
    const sender = effectiveSenderEmail
      ? `"${config.senderName}" <${effectiveSenderEmail}>`
      : `"${config.senderName}" <orders@technoworldbooks.in>`;

    let deliveryStatus = 'DISPATCHED_TO_OUTBOX';
    let messageId = `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let provider = 'OUTBOX';
    let errorMessage: string | null = null;
    let note: string | undefined = undefined;

    const mailAttachments = (params.attachments || []).map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType || 'application/pdf',
    }));

    // 1. Try Resend API (Over HTTPS Port 443)
    if (config.resendApiKey) {
      try {
        const resendPayload: any = {
          from: `${config.senderName} <onboarding@resend.dev>`,
          to: [targetEmail],
          reply_to: effectiveReplyTo,
          subject: params.subject,
          html: html,
          headers: {
            'Auto-Submitted': 'auto-generated',
            'X-Auto-Response-Suppress': 'OOF',
          },
        };

        if (mailAttachments.length > 0) {
          resendPayload.attachments = mailAttachments.map(a => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
          }));
        }

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(resendPayload),
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

    // 2. Try Direct SMTP (Hostinger / Custom SMTP)
    if (deliveryStatus !== 'DELIVERED' && config.user && config.pass) {
      try {
        const cleanPass = config.pass.replace(/\s+/g, '');
        const transportOptions: any = {
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 8000,
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
          to: targetEmail,
          replyTo: effectiveReplyTo,
          subject: params.subject,
          text: params.message,
          html: html,
          attachments: mailAttachments,
          headers: {
            'Auto-Submitted': 'auto-generated',
            'X-Auto-Response-Suppress': 'OOF',
          },
        });

        deliveryStatus = 'DELIVERED';
        messageId = info.messageId;
        provider = 'SMTP';
        note = `Delivered via SMTP (${config.host}:${config.port})`;
      } catch (err: any) {
        errorMessage = err.message;
        note = `Direct SMTP delivery note: ${err.message}. Email logged to Admin Outbox.`;
        logger.info(`[SMTP_NOTICE] ${note}`);
      }
    }

    // 3. Always Persist Email to EmailLog Table in DB
    try {
      await prisma.emailLog.create({
        data: {
          toEmail: targetEmail,
          senderEmail: effectiveSenderEmail || 'orders@technoworldbooks.in',
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
      success: deliveryStatus === 'DELIVERED',
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
    totalAmount?: number;
    attachments?: EmailAttachment[];
    replyTo?: string;
    canReply?: boolean;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      orderNumber: params.orderNumber,
      subject: params.subject,
      message: params.message,
      totalAmount: params.totalAmount,
      attachments: params.attachments,
      replyTo: params.replyTo,
      canReply: params.canReply ?? true,
    });
  }

  public async sendTestEmail(toEmail: string, customConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string; messageId?: string; status: string; isDelivered: boolean; note?: string }> {
    const baseConfig = await this.getEffectiveSmtpConfig();
    const config = { ...baseConfig, ...customConfig };

    const effectiveSenderEmail = config.senderEmail || config.user;
    const subject = '✅ Techno World Books — Email System Connection Test';
    const message = `Hello! This is a verification test from your Techno World Books Admin Panel.\n\nSender: ${effectiveSenderEmail}\nTime: ${new Date().toLocaleString('en-IN')}`;
    const html = this.generateBrandedHtml(subject, message, undefined, undefined, config.logoUrl);
    const sender = `"${config.senderName}" <${effectiveSenderEmail || 'test@technoworldbooks.in'}>`;

    let isDelivered = false;
    let messageId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let provider = 'OUTBOX';
    let errorMessage: string | null = null;
    let statusText = 'DISPATCHED_TO_OUTBOX';
    let diagnosticNote = 'Outbound raw SMTP port (587) was unreachable from current network. Email is captured and visible in your Admin Outbox.';

    if (config.user && config.pass) {
      try {
        const cleanPass = config.pass.replace(/\s+/g, '');
        const transportOptions: any = {
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 8000,
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
          replyTo: 'orders@technoworldbooks.in',
          subject,
          text: message,
          html,
          headers: {
            'Auto-Submitted': 'auto-generated',
            'X-Auto-Response-Suppress': 'All',
            'Precedence': 'bulk',
          },
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

    try {
      await prisma.emailLog.create({
        data: {
          toEmail,
          senderEmail: effectiveSenderEmail || 'system@technoworldbooks.in',
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
      success: isDelivered,
      message: isDelivered ? 'Test email delivered to inbox successfully!' : 'Test email dispatched and logged in Admin Outbox.',
      messageId,
      status: statusText,
      isDelivered,
      note: diagnosticNote,
    };
  }

  public async sendAccountStatusEmail(params: {
    recipientEmail: string;
    recipientName?: string;
    status: 'SUSPENDED' | 'ACTIVATED';
    reason?: string;
  }): Promise<void> {
    const targetEmail = (params.recipientEmail || '').trim();
    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('@example.com') || targetEmail.includes('@technoworld.com')) {
      return;
    }

    const isSuspended = params.status === 'SUSPENDED';
    const subject = isSuspended
      ? 'Important Notice Regarding Your Techno World Books Account'
      : 'Your Techno World Books Account Has Been Re-Activated';

    const headerSubtitle = isSuspended ? 'Account Security Notice' : 'Account Status Update';

    const contentHtml = `
      <h2 class="text-primary" style="margin: 0 0 12px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #262524;">
        Dear ${params.recipientName || 'Valued Customer'},
      </h2>

      ${isSuspended ? `
        ${this.renderStatusPill('Account Status: Suspended', '#FDE8E8', '#9B1C1C')}
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td style="padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              <div style="font-size: 14px; font-weight: 700; color: #991B1B; margin-bottom: 4px;">Account Status: Suspended</div>
              <div style="font-size: 13px; color: #B91C1C; line-height: 1.5;">
                Your customer account on Techno World Books has been temporarily suspended by our administration desk.
              </div>
              ${params.reason ? `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #F87171; font-size: 12.5px; color: #7F1D1D;">
                  <strong>Reason recorded:</strong> ${params.reason}
                </div>
              ` : ''}
            </td>
          </tr>
        </table>

        <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #6E6D68; font-size: 13px; line-height: 1.6; margin: 0 0 14px 0;">
          While suspended, you will not be able to log in or place new book orders. Any existing orders currently in transit will continue to be processed and delivered as scheduled.
        </p>

        <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #6E6D68; font-size: 13px; line-height: 1.6; margin: 0;">
          If you believe this action was taken in error or if you wish to appeal this review, please get in touch directly with our support helpdesk at College Street, Kolkata.
        </p>
      ` : `
        ${this.renderStatusPill('Account Status: Active & In Good Standing', '#E6F4EA', '#137333')}
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F2F9F5; border: 1px solid #B8E0CB; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td style="padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              <div style="font-size: 14px; font-weight: 700; color: #14432B; margin-bottom: 4px;">Account Status: Active &amp; In Good Standing</div>
              <div style="font-size: 13px; color: #166534; line-height: 1.5;">
                We are pleased to inform you that your customer account on Techno World Books is now active. You may log in anytime to browse our collection, track your dispatches, and enjoy member privileges.
              </div>
            </td>
          </tr>
        </table>

        <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #6E6D68; font-size: 13px; line-height: 1.6; margin: 0;">
          Thank you for being part of our reading community!
        </p>
      `}
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, headerSubtitle);

    await this.sendOrderNotification({
      recipientEmail: targetEmail,
      recipientName: params.recipientName,
      orderNumber: '',
      subject,
      message: isSuspended
        ? `Your Techno World Books account has been suspended.${params.reason ? ` Reason: ${params.reason}` : ''}`
        : 'Your Techno World Books account has been re-activated and is now ready for use.',
    }, customHtml);
  }

  public async sendPointsAdjustedEmail(params: {
    recipientEmail: string;
    recipientName?: string;
    points: number;
    type: 'CREDIT' | 'DEBIT';
    newBalance: number;
    reason?: string;
  }): Promise<void> {
    const targetEmail = (params.recipientEmail || '').trim();
    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('@example.com') || targetEmail.includes('@technoworld.com')) {
      return;
    }

    const isCredit = params.type === 'CREDIT';
    const subject = isCredit
      ? `You have received ${params.points} TechnoPoints!`
      : `Update: ${params.points} TechnoPoints deducted from your account`;

    const contentHtml = `
      <h2 class="text-primary" style="margin: 0 0 12px 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #262524;">
        Hello ${params.recipientName || 'Book Lover'},
      </h2>

      <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #44423E; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
        ${isCredit
          ? 'Great news! Bonus TechnoPoints have been credited to your loyalty balance by our team.'
          : 'This is a notification regarding an adjustment to your TechnoPoints loyalty balance.'
        }
      </p>

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${isCredit ? '#F2F9F5' : '#FFFBEB'}; border: 1px solid ${isCredit ? '#B8E0CB' : '#FDE68A'}; border-radius: 6px; margin: 0 0 18px 0;">
        <tr>
          <td align="center" style="padding: 20px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${isCredit ? '#14432B' : '#92400E'};">
              ${isCredit ? 'Points Credited' : 'Points Deducted'}
            </div>
            <div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 32px; font-weight: 700; margin: 6px 0; color: ${isCredit ? '#14432B' : '#B45309'};">
              ${isCredit ? `+${params.points}` : `-${params.points}`} <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600;">pts</span>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: #6E6D68;">
              New Balance: <strong style="color: #262524;">${params.newBalance} TechnoPoints</strong>
            </div>

            ${params.reason ? `
              <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed ${isCredit ? '#A7F3D0' : '#FCD34D'}; font-size: 12px; color: #6E6D68;">
                <strong style="color: #262524;">Note:</strong> ${params.reason}
              </div>
            ` : ''}
          </td>
        </tr>
      </table>

      <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #6E6D68; font-size: 12.5px; line-height: 1.6; margin: 0;">
        TechnoPoints can be redeemed directly at checkout towards discounts on any academic or literature books across our catalog.
      </p>
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, 'TechnoPoints Loyalty Rewards');

    await this.sendOrderNotification({
      recipientEmail: targetEmail,
      recipientName: params.recipientName,
      orderNumber: '',
      subject,
      message: `${isCredit ? `+${params.points}` : `-${params.points}`} TechnoPoints. Current Balance: ${params.newBalance} points.${params.reason ? ` Reason: ${params.reason}` : ''}`,
    }, customHtml);
  }

  public async getRecentEmailLogs(limit = 50): Promise<any[]> {
    return prisma.emailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const emailService = EmailService.getInstance();
