
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('Cleaning up fake demo books and fake demo orders...');

  // 1. Delete all order items & orders
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  console.log('Deleted all fake orders & order items.');

  // 2. Delete all cart items, wishlist items, inventory history, reviews for books
  await prisma.cartItem.deleteMany({});
  await prisma.wishlistItem.deleteMany({});
  await prisma.inventoryHistory.deleteMany({});
  await prisma.review.deleteMany({});

  // 3. Delete all previous books
  const deletedBooks = await prisma.book.deleteMany({});
  console.log(`Deleted ${deletedBooks.count} books.`);

  // 4. Delete notifications relating to demo orders
  await prisma.notification.deleteMany({});
  console.log('Cleared notifications log.');

  console.log('Database is now completely clean and ready for real Excel catalog upload and real orders!');
  await prisma.$disconnect();
}

cleanDatabase().catch(err => {
  console.error('Error cleaning database:', err);
  prisma.$disconnect();
  process.exit(1);
});
