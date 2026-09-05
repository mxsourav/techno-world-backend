import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function getDispatchBatchCutoff(date: Date): Date {
  const d = new Date(date);
  const cutoff = new Date(d);
  cutoff.setHours(14, 0, 0, 0); // 2:00 PM daily cutoff
  if (d.getTime() >= cutoff.getTime()) {
    cutoff.setDate(cutoff.getDate() + 1);
  }
  return cutoff;
}

export function getDispatchBatchKey(date: Date): string {
  const cutoff = getDispatchBatchCutoff(date);
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}_14:00`;
}


export interface PricingInput {
  items: { bookId: string; quantity: number }[];
  promotionCode?: string | null;
  userId?: string | null;
  pincode?: string | null;
  addressId?: string | null;
  shippingMethod?: string | null; // 'NORMAL_POST' | 'SPEED_POST' | 'EXPRESS_LOCAL'
  paymentMethod?: string | null;  // 'COD' | 'upi' | 'card' etc.
  address?: {
    fullName?: string | null;
    phone?: string | null;
    email?: string | null;
    addressLine1?: string | null;
    line1?: string | null;
    pincode?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
}

export interface DeliveryOption {
  method: string;         // 'NORMAL_POST' | 'SPEED_POST' | 'EXPRESS_LOCAL'
  label: string;          // Customer-facing label
  description: string;    // Short description
  price: number;          // Charge amount
  priceLabel: string;     // e.g. 'FREE', '₹199'
  estimatedDays: string;  // e.g. '5–7 Business Days'
  eligible: boolean;      // Whether this option is available
}

export interface PricingResult {
  items: {
    bookId: string;
    title: string;
    slug: string;
    coverUrl: string | null;
    author: string | null;
    quantity: number;
    unitPrice: number;
    unitMrp: number;
    totalPrice: number;
    totalMrp: number;
    categoryId?: string | null;
    weightGrams?: number;
  }[];
  subtotal: number;
  mrpTotal: number;
  itemDiscountTotal: number;
  promotionCode: string | null;
  promotionId: string | null;
  promotionDiscount: number;
  couponDiscount?: number;
  couponCode?: string | null;
  couponError?: string;
  shippingCharge: number;
  codFee?: number;
  isShippingCalculated: boolean;
  shippingZone?: string;
  shippingMessage?: string;
  estimatedTransitDays?: string;
  isAddonBundle?: boolean;
  bundledWithOrderNumber?: string;
  selectedShippingMethod?: string;
  isExpressEligible?: boolean;
  deliveryOptions?: DeliveryOption[];
  taxAmount: number;
  totalSavings: number;
  totalAmount: number;
  promotionError?: string;
  isValid: boolean;
  errors: string[];
}

export class PricingEngine {
  static async calculate(input: PricingInput): Promise<PricingResult> {
    const result: PricingResult = {
      items: [],
      subtotal: 0,
      mrpTotal: 0,
      itemDiscountTotal: 0,
      promotionCode: null,
      promotionId: null,
      promotionDiscount: 0,
      shippingCharge: 0,
      isShippingCalculated: false,
      taxAmount: 0,
      totalSavings: 0,
      totalAmount: 0,
      isValid: true,
      errors: [],
    };

    if (!input.items || input.items.length === 0) {
      result.isValid = false;
      result.errors.push('Cart is empty');
      return result;
    }

    // 1. Fetch Books and Calculate Base Totals
    const bookIds = input.items.map(i => i.bookId);
    const books = await prisma.book.findMany({ 
      where: { id: { in: bookIds } },
      include: { authors: true }
    });
    
    let totalWeightGrams = 0;

    for (const item of input.items) {
      const book = books.find(b => b.id === item.bookId);
      if (!book) {
        result.isValid = false;
        result.errors.push(`Book not found: ${item.bookId}`);
        continue;
      }
      
      const qty = item.quantity;
      if (book.stock < qty) {
        result.isValid = false;
        result.errors.push(`Insufficient stock for ${book.title} (Available: ${book.stock})`);
      }

      const itemWeight = ((book as any).weightGrams || 450) * qty;
      totalWeightGrams += itemWeight;

      result.items.push({
        bookId: book.id,
        title: book.title,
        slug: book.slug,
        coverUrl: book.coverUrl,
        author: book.authors?.[0]?.name || null,
        quantity: qty,
        unitPrice: book.price,
        unitMrp: book.mrp,
        totalPrice: book.price * qty,
        totalMrp: book.mrp * qty,
        categoryId: book.categoryId,
        weightGrams: itemWeight,
      });

      result.subtotal += book.price * qty;
      result.mrpTotal += book.mrp * qty;
      result.itemDiscountTotal += Math.max(0, (book.mrp - book.price) * qty);
    }

    // 2. Promotions & Coupons
    const code = input.promotionCode ? input.promotionCode.trim().toUpperCase() : null;
    if (code) {
      const promotion = await prisma.promotion.findUnique({ where: { code } });
      if (!promotion || promotion.status !== 'ACTIVE') {
        result.promotionError = 'Invalid or inactive promotion code';
      } else {
        const now = new Date();
        if (promotion.validFrom && promotion.validFrom > now) {
          result.promotionError = 'Promotion has not started yet';
        } else if (promotion.validUntil && promotion.validUntil < now) {
          result.promotionError = 'Promotion code has expired';
        } else if (promotion.usageLimit && promotion.usedCount >= promotion.usageLimit) {
          result.promotionError = 'Promotion usage limit reached';
        } else {
          let rules: any = {};
          try { rules = JSON.parse(promotion.rules || '{}'); } catch (e) {}
          
          const isPersonal = promotion.promotionType === 'PERSONAL';
          const configuredMin = Number(rules.minOrderAmount) || 0;
          
          const failSafeMin = (!isPersonal && promotion.discountType === 'FIXED')
            ? (promotion.discountValue * 2)
            : (promotion.discountType === 'FIXED' ? (promotion.discountValue + 1) : 0);

          const effectiveMinOrder = Math.max(configuredMin, failSafeMin);

          if (effectiveMinOrder > 0 && result.subtotal < effectiveMinOrder) {
            result.promotionError = !isPersonal && promotion.discountType === 'FIXED'
              ? `Minimum cart subtotal of ₹${effectiveMinOrder} required to apply ₹${promotion.discountValue} coupon (Max 50% cart discount policy)`
              : `Minimum cart subtotal of ₹${effectiveMinOrder} required to apply this coupon`;
          } else {
            let userPassed = true;
            if (input.userId) {
              const usageCount = await prisma.promotionUsage.count({
                where: { promotionId: promotion.id, userId: input.userId }
              });
              if (usageCount >= promotion.usageLimitPerUser) {
                result.promotionError = 'You have already used this promotion maximum number of times';
                userPassed = false;
              }
              if (userPassed && rules.isFirstOrderOnly) {
                const completedOrders = await prisma.order.count({
                  where: { userId: input.userId, status: { not: 'CANCELLED' } }
                });
                if (completedOrders > 0) {
                  result.promotionError = 'This promotion is valid for first-time orders only';
                  userPassed = false;
                }
              }
            } else if (rules.isFirstOrderOnly || promotion.promotionType === 'PERSONAL' || rules.requireLogin) {
              result.promotionError = 'Please log in to use this promotion';
              userPassed = false;
            }

            if (userPassed && promotion.categoryId) {
              const hasCategoryItem = result.items.some(i => i.categoryId === promotion.categoryId);
              if (!hasCategoryItem) {
                result.promotionError = 'Promotion is not valid for items in your cart';
                userPassed = false;
              }
            }
            
            if (userPassed && rules.allowedCategories && Array.isArray(rules.allowedCategories)) {
              const hasCategoryItem = result.items.some(i => i.categoryId && rules.allowedCategories.includes(i.categoryId));
              if (!hasCategoryItem) {
                result.promotionError = 'Promotion is not valid for items in your cart';
                userPassed = false;
              }
            }

            if (userPassed) {
              let discount = 0;
              if (promotion.discountType === 'PERCENTAGE') {
                const maxAllowedPct = isPersonal ? 90 : 50;
                const effectivePct = Math.min(promotion.discountValue, maxAllowedPct);
                discount = Math.round((result.subtotal * effectivePct) / 100);
                if (rules.maxDiscount && discount > rules.maxDiscount) discount = rules.maxDiscount;
              } else if (promotion.discountType === 'FIXED') {
                const maxAllowedDiscount = isPersonal ? (result.subtotal - 1) : Math.floor(result.subtotal * 0.5);
                discount = Math.min(promotion.discountValue, Math.max(0, maxAllowedDiscount));
              }
              
              result.promotionCode = code;
              result.promotionId = promotion.id;
              result.promotionDiscount = discount;
            }
          }
        }
      }
    }

    // 3. Three-Tier Delivery Calculation
    // Resolve effective pincode from input.pincode or input.addressId
    let effectivePincode: string | null = input.pincode ? String(input.pincode).trim() : null;
    if (!effectivePincode && input.addressId && !input.addressId.startsWith('addr_')) {
      const dbAddr = await prisma.address.findUnique({ where: { id: input.addressId } });
      if (dbAddr && dbAddr.pincode) {
        effectivePincode = dbAddr.pincode.trim();
      }
    }

    const payableSubtotal = result.subtotal - result.promotionDiscount;
    let shippingCharge = 0;
    let isShippingCalculated = false;
    let shippingZone = 'Pending Address';
    let shippingMessage = 'Enter pincode at address step';
    let estimatedTransitDays = '3–4 Business Days';
    let selectedShippingMethod = input.shippingMethod || 'NORMAL_POST';

    // Express Local Delivery Eligibility — Kolkata / Howrah / Jadavpur / South Kolkata area
    const isExpressEligiblePin = (pin: number): boolean => {
      if (pin >= 700001 && pin <= 700160) return true; // Kolkata
      if (pin >= 711101 && pin <= 711315) return true; // Howrah
      return false;
    };

    // Store Self-Pickup / Takeaway logic (no pincode required, 100% free pickup)
    if (selectedShippingMethod === 'SELF_PICKUP') {
      isShippingCalculated = true;
      shippingCharge = 0;
      shippingZone = 'Store Takeaway (College Street)';
      shippingMessage = 'FREE Store Pickup at College Street Dispatch Desk';
      estimatedTransitDays = 'Ready per Appointed Slot';
      result.deliveryOptions = [
        {
          method: 'SELF_PICKUP',
          label: 'Store Self-Pickup / Takeaway',
          description: 'Collect in person at College Street Dispatch Desk (Zero Shipping Fee)',
          price: 0,
          priceLabel: 'FREE',
          estimatedDays: 'Per Appointed Slot',
          eligible: true,
        },
      ];
    } else if (effectivePincode && /^[1-8]\d{5}$/.test(effectivePincode)) {
      isShippingCalculated = true;
      const pinNum = parseInt(effectivePincode, 10);
      const weightSlabs = Math.max(1, Math.ceil(totalWeightGrams / 500));
      const expressEligible = isExpressEligiblePin(pinNum);
      result.isExpressEligible = expressEligible;

      // If user chose EXPRESS_LOCAL but not eligible, fall back to NORMAL_POST
      if (selectedShippingMethod === 'EXPRESS_LOCAL' && !expressEligible) {
        selectedShippingMethod = 'NORMAL_POST';
      }

      // Check Same-Batch Add-On Free Shipping Rule — ONLY for India Post methods (not Express)
      // Express Delivery uses Porter/Rapido which charge per-trip, no batching/bundling possible
      let isSameBatchAddon = false;
      if (selectedShippingMethod !== 'EXPRESS_LOCAL') {
      const now = new Date();
      const currentBatchCutoff = getDispatchBatchCutoff(now);
      const previousBatchCutoff = new Date(currentBatchCutoff.getTime() - 24 * 60 * 60 * 1000);

      const targetPhone = input.address?.phone?.trim();
      const targetEmail = input.address?.email?.trim();
      const targetLine1 = (input.address?.addressLine1 || input.address?.line1 || '').trim().toLowerCase();
      const targetPin = effectivePincode.trim();

      const candidateOrders = await prisma.order.findMany({
        where: {
          status: { in: ['PENDING', 'CONFIRMED'] },
          createdAt: {
            gte: previousBatchCutoff,
            lt: currentBatchCutoff,
          },
          ...(input.userId ? { userId: input.userId } : {}),
        },
        include: { address: true, user: true },
        orderBy: { createdAt: 'desc' },
      });

      for (const ord of candidateOrders) {
        const addr = ord.address;
        if (!addr) continue;

        const isUserMatch = (input.userId && ord.userId === input.userId) ||
          (targetPhone && (addr.phone === targetPhone || ord.user?.phone === targetPhone)) ||
          (targetEmail && ord.user?.email === targetEmail);

        if (isUserMatch) {
          const addrLine1 = (addr.addressLine1 || '').trim().toLowerCase();
          const addrPin = (addr.pincode || '').trim();

          // Exactly same recipient and delivery address
          if ((!targetLine1 || targetLine1 === addrLine1) && targetPin === addrPin) {
            isSameBatchAddon = true;
            shippingCharge = 0;
            shippingZone = 'Same-Batch Add-On (FREE)';
            shippingMessage = `🎉 FREE Add-on Delivery! Bundled with your un-dispatched order #${ord.orderNumber} in today's 2 PM dispatch batch.`;
            result.isAddonBundle = true;
            result.bundledWithOrderNumber = ord.orderNumber;
            break;
          }
        }
      }
      } // end: same-batch add-on check (skipped for EXPRESS_LOCAL)

      // ──────────────────────────────────────────────────────────────────
      // Calculate shipping based on selected method (3-tier system)
      // ──────────────────────────────────────────────────────────────────

      // Helper: compute Normal Post charge for a given pincode
      const calcNormalPostCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        if (payableSubtotal >= 799) {
          return { charge: 0, zone: 'Free Standard Delivery', msg: 'FREE Standard Delivery (Orders above ₹799)', days: '5–7 Business Days' };
        }
        return { charge: 69, zone: 'Standard Delivery', msg: '₹69 Standard Delivery', days: '5–7 Business Days' };
      };

      // Helper: compute Speed Post charge
      const calcSpeedPostCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        return { charge: 199, zone: 'Speed Post', msg: '₹199 Speed Post Delivery', days: '2–4 Business Days' };
      };

      // Helper: compute Express Local charge
      const calcExpressLocalCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        return { charge: 149, zone: 'Express Local Delivery', msg: '₹149 Express Delivery (Same-day local)', days: 'Same Day' };
      };

      if (!isSameBatchAddon) {
        // Calculate per selected method
        if (selectedShippingMethod === 'SPEED_POST') {
          const sp = calcSpeedPostCharge();
          shippingCharge = sp.charge;
          shippingZone = sp.zone;
          shippingMessage = sp.msg;
          estimatedTransitDays = sp.days;
        } else if (selectedShippingMethod === 'EXPRESS_LOCAL' && expressEligible) {
          const ex = calcExpressLocalCharge();
          shippingCharge = ex.charge;
          shippingZone = ex.zone;
          shippingMessage = ex.msg;
          estimatedTransitDays = ex.days;
        } else {
          // Default: NORMAL_POST
          selectedShippingMethod = 'NORMAL_POST';
          const np = calcNormalPostCharge();
          shippingCharge = np.charge;
          shippingZone = np.zone;
          shippingMessage = np.msg;
          estimatedTransitDays = np.days;
        }
      }

      // Build delivery options array for frontend display
      const normalPost = calcNormalPostCharge();
      const speedPost = calcSpeedPostCharge();
      const expressLocal = calcExpressLocalCharge();

      const deliveryOptions: DeliveryOption[] = [
        {
          method: 'NORMAL_POST',
          label: 'Standard Delivery',
          description: payableSubtotal >= 799 ? 'Free nationwide delivery' : `Reliable delivery via postal network`,
          price: normalPost.charge,
          priceLabel: normalPost.charge === 0 ? 'FREE' : `₹${normalPost.charge}`,
          estimatedDays: normalPost.days,
          eligible: true,
        },
        {
          method: 'SPEED_POST',
          label: 'Speed Post',
          description: 'Priority handling with real-time tracking',
          price: speedPost.charge,
          priceLabel: `₹${speedPost.charge}`,
          estimatedDays: speedPost.days,
          eligible: true,
        },
        {
          method: 'EXPRESS_LOCAL',
          label: 'Express Delivery',
          description: 'Same-day local delivery partner',
          price: expressLocal.charge,
          priceLabel: `₹${expressLocal.charge}`,
          estimatedDays: expressLocal.days,
          eligible: expressEligible,
        },
      ];

      result.deliveryOptions = deliveryOptions;

      // Check if Free Shipping Coupon applied (overrides selected method charge)
      if (result.promotionId) {
        const promotion = await prisma.promotion.findUnique({ where: { id: result.promotionId } });
        if (promotion?.discountType === 'FREE_SHIPPING') {
          shippingCharge = 0;
          shippingMessage = 'FREE Shipping Coupon Applied';
        }
        let rules: any = {};
        try { rules = JSON.parse(promotion?.rules || '{}'); } catch (_e) {}
        if (rules.freeShipping === true) {
          shippingCharge = 0;
          shippingMessage = 'FREE Shipping Coupon Applied';
        }
      }
    } else {
      // Pincode not yet entered/selected: delivery is NOT calculated yet
      isShippingCalculated = false;
      shippingCharge = 0;
      shippingZone = 'Pending Address';
      shippingMessage = 'Enter pincode at address step';
      estimatedTransitDays = '3–4 Business Days';
    }

    result.shippingCharge = shippingCharge;
    result.isShippingCalculated = isShippingCalculated;
    result.shippingZone = shippingZone;
    result.shippingMessage = shippingMessage;
    result.estimatedTransitDays = estimatedTransitDays;
    result.selectedShippingMethod = selectedShippingMethod;

    // 4. Taxes & Fees
    result.taxAmount = 0;

    // COD Handling Fee (₹20 when Cash on Delivery is chosen)
    const normPay = String(input.paymentMethod || '').trim().toLowerCase();
    const isCOD = normPay === 'cod' || normPay.includes('cash on delivery');

    if (selectedShippingMethod === 'SELF_PICKUP' && isCOD) {
      result.isValid = false;
      result.errors.push('Cash on Delivery is not available for Store Self-Pickup. Please pay online via UPI, Card, or Net Banking.');
    }

    const codFee = (isCOD && selectedShippingMethod !== 'SELF_PICKUP') ? 20 : 0;
    result.codFee = codFee;
    
    // 5. Final Totals
    result.totalAmount = payableSubtotal + result.shippingCharge + codFee + result.taxAmount;
    result.totalSavings = result.itemDiscountTotal + result.promotionDiscount;

    result.couponDiscount = result.promotionDiscount;
    result.couponCode = result.promotionCode;
    result.couponError = result.promotionError;

    return result;
  }
}
