import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  generateInvoicePDF,
  assignInvoiceNumber,
  generateBatchInvoices,
  generateMergedInvoicesPDF
} from '../services/invoice.service.js';

const prisma = new PrismaClient();

// ─── Customer: Download own invoice ──────────────────────────────
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { orderId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // Verify the order belongs to this user
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, orderNumber: true, invoiceNumber: true, status: true }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    // Don't generate invoices for PENDING or CANCELLED orders
    if (order.status === 'PENDING' || order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      res.status(400).json({ success: false, message: 'Invoice not available for this order status' });
      return;
    }

    // Assign invoice number if not yet assigned
    if (!order.invoiceNumber) {
      await assignInvoiceNumber(order.id);
    }

    const pdfBuffer = await generateInvoicePDF(order.id);
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id }, select: { invoiceNumber: true } });
    const filename = `Invoice-${updatedOrder?.invoiceNumber || order.orderNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[DOWNLOAD_INVOICE_ERROR]', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to generate invoice' });
  }
};

// ─── Admin: Download any order's invoice ─────────────────────────
export const adminDownloadInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, invoiceNumber: true }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    // Assign invoice number if not yet assigned
    if (!order.invoiceNumber) {
      await assignInvoiceNumber(order.id);
    }

    const pdfBuffer = await generateInvoicePDF(order.id);
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id }, select: { invoiceNumber: true } });
    const filename = `Invoice-${updatedOrder?.invoiceNumber || order.orderNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[ADMIN_DOWNLOAD_INVOICE_ERROR]', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to generate invoice' });
  }
};

// ─── Admin: Manually generate invoice for one order ──────────────
export const adminGenerateInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, invoiceNumber: true }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (order.invoiceNumber) {
      res.status(200).json({
        success: true,
        message: 'Invoice already exists',
        invoiceNumber: order.invoiceNumber
      });
      return;
    }

    const invoiceNumber = await assignInvoiceNumber(order.id);
    res.status(200).json({
      success: true,
      message: 'Invoice generated successfully',
      invoiceNumber
    });
  } catch (error: any) {
    console.error('[ADMIN_GENERATE_INVOICE_ERROR]', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to generate invoice' });
  }
};

// ─── Admin: Batch generate invoices ──────────────────────────────
export const adminBatchGenerate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await generateBatchInvoices();
    res.status(200).json({
      success: true,
      message: `Generated ${result.generated} invoice(s)`,
      generated: result.generated,
      errors: result.errors
    });
  } catch (error: any) {
    console.error('[ADMIN_BATCH_GENERATE_ERROR]', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to batch generate invoices' });
  }
};

// ─── Admin: Download merged PDF for multiple orders ──────────────
export const adminBatchDownload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, message: 'orderIds array required' });
      return;
    }

    // Ensure all have invoice numbers
    for (const oid of orderIds) {
      const o = await prisma.order.findUnique({ where: { id: oid }, select: { invoiceNumber: true } });
      if (o && !o.invoiceNumber) {
        await assignInvoiceNumber(oid);
      }
    }

    const pdfBuffer = await generateMergedInvoicesPDF(orderIds);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Invoices-Batch-${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[ADMIN_BATCH_DOWNLOAD_ERROR]', error.message || error);
    res.status(500).json({ success: false, message: 'Failed to generate batch invoices' });
  }
};
