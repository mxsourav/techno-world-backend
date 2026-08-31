import { PricingEngine } from './src/services/pricing.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---\n');

  // Test 1: Empty Cart
  console.log('Test 1: Empty Cart');
  const res1 = await PricingEngine.calculate({ items: [] });
  console.log(res1);
  console.log(res1.items.length === 0 ? 'PASS' : 'FAIL', '\n');

  // Find some books to test with
  const books = await prisma.book.findMany({ take: 2 });
  if (books.length < 2) {
    console.log('Not enough books in DB for tests');
    return;
  }

  // Test 2: Invalid Book IDs
  console.log('Test 2: Invalid Book IDs');
  const res2 = await PricingEngine.calculate({ 
    items: [{ bookId: 'invalid-id-123', quantity: 1 }] 
  });
  console.log(res2);
  console.log(!res2.isValid && res2.errors.includes('Invalid items found') ? 'PASS' : 'FAIL', '\n');

  // Test 3: Normal checkout with valid coupon
  console.log('Test 3: Valid Coupon');
  const coupon = await prisma.coupon.findFirst({ where: { isActive: true } });
  
  const res3 = await PricingEngine.calculate({ 
    items: [
      { bookId: books[0].id, quantity: 2 },
      { bookId: books[1].id, quantity: 1 }
    ],
    couponCode: coupon ? coupon.code : undefined
  });
  console.log(res3);
  console.log(res3.isValid ? 'PASS' : 'FAIL', '\n');
}

runTests().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
