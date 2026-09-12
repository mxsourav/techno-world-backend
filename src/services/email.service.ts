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
          senderEmail: parsed.senderEmail || parsed.user || env.SMTP_USER || '',
          senderName: parsed.senderName || 'Techno World Books',
          host: parsed.host || env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(parsed.port) || Number(env.SMTP_PORT) || 587,
          user: parsed.user || env.SMTP_USER || '',
          pass: parsed.pass || env.SMTP_PASS || '',
          secure: parsed.secure ?? (Number(parsed.port) === 465),
          resendApiKey: parsed.resendApiKey || '',
          logoUrl: parsed.logoUrl || '',
        };
      }
    } catch (err: any) {
      logger.warn(`Failed to read runtime SMTP settings from DB: ${err.message}`);
    }

    return {
      senderEmail: env.SMTP_USER || '',
      senderName: 'Techno World Books',
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT) || 587,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      secure: Number(env.SMTP_PORT) === 465,
      resendApiKey: '',
      logoUrl: '',
    };
  }

  public generateBrandedHeader(subtitle = 'Official Customer Communications'): string {
    const b64 = getWhiteLogoBase64();
    const logoImg = b64
      ? `<img src="data:image/png;base64,${b64}" alt="Techno World" style="height: 52px; width: 52px; margin-bottom: 10px; display: inline-block; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));" />`
      : '';

    return `
      <div style="background: linear-gradient(135deg, #042419 0%, #064e3b 50%, #047857 100%); padding: 24px 20px; border-radius: 14px; text-align: center; color: #ffffff;">
        ${logoImg}
        <h1 style="margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.3px; color: #ffffff;">Techno World Books</h1>
        <p style="margin: 4px 0 0; font-size: 12px; color: #a7f3d0; font-weight: 500;">${subtitle}</p>
      </div>
    `;
  }

  public generateBrandedFooter(): string {
    return `
      <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 18px; font-size: 12px; color: #64748b; text-align: center; line-height: 1.6;">
        <p style="margin: 0 0 6px; font-weight: 600; color: #334155;">
          Techno World Books &bull; College Street, Kolkata &bull; Delivering Across India
        </p>
        <p style="margin: 0; font-size: 11px;">
          Office: 90/6A, Mahatma Gandhi Rd, College Street, Kolkata, WB 700007<br/>
          Direct Phone: <a href="tel:+917479135626" style="color: #047857; text-decoration: none; font-weight: 600;">+91 747 913 5626</a> &bull; 
          WhatsApp Support: <a href="https://wa.me/917479135626" style="color: #047857; text-decoration: none; font-weight: 600;">Chat on WhatsApp</a>
        </p>
        <p style="margin: 8px 0 0; font-size: 10.5px; color: #94a3b8;">
          You received this email because you placed an order or requested updates on technoworldbooks.com.
        </p>
      </div>
    `;
  }

  public generateBrandedHtml(title: string, message: string, orderNumber?: string, totalAmount?: number): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        ${this.generateBrandedHeader('Official Order Communications')}
        
        <div style="padding: 24px 8px 8px; font-size: 14px; line-height: 1.6;">
          <h2 style="margin-top: 0; font-size: 17px; font-weight: 700; color: #0f172a;">${title}</h2>
          <div style="color: #334155; margin-top: 12px;">
            ${message.replace(/\n/g, '<br/>')}
          </div>

          ${orderNumber ? `
            <div style="margin-top: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Order Reference:</span>
                <span style="font-weight: 700; color: #0f172a;">#${orderNumber}</span>
              </div>
              ${totalAmount !== undefined ? `
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b;">Total Amount:</span>
                  <span style="font-weight: 800; color: #047857;">₹${Number(totalAmount).toFixed(2)}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>

        ${this.generateBrandedFooter()}
      </div>
    `;
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
        <div style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #f8fafc; padding: 10px 14px; font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
            <span>Ordered Item(s)</span>
            <span>Qty &bull; Price</span>
          </div>
          ${items.map((it, idx) => `
            <div style="padding: 12px 14px; border-bottom: ${idx === items.length - 1 ? 'none' : '1px solid #f1f5f9'}; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
              <div>
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.4;">${it.title}</p>
                ${it.sku ? `<p style="margin: 3px 0 0; font-size: 11px; color: #64748b;">SKU / Code: <b>${it.sku}</b></p>` : ''}
              </div>
              <div style="text-align: right; shrink-0; font-size: 12.5px; font-weight: 600; color: #334155; white-space: nowrap;">
                ${it.quantity} &times; ₹${it.price.toFixed(2)}
              </div>
            </div>
          `).join('')}
          
          <div style="background: #fafafa; padding: 12px 14px; border-top: 1px solid #e2e8f0; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #64748b;">
              <span>Subtotal:</span>
              <span>₹${subtotal.toFixed(2)}</span>
            </div>
            ${shippingCharge > 0 ? `
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #64748b;">
                <span>Delivery:</span>
                <span>₹${shippingCharge.toFixed(2)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #047857; font-weight: 600;">
                <span>Delivery:</span>
                <span>FREE</span>
              </div>
            `}
            ${discountAmount > 0 ? `
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #047857; font-weight: 600;">
                <span>Discounts & Rewards:</span>
                <span>-₹${discountAmount.toFixed(2)}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0; font-size: 14px; font-weight: 800; color: #0f172a;">
              <span>Total Paid / Payable:</span>
              <span style="color: #047857;">₹${totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>
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
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            We have received your order <b>#${orderNumber}</b> and it is confirmed. Our team at College Street has initiated procurement and stock verification.
          </p>
          ${paymentMethod ? `<p style="margin: 0 0 8px; font-size: 12.5px; color: #64748b;">Payment Method: <b>${paymentMethod}</b></p>` : ''}
          ${deliveryAddress ? `<p style="margin: 0 0 8px; font-size: 12.5px; color: #64748b;">Shipping to: <b>${deliveryAddress}</b></p>` : ''}
          <p style="margin: 12px 0 0; color: #334155; line-height: 1.6;">
            You will receive another update as soon as your package moves to our packing and dispatch counter.
          </p>
        `;
        actionBadge = `
          <div style="background: #ecfdf5; border-left: 4px solid #059669; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #065f46;">
            <b>Status:</b> Order Confirmed &bull; Preparing for Packing
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nYour order #${orderNumber} has been received and confirmed. Total: ₹${totalAmount.toFixed(2)}.\nOur College Street team is preparing your books.`;
        break;

      case 'PROCESSING':
        subject = `Packing in Progress: Order #${orderNumber} — Techno World Books`;
        headline = `We are packing your books, ${safeName}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Your order <b>#${orderNumber}</b> is currently being packed at our College Street dispatch desk.
          </p>
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Each book is inspected for physical condition and carefully wrapped to protect corners and binding during transit.
          </p>
          <p style="margin: 0; color: #334155; line-height: 1.6;">
            Once handed over for delivery, we will send your consignment tracking number.
          </p>
        `;
        actionBadge = `
          <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #1e40af;">
            <b>Status:</b> Packing & Inspection &bull; Preparing Consignment
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} is now being packed at our dispatch counter.`;
        break;

      case 'SHIPPED':
        subject = `Dispatched: Order #${orderNumber} is on its way! — Techno World Books`;
        headline = `Your books are on the way, ${safeName}!`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Great news! Order <b>#${orderNumber}</b> has been handed over for delivery.
          </p>
          ${trackingNumber ? `
            <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 14px 16px; margin: 16px 0;">
              <span style="font-size: 11px; font-weight: 700; color: #15803d; text-transform: uppercase; letter-spacing: 0.5px;">Consignment Details</span>
              <p style="margin: 4px 0 0; font-size: 16px; font-weight: 800; color: #0f172a; font-family: monospace;">
                Tracking No: ${trackingNumber}
              </p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #334155;">
                Carrier: <b>India Post / Postal Network</b> &bull; Service: <b>${shippingMethod || 'Standard Post'}</b>
              </p>
              <div style="margin-top: 10px;">
                <a href="https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx" target="_blank" style="display: inline-block; background: #047857; color: #ffffff; text-decoration: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700;">
                  Track on India Post Portal &rarr;
                </a>
              </div>
            </div>
          ` : `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin: 14px 0; font-size: 12.5px; color: #475569;">
              Dispatched via postal service. Tracking details will update once scanned by the transit hub.
            </div>
          `}
          ${hasInvoiceAttachment ? `
            <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
              &bull; <i>Official Tax Invoice (PDF) is attached to this email for your records.</i>
            </p>
          ` : ''}
        `;
        actionBadge = `
          <div style="background: #faf5ff; border-left: 4px solid #a855f7; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #6b21a8;">
            <b>Status:</b> Dispatched &bull; In Transit
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been dispatched.${trackingNumber ? ` Tracking Number: ${trackingNumber}` : ''}`;
        break;

      case 'DELIVERED':
        subject = `Delivered: Order #${orderNumber} — Enjoy your reading!`;
        headline = `Package Delivered, ${safeName}!`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Our records indicate that your package for order <b>#${orderNumber}</b> has been delivered. We hope the books reached you in excellent condition!
          </p>

          <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 12px; padding: 16px; margin: 18px 0; text-align: center;">
            <p style="margin: 0 0 6px; font-size: 15px; font-weight: 800; color: #065f46;">
              &starf;&starf;&starf;&starf;&starf; How was your book delivery experience?
            </p>
            <p style="margin: 0 0 12px; font-size: 12px; color: #047857; line-height: 1.5;">
              As an independent academic bookstore, your honest review helps fellow students and readers discover genuine editions.
            </p>
            <a href="https://maps.google.com/?q=Techno+World+Books+College+Street+Kolkata" target="_blank" style="display: inline-block; background: #047857; color: #ffffff; text-decoration: none; padding: 9px 18px; border-radius: 8px; font-size: 12.5px; font-weight: 700;">
              Leave a Google Review &rarr;
            </a>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin: 16px 0;">
            <h4 style="margin: 0 0 6px; font-size: 13px; font-weight: 700; color: #0f172a;">Any concern with your parcel?</h4>
            <p style="margin: 0; font-size: 12px; color: #475569; line-height: 1.5;">
              If any title arrived damaged, missing, or requires assistance, please message our support desk immediately via WhatsApp at <b>+91 747 913 5626</b> with your order reference. We are committed to making it right.
            </p>
          </div>

          ${hasInvoiceAttachment ? `
            <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
              &bull; <i>Final Tax Invoice (PDF) is attached to this email.</i>
            </p>
          ` : ''}
        `;
        actionBadge = `
          <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #166534;">
            <b>Status:</b> Successfully Delivered
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been delivered. If you have any questions or concerns, reach our desk on WhatsApp: +91 747 913 5626.`;
        break;

      case 'CANCELLED':
        subject = `Order Cancellation Notice: #${orderNumber} — Techno World Books`;
        headline = `Notice regarding Order #${orderNumber}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Dear ${safeName}, we are writing to inform you that order <b>#${orderNumber}</b> has been cancelled.
          </p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 14px; margin: 14px 0; font-size: 12.5px; color: #991b1b;">
            <b>Reason:</b> ${cancelReason || 'Fulfillment unavailable from publisher stock at this time.'}
          </div>
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            <b>Refund Policy:</b> If any online payment was deducted, a 100% full refund has been initiated to your original payment method. Depending on your bank or UPI provider, the credited amount reflects in 3–5 business days. Any Techno Points or TechnoWallet balance used has been restored to your account.
          </p>
          <p style="margin: 0; color: #334155; line-height: 1.6;">
            If you have any questions or feel this was in error, please contact our team directly on WhatsApp: <b>+91 747 913 5626</b>.
          </p>
        `;
        actionBadge = `
          <div style="background: #fff1f2; border-left: 4px solid #f43f5e; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #9f1239;">
            <b>Status:</b> Cancelled &bull; Refund Initiated
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} was cancelled. Reason: ${cancelReason || 'Fulfillment unavailable'}. Any deducted payment will be refunded in 3-5 business days.`;
        break;

      default:
        subject = `Order Received: #${orderNumber} (Pending Review) — Techno World Books`;
        headline = `We have received your order, ${safeName}`;
        messageBody = `
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Thank you for shopping with Techno World Books! Your order <b>#${orderNumber}</b> has been received and placed in our verification queue.
          </p>
          <p style="margin: 0 0 12px; color: #334155; line-height: 1.6;">
            Our store managers review edition availability and dispatch schedules before confirming. You will receive an email confirmation as soon as your order is approved.
          </p>
        `;
        actionBadge = `
          <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #92400e;">
            <b>Status:</b> Awaiting Store Confirmation
          </div>
        `;
        plainTextMessage = `Hello ${safeName},\n\nOrder #${orderNumber} has been received and is pending store confirmation.`;
        break;
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        ${this.generateBrandedHeader(`Order #${orderNumber}`)}
        
        <div style="padding: 20px 6px 6px; font-size: 14px;">
          <h2 style="margin: 0 0 10px; font-size: 17px; font-weight: 800; color: #0f172a;">${headline}</h2>
          
          ${actionBadge}
          
          ${messageBody}
          
          ${itemsHtml}
        </div>

        ${this.generateBrandedFooter()}
      </div>
    `;

    return { subject, html, text: plainTextMessage };
  }

  public async sendOrderMergeRefundEmail(params: OrderMergeRefundEmailParams): Promise<any> {
    const subject = params.refundAmount > 0
      ? `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber} – ₹${params.refundAmount.toFixed(2)} Refunded to TechnoWallet`
      : `Order #${params.childOrderNumber} Consolidated with #${params.parentOrderNumber}`;

    const refundBadgeHtml = params.refundAmount > 0
      ? `
        <div style="margin: 20px 0; background: #ecfdf5; border: 2px solid #059669; border-radius: 12px; padding: 18px; text-align: center;">
          <span style="font-size: 12px; font-weight: 800; color: #047857; text-transform: uppercase; letter-spacing: 0.5px;">TechnoWallet Instant Refund</span>
          <div style="font-size: 28px; font-weight: 900; color: #065f46; margin: 6px 0;">+₹${params.refundAmount.toFixed(2)}</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Refund of Delivery Charge for Order #${params.childOrderNumber}</div>
          <div style="font-size: 12px; color: #334155; margin-top: 4px;">Updated TechnoWallet Balance: <b>₹${params.newWalletBalance.toFixed(2)}</b></div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 6px; font-size: 12.5px; font-weight: 800; color: #0f172a;">
            Why Your TechnoWallet Balance is 100% Cash-Equivalent:
          </h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #475569; line-height: 1.6;">
            <li><b>No Expiry Date:</b> Unlike promotional coins, your TechnoWallet balance never expires.</li>
            <li><b>Zero Restrictions:</b> Usable on any academic, medical, engineering, or competitive book.</li>
            <li><b>100% Usable:</b> You can use your entire balance toward any future purchase.</li>
          </ul>
        </div>
      `
      : `
        <div style="margin: 20px 0; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; text-align: center; color: #166534; font-size: 13px; font-weight: 700;">
          Both orders have been combined into a single parcel for united dispatch at zero extra delivery charge.
        </div>
      `;

    const customHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        ${this.generateBrandedHeader('Consolidated Parcel Notice')}
        
        <div style="padding: 20px 6px 6px; font-size: 14px; line-height: 1.6;">
          <h2 style="margin: 0 0 10px; font-size: 17px; font-weight: 800; color: #0f172a;">Dear ${params.customerName || 'Valued Customer'},</h2>
          <p style="color: #334155; margin-top: 6px;">
            Your subsequent order <b>#${params.childOrderNumber}</b> has been combined with your existing order <b>#${params.parentOrderNumber}</b> into a single package for unified dispatch.
          </p>

          ${refundBadgeHtml}

          <div style="margin-top: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 12px; color: #64748b;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Primary Consignment:</span>
              <span style="font-weight: 700; color: #0f172a;">#${params.parentOrderNumber}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Merged Add-on Order:</span>
              <span style="font-weight: 700; color: #0f172a;">#${params.childOrderNumber}</span>
            </div>
          </div>

          ${params.attachments && params.attachments.length > 0 ? `
            <p style="margin: 14px 0 0; font-size: 12px; color: #64748b;">
              &bull; <i>Combined Tax Invoice (PDF) is attached to this email.</i>
            </p>
          ` : ''}
        </div>

        ${this.generateBrandedFooter()}
      </div>
    `;

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
    const html = customHtml || this.generateBrandedHtml(params.subject, params.message, params.orderNumber, params.totalAmount);
    
    const effectiveSenderEmail = config.senderEmail || config.user;
    const sender = effectiveSenderEmail
      ? `"${config.senderName}" <${effectiveSenderEmail}>`
      : `"${config.senderName}" <orders@technoworldbooks.com>`;

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
          subject: params.subject,
          html: html,
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

    // 2. Try Direct SMTP (Gmail / Custom SMTP)
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
          subject: params.subject,
          text: params.message,
          html: html,
          attachments: mailAttachments,
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
          senderEmail: effectiveSenderEmail || 'system@technoworldbooks.com',
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
  }): Promise<{ success: boolean; messageId: string; timestamp: string; status: string; note?: string }> {
    return this.sendOrderNotification({
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      orderNumber: params.orderNumber,
      subject: params.subject,
      message: params.message,
      totalAmount: params.totalAmount,
      attachments: params.attachments,
    });
  }

  public async sendTestEmail(toEmail: string, customConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string; messageId?: string; status: string; isDelivered: boolean; note?: string }> {
    const baseConfig = await this.getEffectiveSmtpConfig();
    const config = { ...baseConfig, ...customConfig };

    const effectiveSenderEmail = config.senderEmail || config.user;
    const subject = '✅ Techno World Books — Email System Connection Test';
    const message = `Hello! This is a verification test from your Techno World Books Admin Panel.\n\nSender: ${effectiveSenderEmail}\nTime: ${new Date().toLocaleString('en-IN')}`;
    const html = this.generateBrandedHtml(subject, message);
    const sender = `"${config.senderName}" <${effectiveSenderEmail || 'test@technoworldbooks.com'}>`;

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

    try {
      await prisma.emailLog.create({
        data: {
          toEmail,
          senderEmail: effectiveSenderEmail || 'system@technoworldbooks.com',
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

    const customHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        ${this.generateBrandedHeader(headerSubtitle)}

        <div style="padding: 24px 8px 8px; font-size: 14px; line-height: 1.6;">
          <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 800; color: #0f172a;">
            Dear ${params.recipientName || 'Valued Customer'},
          </h2>

          ${isSuspended ? `
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 16px 0; color: #991b1b;">
              <p style="margin: 0; font-weight: 700; font-size: 14px;">Account Status: Suspended</p>
              <p style="margin: 6px 0 0; font-size: 13px; color: #b91c1c; line-height: 1.5;">
                Your customer account on Techno World Books has been temporarily suspended by our administration desk.
              </p>
              ${params.reason ? `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #f87171; font-size: 12.5px; color: #7f1d1d;">
                  <strong>Reason recorded:</strong> ${params.reason}
                </div>
              ` : ''}
            </div>

            <p style="color: #475569; font-size: 13px; margin: 14px 0;">
              While suspended, you will not be able to log in or place new book orders. Any existing orders currently in transit will continue to be processed and delivered as scheduled.
            </p>

            <p style="color: #475569; font-size: 13px; margin: 14px 0;">
              If you believe this action was taken in error or if you wish to appeal this review, please get in touch directly with our support helpdesk at College Street, Kolkata.
            </p>
          ` : `
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 16px; margin: 16px 0; color: #065f46;">
              <p style="margin: 0; font-weight: 700; font-size: 14px;">Account Status: Active & In Good Standing</p>
              <p style="margin: 6px 0 0; font-size: 13px; color: #047857; line-height: 1.5;">
                We are pleased to inform you that your customer account on Techno World Books is now active. You may log in anytime to browse our collection, track your dispatches, and enjoy member privileges.
              </p>
            </div>

            <p style="color: #475569; font-size: 13px; margin: 14px 0;">
              Thank you for being part of our reading community!
            </p>
          `}
        </div>

        ${this.generateBrandedFooter()}
      </div>
    `;

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

    const customHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; color: #1e293b;">
        ${this.generateBrandedHeader('TechnoPoints Loyalty Rewards')}

        <div style="padding: 24px 8px 8px; font-size: 14px; line-height: 1.6;">
          <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 800; color: #0f172a;">
            Hello ${params.recipientName || 'Book Lover'},
          </h2>

          <p style="color: #334155; margin-top: 6px;">
            ${isCredit
              ? 'Great news! Bonus TechnoPoints have been credited to your loyalty balance by our team.'
              : 'This is a notification regarding an adjustment to your TechnoPoints loyalty balance.'
            }
          </p>

          <div style="background: ${isCredit ? '#f0fdf4' : '#fffbeb'}; border: 1px solid ${isCredit ? '#bbf7d0' : '#fde68a'}; border-radius: 12px; padding: 18px; margin: 20px 0; text-align: center;">
            <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${isCredit ? '#166534' : '#92400e'};">
              ${isCredit ? 'Points Credited' : 'Points Deducted'}
            </div>
            <div style="font-size: 32px; font-weight: 900; margin: 6px 0; color: ${isCredit ? '#15803d' : '#b45309'};">
              ${isCredit ? `+${params.points}` : `-${params.points}`} <span style="font-size: 18px; font-weight: 600;">pts</span>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: #475569;">
              New Balance: <strong style="color: #0f172a;">${params.newBalance} TechnoPoints</strong>
            </div>

            ${params.reason ? `
              <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed ${isCredit ? '#86efac' : '#fcd34d'}; font-size: 12px; color: #475569;">
                <b>Note:</b> ${params.reason}
              </div>
            ` : ''}
          </div>

          <p style="color: #64748b; font-size: 12.5px; margin: 14px 0;">
            TechnoPoints can be redeemed directly at checkout towards discounts on any academic or literature books across our catalog.
          </p>
        </div>

        ${this.generateBrandedFooter()}
      </div>
    `;

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
