import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding simulation promotional coupon codes...');

  const promotions = [
    {
      code: 'WB2026',
      name: 'West Bengal 2026 Academic Student Subsidy',
      description: 'Special 15% discount for 2026 edition engineering & medical textbooks across West Bengal colleges.',
      discountType: 'PERCENTAGE',
      discountValue: 15.0,
      promotionType: 'UNIVERSAL',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-12-31'),
      usageLimit: 10000,
      usageLimitPerUser: 5,
      rules: JSON.stringify({ minOrderAmount: 499 }),
    },
    {
      code: 'MEDICO15',
      name: 'MBBS & Healthcare Scholar Discount',
      description: '15% instant savings on Anatomy, Pharmacology, and Medical reference books.',
      discountType: 'PERCENTAGE',
      discountValue: 15.0,
      promotionType: 'UNIVERSAL',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-12-31'),
      usageLimit: 5000,
      usageLimitPerUser: 3,
      rules: JSON.stringify({ minOrderAmount: 999 }),
    },
    {
      code: 'TECHNO10',
      name: 'Techno World Universal Welcome',
      description: '10% universal discount for all college students on orders above Rs 299.',
      discountType: 'PERCENTAGE',
      discountValue: 10.0,
      promotionType: 'UNIVERSAL',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-12-31'),
      usageLimit: 20000,
      usageLimitPerUser: 10,
      rules: JSON.stringify({ minOrderAmount: 299 }),
    },
    {
      code: 'FREESHIP',
      name: 'Delivery Fee Waiver',
      description: 'Flat Rs 60 off shipping on orders above Rs 399.',
      discountType: 'FIXED',
      discountValue: 60.0,
      promotionType: 'UNIVERSAL',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-12-31'),
      usageLimit: 10000,
      usageLimitPerUser: 5,
      rules: JSON.stringify({ minOrderAmount: 399 }),
    },
    {
      code: 'LIBBULK25',
      name: 'Institutional Library Bulk Procurement',
      description: '25% institutional discount on textbook orders above Rs 2500.',
      discountType: 'PERCENTAGE',
      discountValue: 25.0,
      promotionType: 'UNIVERSAL',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-12-31'),
      usageLimit: 1000,
      usageLimitPerUser: 10,
      rules: JSON.stringify({ minOrderAmount: 2500 }),
    },
  ];

  for (const promo of promotions) {
    const upserted = await prisma.promotion.upsert({
      where: { code: promo.code },
      update: {
        name: promo.name,
        description: promo.description,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        promotionType: promo.promotionType,
        status: promo.status,
        validFrom: promo.validFrom,
        validUntil: promo.validUntil,
        usageLimit: promo.usageLimit,
        usageLimitPerUser: promo.usageLimitPerUser,
        rules: promo.rules,
      },
      create: {
        code: promo.code,
        name: promo.name,
        description: promo.description,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        promotionType: promo.promotionType,
        status: promo.status,
        validFrom: promo.validFrom,
        validUntil: promo.validUntil,
        usageLimit: promo.usageLimit,
        usageLimitPerUser: promo.usageLimitPerUser,
        rules: promo.rules,
      },
    });
    console.log(`[PROMOTION] Upserted code: ${upserted.code} (${upserted.name}) - Status: ${upserted.status}`);
  }

  console.log('Successfully seeded simulation coupon codes.');
}

main()
  .catch((e) => {
    console.error('Error seeding promotions:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
