import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.homepageCMS.upsert({
    where: { sectionKey: 'promo-banners' },
    update: {},
    create: {
      sectionKey: 'promo-banners',
      title: 'Promotional Banners',
      sortOrder: 6,
      configData: JSON.stringify({
        banners: [
          {
            id: '1',
            imageUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?q=80&w=1200&auto=format&fit=crop',
            linkUrl: '/category/fiction',
            altText: 'Bestselling Fiction',
            isActive: true
          },
          {
            id: '2',
            imageUrl: 'https://images.unsplash.com/photo-1588666309990-d68f08e3d4a6?q=80&w=1200&auto=format&fit=crop',
            linkUrl: '/category/engineering',
            altText: 'Engineering Books',
            isActive: true
          }
        ]
      })
    }
  });
  console.log('Successfully added promo-banners to CMS');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
