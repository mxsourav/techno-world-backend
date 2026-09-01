import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface PricingInput {
  items: { bookId: string; quantity: number }[];
  promotionCode?: string | null;
  userId?: string | null;
  pincode?: string | null;
  addressId?: string | null;
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
  isShippingCalculated: boolean;
  shippingZone?: string;
  shippingMessage?: string;
  estimatedTransitDays?: string;
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

    // 3. Dynamic India Post Delivery Calculation
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

    // Only calculate delivery charge if user has provided a valid 6-digit PIN code
    if (effectivePincode && /^[1-8]\d{5}$/.test(effectivePincode)) {
      isShippingCalculated = true;
      const pinNum = parseInt(effectivePincode, 10);
      const weightSlabs = Math.max(1, Math.ceil(totalWeightGrams / 500));

      // Check Free Shipping Threshold (Free delivery on orders >= ₹999)
      if (payableSubtotal >= 999) {
        shippingCharge = 0;
        shippingZone = 'Free Delivery';
        shippingMessage = 'FREE Speed Post Delivery (Orders above ₹999)';
        estimatedTransitDays = '2–4 Business Days';
      } else {
        // India Post Speed Post Zone Matrix (Origin: 700009 College St Kolkata)
        if (pinNum >= 700001 && pinNum <= 700160) {
          // Local Kolkata Zone
          shippingZone = 'Local Kolkata (Speed Post)';
          shippingCharge = 30 + Math.max(0, weightSlabs - 1) * 15;
          shippingMessage = `₹${shippingCharge} (Local Kolkata Speed Post, ${totalWeightGrams}g)`;
          estimatedTransitDays = '1–2 Business Days';
        } else if (pinNum >= 710000 && pinNum <= 749999) {
          // Same State (West Bengal)
          shippingZone = 'West Bengal (Speed Post)';
          shippingCharge = 45 + Math.max(0, weightSlabs - 1) * 20;
          shippingMessage = `₹${shippingCharge} (West Bengal Speed Post, ${totalWeightGrams}g)`;
          estimatedTransitDays = '2–3 Business Days';
        } else {
          // National / Rest of India
          shippingZone = 'National (Speed Post)';
          shippingCharge = 65 + Math.max(0, weightSlabs - 1) * 30;
          shippingMessage = `₹${shippingCharge} (National Speed Post, ${totalWeightGrams}g)`;
          estimatedTransitDays = '3–5 Business Days';
        }
      }

      // Check if Free Shipping Coupon applied
      if (result.promotionId) {
        const promotion = await prisma.promotion.findUnique({ where: { id: result.promotionId } });
        if (promotion?.discountType === 'FREE_SHIPPING') {
          shippingCharge = 0;
          shippingMessage = 'FREE Shipping Coupon Applied';
        }
        let rules: any = {};
        try { rules = JSON.parse(promotion?.rules || '{}'); } catch (e) {}
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

    // 4. Taxes & Fees
    result.taxAmount = 0;
    
    // 5. Final Totals
    result.totalAmount = payableSubtotal + result.shippingCharge + result.taxAmount;
    result.totalSavings = result.itemDiscountTotal + result.promotionDiscount;

    result.couponDiscount = result.promotionDiscount;
    result.couponCode = result.promotionCode;
    result.couponError = result.promotionError;

    return result;
  }
}
