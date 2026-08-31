import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const book = await prisma.book.findFirst();
  if (book) {
    await prisma.book.update({
      where: { id: book.id },
      data: { isFeatured: true }
    });
    console.log(`Updated book ${book.title} to be featured.`);
  } else {
    console.log('No books found.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
