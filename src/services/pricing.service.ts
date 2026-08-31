import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface PricingInput {
  items: { bookId: string; quantity: number }[];
  promotionCode?: string | null;
  userId?: string | null;
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
      });

      result.subtotal += book.price * qty;
      result.mrpTotal += book.mrp * qty;
    }

    result.itemDiscountTotal = result.mrpTotal - result.subtotal;

    // 2. Promotion Validation & Calculation
    if (input.promotionCode && result.isValid) {
      const code = input.promotionCode.toUpperCase().trim();
      const promotion = await prisma.promotion.findUnique({ where: { code } });
      
      if (!promotion) {
        result.promotionError = 'Invalid promotion code';
      } else if (promotion.status !== 'ACTIVE') {
        result.promotionError = 'Promotion is not active';
      } else {
        const now = new Date();
        if ((promotion.validFrom && now < promotion.validFrom) || (promotion.validUntil && now > promotion.validUntil)) {
          result.promotionError = 'Promotion is expired or not yet active';
        } else if (promotion.usageLimit && promotion.usedCount >= promotion.usageLimit) {
          result.promotionError = 'Promotion usage limit reached';
        } else {
          // Parse JSON Rules Engine
          let rules: any = {};
          try { rules = JSON.parse(promotion.rules || '{}'); } catch (e) {}

          // 50% Maximum Discount Policy for Universal Coupons (Exempts Personal Targeted Coupons)
          const isPersonal = promotion.promotionType === 'PERSONAL';
          const configuredMin = Number(rules.minOrderAmount) || 0;
          
          // Universal Flat discounts require at least 2x cart subtotal (<= 50% discount)
          // Personal discounts require at least discount + 1
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
                // Universal coupons capped at 50% max; Personal coupons can go up to 90%
                const maxAllowedPct = isPersonal ? 90 : 50;
                const effectivePct = Math.min(promotion.discountValue, maxAllowedPct);
                discount = Math.round((result.subtotal * effectivePct) / 100);
                if (rules.maxDiscount && discount > rules.maxDiscount) discount = rules.maxDiscount;
              } else if (promotion.discountType === 'FIXED') {
                // Universal coupons can discount at most 50% of the cart; Personal coupons can discount up to subtotal - 1
                const maxAllowedDiscount = isPersonal ? (result.subtotal - 1) : Math.floor(result.subtotal * 0.5);
                discount = Math.min(promotion.discountValue, Math.max(0, maxAllowedDiscount));
              } else if (promotion.discountType === 'FREE_SHIPPING') {
                // Free shipping handled below
              }
              
              result.promotionCode = code;
              result.promotionId = promotion.id;
              result.promotionDiscount = discount;
            }
          }
        }
      }
    }

    // 3. Shipping Calculation
    const payableSubtotal = result.subtotal - result.promotionDiscount;
    let shippingCharge = 0;
    
    if (payableSubtotal > 0 && payableSubtotal < 499) {
      shippingCharge = 40;
    }
    
    // Check if free shipping promo applied
    if (result.promotionId) {
       const promotion = await prisma.promotion.findUnique({ where: { id: result.promotionId } });
       if (promotion?.discountType === 'FREE_SHIPPING') {
          shippingCharge = 0;
       }
       
       let rules: any = {};
       try { rules = JSON.parse(promotion?.rules || '{}'); } catch (e) {}
       if (rules.freeShipping === true) {
         shippingCharge = 0;
       }
    }
    result.shippingCharge = shippingCharge;

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
