import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin' },
    update: {},
    create: {
      email: 'admin',
      name: 'Super Admin',
      password: hashedPassword,
      role: Role.SUPER_ADMIN,
    },
  });

  console.log('Admin user seeded:', adminUser.email);

  const seedDataPath = path.resolve(process.cwd(), 'prisma/seedData.json');
  const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

  // Seed Categories
  console.log(`Seeding ${seedData.categories.length} categories...`);
  for (const cat of seedData.categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: { slug: cat.slug, name: cat.name },
    });
  }

  // Fetch created categories to map them by slug
  const dbCategories = await prisma.category.findMany();
  const categoryMap = new Map(dbCategories.map(c => [c.slug, c.id]));

  // Seed Books
  console.log(`Seeding ${seedData.books.length} books...`);
  for (const bookData of seedData.books) {
    const categoryId = categoryMap.get(bookData.category);

    await prisma.book.upsert({
      where: { slug: bookData.slug },
      update: {
        title: bookData.title,
        description: bookData.description || '',
        price: bookData.price || 0,
        mrp: bookData.mrp || 0,
        stock: bookData.stock || 0,
        isbn: bookData.isbn,
        edition: bookData.edition,
        language: bookData.language || 'English',
      },
      create: {
        title: bookData.title,
        slug: bookData.slug,
        description: bookData.description || '',
        price: bookData.price || 0,
        mrp: bookData.mrp || 0,
        stock: bookData.stock || 0,
        isbn: bookData.isbn,
        edition: bookData.edition,
        language: bookData.language || 'English',
        status: 'PUBLISHED',
        isFeatured: false,
        isTrending: !!bookData.trending,
        isNewArrival: !!bookData.newRelease,
        isBestseller: !!bookData.bestseller,
        category: categoryId ? { connect: { id: categoryId } } : undefined,
        author: bookData.author ? {
          connectOrCreate: {
            where: { slug: bookData.author.toLowerCase().replace(/\s+/g, '-') },
            create: { name: bookData.author, slug: bookData.author.toLowerCase().replace(/\s+/g, '-') }
          }
        } : undefined,
        publisher: bookData.publisher ? {
          connectOrCreate: {
            where: { slug: bookData.publisher.toLowerCase().replace(/\s+/g, '-') },
            create: { name: bookData.publisher, slug: bookData.publisher.toLowerCase().replace(/\s+/g, '-') }
          }
        } : undefined,
      }
    });
  }

  // Seed Homepage CMS sections
  console.log('Seeding Homepage CMS sections...');
  const cmsSections = [
    {
      sectionKey: 'hero_banner',
      title: 'Hero Banner',
      sortOrder: 1,
      configData: JSON.stringify({
        headline: 'Your One-Stop Destination for Competitive Exam Books',
        subtext: 'UPSC, SSC, Banking, Railways — All under one roof at the best prices',
        ctaText: 'Shop Now',
        ctaLink: '/listing',
        bgImage: '',
      }),
    },
    {
      sectionKey: 'flash_sale',
      title: 'Flash Sale',
      sortOrder: 2,
      configData: JSON.stringify({
        headline: '🔥 Flash Sale — Up to 60% OFF',
        subtext: 'Grab top-rated books before the offer expires!',
        endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        badgeText: 'LIMITED TIME',
      }),
    },
    {
      sectionKey: 'featured_books',
      title: 'Featured Books',
      sortOrder: 3,
      configData: JSON.stringify({
        sectionTitle: 'Editor\'s Picks',
        bookIds: [],
        maxDisplay: 10,
      }),
    },
    {
      sectionKey: 'testimonials',
      title: 'Testimonials',
      sortOrder: 4,
      configData: JSON.stringify({
        sectionTitle: 'What Our Students Say',
        items: [
          { name: 'Rahul Sharma', text: 'Got my UPSC books delivered in 2 days. Amazing quality!', rating: 5 },
          { name: 'Priya Patel', text: 'Best prices for SSC preparation books. Highly recommended!', rating: 5 },
          { name: 'Amit Kumar', text: 'The book quality is excellent and packaging was great.', rating: 4 },
        ],
      }),
    },
    {
      sectionKey: 'sale_banner',
      title: 'Sale Banner',
      sortOrder: 5,
      configData: JSON.stringify({
        headline: 'Mega Book Sale — Flat 40% OFF on all categories',
        ctaText: 'Browse Sale',
        ctaLink: '/listing?sort=price-asc',
        bgColor: '#065f46',
      }),
    },
  ];

  for (const section of cmsSections) {
    await prisma.homepageCMS.upsert({
      where: { sectionKey: section.sectionKey },
      update: { title: section.title, sortOrder: section.sortOrder },
      create: section,
    });
  }
  console.log(`${cmsSections.length} CMS sections seeded.`);

  console.log('Seed successful!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
