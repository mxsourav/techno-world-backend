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
  parentShippingMethod?: string;
  parentShippingCharge?: number;
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

      // Check Same-Batch Add-On Free Shipping Rule (with Upgrade with Credit support)
      let isSameBatchAddon = false;
      let parentOrder: any = null;

      const now = new Date();
      const currentBatchCutoff = getDispatchBatchCutoff(now);
      const previousBatchCutoff = new Date(currentBatchCutoff.getTime() - 24 * 60 * 60 * 1000);

      const normDigits = (str: string | null | undefined) => {
        if (!str) return '';
        return str.replace(/\D/g, '').slice(-10);
      };

      const targetPhoneNorm = normDigits(input.address?.phone);
      const targetPin = (effectivePincode || '').trim();
      const targetLine1Norm = (input.address?.addressLine1 || input.address?.line1 || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetAddrId = input.addressId;

      const candidateOrders = await prisma.order.findMany({
        where: {
          status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING'] },
          trackingNumber: null,
          createdAt: {
            gte: previousBatchCutoff,
            lt: currentBatchCutoff,
          },
        },
        include: { address: true, user: true },
        orderBy: { createdAt: 'desc' },
      });

      for (const ord of candidateOrders) {
        const addr = ord.address;
        if (!addr) continue;

        const addrPin = (addr.pincode || '').trim();
        const addrPhoneNorm = normDigits(addr.phone) || normDigits(ord.user?.phone);
        const addrLine1Norm = (addr.addressLine1 || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

        const isExactAddressIdMatch = Boolean(targetAddrId && ord.addressId && targetAddrId === ord.addressId);
        const isPhoneAndPinMatch = Boolean(targetPhoneNorm && addrPhoneNorm && targetPhoneNorm === addrPhoneNorm && targetPin && addrPin && targetPin === addrPin);
        const isUserAndPinMatch = Boolean(input.userId && ord.userId && input.userId === ord.userId && targetPin && addrPin && targetPin === addrPin);
        const isLineAndPinMatch = Boolean(targetLine1Norm && addrLine1Norm && targetLine1Norm === addrLine1Norm && targetPin && addrPin && targetPin === addrPin);

        if (isExactAddressIdMatch || isPhoneAndPinMatch || isUserAndPinMatch || isLineAndPinMatch) {
          isSameBatchAddon = true;
          parentOrder = ord;
          result.isAddonBundle = true;
          result.bundledWithOrderNumber = ord.orderNumber;
          result.parentShippingMethod = ord.shippingMethod || 'NORMAL_POST';
          result.parentShippingCharge = ord.shippingCharge || 0;
          break;
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // Calculate shipping based on selected method (3-tier system)
      // ──────────────────────────────────────────────────────────────────

      // Tier weights: NORMAL_POST (1) < SPEED_POST (2) < EXPRESS_LOCAL (3)
      const getTierWeight = (m: string) => {
        if (m === 'EXPRESS_LOCAL') return 3;
        if (m === 'SPEED_POST') return 2;
        return 1;
      };

      // Helper: compute Normal Post charge (FREE only above ₹999 net after discounts)
      const calcNormalPostCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        if (payableSubtotal >= 999) {
          return { charge: 0, zone: 'Free Standard Delivery', msg: 'FREE Standard Delivery (Orders above ₹999)', days: '5–7 Business Days' };
        }
        return { charge: 69, zone: 'Standard Delivery', msg: '₹69 Standard Delivery', days: '5–7 Business Days' };
      };

      // Helper: compute Speed Post charge (ALWAYS paid)
      const calcSpeedPostCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        return { charge: 199, zone: 'Speed Post', msg: '₹199 Speed Post Delivery', days: '2–4 Business Days' };
      };

      // Helper: compute Express Local charge (ALWAYS paid, never free)
      const calcExpressLocalCharge = (): { charge: number; zone: string; msg: string; days: string } => {
        return { charge: 149, zone: 'Express Local Delivery', msg: '₹149 Express Delivery (Same-day local)', days: 'Same Day' };
      };

      const normalPost = calcNormalPostCharge();
      const speedPost = calcSpeedPostCharge();
      const expressLocal = calcExpressLocalCharge();

      const parentMethod = parentOrder ? (parentOrder.shippingMethod || 'NORMAL_POST') : null;
      const parentPaidFee = parentOrder ? (parentOrder.shippingCharge || 0) : 0;
      const parentTier = parentMethod ? getTierWeight(parentMethod) : 0;

      if (isSameBatchAddon && parentMethod) {
        // Enforce No Downgrade: cannot pick lower tier than parent order
        if (!input.shippingMethod || getTierWeight(input.shippingMethod) < parentTier) {
          selectedShippingMethod = parentMethod;
        } else {
          selectedShippingMethod = input.shippingMethod;
        }

        const selectedTier = getTierWeight(selectedShippingMethod);

        if (selectedTier === parentTier) {
          // Joined active consignment at ₹0 extra fee
          shippingCharge = 0;
          shippingZone = 'Same-Batch Add-On (FREE)';
          shippingMessage = `🎉 FREE Add-on Delivery! Bundled with your un-dispatched order #${parentOrder.orderNumber} in today's 2 PM dispatch batch.`;
          estimatedTransitDays = parentMethod === 'EXPRESS_LOCAL' ? 'Same Day' : (parentMethod === 'SPEED_POST' ? '2–4 Business Days' : '5–7 Business Days');
        } else {
          // Upgraded to higher delivery service: credit previously paid delivery fee!
          const fullPrice = selectedShippingMethod === 'EXPRESS_LOCAL' ? expressLocal.charge : speedPost.charge;
          shippingCharge = Math.max(0, fullPrice - parentPaidFee);
          shippingZone = 'Consignment Upgrade';
          shippingMessage = `🚀 Whole consignment upgraded to ${selectedShippingMethod === 'EXPRESS_LOCAL' ? 'Express Delivery' : 'Speed Post'} (₹${parentPaidFee} paid credit deducted)!`;
          estimatedTransitDays = selectedShippingMethod === 'EXPRESS_LOCAL' ? 'Same Day' : '2–4 Business Days';
        }

        // Delivery options for add-on with upgrade pricing and no downgrade
        const deliveryOptions: DeliveryOption[] = [];

        // Option 1: Standard Delivery (Tier 1) - Only if parent was Tier 1
        if (parentTier <= 1) {
          deliveryOptions.push({
            method: 'NORMAL_POST',
            label: 'Standard Delivery (Active Parcel)',
            description: `Bundled with Order #${parentOrder.orderNumber} · Zero extra fee`,
            price: 0,
            priceLabel: 'FREE',
            estimatedDays: normalPost.days,
            eligible: true,
          });
        }

        // Option 2: Speed Post (Tier 2) - Upgrade if parent Tier 1, FREE if parent Tier 2, Hidden if parent Tier 3
        if (parentTier <= 2) {
          const spDiff = parentTier === 2 ? 0 : Math.max(0, speedPost.charge - parentPaidFee);
          deliveryOptions.push({
            method: 'SPEED_POST',
            label: parentTier === 2 ? 'Speed Post (Active Parcel)' : 'Upgrade to Speed Post (Whole Package)',
            description: parentTier === 2
              ? `Bundled with Order #${parentOrder.orderNumber} · Zero extra fee`
              : `Upgrades whole package to Speed Post (₹${parentPaidFee} credit applied)`,
            price: spDiff,
            priceLabel: spDiff === 0 ? 'FREE' : `₹${spDiff}`,
            estimatedDays: speedPost.days,
            eligible: true,
          });
        }

        // Option 3: Express Local (Tier 3) - Available if express eligible
        if (expressEligible) {
          const exDiff = parentTier === 3 ? 0 : Math.max(0, expressLocal.charge - parentPaidFee);
          deliveryOptions.push({
            method: 'EXPRESS_LOCAL',
            label: parentTier === 3 ? 'Express Delivery (Active Parcel)' : 'Upgrade to Express Delivery (Whole Package)',
            description: parentTier === 3
              ? `Bundled with Order #${parentOrder.orderNumber} · Zero extra fee`
              : `Upgrades whole package to Same-Day Express (₹${parentPaidFee} credit applied)`,
            price: exDiff,
            priceLabel: exDiff === 0 ? 'FREE' : `₹${exDiff}`,
            estimatedDays: expressLocal.days,
            eligible: true,
          });
        }

        result.deliveryOptions = deliveryOptions;
      } else {
        // Standard first-order calculation
        if (selectedShippingMethod === 'SPEED_POST') {
          shippingCharge = speedPost.charge;
          shippingZone = speedPost.zone;
          shippingMessage = speedPost.msg;
          estimatedTransitDays = speedPost.days;
        } else if (selectedShippingMethod === 'EXPRESS_LOCAL' && expressEligible) {
          shippingCharge = expressLocal.charge;
          shippingZone = expressLocal.zone;
          shippingMessage = expressLocal.msg;
          estimatedTransitDays = expressLocal.days;
        } else {
          selectedShippingMethod = 'NORMAL_POST';
          shippingCharge = normalPost.charge;
          shippingZone = normalPost.zone;
          shippingMessage = normalPost.msg;
          estimatedTransitDays = normalPost.days;
        }

        result.deliveryOptions = [
          {
            method: 'NORMAL_POST',
            label: 'Standard Delivery',
            description: payableSubtotal >= 999 ? 'Free nationwide delivery' : 'Reliable delivery via postal network',
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
      }

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
