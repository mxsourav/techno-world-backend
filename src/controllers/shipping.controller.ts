import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { indiaPostService } from '../services/indiapost.service.js';
import { emailService } from '../services/email.service.js';
import { generateInvoicePDF, assignInvoiceNumber } from '../services/invoice.service.js';
import {
  indiaPostTariffRequestSchema,
  indiaPostArticleSchema,
} from '../schemas/indiapost.schema.js';
import { logger } from '../config/logger.js';


/**
 * Pincode Master Search
 * GET /api/v1/shipping/pincode/:pincode
 */
export const searchPincode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { pincode } = req.params;
    const offices = await indiaPostService.searchPincode(pincode);
    if (!offices || offices.length === 0) {
      res.status(404).json({
        success: false,
        message: `Invalid or non-existent Indian postal PIN code: ${pincode}`,
      });
      return;
    }
    res.json({
      success: true,
      count: offices.length,
      data: offices,
    });
  } catch (error: any) {
    logger.warn('Pincode search error: ' + error.message);
    res.status(400).json({ success: false, message: error.message || 'Invalid pincode lookup' });
  }
};

/**
 * Tariff Calculation
 * POST /api/v1/shipping/tariff
 */
export const calculateTariff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tariff = await indiaPostService.calculateTariff(req.body);
    res.json({
      success: true,
      data: tariff,
    });
  } catch (error: any) {
    logger.warn('Tariff calculation error: ' + error.message);
    res.status(400).json({ success: false, message: error.message || 'Tariff calculation failed' });
  }
};

/**
 * Book Order Consignment with India Post (Admin only)
 * POST /api/v1/shipping/book/:orderId
 */
export const bookOrderShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { serviceType, weightGrams, length, width, height, isCOD } = req.body;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
      include: {
        address: true,
        user: true,
        items: {
          include: { book: true },
        },
      },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (!order.address) {
      res.status(400).json({ success: false, message: 'Order has no valid shipping address associated' });
      return;
    }

    const { deliveryPartner, agentPhone, bundledOrderIds } = req.body;
    const allIds = [order.id, ...(Array.isArray(bundledOrderIds) ? bundledOrderIds.filter((id: string) => id !== order.id) : [])];

    let orderShippingMethod = serviceType || order.shippingMethod || 'SPEED_POST';
    if (!serviceType && Array.isArray(bundledOrderIds) && bundledOrderIds.length > 0) {
      const allBundledOrders = await prisma.order.findMany({
        where: { id: { in: allIds } },
        select: { shippingMethod: true },
      });
      if (allBundledOrders.some(o => o.shippingMethod === 'EXPRESS_LOCAL')) {
        orderShippingMethod = 'EXPRESS_LOCAL';
      } else if (allBundledOrders.some(o => o.shippingMethod === 'SPEED_POST')) {
        orderShippingMethod = 'SPEED_POST';
      }
    }

