import nodemailer, { Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
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

export type EmailTier = 'ORDERS' | 'TEAM' | 'SUPPORT';

export interface TierConfig {
  tier: EmailTier;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  canReply: boolean;
  user: string;
  pass: string;
  host: string;
  port: number;
  secure: boolean;
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
  tier?: EmailTier;
  customerId?: string;
  customerPhone?: string;
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

export interface SendManualEmailParams {
  toEmail: string;
  tier: EmailTier;
  subject: string;
  message: string;
  orderNumber?: string;
  customerName?: string;
  customerId?: string;
  customerPhone?: string;
}

export class EmailService {
  private static instance: EmailService;
  // Multi-transporter cache keyed by tier
  private transporters: Map<EmailTier, Transporter> = new Map();

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Resolves configuration for each specific tier.
   * Tier 1 (ORDERS): Strict No-Reply
   * Tier 2 (TEAM): Interactive Operational Desk (Replies Welcome to team@)
   * Tier 3 (SUPPORT): Customer Care Helpdesk (Replies Welcome to support@)
   */
  public getTierConfig(tier: EmailTier = 'ORDERS'): TierConfig {
    const host = env.SMTP_HOST || 'smtp.hostinger.com';
    const port = Number(env.SMTP_PORT) || 465;
    const pass = (env.SMTP_PASSWORD || env.SMTP_PASS || '').trim();
    const secure = port === 465;

    switch (tier) {
      case 'TEAM':
        return {
          tier: 'TEAM',
          fromName: 'Techno World Books Team',
          fromEmail: (env.SMTP_TEAM_USER || 'team@technoworldbooks.in').trim(),
          replyTo: 'team@technoworldbooks.in',
          canReply: true,
          user: (env.SMTP_TEAM_USER || 'team@technoworldbooks.in').trim(),
          pass,
          host,
          port,
          secure,
        };

      case 'SUPPORT':
        return {
          tier: 'SUPPORT',
          fromName: 'Techno World Books Support',
          fromEmail: (env.SMTP_SUPPORT_USER || 'support@technoworldbooks.in').trim(),
          replyTo: 'support@technoworldbooks.in',
          canReply: true,
          user: (env.SMTP_SUPPORT_USER || 'support@technoworldbooks.in').trim(),
          pass,
          host,
          port,
          secure,
        };

      case 'ORDERS':
      default:
        return {
          tier: 'ORDERS',
          fromName: 'Techno World Books Orders',
          fromEmail: (env.SMTP_ORDERS_USER || 'orders@technoworldbooks.in').trim(),
          replyTo: undefined, // Strict No-Reply
          canReply: false,
          user: (env.SMTP_ORDERS_USER || 'orders@technoworldbooks.in').trim(),
          pass,
          host,
          port,
          secure,
        };
    }
  }

  /**
   * Multi-Transporter Factory: Dynamically returns or instantiates a transporter for the tier.
   */
  public getTransporter(tier: EmailTier = 'ORDERS'): Transporter {
    if (this.transporters.has(tier)) {
      return this.transporters.get(tier)!;
    }

    const config = this.getTierConfig(tier);
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass.replace(/\s+/g, ''),
      },
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 10000,
    });

    this.transporters.set(tier, transporter);
    return transporter;
  }

  /**
   * Generates a short, opaque encrypted security reference code for buyer-facing communications
   * so the customer never sees their internal database customer ID (e.g. TWC-10008) or UUID.
   * Format: CR-9F2B8A1C (clean 8-character uppercase cryptographic hash)
   */
  public generateSecureCustomerRef(identifier?: string | null): string {
    if (!identifier || identifier.trim() === '' || identifier === 'GUEST') {
      return 'CR-GUEST';
    }
    const clean = identifier.trim();
    const hash = crypto.createHash('sha256').update(`twb_buyer_ref_${clean}`).digest('hex');
    return `CR-${hash.substring(0, 8).toUpperCase()}`;
  }

  /**
   * Builds machine-parseable tracking tokens and a 1-click mailto confirmation payload
   * for Tier 2 (TEAM) emails.
   */
  public buildAutoMatchingReplyPayload(params: {
    orderNumber: string;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    subject?: string;
  }) {
    const ord = params.orderNumber || 'GENERAL';

    // Clean, crisp reply subject with only the unique order number
    const replySubject = `Re: Address Clarification - Order #${ord}`;
    const replyBody = `Order Reference: #${ord}\nCustomer Name: ${params.customerName || 'Valued Customer'}\nPhone: ${params.customerPhone || 'N/A'}\n\n------------------------------------\nMY CORRECT DELIVERY ADDRESS IS:\n[Please type full street address, landmark, city, state & pincode here]\n------------------------------------\n`;

    const mailtoUrl = `mailto:team@technoworldbooks.in?subject=${encodeURIComponent(replySubject)}&body=${encodeURIComponent(replyBody)}`;

    const actionButtonHtml = `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 24px auto; text-align: center;">
        <tr>
          <td align="center" style="border-radius: 8px; background-color: #2563EB;">
            <a href="${mailtoUrl}" target="_blank" style="display: inline-block; background-color: #2563EB; color: #FFFFFF !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px; border: 1px solid #1D4ED8;">
              Confirm Delivery Address
            </a>
          </td>
        </tr>
      </table>
    `;

    const metadataBoxHtml = `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 6px; margin: 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #475569;">
        <tr>
          <td style="padding: 12px 16px;">
            <strong style="color: #1E293B;">Order Reference: #${ord}</strong><br/>
            <strong>Recipient:</strong> ${params.customerName || 'Customer'} (${params.customerPhone || 'N/A'})<br/>
            <span style="font-size: 10.5px; color: #64748B;">Please click the button above or reply directly with your complete delivery address.</span>
          </td>
        </tr>
      </table>
    `;

    return {
      trackingToken: `[Ref: #${ord}]`,
      mailtoUrl,
      actionButtonHtml,
      metadataBoxHtml,
    };
  }

  public renderStatusPill(text: string, bgColor: string, textColor: string): string {
    return `
      <div style="margin: 12px 0 16px 0;">
        <span style="display: inline-block; padding: 4px 12px; background-color: ${bgColor}; color: ${textColor}; border-radius: 12px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;">
          ${text}
        </span>
      </div>
    `;
  }

  /**
   * Generates branded footer strictly adhering to Tier rules:
   * Tier 1: Strictly No-Reply notice
   * Tier 2: Interactive Operational Team notice (Replies Welcome)
   * Tier 3: Customer Care Helpdesk notice
   */
  public generateBrandedFooter(tier: EmailTier = 'ORDERS', canReply?: boolean, replyEmail?: string): string {
    const config = this.getTierConfig(tier);
    const allowReply = canReply !== undefined ? canReply : config.canReply;
    const effectiveReplyEmail = replyEmail || config.replyTo || 'support@technoworldbooks.in';

    let replyNoteHtml = '';
    if (tier === 'ORDERS' || !allowReply) {
      replyNoteHtml = `
        <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">
          Automated order notification. For help, email <a href="mailto:support@technoworldbooks.in" style="color: #15803D; font-weight: 600; text-decoration: underline;">support@technoworldbooks.in</a> or WhatsApp: <a href="https://wa.me/917479135626" style="color: #15803D; font-weight: 600; text-decoration: underline;">+91 747 913 5626</a>.
        </div>
      `;
    } else {
      replyNoteHtml = `
        <div style="font-size: 11px; color: #64748B; margin-bottom: 8px;">
          You can reply directly to this email (<a href="mailto:${effectiveReplyEmail}" style="color: #2563EB; font-weight: 600; text-decoration: underline;">${effectiveReplyEmail}</a>) or WhatsApp <a href="https://wa.me/917479135626" style="color: #15803D; font-weight: 600; text-decoration: underline;">+91 747 913 5626</a>.
        </div>
      `;
    }

    return `
      <tr>
        <td align="center" style="padding: 18px 20px 14px 20px; border-top: 1px solid #F1F0EA; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          ${replyNoteHtml}
          <div style="font-size: 11px; color: #64748B; line-height: 1.5; margin-top: 6px;">
            <strong style="color: #334155;">Techno World Books</strong> &bull; Kolkata 700007<br/>
            Store: <a href="https://technoworldbooks.in" style="color: #15803D; font-weight: 600; text-decoration: none;">technoworldbooks.in</a>
          </div>
        </td>
      </tr>
    `;
  }

  public wrapInDocument(
    title: string,
    contentHtml: string,
    subtitle = 'Official Order Communication',
    logoUrl?: string,
    tier: EmailTier = 'ORDERS',
    canReply?: boolean,
    replyEmail?: string
  ): string {
    const logoSrc = logoUrl || 'https://technoworldbooks.in/icon.png';
    const footerHtml = this.generateBrandedFooter(tier, canReply, replyEmail);

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
    @media (prefers-color-scheme: dark) {
      body, table, td { background-color: #121212 !important; color: #E4E4E7 !important; }
      .email-bg { background-color: #121212 !important; }
      .card { background-color: #1E1E1E !important; border-color: #333333 !important; }
      .text-muted { color: #A1A1AA !important; }
      .text-primary { color: #FFFFFF !important; }
      .brand-header { background: #0B2518 !important; }
      .footer-note { background-color: #27272A !important; color: #E4E4E7 !important; border-color: #3F3F46 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F6F5F0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color: #F6F5F0; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #EAE8E2;" class="card">
          <!-- Brand Header -->
          <tr>
            <td class="brand-header" align="center" style="background: linear-gradient(135deg, #14432B 0%, #0A2618 100%); padding: 22px 16px 20px 16px; text-align: center;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto; text-align: center;">
                <tr>
                  <td align="center" style="padding-bottom: 8px;">
                    <a href="https://technoworldbooks.in" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${logoSrc}" alt="Techno World Books" width="44" height="44" style="display: block; margin: 0 auto; border-radius: 10px; border: 0; outline: none; text-decoration: none;" />
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 19px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.3px; line-height: 1.25; font-variant-numeric: lining-nums tabular-nums;">
                      Techno World Books
                    </div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11.5px; color: #A7F3D0; font-weight: 500; margin-top: 4px; font-variant-numeric: lining-nums tabular-nums;">
                      ${subtitle} &bull; Kolkata
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding: 26px 22px 22px 22px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  public generateBrandedHtml(
    title: string,
    message: string,
    orderNumber?: string,
    totalAmount?: number,
    logoUrl?: string,
    tier: EmailTier = 'ORDERS',
    canReply?: boolean,
    replyEmail?: string,
    extraContentHtml = ''
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

    const cleanHeading = title
      .replace(/\[REF:[^\]]+\]/gi, '')
      .replace(/\[Ref:[^\]]+\]/gi, '')
      .replace(/\s*-\s*Techno World Books/gi, '')
      .trim();

    const content = `
      <h1 class="text-primary" style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; color: #1E293B; line-height: 1.35; font-variant-numeric: lining-nums tabular-nums;">
        ${cleanHeading}
      </h1>
      ${statusPill}
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.55; color: #262524; text-align: left;">
        ${message.replace(/\n/g, '<br/>')}
      </div>
      ${extraContentHtml}
      ${orderBox}
    `;

    return this.wrapInDocument(
      title,
      content,
      orderNumber ? `Order #${orderNumber}` : 'Official Communication',
      logoUrl,
      tier,
      canReply,
      replyEmail
    );
  }

  public generateLifecycleEmailHtml(params: {
    status: 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'PENDING';
    orderNumber: string;
    customerName: string;
    items: Array<{ title: string; quantity: number; price: number; sku?: string; slug?: string; coverUrl?: string; author?: string }>;
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
      items,
      totalAmount,
      subtotal,
      shippingCharge,
      discountAmount,
      trackingNumber,
      shippingCarrier,
      shippingMethod,
      cancelReason,
      deliveryAddress,
      paymentMethod,
      hasInvoiceAttachment,
    } = params;

    const safeName = customerName || 'Valued Reader';

    const itemsRows = (items || []).map((item) => `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #F0EEE6; font-size: 13px; color: #262524;">
          <div style="font-weight: 600; line-height: 1.3;">${item.title}</div>
          ${item.sku ? `<div style="font-size: 11px; color: #6E6D68; font-family: monospace;">SKU: ${item.sku}</div>` : ''}
        </td>
        <td align="center" style="padding: 10px 8px; border-bottom: 1px solid #F0EEE6; font-size: 13px; color: #6E6D68; white-space: nowrap;">
          &times;${item.quantity}
        </td>
        <td align="right" style="padding: 10px 0; border-bottom: 1px solid #F0EEE6; font-size: 13px; font-weight: 700; color: #262524; white-space: nowrap;">
          ₹${(item.price * item.quantity).toFixed(2)}
        </td>
      </tr>
    `).join('');

    const itemsHtml = `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FAF9F5; border: 1px solid #EAE8E2; border-radius: 8px; margin: 18px 0; padding: 14px 18px;">
        <tr>
          <td colspan="3" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #1E293B; padding-bottom: 8px; border-bottom: 2px solid #EAE8E2; font-variant-numeric: lining-nums tabular-nums;">
            Order Summary (${(items || []).reduce((acc, i) => acc + i.quantity, 0)} Items)
          </td>
        </tr>
        ${itemsRows}
        ${subtotal !== undefined ? `
          <tr>
            <td colspan="2" align="right" style="padding: 6px 8px 2px 0; font-size: 12px; color: #6E6D68;">Subtotal:</td>
            <td align="right" style="padding: 6px 0 2px 0; font-size: 12px; color: #262524; font-weight: 600;">₹${subtotal.toFixed(2)}</td>
          </tr>
        ` : ''}
        ${discountAmount ? `
          <tr>
            <td colspan="2" align="right" style="padding: 2px 8px 2px 0; font-size: 12px; color: #047857;">Promotional Discount:</td>
            <td align="right" style="padding: 2px 0 2px 0; font-size: 12px; color: #047857; font-weight: 700;">-₹${discountAmount.toFixed(2)}</td>
          </tr>
        ` : ''}
        ${shippingCharge !== undefined ? `
          <tr>
            <td colspan="2" align="right" style="padding: 2px 8px 2px 0; font-size: 12px; color: #6E6D68;">Shipping:</td>
            <td align="right" style="padding: 2px 0 2px 0; font-size: 12px; color: #262524; font-weight: 600;">${shippingCharge === 0 ? 'FREE' : `₹${shippingCharge.toFixed(2)}`}</td>
          </tr>
        ` : ''}
        <tr>
          <td colspan="2" align="right" style="padding: 10px 8px 0 0; font-size: 14px; font-weight: 800; color: #14432B; border-top: 1px dashed #D6D3C7;">Total Paid:</td>
          <td align="right" style="padding: 10px 0 0 0; font-size: 16px; font-weight: 800; color: #14432B; border-top: 1px dashed #D6D3C7;">₹${Number(totalAmount).toFixed(2)}</td>
        </tr>
      </table>
    `;

    let subject = '';
    let headline = '';
    let messageBody = '';
    let actionBadge = '';
    let plainTextMessage = '';

    switch (status) {
      case 'CONFIRMED':
        subject = `Order Confirmed: #${orderNumber} — Techno World Books`;
        headline = `Thank you, ${safeName}! Your order is confirmed.`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            We are preparing your books at our fulfillment facility in Kolkata. Our fulfillment team is packaging each title securely with moisture-resistant protection.
          </p>
          ${paymentMethod ? `<p style="margin: 0 0 10px; font-size: 12.5px; color: #6E6D68;"><b>Payment Method:</b> ${paymentMethod}</p>` : ''}
          ${deliveryAddress ? `<p style="margin: 0 0 10px; font-size: 12.5px; color: #6E6D68;"><b>Delivery Address:</b> ${deliveryAddress}</p>` : ''}
          <p style="margin: 0; color: #262524; line-height: 1.6;">
            You will receive another update containing your postal tracking consignment number once the parcel is handed to the carrier.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: Confirmed & Packing', '#E6F4EA', '#137333');
        plainTextMessage = `Hello ${safeName},\n\nYour order #${orderNumber} is confirmed! Total: ₹${totalAmount.toFixed(2)}. We will notify you with tracking details as soon as it is dispatched.`;
        break;

      case 'PROCESSING':
        subject = `Fulfillment Update: Order #${orderNumber} is being packed`;
        headline = `Your books are being packed with care, ${safeName}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #262524; line-height: 1.6;">
            Our fulfillment staff has picked the titles for order <b>#${orderNumber}</b>. The parcel is currently undergoing quality inspection and tamper-proof sealing.
          </p>
        `;
        actionBadge = this.renderStatusPill('Status: In Quality Check & Packaging', '#E8F0FE', '#1A73E8');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} is currently undergoing quality check and packing.`;
        break;

      case 'SHIPPED':
        subject = `Order Dispatched: #${orderNumber} ${trackingNumber ? `(Tracking: ${trackingNumber})` : ''} — Techno World Books`;
        headline = `Good news! Your order #${orderNumber} is on its way.`;
        messageBody = `
          <p style="margin: 0 0 14px; color: #262524; line-height: 1.6;">
            Your book parcel has been handed over to <b>${shippingCarrier || 'India Post Speed Post'}</b> for fast and secure delivery across India.
          </p>
          ${trackingNumber ? `
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; margin: 16px 0;">
              <tr>
                <td style="padding: 14px 18px;">
                  <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #166534; letter-spacing: 0.5px;">Consignment / Tracking Number</div>
                  <div style="font-size: 20px; font-weight: 800; color: #14532D; font-family: monospace; letter-spacing: 1px; margin: 4px 0;">
                    ${trackingNumber}
                  </div>
                  <div style="font-size: 12px; color: #15803D; margin-top: 6px;">
                    Carrier: <b>${shippingCarrier || 'India Post Speed Post'}</b> ${shippingMethod ? `(${shippingMethod})` : ''}
                  </div>
                </td>
              </tr>
            </table>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 14px 0;">
              <tr>
                <td align="center" style="background-color: #14432B; border-radius: 6px;">
                  <a href="https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx" target="_blank" style="display: inline-block; padding: 10px 22px; font-size: 13px; font-weight: 700; color: #FFFFFF; text-decoration: none; border-radius: 6px;">
                    Track Consignment on India Post &rarr;
                  </a>
                </td>
              </tr>
            </table>
          ` : ''}
          ${hasInvoiceAttachment ? `
            <p style="margin: 12px 0 0; font-size: 12px; color: #6E6D68;">
              &bull; <i>Final Tax Invoice (PDF) is attached to this email.</i>
            </p>
          ` : ''}
        `;
        actionBadge = this.renderStatusPill('Status: Dispatched & In Transit', '#FEF3C7', '#92400E');
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been dispatched! Tracking: ${trackingNumber || 'Available shortly'}. Carrier: ${shippingCarrier || 'India Post'}.`;
        break;

      case 'DELIVERED':
        subject = `Delivered: Order #${orderNumber} — Please Review Your Books!`;
        headline = `Your books have arrived, ${safeName}!`;

        const reviewCardsHtml = (items || []).map((it) => {
          const bookUrl = it.slug ? `https://technoworldbooks.in/book/${it.slug}?review=true#reviews` : `https://technoworldbooks.in/`;
          return `
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FFFFFF; border: 1px solid #EAE8E2; border-radius: 8px; margin: 10px 0; padding: 12px 14px;">
              <tr>
                ${it.coverUrl ? `
                  <td width="55" valign="top" style="padding-right: 12px;">
                    <img src="${it.coverUrl}" alt="${it.title}" width="55" height="75" style="border-radius: 4px; object-fit: cover; display: block; border: 1px solid #EAE8E2;" />
                  </td>
                ` : ''}
                <td valign="top" style="vertical-align: middle;">
                  <div style="font-size: 13px; font-weight: 700; color: #1E293B; line-height: 1.3;">${it.title}</div>
                  ${it.author ? `<div style="font-size: 11.5px; color: #6E6D68; margin-top: 2px;">By ${it.author}</div>` : ''}
                  <div style="margin-top: 8px;">
                    <a href="${bookUrl}" target="_blank" style="display: inline-block; background-color: #047857; color: #FFFFFF; font-size: 11.5px; font-weight: 700; padding: 6px 14px; text-decoration: none; border-radius: 6px;">
                      Write a Review &rarr;
                    </a>
                  </div>
                </td>
              </tr>
            </table>
          `;
        }).join('');

        messageBody = `
          <p style="margin: 0 0 14px; color: #262524; line-height: 1.6;">
            We are pleased to inform you that your package for order <b>#${orderNumber}</b> has been successfully delivered. We hope you enjoy reading your new titles!
          </p>

          <div style="margin: 18px 0;">
            <h4 style="margin: 0 0 6px; font-size: 13px; font-weight: 700; color: #1E293B;">How was your experience?</h4>
            <p style="margin: 0 0 12px; font-size: 12px; color: #6E6D68; line-height: 1.5;">
              Your feedback helps other students and book lovers across India find the right academic titles. Please take a moment to share your review:
            </p>
            ${reviewCardsHtml}
          </div>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FAF9F5; border: 1px solid #EAE8E2; border-radius: 8px; margin: 16px 0;">
            <tr>
              <td style="padding: 14px 16px;">
                <h4 class="text-primary" style="margin: 0 0 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; font-weight: 700; color: #1E293B;">Official 7-Day Replacement Guarantee</h4>
                <p class="text-muted" style="margin: 0; font-size: 11.5px; color: #6E6D68; line-height: 1.5;">
                  If any book arrived damaged, misprinted, or defective, you qualify for a free replacement within <b>7 calendar days of delivery</b>. Please record an uninterrupted unboxing video and contact us at <b>support@technoworldbooks.in</b> or WhatsApp <b>+91 747 913 5626</b>.
                </p>
              </td>
            </tr>
          </table>
          ${hasInvoiceAttachment ? `
            <p style="margin: 12px 0 0; font-size: 12px; color: #6E6D68;">
              &bull; <i>Final Tax Invoice (PDF) is attached to this email.</i>
            </p>
          ` : ''}
        `;
        actionBadge = this.renderStatusPill('Status: Successfully Delivered', '#DEF7EC', '#03543F');
        plainTextMessage = `Hello ${safeName},\n\nYour order #${orderNumber} has been delivered! Please visit our website to share your review on the books you received. If you need a replacement for damaged or misprinted titles, our 7-day replacement window is active. Contact: support@technoworldbooks.in or WhatsApp +91 747 913 5626.`;
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
            If you have any questions or feel this was in error, please contact our helpdesk: <b>support@technoworldbooks.in</b> or WhatsApp: <b>+91 747 913 5626</b>.
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
      <h1 class="text-primary" style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; color: #1E293B; line-height: 1.35; font-variant-numeric: lining-nums tabular-nums;">
        ${headline}
      </h1>
      
      ${actionBadge}
      
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #262524; text-align: left;">
        ${messageBody}
      </div>
      
      ${itemsHtml}
    `;

    // Lifecycle emails strictly belong to Tier 1: ORDERS (No-Reply)
    const html = this.wrapInDocument(subject, contentHtml, `Order #${orderNumber}`, undefined, 'ORDERS', false);

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
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 26px; font-weight: 700; color: #14432B; margin: 6px 0; font-variant-numeric: lining-nums tabular-nums;">+₹${params.refundAmount.toFixed(2)}</div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #262524;">Refund of Delivery Charge for Order #${params.childOrderNumber}</div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68; margin-top: 4px;">Updated TechnoWallet Balance: <strong style="color: #262524;">₹${params.newWalletBalance.toFixed(2)}</strong></div>
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
      <h1 class="text-primary" style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 700; color: #1E293B; line-height: 1.35; font-variant-numeric: lining-nums tabular-nums;">
        Orders Consolidated for Unified Delivery
      </h1>

      <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #262524; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
        Dear ${params.customerName || 'Valued Customer'}, your subsequent add-on order has been merged into your primary parcel.
      </p>

      ${refundBadgeHtml}

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="card" style="background-color: #FAF9F5; border: 1px solid #EAE8E2; border-radius: 8px; margin: 16px 0;">
        <tr>
          <td style="padding: 12px 16px 6px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #6E6D68;">
            Primary Dispatch Order:
          </td>
          <td align="right" style="padding: 12px 16px 6px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 700; color: #262524;">
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
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, 'Consolidated Parcel Notice', undefined, 'ORDERS', false);

    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      orderNumber: params.childOrderNumber,
      subject,
      message: `Your order #${params.childOrderNumber} has been consolidated with #${params.parentOrderNumber}. ₹${params.refundAmount.toFixed(2)} delivery fee has been refunded to your TechnoWallet balance.`,
      attachments: params.attachments,
      tier: 'ORDERS',
    }, customHtml);
  }

  /**
   * Core multi-tier sendNotification implementation.
   * Dynamically selects Tier 1 (ORDERS), Tier 2 (TEAM), or Tier 3 (SUPPORT).
   */
  public async sendOrderNotification(
    params: SendOrderEmailParams,
    customHtml?: string
  ): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
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

    // Determine target tier
    const tier: EmailTier = params.tier || (
      params.subject.toLowerCase().includes('clarification') || params.subject.toLowerCase().includes('address') || (params as any).templateType === 'ADDRESS_CLARIFICATION'
        ? 'TEAM'
        : params.subject.toLowerCase().includes('support') || params.subject.toLowerCase().includes('inquiry')
        ? 'SUPPORT'
        : 'ORDERS'
    );

    const config = this.getTierConfig(tier);
    const timestamp = new Date().toISOString();

    // Prepare Auto-matching tokens if Tier 2 (TEAM)
    let extraContentHtml = '';
    let finalSubject = params.subject
      .replace(/\[REF:[^\]]+\]/gi, '')
      .replace(/\[Ref:[^\]]+\]/gi, '')
      .replace(/\s*-\s*Techno World Books/gi, '')
      .trim();

    if (tier === 'TEAM' && params.orderNumber) {
      const autoMatch = this.buildAutoMatchingReplyPayload({
        orderNumber: params.orderNumber,
        customerId: params.customerId,
        customerName: params.recipientName,
        customerPhone: params.customerPhone,
        subject: finalSubject,
      });

      // Keep email header subject line clean, uncluttered, and readable:
      if (!finalSubject.includes(params.orderNumber)) {
        finalSubject = `${finalSubject} (Order #${params.orderNumber})`;
      }

      extraContentHtml = `${autoMatch.actionButtonHtml}\n${autoMatch.metadataBoxHtml}`;
    }

    const html = customHtml || this.generateBrandedHtml(
      finalSubject,
      params.message,
      params.orderNumber,
      params.totalAmount,
      undefined,
      tier,
      params.canReply !== undefined ? params.canReply : config.canReply,
      config.replyTo,
      extraContentHtml
    );

    const sender = `"${config.fromName}" <${config.fromEmail}>`;

    let deliveryStatus = 'DISPATCHED_TO_OUTBOX';
    let messageId = `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    let errorMessage: string | null = null;
    let note: string | undefined = undefined;

    const mailAttachments = (params.attachments || []).map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType || 'application/pdf',
    }));

    // Dispatch via the dedicated Tier Transporter
    try {
      const transporter = this.getTransporter(tier);
      const mailOptions: any = {
        from: sender,
        to: targetEmail,
        subject: finalSubject,
        text: params.message,
        html,
        attachments: mailAttachments,
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'OOF',
        },
      };

      if (config.replyTo) {
        mailOptions.replyTo = config.replyTo;
      }

      const info = await transporter.sendMail(mailOptions);
      deliveryStatus = 'DELIVERED';
      messageId = info.messageId;
      note = `Delivered via Tier ${tier} (${config.fromEmail} on ${config.host}:${config.port})`;
    } catch (err: any) {
      errorMessage = err.message;
      note = `Direct SMTP delivery error on Tier ${tier}: ${err.message}. Email saved to Admin Outbox.`;
      logger.warn(`[SMTP_TIER_FAIL: ${tier}] ${note}`);
    }

    // Always log to EmailLog table in DB with provider tier tag
    try {
      await prisma.emailLog.create({
        data: {
          toEmail: targetEmail,
          senderEmail: config.fromEmail,
          senderName: config.fromName,
          subject: finalSubject,
          message: params.message,
          htmlContent: html,
          orderNumber: params.orderNumber || null,
          provider: `SMTP:${tier}`,
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

  /**
   * Dedicated Address Clarification Dispatch (Tier 2: TEAM)
   */
  public async sendAddressClarificationEmail(params: {
    recipientEmail: string;
    recipientName?: string;
    orderNumber: string;
    customerId?: string;
    customerPhone?: string;
    subject: string;
    message: string;
  }) {
    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      orderNumber: params.orderNumber,
      customerId: params.customerId,
      customerPhone: params.customerPhone,
      subject: params.subject,
      message: params.message,
      tier: 'TEAM',
      canReply: true,
      replyTo: 'team@technoworldbooks.in',
    });
  }

  /**
   * Helper for general order emails with dynamic template-type tier deduction.
   */
  public async sendOrderEmail(params: {
    orderId?: string;
    orderNumber: string;
    recipientEmail: string;
    recipientName?: string;
    customerId?: string;
    customerPhone?: string;
    subject: string;
    message: string;
    templateType?: string;
    totalAmount?: number;
    attachments?: EmailAttachment[];
    tier?: EmailTier;
    replyTo?: string;
    canReply?: boolean;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    let resolvedTier: EmailTier = params.tier || 'ORDERS';
    if (!params.tier) {
      if (params.templateType === 'ADDRESS_CLARIFICATION' || params.templateType === 'DELAY_NOTICE') {
        resolvedTier = 'TEAM';
      } else {
        resolvedTier = 'ORDERS';
      }
    }

    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      orderNumber: params.orderNumber,
      customerId: params.customerId,
      customerPhone: params.customerPhone,
      subject: params.subject,
      message: params.message,
      totalAmount: params.totalAmount,
      attachments: params.attachments,
      tier: resolvedTier,
      replyTo: params.replyTo,
      canReply: params.canReply,
    });
  }

  /**
   * Dedicated Customer Success / Support Dispatch (Tier 3: SUPPORT)
   */
  public async sendSupportEmail(params: {
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    message: string;
    orderNumber?: string;
  }) {
    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      orderNumber: params.orderNumber || '',
      subject: params.subject,
      message: params.message,
      tier: 'SUPPORT',
      canReply: true,
      replyTo: 'support@technoworldbooks.in',
    });
  }

  /**
   * Send Manual Email directly from Admin composer modal with Tier selection.
   */
  public async sendManualEmail(params: SendManualEmailParams) {
    return this.sendOrderNotification({
      recipientEmail: params.toEmail,
      recipientName: params.customerName,
      orderNumber: params.orderNumber || '',
      customerId: params.customerId,
      customerPhone: params.customerPhone,
      subject: params.subject,
      message: params.message,
      tier: params.tier,
    });
  }

  /**
   * Tests a specific Tier's SMTP connection and dispatches a live test email.
   */
  public async sendTestEmail(
    toEmail: string,
    options?: {
      tier?: EmailTier;
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      senderEmail?: string;
      senderName?: string;
    }
  ): Promise<{ success: boolean; message: string; messageId?: string; status: string; isDelivered: boolean; note?: string }> {
    const tier: EmailTier = options?.tier || 'ORDERS';
    const config = this.getTierConfig(tier);

    const effectiveSenderEmail = options?.senderEmail || options?.user || config.fromEmail;
    const effectiveSenderName = options?.senderName || config.fromName;
    const effectiveHost = options?.host || config.host;
    const effectivePort = options?.port ? Number(options.port) : config.port;
    const effectiveUser = options?.user || config.user;
    const effectivePass = (options?.pass || config.pass).replace(/\s+/g, '');

    const subject = `✅ [Tier ${tier}] Connection Test — Techno World Books`;
    const message = `Hello! This is an active connection verification test for Tier ${tier} (${effectiveSenderEmail}).\n\nSent: ${new Date().toLocaleString('en-IN')}\nHost: ${effectiveHost}:${effectivePort}\nReply Policy: ${tier === 'ORDERS' ? 'Strictly No-Reply' : `Replies accepted to ${config.replyTo}`}`;
    const html = this.generateBrandedHtml(subject, message, undefined, undefined, undefined, tier);
    const sender = `"${effectiveSenderName}" <${effectiveSenderEmail}>`;

    let isDelivered = false;
    let messageId = `test_${tier}_${Date.now()}`;
    let errorMessage: string | null = null;
    let statusText = 'DISPATCHED_TO_OUTBOX';
    let diagnosticNote = '';

    try {
      const transporter = nodemailer.createTransport({
        host: effectiveHost,
        port: effectivePort,
        secure: effectivePort === 465,
        auth: { user: effectiveUser, pass: effectivePass },
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 8000,
      });

      const mailOptions: any = {
        from: sender,
        to: toEmail,
        subject,
        text: message,
        html,
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        },
      };

      if (config.replyTo) {
        mailOptions.replyTo = config.replyTo;
      }

      const info = await transporter.sendMail(mailOptions);
      isDelivered = true;
      messageId = info.messageId;
      statusText = 'DELIVERED';
      diagnosticNote = `Live test email delivered successfully to ${toEmail} via Tier ${tier} (${effectiveSenderEmail})!`;
    } catch (err: any) {
      errorMessage = err.message;
      diagnosticNote = `SMTP Test Error on Tier ${tier}: ${err.message}`;
    }

    try {
      await prisma.emailLog.create({
        data: {
          toEmail,
          senderEmail: effectiveSenderEmail,
          senderName: effectiveSenderName,
          subject,
          message,
          htmlContent: html,
          provider: `SMTP:${tier}`,
          status: statusText,
          errorMessage,
        },
      });
    } catch {}

    return {
      success: isDelivered,
      message: isDelivered ? `Tier ${tier} test email delivered successfully!` : `Tier ${tier} dispatch logged in Outbox. (${diagnosticNote})`,
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
      ? 'Important Notice: Your Techno World Books Account has been Suspended'
      : 'Welcome Back: Your Techno World Books Account is Activated';

    const contentHtml = `
      <h2 class="text-primary" style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 700; color: #1E293B; font-variant-numeric: lining-nums tabular-nums;">
        Dear ${params.recipientName || 'Valued Customer'},
      </h2>

      ${isSuspended ? `
        ${this.renderStatusPill('Account Status: Suspended', '#FDE8E8', '#9B1C1C')}
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td style="padding: 16px;">
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
        <p style="color: #6E6D68; font-size: 13px; line-height: 1.6; margin: 0 0 14px 0;">
          If you believe this action was taken in error, please reply directly to this email or write to <a href="mailto:support@technoworldbooks.in" style="color: #14432B; font-weight: 600;">support@technoworldbooks.in</a>.
        </p>
      ` : `
        ${this.renderStatusPill('Account Status: Active & In Good Standing', '#E6F4EA', '#137333')}
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F2F9F5; border: 1px solid #B8E0CB; border-radius: 6px; margin: 0 0 16px 0;">
          <tr>
            <td style="padding: 16px;">
              <div style="font-size: 14px; font-weight: 700; color: #14432B; margin-bottom: 4px;">Account Status: Active &amp; In Good Standing</div>
              <div style="font-size: 13px; color: #166534; line-height: 1.5;">
                Your customer account on Techno World Books is active. You may log in anytime to browse our collection and track your orders.
              </div>
            </td>
          </tr>
        </table>
      `}
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, 'Account Security Update', undefined, 'SUPPORT', true);

    await this.sendOrderNotification({
      recipientEmail: targetEmail,
      recipientName: params.recipientName,
      orderNumber: '',
      subject,
      message: isSuspended
        ? `Your Techno World Books account has been suspended.${params.reason ? ` Reason: ${params.reason}` : ''}`
        : 'Your Techno World Books account has been re-activated and is now ready for use.',
      tier: 'SUPPORT',
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
      <h2 class="text-primary" style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 700; color: #1E293B; font-variant-numeric: lining-nums tabular-nums;">
        Hello ${params.recipientName || 'Book Lover'},
      </h2>

      <p style="color: #44423E; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
        ${isCredit
          ? 'Great news! Bonus TechnoPoints have been credited to your loyalty balance by our team.'
          : 'This is a notification regarding an adjustment to your TechnoPoints loyalty balance.'
        }
      </p>

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${isCredit ? '#F2F9F5' : '#FFFBEB'}; border: 1px solid ${isCredit ? '#B8E0CB' : '#FDE68A'}; border-radius: 6px; margin: 0 0 18px 0;">
        <tr>
          <td align="center" style="padding: 20px 16px; text-align: center;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${isCredit ? '#14432B' : '#92400E'};">
              ${isCredit ? 'Points Credited' : 'Points Deducted'}
            </div>
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 28px; font-weight: 700; margin: 6px 0; color: ${isCredit ? '#14432B' : '#B45309'}; font-variant-numeric: lining-nums tabular-nums;">
              ${isCredit ? `+${params.points}` : `-${params.points}`} <span style="font-size: 16px; font-weight: 600;">pts</span>
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
    `;

    const customHtml = this.wrapInDocument(subject, contentHtml, 'TechnoPoints Loyalty Rewards', undefined, 'SUPPORT', true);

    await this.sendOrderNotification({
      recipientEmail: targetEmail,
      recipientName: params.recipientName,
      orderNumber: '',
      subject,
      message: `${isCredit ? `+${params.points}` : `-${params.points}`} TechnoPoints. Current Balance: ${params.newBalance} points.${params.reason ? ` Reason: ${params.reason}` : ''}`,
      tier: 'SUPPORT',
    }, customHtml);
  }

  public async getRecentEmailLogs(params?: { limit?: number; tier?: string; status?: string; search?: string } | number): Promise<any[]> {
    const limit = typeof params === 'number' ? params : (params?.limit || 50);
    const tier = typeof params === 'object' ? params?.tier : undefined;
    const status = typeof params === 'object' ? params?.status : undefined;
    const search = typeof params === 'object' ? params?.search : undefined;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (tier && tier !== 'ALL') {
      if (tier === 'ORDERS') {
        where.OR = [
          { senderEmail: { contains: 'orders' } },
          { provider: { contains: 'ORDERS' } },
        ];
      } else if (tier === 'TEAM') {
        where.OR = [
          { senderEmail: { contains: 'team' } },
          { provider: { contains: 'TEAM' } },
        ];
      } else if (tier === 'SUPPORT') {
        where.OR = [
          { senderEmail: { contains: 'support' } },
          { provider: { contains: 'SUPPORT' } },
        ];
      }
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { toEmail: { contains: q, mode: 'insensitive' } },
            { subject: { contains: q, mode: 'insensitive' } },
            { orderNumber: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const logs = await prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const orderNumbers = Array.from(new Set(logs.map((l) => l.orderNumber).filter(Boolean))) as string[];
    const emails = Array.from(new Set(logs.map((l) => l.toEmail).filter(Boolean))) as string[];

    const [orders, users] = await Promise.all([
      orderNumbers.length > 0
        ? prisma.order.findMany({
            where: { orderNumber: { in: orderNumbers } },
            select: { orderNumber: true, userId: true, user: { select: { id: true, customerId: true } } },
          })
        : [],
      emails.length > 0
        ? prisma.user.findMany({
            where: { email: { in: emails } },
            select: { id: true, email: true, customerId: true },
          })
        : [],
    ]);

    const orderMap = new Map(orders.map((o) => [o.orderNumber, o]));
    const userMap = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    return logs.map((l) => {
      const ord = l.orderNumber ? orderMap.get(l.orderNumber) : undefined;
      const usr = userMap.get(l.toEmail.toLowerCase());
      const customerId = ord?.user?.customerId || usr?.customerId || null;
      const userId = ord?.userId || usr?.id || null;
      return {
        ...l,
        customerId,
        userId,
      };
    });
  }

  /**
   * Dispatches an outbound Helpdesk Ticket reply from support@ or team@
   * with proper RFC 822 In-Reply-To and References headers to maintain the email thread.
   */
  public async sendTicketReply(params: {
    toEmail: string;
    department: 'SUPPORT' | 'TEAM';
    ticketId: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    inReplyTo?: string;
    references?: string[];
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const tier: EmailTier = params.department === 'TEAM' ? 'TEAM' : 'SUPPORT';
      const config = this.getTierConfig(tier);
      const transporter = this.getTransporter(tier);

      const cleanSubject = params.subject.includes(`[${params.ticketId}]`)
        ? params.subject
        : `[${params.ticketId}] ${params.subject}`;

      const headers: Record<string, string> = {};
      if (params.inReplyTo) {
        headers['In-Reply-To'] = params.inReplyTo;
      }
      if (params.references && params.references.length > 0) {
        headers['References'] = params.references.join(' ');
      }

      const formattedHtml = params.bodyHtml || `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1c1917; max-width: 600px;">
          <div style="white-space: pre-wrap;">${params.bodyText}</div>
          <hr style="border: 0; border-top: 1px solid #e7e5e4; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #78716c; margin: 0;">
            Ticket Reference: <strong>${params.ticketId}</strong> &bull; Techno World Books Helpdesk<br />
            Replies to this email will be automatically appended to your support ticket.
          </p>
        </div>
      `;

      const result = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: params.toEmail,
        subject: cleanSubject,
        text: params.bodyText,
        html: formattedHtml,
        replyTo: config.replyTo,
        headers,
      });

      return { success: true, messageId: result.messageId };
    } catch (err: any) {
      logger.error(`Failed to dispatch ticket reply for ${params.ticketId}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

export const emailService = EmailService.getInstance();
