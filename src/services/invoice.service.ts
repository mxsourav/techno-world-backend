import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Seller Details ─────────────────────────────────────────────
const SELLER = {
  name: 'TECHNO WORLD BOOKS',
  tagline: 'Online Academic & Medical Bookstore Division',
  address: '90/6A, Mahatma Gandhi Rd, opp. Grace Cinema,\nCalcutta University, College Street, Kolkata, WB 700007',
  phone: '+91 747 913 5626',
  email: 'support@technoworldbooks.com',
  hsn: '4901',       // HSN code for printed books (GST exempt)
  sacShipping: '9968' // SAC code for postal/courier services
};

// ─── Invoice Number Generator ───────────────────────────────────
export async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `TW-INV-${dateStr}-`;

  // Find highest existing invoice number for today
  const latest = await prisma.order.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true }
  });

  let seq = 1;
  if (latest?.invoiceNumber) {
    const lastSeq = parseInt(latest.invoiceNumber.replace(prefix, ''), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── Assign Invoice Number to Order ─────────────────────────────
export async function assignInvoiceNumber(orderId: string): Promise<string> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
    select: { id: true, invoiceNumber: true }
  });
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.invoiceNumber) return order.invoiceNumber;

  const invoiceNumber = await generateInvoiceNumber();
  await prisma.order.update({
    where: { id: order.id },
    data: { invoiceNumber, invoiceGeneratedAt: new Date() }
  });
  return invoiceNumber;
}

// ─── Helpers ────────────────────────────────────────────────────
function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getShippingLabel(method?: string | null): string {
  switch (method) {
    case 'SPEED_POST': return 'Speed Post (2-4 Business Days)';
    case 'EXPRESS_LOCAL': return 'Express Local Delivery (Same Day)';
    case 'SELF_PICKUP': return 'Store Self-Pickup (College Street)';
    default: return 'Standard Post (5-7 Business Days)';
  }
}