async function sendDispatchEmail(orderId: string, trackingNumber?: string | null, carrier?: string | null, method?: string | null) {
  try {
    const fullOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        address: true,
        user: true,
        items: { include: { book: true } },
      },
    });

    if (!fullOrder) return;

    // Use actual customer email from address, ignoring dummy @mail.com
    const recipientEmail = (fullOrder.address?.email && !fullOrder.address.email.includes('@mail.com') && !fullOrder.address.email.includes('@example.com'))
      ? fullOrder.address.email
      : (fullOrder.user?.email && !fullOrder.user.email.includes('@mail.com') && !fullOrder.user.email.includes('@example.com'))
      ? fullOrder.user.email
      : null;

    const recipientName = fullOrder.address?.fullName || fullOrder.user?.name || 'Valued Customer';

    if (recipientEmail && recipientEmail.includes('@')) {
      let invoiceAttachment: any = undefined;
      try {
        const invNum = fullOrder.invoiceNumber || await assignInvoiceNumber(fullOrder.id);
        const pdfBuffer = await generateInvoicePDF(fullOrder.id);
        if (pdfBuffer && pdfBuffer.length > 0) {
          invoiceAttachment = [{
            filename: `Tax-Invoice-${invNum || fullOrder.orderNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }];
        }
      } catch (invErr: any) {
        logger.warn(`[SHIP_INVOICE_WARN] Could not generate invoice for #${fullOrder.orderNumber}: ${invErr.message}`);
      }

      const addrStr = fullOrder.address
        ? `${fullOrder.address.addressLine1}${fullOrder.address.city ? `, ${fullOrder.address.city}` : ''}${fullOrder.address.pincode ? ` - ${fullOrder.address.pincode}` : ''}`
        : null;

      const itemsSummary = (fullOrder.items || []).map((it: any) => ({
        title: it.book?.title || 'Academic Book',
        quantity: it.quantity,
        price: Number(it.priceAtPurchase),
        sku: it.book?.sku || it.book?.bookCode || undefined,
      }));

      const emailContent = emailService.generateLifecycleEmailHtml({
        status: 'SHIPPED',
        orderNumber: fullOrder.orderNumber,
        customerName: recipientName,
        items: itemsSummary,
        totalAmount: Number(fullOrder.totalAmount),
        subtotal: Number(fullOrder.subtotal),
        shippingCharge: Number(fullOrder.shippingCharge),
        discountAmount: Number(fullOrder.discountAmount),
        trackingNumber: trackingNumber || fullOrder.trackingNumber,
        shippingCarrier: carrier || fullOrder.shippingCarrier,
        shippingMethod: method || fullOrder.shippingMethod,
        deliveryAddress: addrStr,
        paymentMethod: fullOrder.paymentMethod,
        hasInvoiceAttachment: Boolean(invoiceAttachment),
      });

      await emailService.sendOrderNotification({
        recipientEmail,
        recipientName,
        orderNumber: fullOrder.orderNumber,
        subject: emailContent.subject,
        message: emailContent.text,
        attachments: invoiceAttachment,
      }, emailContent.html);

      logger.info(`[SHIP_EMAIL_SENT] Automated dispatch email sent for #${fullOrder.orderNumber} to ${recipientEmail}`);
    }

    // In-app customer notification
    if (fullOrder.userId) {
      await prisma.notification.create({
        data: {
          userId: fullOrder.userId,
          title: `🚚 Dispatched: #${fullOrder.orderNumber}`,
          message: `Order #${fullOrder.orderNumber} has been dispatched via ${carrier || 'India Post'}.${trackingNumber ? ` Tracking No: ${trackingNumber}` : ''}`,
          type: 'order_shipped',
          link: '/profile?tab=orders',
        },
      }).catch(() => {});
    }
  } catch (err: any) {
    logger.warn(`[SHIP_EMAIL_ERR] Failed to send dispatch email for ${orderId}: ${err.message}`);
  }
}

    // ── EXPRESS_LOCAL: Manual local courier (Porter/Rapido) — no India Post API ──
    if (orderShippingMethod === 'EXPRESS_LOCAL') {
      await prisma.order.updateMany({
        where: { id: { in: allIds } },
        data: {
          shippingCarrier: deliveryPartner || 'Local Courier',
          shippingMethod: 'EXPRESS_LOCAL',
          status: 'SHIPPED',
          notes: (order.notes ? order.notes + ' | ' : '') +
            `Express Local dispatch via ${deliveryPartner || 'Local Courier'}${agentPhone ? ` (${agentPhone})` : ''} at ${new Date().toISOString()}`,
        },
      });

      // Send automated dispatch emails asynchronously
      allIds.forEach(id => {
        sendDispatchEmail(id, null, deliveryPartner || 'Local Courier', 'EXPRESS_LOCAL');
      });

      res.json({
        success: true,
        message: `Express delivery assigned to ${deliveryPartner || 'Local Courier'}${allIds.length > 1 ? ` for ${allIds.length} bundled orders` : ''}`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          carrier: deliveryPartner || 'Local Courier',
          method: 'EXPRESS_LOCAL',
          bundledCount: allIds.length,
        },
      });
      return;
    }

    // ── NORMAL_POST / SPEED_POST: India Post API booking ──
    const barcode = order.trackingNumber || indiaPostService.generateBarcode('EB', 'IN');
    const totalWeight = Number(weightGrams) || Math.max(250, order.items.length * 350);

    // Determine article type based on shipping method
    const reqMethod = (serviceType || orderShippingMethod || 'SPEED_POST').toUpperCase();
    const isDoc = totalWeight <= 500;
    let articleType: string;
    let carrierLabel = 'India Post Speed Post';

    if (reqMethod.includes('NORMAL') || reqMethod.includes('BOOK') || reqMethod === 'BP') {
      articleType = isDoc ? 'BP' : 'BUSINESS_PARCEL';
      carrierLabel = 'India Post Book Post';
    } else {
      articleType = isDoc ? 'SP_INLAND_DOC' : 'SP_INLAND_PARCEL';
      carrierLabel = 'India Post Speed Post';
    }

    const articlePayload = {
      barcode_no: barcode,
      article_type: articleType,
      physical_weight: totalWeight,
      length: Number(length) || 20,
      breadth_diameter: Number(width) || 15,
      height: Number(height) || 3,
      sender_name: 'Techno World Books Hub',
      sender_company: 'Techno World Publications',
      sender_add_line_1: 'College Street (Bidhan Sarani), Near Presidency',
      sender_city: 'Kolkata',
      sender_state: 'West Bengal',
      sender_pincode: '700006',
      sender_mobile_no: '9830000000',
      receiver_name: order.address.fullName,
      receiver_company: '',
      receiver_add_line_1: order.address.addressLine1,
      receiver_city: order.address.city,
      receiver_state: order.address.state,
      receiver_pincode: order.address.pincode,
      receiver_mobile_no: order.address.phone,
      receiver_email: order.address.email || order.user.email,
      insurance: false,
      value_for_customs: order.totalAmount,
    };

    const bookingResult = await indiaPostService.bookArticles([articlePayload]);

    await prisma.order.updateMany({
      where: { id: { in: allIds } },
      data: {
        trackingNumber: barcode,
        shippingCarrier: carrierLabel,
        shippingMethod: orderShippingMethod,
        status: 'SHIPPED',
      },
    });

    // Send automated dispatch emails with real India Post AWB / barcode
    allIds.forEach(id => {
      sendDispatchEmail(id, barcode, carrierLabel, orderShippingMethod);
    });

    res.json({
      success: true,
      message: `Shipment booked successfully via ${carrierLabel}${allIds.length > 1 ? ` for ${allIds.length} bundled orders` : ''}`,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        barcode,
        carrier: carrierLabel,
        method: orderShippingMethod,
        bundledCount: allIds.length,
        bookingDetails: bookingResult,
      },
    });
  } catch (error: any) {
    logger.error('Shipment booking failed: ' + error.message);
    res.status(500).json({ success: false, message: error.message || 'Shipment booking failed' });
  }
};

