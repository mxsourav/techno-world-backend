import PDFDocument from 'pdfkit';
import { prisma } from '../config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getBlackLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../assets/techno_world_black.png'),
    path.resolve(__dirname, '../../src/assets/techno_world_black.png'),
    path.resolve(process.cwd(), 'src/assets/techno_world_black.png'),
    path.resolve(process.cwd(), 'dist/assets/techno_world_black.png'),
    path.resolve(process.cwd(), 'assets/techno_world_black.png'),
    path.resolve(process.cwd(), '../app/public/techno_world_black.png'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

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
// Uses clean 'Rs. ' prefix instead of raw '₹' to prevent PDFKit WinAnsiEncoding glitches (which renders '¹')
function formatINR(amount: number): string {
  const val = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  return 'Rs. ' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanPdfText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/₹/g, 'Rs. ')
    .replace(/[•·]/g, '|')
    .replace(/[—–]/g, '-')
    .replace(/[^\x00-\x7F]/g, '');
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

// ─── Render Clean Multipage Invoice Sheet ───────────────────────
function renderInvoiceSheet(doc: PDFKit.PDFDocument, invoiceData: {
  invoiceNumber: string;
  isConsolidated: boolean;
  orderNumbers: string[];
  createdAt: Date | string;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  isPickup: boolean;
  pickupSlot?: string | null;
  deliveryAddress?: string;
  items: Array<{
    title: string;
    authors?: string;
    sku: string;
    quantity: number;
    priceAtPurchase: number;
    weightGrams?: number;
    orderNumber?: string;
  }>;
  subtotal: number;
  shippingCharge: number;
  discountAmount: number;
  totalAmount: number;
  shippingMethod: string;
}) {
  const pageW = doc.page.width - 80; // 40 margin each side
  const leftX = 40;
  const rightX = doc.page.width - 40;
  let y = 40;

  // ─── HEADER ──────────────────────────────────────────────
  const blackLogo = getBlackLogoPath();
  if (blackLogo) {
    try {
      doc.image(blackLogo, leftX, y, { width: 140 });
      y += 34;
    } catch {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(SELLER.name, leftX, y);
      y += 18;
    }
  } else {
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(SELLER.name, leftX, y);
    y += 18;
  }
  doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(SELLER.tagline, leftX, y);
  y += 12;
  doc.fontSize(7.5).fillColor('#475569').text(SELLER.address.replace('\n', ', '), leftX, y, { width: 280 });
  y += 18;
  doc.text(`WhatsApp Support: ${SELLER.phone}`, leftX, y);

  // Invoice title (right side)
  const titleText = invoiceData.isConsolidated ? 'CONSOLIDATED TAX INVOICE' : 'TAX INVOICE';
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#0f172a')
     .text(titleText, rightX - 220, 40, { width: 220, align: 'right' });
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#047857')
     .text(`${cleanPdfText(invoiceData.invoiceNumber)}`, rightX - 220, 58, { width: 220, align: 'right' });
  doc.fontSize(8).font('Helvetica').fillColor('#64748b')
     .text(`Date: ${formatDate(invoiceData.createdAt)}`, rightX - 220, 73, { width: 220, align: 'right' });

  const orderDisplay = invoiceData.orderNumbers.length > 1
    ? `Orders (${invoiceData.orderNumbers.length}): #${invoiceData.orderNumbers[0]} +${invoiceData.orderNumbers.length - 1} more`
    : `Order: #${invoiceData.orderNumbers[0] || 'N/A'}`;
  doc.text(cleanPdfText(orderDisplay), rightX - 240, 85, { width: 240, align: 'right' });

  // Payment badge - clean ASCII without middle dot which glitched as small 1
  const payMethod = (invoiceData.paymentMethod || 'PREPAID').toUpperCase();
  const payStatus = invoiceData.paymentStatus === 'PAID' ? 'PAID' : invoiceData.paymentStatus || 'PENDING';
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#065f46')
     .text(`${payMethod} | ${payStatus}`, rightX - 220, 98, { width: 220, align: 'right' });

  // ─── SEPARATOR ───────────────────────────────────────────
  y += 20;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  y += 14;

  // ─── CUSTOMER INFO ───────────────────────────────────────
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b').text('BILL TO:', leftX, y);
  y += 12;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(cleanPdfText(invoiceData.customerName), leftX, y);
  y += 12;
  doc.fontSize(8).font('Helvetica').fillColor('#475569')
     .text(`Phone: ${cleanPdfText(invoiceData.customerPhone)} | Email: ${cleanPdfText(invoiceData.customerEmail)}`, leftX, y);
  y += 11;

  if (invoiceData.isPickup) {
    doc.text(`Pickup: College Street Dispatch Desk`, leftX, y);
    if (invoiceData.pickupSlot) {
      y += 11;
      doc.text(`Slot: ${cleanPdfText(invoiceData.pickupSlot)}`, leftX, y);
    }
  } else if (invoiceData.deliveryAddress) {
    doc.text(`Deliver to: ${cleanPdfText(invoiceData.deliveryAddress)}`, leftX, y, { width: pageW });
  }

  // ─── SEPARATOR ───────────────────────────────────────────
  y += 16;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  y += 10;

  // ─── ITEMS TABLE ─────────────────────────────────────────
  const colX = {
    num: leftX,
    desc: leftX + 24,
    sku: leftX + 245,
    hsn: leftX + 315,
    qty: leftX + 355,
    rate: leftX + 390,
    total: rightX - 65
  };

  const drawTableHeader = (atY: number) => {
    doc.rect(leftX, atY, pageW, 16).fill('#f8fafc');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569');
    doc.text('#', colX.num + 3, atY + 4);
    doc.text('DESCRIPTION', colX.desc, atY + 4);
    doc.text('SKU', colX.sku, atY + 4);
    doc.text('HSN', colX.hsn, atY + 4);
    doc.text('QTY', colX.qty, atY + 4);
    doc.text('RATE', colX.rate, atY + 4);
    doc.text('TOTAL', colX.total, atY + 4, { width: 60, align: 'right' });
    return atY + 18;
  };

  y = drawTableHeader(y);

  let totalConsignmentWeightGrams = 0;

  invoiceData.items.forEach((item, idx) => {
    const title = cleanPdfText(item.title || 'Book');
    const authors = cleanPdfText(item.authors || '');
    const sku = cleanPdfText(item.sku || '-');
    const qty = item.quantity || 1;
    const rate = item.priceAtPurchase || 0;
    const total = qty * rate;
    const unitWeightGrams = item.weightGrams || 450;
    totalConsignmentWeightGrams += unitWeightGrams * qty;

    // Check if we need to paginate to a new page
    if (y > 690) {
      doc.addPage({ size: 'A4', margin: 40 });
      y = 40;
      y = drawTableHeader(y);
    }

    doc.fontSize(7.5).font('Helvetica').fillColor('#0f172a');
    doc.text(`${idx + 1}`, colX.num + 3, y + 2);
    doc.font('Helvetica-Bold').text(title, colX.desc, y + 2, { width: 215 });
    const titleH = doc.heightOfString(title, { width: 215 });

    if (authors) {
      doc.fontSize(6.5).font('Helvetica').fillColor('#64748b')
         .text(authors, colX.desc, y + 2 + titleH, { width: 215 });
    }

    doc.fontSize(7).font('Helvetica').fillColor('#475569');
    doc.text(sku, colX.sku, y + 2, { width: 65 });
    doc.text(SELLER.hsn, colX.hsn, y + 2);
    doc.text(`${qty}`, colX.qty, y + 2);
    doc.text(formatINR(rate), colX.rate, y + 2);
    doc.font('Helvetica-Bold').fillColor('#0f172a')
       .text(formatINR(total), colX.total, y + 2, { width: 60, align: 'right' });

    const rowH = Math.max(titleH + (authors ? 9 : 0) + 4, 17);
    y += rowH;

    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
    y += 3;
  });

  // Check if totals fit on this page
  if (y > 640) {
    doc.addPage({ size: 'A4', margin: 40 });
    y = 40;
  }

  // ─── TOTALS ──────────────────────────────────────────────
  y += 10;
  const totalsX = rightX - 220;
  const totalsValX = rightX - 65;

  doc.fontSize(8).font('Helvetica').fillColor('#475569');
  doc.text('Subtotal:', totalsX, y);
  doc.text(formatINR(invoiceData.subtotal), totalsValX, y, { width: 65, align: 'right' });
  y += 14;

  const shipLabel = invoiceData.shippingCharge === 0 ? 'FREE' : formatINR(invoiceData.shippingCharge);
  doc.text(`Shipping (SAC ${SELLER.sacShipping}):`, totalsX, y);
  doc.font('Helvetica-Bold').fillColor(invoiceData.shippingCharge === 0 ? '#047857' : '#475569')
     .text(shipLabel, totalsValX, y, { width: 65, align: 'right' });
  y += 14;

  if (invoiceData.discountAmount > 0) {
    doc.font('Helvetica').fillColor('#047857');
    doc.text('Discount:', totalsX, y);
    doc.text(`- ${formatINR(invoiceData.discountAmount)}`, totalsValX, y, { width: 65, align: 'right' });
    y += 14;
  }

  doc.font('Helvetica').fillColor('#475569');
  doc.text(`Tax on Books (HSN ${SELLER.hsn} - 0%):`, totalsX, y);
  doc.text('Rs. 0.00', totalsValX, y, { width: 65, align: 'right' });
  y += 16;

  // Grand Total
  doc.moveTo(totalsX, y).lineTo(rightX, y).strokeColor('#cbd5e1').lineWidth(1).stroke();
  y += 6;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text('GRAND TOTAL:', totalsX, y);
  doc.text(formatINR(invoiceData.totalAmount), totalsValX - 5, y, { width: 70, align: 'right' });
  y += 20;

  // ─── DELIVERY METHOD & WEIGHT ────────────────────────────
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  y += 10;
  const totalWeightKg = (totalConsignmentWeightGrams / 1000).toFixed(2);
  const totalWeightStr = `${totalWeightKg} kg (${totalConsignmentWeightGrams}g)`;

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
     .text(`Delivery Method: ${getShippingLabel(invoiceData.shippingMethod)}  |  Total Parcel Weight: ${totalWeightStr}`, leftX, y);
  y += 14;

  if (invoiceData.orderNumbers.length > 1) {
    doc.fontSize(7).font('Helvetica').fillColor('#4338ca')
       .text(`Consolidated Consignment Package for ${invoiceData.orderNumbers.length} merged orders: ${invoiceData.orderNumbers.map(n => '#' + n).join(', ')}`, leftX, y, { width: pageW });
    y += 14;
  }

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
  y += 20;
  doc.text(
    'Techno World Books Online and the College Street offline retail bookstore operate under the same parent brand ' +
    'trademark, but are managed as independent business entities with distinct inventory and accounting. ' +
    'Offline counter exchanges or retail returns are strictly prohibited.',
    leftX, y, { width: pageW, lineGap: 2 }
  );
}

// ─── Generate Invoice for a Single Order (With Child Orders Merged) ──
export async function generateInvoicePDF(orderId: string): Promise<Buffer> {
  const initialOrder = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
    select: { id: true, parentOrderId: true }
  });

  if (!initialOrder) throw new Error(`Order ${orderId} not found`);

  // If this order is a child of a merged parcel, find the parent order so the entire consignment is billed together
  const targetParentId = initialOrder.parentOrderId || initialOrder.id;

  const order = await prisma.order.findFirst({
    where: { id: targetParentId },
    include: {
      items: {
        include: {
          book: {
            select: {
              id: true, title: true, sku: true, isbn13: true, isbn10: true, weight: true, pages: true,
              authors: { select: { name: true } }
            }
          }
        }
      },
      childOrders: {
        include: {
          items: {
            include: {
              book: {
                select: {
                  id: true, title: true, sku: true, isbn13: true, isbn10: true, weight: true, pages: true,
                  authors: { select: { name: true } }
                }
              }
            }
          }
        }
      },
      address: true,
      user: { select: { name: true, email: true, phone: true } }
    }
  });

  if (!order) throw new Error(`Order ${targetParentId} not found`);

  // Ensure invoice number is assigned
  const invoiceNumber = order.invoiceNumber || await assignInvoiceNumber(order.id);

  // Gather ALL items (parent order + any merged child orders) without duplicates
  const allRawItems: any[] = [];
  const allOrderNumbers: string[] = [order.orderNumber];
  const seenItemKeys = new Set<string>();

  if (Array.isArray(order.items)) {
    order.items.forEach((it: any) => {
      const itemKey = `${order.id}_${it.id || it.bookId || ''}`;
      if (!seenItemKeys.has(itemKey)) {
        seenItemKeys.add(itemKey);
        allRawItems.push({ ...it, sourceOrderNumber: order.orderNumber });
      }
    });
  }

  if (Array.isArray(order.childOrders) && order.childOrders.length > 0) {
    for (const child of order.childOrders) {
      if (child.orderNumber && !allOrderNumbers.includes(child.orderNumber)) {
        allOrderNumbers.push(child.orderNumber);
      }
      if (Array.isArray(child.items)) {
        child.items.forEach((it: any) => {
          const itemKey = `${child.id}_${it.id || it.bookId || ''}`;
          if (!seenItemKeys.has(itemKey)) {
            seenItemKeys.add(itemKey);
            allRawItems.push({ ...it, sourceOrderNumber: child.orderNumber });
          }
        });
      }
    }
  }

  const items = allRawItems.map((item: any) => {
    const bk = item.book || {};
    let unitWeightGrams = 450;
    if (bk.weight && typeof bk.weight === 'number' && bk.weight > 0) {
      unitWeightGrams = bk.weight < 10 ? Math.round(bk.weight * 1000) : Math.round(bk.weight);
    } else if (bk.pages && typeof bk.pages === 'number' && bk.pages > 0) {
      unitWeightGrams = Math.round(bk.pages * 1.25 + 50);
    }

    return {
      title: cleanPdfText(bk.title || 'Book'),
      authors: cleanPdfText(bk.authors?.map((a: any) => a.name).join(', ') || ''),
      sku: cleanPdfText(bk.sku || bk.isbn13 || bk.isbn10 || '-'),
      quantity: item.quantity || 1,
      priceAtPurchase: item.priceAtPurchase || 0,
      weightGrams: unitWeightGrams,
      orderNumber: item.sourceOrderNumber,
    };
  });

  // Calculate consolidated subtotal across all items
  const subtotal = items.reduce((sum, it) => sum + (it.priceAtPurchase * it.quantity), 0);
  const shippingCharge = order.shippingCharge || 0;
  const discountAmount = order.discountAmount || 0;
  const totalAmount = Math.max(0, subtotal + shippingCharge - discountAmount);

  const isPickup = order.shippingMethod === 'SELF_PICKUP' || order.shippingCarrier === 'STORE_TAKEAWAY';
  const custName = cleanPdfText(order.pickupName || order.address?.fullName || order.user?.name || 'Valued Customer');
  const custPhone = cleanPdfText(order.pickupPhone || order.address?.phone || order.user?.phone || 'N/A');
  const custEmail = cleanPdfText(order.pickupEmail || order.customerEmail || order.address?.email || order.user?.email || 'N/A');

  let deliveryAddress = '';
  if (order.address) {
    const addr = order.address;
    deliveryAddress = cleanPdfText([addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', '));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderInvoiceSheet(doc, {
      invoiceNumber,
      isConsolidated: allOrderNumbers.length > 1,
      orderNumbers: allOrderNumbers,
      createdAt: order.invoiceGeneratedAt || order.createdAt,
      paymentMethod: order.paymentMethod || 'PREPAID',
      paymentStatus: order.paymentStatus || 'PAID',
      customerName: custName,
      customerPhone: custPhone,
      customerEmail: custEmail,
      isPickup,
      pickupSlot: order.selectedPickupSlot,
      deliveryAddress,
      items,
      subtotal,
      shippingCharge,
      discountAmount,
      totalAmount,
      shippingMethod: order.shippingMethod || 'NORMAL_POST',
    });

    doc.end();
  });
}