// ─── PDF Generation ─────────────────────────────────────────────
export async function generateInvoicePDF(orderId: string): Promise<Buffer> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
    include: {
      items: {
        include: {
          book: {
            select: {
              id: true, title: true, sku: true, isbn13: true, isbn10: true,
              authors: { select: { name: true } }
            }
          }
        }
      },
      address: true,
      user: { select: { name: true, email: true, phone: true } }
    }
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  // Ensure invoice number is assigned
  const invoiceNumber = order.invoiceNumber || await assignInvoiceNumber(order.id);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - 80; // 40 margin each side
    const leftX = 40;
    const rightX = doc.page.width - 40;
    let y = 40;

    // ─── HEADER ──────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#065f46')
       .text(SELLER.name, leftX, y);
    y += 18;
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
       .text(SELLER.tagline, leftX, y);
    y += 12;
    doc.fontSize(7.5).fillColor('#475569')
       .text(SELLER.address.replace('\n', ', '), leftX, y, { width: 280 });
    y += 20;
    doc.text(`WhatsApp Support: ${SELLER.phone}`, leftX, y);

    // Invoice title (right side)
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
       .text('TAX INVOICE', rightX - 200, 40, { width: 200, align: 'right' });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#047857')
       .text(`${invoiceNumber}`, rightX - 200, 60, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
       .text(`Date: ${formatDate(order.invoiceGeneratedAt || order.createdAt)}`, rightX - 200, 75, { width: 200, align: 'right' });
    doc.text(`Order: #${order.orderNumber}`, rightX - 200, 87, { width: 200, align: 'right' });

    // Payment badge
    const payMethod = (order.paymentMethod || 'PREPAID').toUpperCase();
    const payStatus = order.paymentStatus === 'PAID' ? 'PAID' : order.paymentStatus || 'PENDING';
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#065f46')
       .text(`${payMethod} · ${payStatus}`, rightX - 200, 101, { width: 200, align: 'right' });

    // ─── SEPARATOR ───────────────────────────────────────────
    y += 20;
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 15;

    // ─── CUSTOMER INFO ───────────────────────────────────────
    const isPickup = order.shippingMethod === 'SELF_PICKUP' || order.shippingCarrier === 'STORE_TAKEAWAY';
    const custName = order.pickupName || order.address?.fullName || order.user?.name || 'Valued Customer';
    const custPhone = order.pickupPhone || order.address?.phone || order.user?.phone || 'N/A';
    const custEmail = order.pickupEmail || order.customerEmail || order.address?.email || order.user?.email || 'N/A';

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
       .text('BILL TO:', leftX, y);
    y += 12;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
       .text(custName, leftX, y);
    y += 12;
    doc.fontSize(8).font('Helvetica').fillColor('#475569')
       .text(`Phone: ${custPhone}`, leftX, y);
    y += 11;
    doc.text(`Email: ${custEmail}`, leftX, y);
    y += 11;

    if (isPickup) {
      doc.text(`Pickup: College Street Dispatch Desk`, leftX, y);
      if (order.selectedPickupSlot) {
        y += 11;
        doc.text(`Slot: ${order.selectedPickupSlot}`, leftX, y);
      }
    } else if (order.address) {
      const addr = order.address;
      const addrLine = [addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
      doc.text(`Deliver to: ${addrLine}`, leftX, y, { width: pageW });
    }

    // ─── SEPARATOR ───────────────────────────────────────────
    y += 18;
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 10;

    // ─── ITEMS TABLE ─────────────────────────────────────────
    const colX = {
      num: leftX,
      desc: leftX + 30,
      sku: leftX + 260,
      hsn: leftX + 330,
      qty: leftX + 375,
      rate: leftX + 410,
      total: rightX - 60
    };

    // Table header
    doc.rect(leftX, y, pageW, 18).fill('#f8fafc');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569');
    doc.text('#', colX.num + 4, y + 5);
    doc.text('ITEM DESCRIPTION', colX.desc, y + 5);
    doc.text('SKU', colX.sku, y + 5);
    doc.text('HSN', colX.hsn, y + 5);
    doc.text('QTY', colX.qty, y + 5);
    doc.text('RATE', colX.rate, y + 5);
    doc.text('TOTAL', colX.total, y + 5, { width: 55, align: 'right' });
    y += 20;

    // Table rows
    let itemTotal = 0;
    order.items.forEach((item, idx) => {
      const title = item.book?.title || 'Book';
      const authors = item.book?.authors?.map((a: any) => a.name).join(', ') || '';
      const sku = item.book?.sku || item.book?.isbn13 || '—';
      const qty = item.quantity;
      const rate = item.priceAtPurchase;
      const total = qty * rate;
      itemTotal += total;

      // Check if we need a new page
      if (y > 700) {
        doc.addPage();
        y = 40;
      }

      doc.fontSize(8).font('Helvetica').fillColor('#0f172a');
      doc.text(`${idx + 1}`, colX.num + 4, y + 2);
      doc.font('Helvetica-Bold').text(title, colX.desc, y + 2, { width: 225 });
      const titleH = doc.heightOfString(title, { width: 225 });
      if (authors) {
        doc.fontSize(7).font('Helvetica').fillColor('#64748b')
           .text(authors, colX.desc, y + 2 + titleH, { width: 225 });
      }
      doc.fontSize(7.5).font('Helvetica').fillColor('#475569');
      doc.text(sku, colX.sku, y + 2, { width: 65 });
      doc.text(SELLER.hsn, colX.hsn, y + 2);
      doc.text(`${qty}`, colX.qty, y + 2);
      doc.text(formatINR(rate), colX.rate, y + 2);
      doc.font('Helvetica-Bold').fillColor('#0f172a')
         .text(formatINR(total), colX.total, y + 2, { width: 55, align: 'right' });

      const rowH = Math.max(titleH + (authors ? 10 : 0) + 4, 18);
      y += rowH;

      // Row separator
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += 4;
    });

    // ─── TOTALS ──────────────────────────────────────────────
    y += 10;
    const totalsX = rightX - 200;
    const totalsValX = rightX - 60;

    doc.fontSize(8).font('Helvetica').fillColor('#475569');
    doc.text('Subtotal:', totalsX, y);
    doc.text(formatINR(order.subtotal), totalsValX, y, { width: 55, align: 'right' });
    y += 14;

    const shippingLabel = order.shippingCharge === 0 ? 'FREE' : formatINR(order.shippingCharge);
    doc.text(`Shipping (SAC ${SELLER.sacShipping}):`, totalsX, y);
    doc.font('Helvetica-Bold').fillColor(order.shippingCharge === 0 ? '#047857' : '#475569')
       .text(shippingLabel, totalsValX, y, { width: 55, align: 'right' });
    y += 14;

    if (order.discountAmount && order.discountAmount > 0) {
      doc.font('Helvetica').fillColor('#047857');
      doc.text('Discount:', totalsX, y);
      doc.text(`- ${formatINR(order.discountAmount)}`, totalsValX, y, { width: 55, align: 'right' });
      y += 14;
    }

    // Tax line (books are 0% GST)
    doc.font('Helvetica').fillColor('#475569');
    doc.text(`Tax on Books (HSN ${SELLER.hsn} — 0%):`, totalsX, y);
    doc.text(formatINR(0), totalsValX, y, { width: 55, align: 'right' });
    y += 16;

    // Grand Total
    doc.moveTo(totalsX, y).lineTo(rightX, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    y += 6;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a');
    doc.text('GRAND TOTAL:', totalsX, y);
    doc.text(formatINR(order.totalAmount), totalsValX - 5, y, { width: 60, align: 'right' });
    y += 20;

    // ─── DELIVERY METHOD ─────────────────────────────────────
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
       .text(`Delivery Method: ${getShippingLabel(order.shippingMethod)}`, leftX, y);
    y += 18;

    // ─── FOOTER NOTICE ───────────────────────────────────────
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#cbd5e1').lineWidth(0.5).dash(3, { space: 3 }).stroke();
    doc.undash();
    y += 10;

    doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8')
       .text(
         'Note: Printed books (HSN 4901) are exempt from GST under Indian tax law. ' +
         'This is a computer-generated invoice and does not require a physical signature.',
         leftX, y, { width: pageW, lineGap: 2 }
       );
    y += 22;
    doc.text(
      'Techno World Books Online and the College Street offline retail bookstore operate under the same parent brand ' +
      'trademark, but are managed as independent business entities with distinct inventory and accounting. ' +
      'Offline counter exchanges or retail returns are strictly prohibited.',
      leftX, y, { width: pageW, lineGap: 2 }
    );

    doc.end();
  });
}