/**
 * Track Consignment by Order Number or India Post AWB
 * GET /api/v1/shipping/track/:identifier
 */
export const trackShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { identifier } = req.params;
    const cleanId = identifier.trim();

    // Check if identifier is an Order Number in our DB
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { orderNumber: cleanId },
          { id: cleanId },
          { trackingNumber: cleanId },
        ],
      },
      include: {
        address: true,
        items: {
          include: { book: true },
        },
      },
    });

    const trackingBarcode = order?.trackingNumber || cleanId;
    const trackingResults = await indiaPostService.trackArticles([trackingBarcode]);
    const trackingData = trackingResults[0] || null;

    res.json({
      success: true,
      data: {
        order: order
          ? {
              id: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              carrier: order.shippingCarrier || 'India Post Speed Post',
              trackingNumber: order.trackingNumber,
              totalAmount: order.totalAmount,
              createdAt: order.createdAt,
              address: order.address,
              items: order.items.map((i) => ({
                id: i.id,
                title: i.book.title,
                slug: i.book.slug,
                coverUrl: i.book.coverUrl,
                quantity: i.quantity,
                price: i.priceAtPurchase,
              })),
            }
          : null,
        tracking: trackingData,
      },
    });
  } catch (error: any) {
    logger.error('Tracking query failed: ' + error.message);
    res.status(500).json({ success: false, message: error.message || 'Tracking query failed' });
  }
};

/**
 * Generate Printable Shipping Label
 * GET /api/v1/shipping/label/:orderId
 */
