import { PrismaClient } from '@prisma/client';
import { Normalizer } from './normalizer.js';

export class EntityCreator {
  /**
   * Fast batch-entity creation:
   * 1. Fetches all existing authors, publishers, categories, bookTypes, and subjects concurrently.
   * 2. Identifies truly missing entities in memory.
   * 3. Uses createMany in a single query per entity type for maximum speed.
   */
  static async createMissingEntities(
    prisma: PrismaClient,
    authorsToCreate: Set<string>,
    publishersToCreate: Set<string>,
    categoriesToCreate: Set<string>,
    bookTypesToCreate: Set<string>,
    subjectsToCreate: Set<string>
  ) {
    const authorMap = new Map<string, string>();
    const publisherMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();
    const bookTypeMap = new Map<string, string>();
    const subjectMap = new Map<string, string>();

    // 1. Fetch all existing entities concurrently in one network round
    const [existingAuthors, existingPublishers, existingCategories, existingBookTypes, existingSubjects] = await Promise.all([
      prisma.author.findMany({ select: { id: true, name: true, slug: true } }),
      prisma.publisher.findMany({ select: { id: true, name: true, slug: true } }),
      prisma.category.findMany({ select: { id: true, name: true, slug: true } }),
      prisma.bookType.findMany({ select: { id: true, name: true, slug: true } }),
      prisma.subject.findMany({ select: { id: true, name: true, slug: true } }),
    ]);

    for (const a of existingAuthors) {
      authorMap.set(a.name, a.id);
      authorMap.set(a.slug, a.id);
      authorMap.set(a.name.toLowerCase().trim(), a.id);
    }
    for (const p of existingPublishers) {
      publisherMap.set(p.name, p.id);
      publisherMap.set(p.slug, p.id);
      publisherMap.set(p.name.toLowerCase().trim(), p.id);
    }
    for (const c of existingCategories) {
      categoryMap.set(c.name, c.id);
      categoryMap.set(c.slug, c.id);
      categoryMap.set(c.name.toLowerCase().trim(), c.id);
    }
    for (const bt of existingBookTypes) {
      bookTypeMap.set(bt.name, bt.id);
      bookTypeMap.set(bt.slug, bt.id);
      bookTypeMap.set(bt.name.toLowerCase().trim(), bt.id);
    }
    for (const s of existingSubjects) {
      subjectMap.set(s.name, s.id);
      subjectMap.set(s.slug, s.id);
      subjectMap.set(s.name.toLowerCase().trim(), s.id);
    }

    // 2. Batch create missing Authors
    const authorsToInsert: { name: string; slug: string; bio: string }[] = [];
    const seenAuthorSlugs = new Set<string>();
    for (const authorRaw of authorsToCreate) {
      const name = Normalizer.normalizeName(authorRaw);
      const slug = Normalizer.generateSlug(name);
      if (!authorMap.has(authorRaw) && !authorMap.has(name) && !authorMap.has(slug) && !authorMap.has(name.toLowerCase().trim()) && !seenAuthorSlugs.has(slug)) {
        authorsToInsert.push({ name, slug, bio: '' });
        seenAuthorSlugs.add(slug);
      }
    }
    if (authorsToInsert.length > 0) {
      await prisma.author.createMany({ data: authorsToInsert, skipDuplicates: true });
      const newAuths = await prisma.author.findMany({
        where: { slug: { in: authorsToInsert.map(a => a.slug) } },
        select: { id: true, name: true, slug: true }
      });
      for (const a of newAuths) {
        authorMap.set(a.name, a.id);
        authorMap.set(a.slug, a.id);
        authorMap.set(a.name.toLowerCase().trim(), a.id);
      }
    }
    for (const authorRaw of authorsToCreate) {
      const name = Normalizer.normalizeName(authorRaw);
      const id = authorMap.get(authorRaw) || authorMap.get(name) || authorMap.get(name.toLowerCase().trim()) || authorMap.get(Normalizer.generateSlug(name));
      if (id) authorMap.set(authorRaw, id);
    }

    // 3. Batch create missing Publishers
    const publishersToInsert: { name: string; slug: string }[] = [];
    const seenPubSlugs = new Set<string>();
    for (const pubRaw of publishersToCreate) {
      const name = Normalizer.normalizeName(pubRaw);
      const slug = Normalizer.generateSlug(name);
      if (!publisherMap.has(pubRaw) && !publisherMap.has(name) && !publisherMap.has(slug) && !publisherMap.has(name.toLowerCase().trim()) && !seenPubSlugs.has(slug)) {
        publishersToInsert.push({ name, slug });
        seenPubSlugs.add(slug);
      }
    }
    if (publishersToInsert.length > 0) {
      await prisma.publisher.createMany({ data: publishersToInsert, skipDuplicates: true });
      const newPubs = await prisma.publisher.findMany({
        where: { slug: { in: publishersToInsert.map(p => p.slug) } },
        select: { id: true, name: true, slug: true }
      });
      for (const p of newPubs) {
        publisherMap.set(p.name, p.id);
        publisherMap.set(p.slug, p.id);
        publisherMap.set(p.name.toLowerCase().trim(), p.id);
      }
    }
    for (const pubRaw of publishersToCreate) {
      const name = Normalizer.normalizeName(pubRaw);
      const id = publisherMap.get(pubRaw) || publisherMap.get(name) || publisherMap.get(name.toLowerCase().trim()) || publisherMap.get(Normalizer.generateSlug(name));
      if (id) publisherMap.set(pubRaw, id);
    }

    // 4. Batch create missing BookTypes
    const bookTypesToInsert: { name: string; slug: string }[] = [];
    const seenBTSlugs = new Set<string>();
    for (const btRaw of bookTypesToCreate) {
      const name = Normalizer.normalizeName(btRaw);
      const slug = Normalizer.generateSlug(name);
      if (!bookTypeMap.has(btRaw) && !bookTypeMap.has(name) && !bookTypeMap.has(slug) && !bookTypeMap.has(name.toLowerCase().trim()) && !seenBTSlugs.has(slug)) {
        bookTypesToInsert.push({ name, slug });
        seenBTSlugs.add(slug);
      }
    }
    if (bookTypesToInsert.length > 0) {
      await prisma.bookType.createMany({ data: bookTypesToInsert, skipDuplicates: true });
      const newBTs = await prisma.bookType.findMany({
        where: { slug: { in: bookTypesToInsert.map(bt => bt.slug) } },
        select: { id: true, name: true, slug: true }
      });
      for (const bt of newBTs) {
        bookTypeMap.set(bt.name, bt.id);
        bookTypeMap.set(bt.slug, bt.id);
        bookTypeMap.set(bt.name.toLowerCase().trim(), bt.id);
      }
    }
    for (const btRaw of bookTypesToCreate) {
      const name = Normalizer.normalizeName(btRaw);
      const id = bookTypeMap.get(btRaw) || bookTypeMap.get(name) || bookTypeMap.get(name.toLowerCase().trim()) || bookTypeMap.get(Normalizer.generateSlug(name));
      if (id) bookTypeMap.set(btRaw, id);
    }

    // 5. Batch create missing Subjects
    const subjectsToInsert: { name: string; slug: string }[] = [];
    const seenSubSlugs = new Set<string>();
    for (const subRaw of subjectsToCreate) {
      const name = Normalizer.normalizeName(subRaw);
      const slug = Normalizer.generateSlug(name);
      if (!subjectMap.has(subRaw) && !subjectMap.has(name) && !subjectMap.has(slug) && !subjectMap.has(name.toLowerCase().trim()) && !seenSubSlugs.has(slug)) {
        subjectsToInsert.push({ name, slug });
        seenSubSlugs.add(slug);
      }
    }
    if (subjectsToInsert.length > 0) {
      await prisma.subject.createMany({ data: subjectsToInsert, skipDuplicates: true });
      const newSubs = await prisma.subject.findMany({
        where: { slug: { in: subjectsToInsert.map(s => s.slug) } },
        select: { id: true, name: true, slug: true }
      });
      for (const s of newSubs) {
        subjectMap.set(s.name, s.id);
        subjectMap.set(s.slug, s.id);
        subjectMap.set(s.name.toLowerCase().trim(), s.id);
      }
    }
    for (const subRaw of subjectsToCreate) {
      const name = Normalizer.normalizeName(subRaw);
      const id = subjectMap.get(subRaw) || subjectMap.get(name) || subjectMap.get(name.toLowerCase().trim()) || subjectMap.get(Normalizer.generateSlug(name));
      if (id) subjectMap.set(subRaw, id);
    }

    // 6. Categories (hierarchical tree support)
    for (const categoryRaw of categoriesToCreate) {
      const levels = Normalizer.normalizeCategoryHierarchy(categoryRaw);
      let currentParentId: string | null = null;
      let finalCategoryId: string | null = null;

      for (const levelName of levels) {
        const slug = Normalizer.generateSlug(levelName);
        let catId = categoryMap.get(levelName) || categoryMap.get(slug) || categoryMap.get(levelName.toLowerCase().trim());

        if (!catId) {
          const createdCat: { id: string } = await prisma.category.create({
            data: { name: levelName, slug, parentId: currentParentId },
            select: { id: true }
          });
          catId = createdCat.id;
          categoryMap.set(levelName, catId);
          categoryMap.set(slug, catId);
          categoryMap.set(levelName.toLowerCase().trim(), catId);
        }

        currentParentId = catId || null;
        finalCategoryId = catId || null;
      }

      if (finalCategoryId) {
        categoryMap.set(categoryRaw, finalCategoryId);
      }
    }

    return { authorMap, publisherMap, categoryMap, bookTypeMap, subjectMap };
  }
}
