import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const books = await prisma.book.findMany();
  
  for (const book of books) {
    await prisma.book.update({
      where: { id: book.id },
      data: {
        costPrice: Math.round((book.mrp || book.price) * 0.7),
        lifetimeSales: Math.floor(Math.random() * 50),
        reservedStock: Math.floor(Math.random() * 10),
      }
    });
  }
  
  console.log(`Updated ${books.length} books with cost price and lifetime sales.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