export const getShippingLabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
      include: {
        address: true,
        user: true,
      },
    });

    if (!order || !order.address) {
      res.status(404).json({ success: false, message: 'Order or shipping address not found' });
      return;
    }

    const label = await indiaPostService.generateLabel({
      barcode_no: order.trackingNumber || indiaPostService.generateBarcode(),
      article_type: 'Speed Post (Domestic)',
      receiver_name: order.address.fullName || order.user.name,
      receiver_mobile_no: order.address.phone,
      receiver_add_line_1: order.address.addressLine1,
      receiver_add_line_2: order.address.addressLine2,
      receiver_city: order.address.city,
      receiver_state: order.address.state,
      receiver_pincode: order.address.pincode,
      physical_weight: 450,
    });

    res.json({
      success: true,
      data: label,
    });
  } catch (error: any) {
    logger.error('Label generation error: ' + error.message);
    res.status(500).json({ success: false, message: error.message || 'Label generation failed' });
  }
};

/**
 * Bulk Consignment Booking with India Post CEPT (Admin only)
 * POST /api/v1/shipping/book-batch
 */
export const bookBatchShipments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderIds, serviceType } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, message: 'orderIds array is required' });
      return;
    }

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
      },
      include: {
        address: true,
        user: true,
        items: {
          include: { book: true },
        },
      },
    });

    if (orders.length === 0) {
      res.status(404).json({ success: false, message: 'No matching orders found' });
      return;
    }

    const articles: any[] = [];
    const updatedOrders: any[] = [];

    for (const order of orders) {
      if (!order.address) continue;

      const orderMethod = serviceType || order.shippingMethod || 'SPEED_POST';
      const barcode = order.trackingNumber || indiaPostService.generateBarcode(orderMethod === 'NORMAL_POST' ? 'BP' : 'EB', 'IN');
      const totalWeight = Math.max(250, order.items.length * 350);

      const reqMethod = (serviceType || orderMethod || 'SPEED_POST').toUpperCase();
      const isDoc = totalWeight <= 500;
      let articleType: string;
      let carrierLabel = 'India Post Speed Post';

      if (reqMethod.includes('NORMAL') || reqMethod.includes('BOOK') || reqMethod === 'BP') {
        articleType = isDoc ? 'BP' : 'BUSINESS_PARCEL';
        carrierLabel = 'India Post Book Post';
      } else {
        articleType = isDoc ? 'SP_INLAND_DOC' : 'SP_INLAND_PARCEL';
        carrierLabel = 'India Post Speed Post';
      }

      articles.push({
        barcode_no: barcode,
        article_type: articleType,
        physical_weight: totalWeight,
        length: 20,
        breadth_diameter: 15,
        height: 3,
        sender_name: 'Techno World Books Hub',
        sender_company: 'Techno World Publications',
        sender_add_line_1: 'College Street (Bidhan Sarani), Near Presidency',
        sender_city: 'Kolkata',
        sender_state: 'West Bengal',
        sender_pincode: '700006',
        sender_mobile_no: '9830000000',
        receiver_name: order.address.fullName,
        receiver_company: '',
        receiver_add_line_1: order.address.addressLine1,
        receiver_city: order.address.city,
        receiver_state: order.address.state,
        receiver_pincode: order.address.pincode,
        receiver_mobile_no: order.address.phone,
        receiver_email: order.address.email || order.user?.email,
        insurance: false,
        value_for_customs: order.totalAmount,
      });

      updatedOrders.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        barcode,
        carrier: carrierLabel,
        method: orderMethod,
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          trackingNumber: barcode,
          shippingCarrier: carrierLabel,
          shippingMethod: orderMethod,
          status: order.status === 'PENDING' ? 'PROCESSING' : order.status,
        },
      });
    }

    const bookingResult = await indiaPostService.bookArticles(articles);

    res.json({
      success: true,
      message: `Batch shipment booked successfully for ${articles.length} parcels via India Post CEPT`,
      data: {
        totalBooked: articles.length,
        orders: updatedOrders,
        bookingDetails: bookingResult,
      },
    });
  } catch (error: any) {
    logger.error('Batch shipment booking failed: ' + error.message);
    res.status(500).json({ success: false, message: error.message || 'Batch shipment booking failed' });
  }
};

/**
 * Get Barcode Pool Status (Admin only)
 * GET /api/v1/shipping/barcode-pool
 */
export const getBarcodePoolStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = indiaPostService.getBarcodePoolStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch barcode pool status' });
  }
};