// ─── Batch Invoice Generation ───────────────────────────────────
export async function generateBatchInvoices(): Promise<{ generated: number; errors: string[] }> {
  // Find all orders that need invoices:
  // - Status is CONFIRMED, PROCESSING, SHIPPED, or DELIVERED
  // - No invoiceNumber assigned yet
  // - Not CANCELLED / REFUNDED
  const orders = await prisma.order.findMany({
    where: {
      invoiceNumber: null,
      status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
    },
    select: { id: true, orderNumber: true },
    orderBy: { createdAt: 'asc' }
  });

  let generated = 0;
  const errors: string[] = [];

  for (const order of orders) {
    try {
      await assignInvoiceNumber(order.id);
      generated++;
    } catch (err: any) {
      errors.push(`${order.orderNumber}: ${err.message || 'Unknown error'}`);
    }
  }

  return { generated, errors };
}

// ─── Merge Multiple PDFs into One ───────────────────────────────
// pdfkit can't merge existing PDFs, so we generate all invoices sequentially
// into one multi-page document
export async function generateMergedInvoicesPDF(orderIds: string[]): Promise<Buffer> {
  if (orderIds.length === 0) throw new Error('No orders specified');
  if (orderIds.length === 1) return generateInvoicePDF(orderIds[0]);

  // For merged PDFs, we generate each invoice as a separate buffer then concatenate pages
  // Since pdfkit can't merge, we generate all invoices into one doc
  const allOrders = await prisma.order.findMany({
    where: {
      OR: [
        { id: { in: orderIds } },
        { orderNumber: { in: orderIds } }
      ]
    },
    include: {
      items: {
        include: {
          book: {
            select: {
              id: true, title: true, sku: true, isbn13: true, isbn10: true,
              authors: { select: { name: true } }
            }
          }
        }
      },
      address: true,
      user: { select: { name: true, email: true, phone: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  if (allOrders.length === 0) throw new Error('No orders found');

  // Generate individual PDFs and concatenate them
  // Since pdfkit can't merge, we generate them individually for download
  const buffers: Buffer[] = [];
  for (const order of allOrders) {
    const buf = await generateInvoicePDF(order.id);
    buffers.push(buf);
  }

  // For true PDF merging we'd need pdf-lib, but for now return the first order's PDF
  // with a note. In practice, admins will download a zip or iterate.
  // Let's install-free approach: generate all into one doc sequentially
  return generateMultiOrderPDF(allOrders);
}

// Generate a single PDF document containing invoices for multiple orders (one per page)
async function generateMultiOrderPDF(orders: any[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    orders.forEach((order, orderIdx) => {
      if (orderIdx > 0) doc.addPage();

      const pageW = doc.page.width - 80;
      const leftX = 40;
      const rightX = doc.page.width - 40;
      let y = 40;

      const invoiceNumber = order.invoiceNumber || 'PENDING';
      const isPickup = order.shippingMethod === 'SELF_PICKUP' || order.shippingCarrier === 'STORE_TAKEAWAY';
      const custName = order.pickupName || order.address?.fullName || order.user?.name || 'Valued Customer';
      const custPhone = order.pickupPhone || order.address?.phone || order.user?.phone || 'N/A';
      const custEmail = order.pickupEmail || order.customerEmail || order.address?.email || order.user?.email || 'N/A';

      // HEADER
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#065f46')
         .text(SELLER.name, leftX, y);
      y += 16;
      doc.fontSize(7).font('Helvetica').fillColor('#64748b')
         .text(SELLER.tagline, leftX, y);
      y += 10;
      doc.fontSize(7).fillColor('#475569')
         .text(SELLER.address.replace('\n', ', '), leftX, y, { width: 260 });
      y += 18;
      doc.text(`WhatsApp: ${SELLER.phone}`, leftX, y);

      // Invoice title (right)
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#0f172a')
         .text('TAX INVOICE', rightX - 180, 40, { width: 180, align: 'right' });
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#047857')
         .text(invoiceNumber, rightX - 180, 58, { width: 180, align: 'right' });
      doc.fontSize(7).font('Helvetica').fillColor('#64748b')
         .text(`Date: ${formatDate(order.invoiceGeneratedAt || order.createdAt)}`, rightX - 180, 70, { width: 180, align: 'right' });
      doc.text(`Order: #${order.orderNumber}`, rightX - 180, 80, { width: 180, align: 'right' });
      const payMethod = (order.paymentMethod || 'PREPAID').toUpperCase();
      const payStatus = order.paymentStatus === 'PAID' ? 'PAID' : order.paymentStatus || 'PENDING';
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#065f46')
         .text(`${payMethod} · ${payStatus}`, rightX - 180, 92, { width: 180, align: 'right' });

      y += 16;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
      y += 12;

      // CUSTOMER
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e293b').text('BILL TO:', leftX, y);
      y += 10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text(custName, leftX, y);
      y += 11;
      doc.fontSize(7).font('Helvetica').fillColor('#475569')
         .text(`Phone: ${custPhone} | Email: ${custEmail}`, leftX, y);
      y += 10;
      if (isPickup) {
        doc.text('Pickup: College Street Dispatch Desk', leftX, y);
      } else if (order.address) {
        const addr = order.address;
        doc.text([addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', '), leftX, y, { width: pageW });
      }
      y += 14;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += 8;

      // ITEMS TABLE
      const colX = { num: leftX, desc: leftX + 25, sku: leftX + 240, hsn: leftX + 310, qty: leftX + 350, rate: leftX + 385, total: rightX - 55 };
      doc.rect(leftX, y, pageW, 15).fill('#f8fafc');
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#475569');
      doc.text('#', colX.num + 3, y + 4);
      doc.text('DESCRIPTION', colX.desc, y + 4);
      doc.text('SKU', colX.sku, y + 4);
      doc.text('HSN', colX.hsn, y + 4);
      doc.text('QTY', colX.qty, y + 4);
      doc.text('RATE', colX.rate, y + 4);
      doc.text('TOTAL', colX.total, y + 4, { width: 50, align: 'right' });
      y += 17;

      order.items.forEach((item: any, idx: number) => {
        const title = item.book?.title || 'Book';
        const sku = item.book?.sku || item.book?.isbn13 || '—';
        const qty = item.quantity;
        const rate = item.priceAtPurchase;
        const total = qty * rate;

        doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f172a');
        doc.text(`${idx + 1}`, colX.num + 3, y + 2);
        doc.text(title, colX.desc, y + 2, { width: 210 });
        doc.fontSize(6.5).font('Helvetica').fillColor('#475569');
        doc.text(sku, colX.sku, y + 2, { width: 65 });
        doc.text(SELLER.hsn, colX.hsn, y + 2);
        doc.text(`${qty}`, colX.qty, y + 2);
        doc.text(formatINR(rate), colX.rate, y + 2);
        doc.font('Helvetica-Bold').fillColor('#0f172a')
           .text(formatINR(total), colX.total, y + 2, { width: 50, align: 'right' });
        y += 16;
        doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.3).stroke();
        y += 3;
      });

      // TOTALS
      y += 8;
      const tX = rightX - 180;
      const tVX = rightX - 55;
      doc.fontSize(7.5).font('Helvetica').fillColor('#475569');
      doc.text('Subtotal:', tX, y);
      doc.text(formatINR(order.subtotal), tVX, y, { width: 50, align: 'right' });
      y += 12;
      doc.text(`Shipping (SAC ${SELLER.sacShipping}):`, tX, y);
      const shipLabel = order.shippingCharge === 0 ? 'FREE' : formatINR(order.shippingCharge);
      doc.font('Helvetica-Bold').fillColor(order.shippingCharge === 0 ? '#047857' : '#475569')
         .text(shipLabel, tVX, y, { width: 50, align: 'right' });
      y += 12;
      if (order.discountAmount > 0) {
        doc.font('Helvetica').fillColor('#047857');
        doc.text('Discount:', tX, y);
        doc.text(`- ${formatINR(order.discountAmount)}`, tVX, y, { width: 50, align: 'right' });
        y += 12;
      }
      doc.font('Helvetica').fillColor('#475569');
      doc.text(`Tax (HSN ${SELLER.hsn} — 0%):`, tX, y);
      doc.text(formatINR(0), tVX, y, { width: 50, align: 'right' });
      y += 14;
      doc.moveTo(tX, y).lineTo(rightX, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
      y += 5;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text('GRAND TOTAL:', tX, y);
      doc.text(formatINR(order.totalAmount), tVX - 5, y, { width: 55, align: 'right' });
      y += 18;

      // DELIVERY + FOOTER
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += 8;
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e293b')
         .text(`Delivery: ${getShippingLabel(order.shippingMethod)}`, leftX, y);
      y += 14;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#cbd5e1').lineWidth(0.5).dash(3, { space: 3 }).stroke();
      doc.undash();
      y += 8;
      doc.fontSize(6).font('Helvetica').fillColor('#94a3b8')
         .text(
           'Printed books (HSN 4901) are exempt from GST under Indian tax law. Computer-generated invoice — no physical signature required. ' +
           'Techno World Books Online and College Street offline retail bookstore are independent entities with distinct inventory and accounting.',
           leftX, y, { width: pageW, lineGap: 1.5 }
         );
    });

    doc.end();
  });
}