// ─── Batch Invoice Generation ───────────────────────────────────
export async function generateBatchInvoices(): Promise<{ generated: number; errors: string[] }> {
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

// ─── Merge Multiple Orders into Consolidated Invoice ─────────────
export async function generateMergedInvoicesPDF(orderIds: string[]): Promise<Buffer> {
  if (orderIds.length === 0) throw new Error('No orders specified');
  if (orderIds.length === 1) return generateInvoicePDF(orderIds[0]);

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
              id: true, title: true, sku: true, isbn13: true, isbn10: true, weight: true, pages: true,
              authors: { select: { name: true } }
            }
          }
        }
      },
      childOrders: {
        include: {
          items: {
            include: {
              book: {
                select: {
                  id: true, title: true, sku: true, isbn13: true, isbn10: true, weight: true, pages: true,
                  authors: { select: { name: true } }
                }
              }
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

  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── CONSOLIDATED INVOICE FOR THIS PARCEL BUNDLE ──────────────
    // Combine ALL books from ALL merged orders into ONE comprehensive bill
    const primaryOrder = allOrders[0];
    const invoiceNumber = primaryOrder.invoiceNumber || await assignInvoiceNumber(primaryOrder.id);

    const allRawItems: any[] = [];
    const allOrderNumbers: string[] = [];
    const seenItemKeys = new Set<string>();

    allOrders.forEach(ord => {
      if (ord.orderNumber && !allOrderNumbers.includes(ord.orderNumber)) {
        allOrderNumbers.push(ord.orderNumber);
      }
      if (Array.isArray(ord.items)) {
        ord.items.forEach((it: any) => {
          const itemKey = `${ord.id}_${it.id || it.bookId || ''}`;
          if (!seenItemKeys.has(itemKey)) {
            seenItemKeys.add(itemKey);
            allRawItems.push({ ...it, sourceOrderNumber: ord.orderNumber });
          }
        });
      }
      if (Array.isArray(ord.childOrders)) {
        ord.childOrders.forEach((child: any) => {
          if (child.orderNumber && !allOrderNumbers.includes(child.orderNumber)) {
            allOrderNumbers.push(child.orderNumber);
          }
          if (Array.isArray(child.items)) {
            child.items.forEach((it: any) => {
              const itemKey = `${child.id}_${it.id || it.bookId || ''}`;
              if (!seenItemKeys.has(itemKey)) {
                seenItemKeys.add(itemKey);
                allRawItems.push({ ...it, sourceOrderNumber: child.orderNumber });
              }
            });
          }
        });
      }
    });

    const items = allRawItems.map((item: any) => {
      const bk = item.book || {};
      let unitWeightGrams = 450;
      if (bk.weight && typeof bk.weight === 'number' && bk.weight > 0) {
        unitWeightGrams = bk.weight < 10 ? Math.round(bk.weight * 1000) : Math.round(bk.weight);
      } else if (bk.pages && typeof bk.pages === 'number' && bk.pages > 0) {
        unitWeightGrams = Math.round(bk.pages * 1.25 + 50);
      }

      return {
        title: cleanPdfText(bk.title || 'Book'),
        authors: cleanPdfText(bk.authors?.map((a: any) => a.name).join(', ') || ''),
        sku: cleanPdfText(bk.sku || bk.isbn13 || bk.isbn10 || '-'),
        quantity: item.quantity || 1,
        priceAtPurchase: item.priceAtPurchase || 0,
        weightGrams: unitWeightGrams,
        orderNumber: item.sourceOrderNumber,
      };
    });

    const subtotal = items.reduce((sum, it) => sum + (it.priceAtPurchase * it.quantity), 0);
    const shippingCharge = allOrders.reduce((sum, o) => sum + (o.shippingCharge || 0), 0);
    const discountAmount = allOrders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
    const totalAmount = Math.max(0, subtotal + shippingCharge - discountAmount);

    // Determine highest shipping method
    let highestMethod = primaryOrder.shippingMethod || 'NORMAL_POST';
    if (allOrders.some(o => o.shippingMethod === 'EXPRESS_LOCAL')) highestMethod = 'EXPRESS_LOCAL';
    else if (allOrders.some(o => o.shippingMethod === 'SPEED_POST')) highestMethod = 'SPEED_POST';

    const isPickup = allOrders.some(o => o.shippingMethod === 'SELF_PICKUP' || o.shippingCarrier === 'STORE_TAKEAWAY');
    const custName = cleanPdfText(primaryOrder.pickupName || primaryOrder.address?.fullName || primaryOrder.user?.name || 'Valued Customer');
    const custPhone = cleanPdfText(primaryOrder.pickupPhone || primaryOrder.address?.phone || primaryOrder.user?.phone || 'N/A');
    const custEmail = cleanPdfText(primaryOrder.pickupEmail || primaryOrder.customerEmail || primaryOrder.address?.email || primaryOrder.user?.email || 'N/A');

    let deliveryAddress = '';
    if (primaryOrder.address) {
      const addr = primaryOrder.address;
      deliveryAddress = cleanPdfText([addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', '));
    }

    renderInvoiceSheet(doc, {
      invoiceNumber,
      isConsolidated: true,
      orderNumbers: allOrderNumbers,
      createdAt: primaryOrder.invoiceGeneratedAt || primaryOrder.createdAt,
      paymentMethod: primaryOrder.paymentMethod || 'PREPAID',
      paymentStatus: primaryOrder.paymentStatus || 'PAID',
      customerName: custName,
      customerPhone: custPhone,
      customerEmail: custEmail,
      isPickup,
      pickupSlot: primaryOrder.selectedPickupSlot,
      deliveryAddress,
      items,
      subtotal,
      shippingCharge,
      discountAmount,
      totalAmount,
      shippingMethod: highestMethod,
    });

    doc.end();
  });
}
