import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { indiaPostService } from '../services/indiapost.service.js';
import {
  indiaPostTariffRequestSchema,
  indiaPostArticleSchema,
} from '../schemas/indiapost.schema.js';
import { logger } from '../config/logger.js';

const prisma = new PrismaClient();

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

    const orderShippingMethod = order.shippingMethod || serviceType || 'SPEED_POST';

    // ── EXPRESS_LOCAL: Manual local courier (Porter/Rapido) — no India Post API ──
    if (orderShippingMethod === 'EXPRESS_LOCAL') {
      const { deliveryPartner, agentPhone } = req.body;
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          shippingCarrier: deliveryPartner || 'Local Courier',
          status: 'SHIPPED',
          notes: (order.notes ? order.notes + ' | ' : '') +
            `Express Local dispatch via ${deliveryPartner || 'Local Courier'}${agentPhone ? ` (${agentPhone})` : ''} at ${new Date().toISOString()}`,
        },
      });

      res.json({
        success: true,
        message: `Express delivery assigned to ${deliveryPartner || 'Local Courier'}`,
        data: {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          carrier: deliveryPartner || 'Local Courier',
          method: 'EXPRESS_LOCAL',
        },
      });
      return;
    }

    // ── NORMAL_POST / SPEED_POST: India Post API booking ──
    const barcode = order.trackingNumber || indiaPostService.generateBarcode('EB', 'IN');
    const totalWeight = Number(weightGrams) || Math.max(250, order.items.length * 350);

    // Determine article type based on shipping method
    let articleType = serviceType;
    let carrierLabel = 'India Post Speed Post';
    if (!articleType) {
      if (orderShippingMethod === 'NORMAL_POST') {
        articleType = totalWeight <= 500 ? 'BP_INLAND_DOC' : 'BP_INLAND_PARCEL';
        carrierLabel = 'India Post Book Post';
      } else {
        articleType = totalWeight <= 500 ? 'SP_INLAND_DOC' : 'SP_INLAND_PARCEL';
        carrierLabel = 'India Post Speed Post';
      }
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
      sender_add_line_1: 'Plot 42, Knowledge Park III',
      sender_city: 'Bengaluru',
      sender_state: 'Karnataka',
      sender_pincode: '560001',
      sender_mobile_no: '9876543210',
      receiver_name: order.address.fullName || order.user.name || 'Valued Customer',
      receiver_company: '',
      receiver_add_line_1: order.address.addressLine1,
      receiver_add_line_2: order.address.addressLine2 || '',
      receiver_city: order.address.city,
      receiver_state: order.address.state || '',
      receiver_pincode: order.address.pincode,
      receiver_mobile_no: order.address.phone.replace(/\D/g, '').slice(-10) || '9876543211',
      codr_cod: isCOD || order.paymentMethod === 'COD' ? 'COD' : '',
      value_for_codr_cod: isCOD || order.paymentMethod === 'COD' ? order.totalAmount : 0,
    };

    const bookingResult = await indiaPostService.bookArticles([articlePayload]);

    // Update order with AWB barcode and shipping carrier
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        trackingNumber: barcode,
        shippingCarrier: carrierLabel,
        status: order.status === 'PENDING' ? 'PROCESSING' : order.status,
        notes: (order.notes ? order.notes + ' | ' : '') + `${carrierLabel} Batch: ` + bookingResult.batch_id,
      },
    });

    res.json({
      success: true,
      message: `Shipment booked successfully via ${carrierLabel}`,
      data: {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        barcode,
        carrier: carrierLabel,
        method: orderShippingMethod,
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