/**
 * Load Barcodes into Pool (Admin only)
 * POST /api/v1/shipping/barcode-pool/load
 */
export const loadBarcodePool = async (req: Request, res: Response): Promise<void> => {
  try {
    const { barcodes, range } = req.body;
    if (Array.isArray(barcodes) && barcodes.length > 0) {
      const result = indiaPostService.loadBarcodeSeries(barcodes);
      res.json({ success: true, message: `Loaded ${result.added} barcodes into pool`, data: result });
      return;
    }
    if (range && range.prefix && range.start && range.count) {
      const result = indiaPostService.loadBarcodeRange(range.prefix, Number(range.start), Number(range.count));
      res.json({ success: true, message: `Generated and loaded ${result.added} barcodes into pool`, data: result });
      return;
    }
    res.status(400).json({ success: false, message: 'Provide either a barcodes array or range specification { prefix, start, count }' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load barcodes into pool' });
  }
};

/**
 * Daily India Post Despatch Manifest / Handover Journal (Admin only)
 * GET /api/v1/shipping/manifest
 */
export const getDailyManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, status, service } = req.query;

    const queryDate = date ? new Date(date as string) : new Date();
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    const whereClause: any = {
      trackingNumber: { not: null },
    };

    if (req.query.date) {
      whereClause.updatedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (status && typeof status === 'string') {
      whereClause.status = status;
    } else {
      whereClause.status = { in: ['PROCESSING', 'SHIPPED', 'CONFIRMED', 'DELIVERED'] };
    }

    if (service && typeof service === 'string') {
      whereClause.shippingCarrier = { contains: service };
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        address: true,
        user: {
          select: { name: true, email: true, phone: true },
        },
        items: {
          include: {
            book: {
              select: { title: true, weight: true, price: true, sku: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const manifestItems = orders.map((order, index) => {
      const parcelWeight = Math.max(
        250,
        order.items.reduce((sum, item) => sum + Math.round((item.book?.weight || 0.45) * 1000 * item.quantity), 0)
      );

      const recipientName = order.address?.fullName || order.user?.name || 'Customer';
      const destinationPincode = order.address?.pincode || 'N/A';
      const destinationCity = order.address?.city || 'N/A';
      const destinationState = order.address?.state || 'West Bengal';

      return {
        serialNo: index + 1,
        orderId: order.id,
        orderNumber: order.orderNumber,
        barcode: order.trackingNumber || 'N/A',
        serviceType: order.shippingCarrier?.includes('Book Post') ? 'Book Post' : 'Speed Post',
        bookingDate: order.updatedAt.toISOString(),
        consigneeName: recipientName,
        consigneePhone: order.address?.phone || order.user?.phone || 'N/A',
        destinationPincode,
        destinationCity,
        destinationState,
        weightGrams: parcelWeight,
        declaredValue: Number(order.totalAmount),
        shippingCharge: Number(order.shippingCharge || 0),
        paymentMode: order.paymentMethod === 'COD' ? 'COD' : 'PREPAID',
        codAmount: order.paymentMethod === 'COD' ? Number(order.totalAmount) : 0,
      };
    });

    const totalWeightGrams = manifestItems.reduce((acc, item) => acc + item.weightGrams, 0);
    const totalDeclaredValue = manifestItems.reduce((acc, item) => acc + Number(item.declaredValue), 0);
    const totalPostage = manifestItems.reduce((acc, item) => acc + Number(item.shippingCharge), 0);

    res.json({
      success: true,
      data: {
        manifestDate: queryDate.toISOString(),
        bookingOffice: 'College Street SO / Kolkata GPO (700006)',
        bnplAccountId: 'BNPL-KOL-TW-700006',
        consignorName: 'Techno World Books Hub',
        consignorAddress: 'College Street (Bidhan Sarani), Kolkata - 700006, WB',
        consignorPhone: '+91 98300 00000',
        totalArticles: manifestItems.length,
        totalWeightGrams,
        totalWeightKg: Number((totalWeightGrams / 1000).toFixed(2)),
        totalDeclaredValue,
        totalPostage,
        items: manifestItems,
      },
    });
  } catch (error: any) {
    logger.error('Failed to generate India Post manifest: ' + error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate manifest' });
  }
};


