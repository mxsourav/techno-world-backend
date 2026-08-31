import { PrismaClient, Prisma } from '@prisma/client';
import { ExcelRow } from '../import.service.js';
import { Normalizer } from './normalizer.js';

export type DuplicateStrategy = 'SKIP' | 'UPDATE' | 'REPLACE';

export class Writer {
  static async executeImport(
    prisma: PrismaClient,
    toAdd: (ExcelRow & { row: number })[],
    toUpdate: (ExcelRow & { row: number })[],
    strategy: DuplicateStrategy,
    authorMap: Map<string, string>,
    publisherMap: Map<string, string>,
    categoryMap: Map<string, string>,
    bookTypeMap: Map<string, string>,
    subjectMap: Map<string, string>
  ) {
    let recordsAdded = 0;
    let recordsUpdated = 0;
    let recordsSkipped = 0;
    const errors: { row: number, message: string }[] = [];

    // Map rows to Prisma Book CreateInput
    const mapToBookInput = (row: ExcelRow) => {
      const title = row.title.trim();
      let slug = Normalizer.generateSlug(title, row.isbn13 || row.isbn10 || row.sku || row.bookCode);
      
      const categoryId = row.subcategory ? categoryMap.get(row.subcategory) : categoryMap.get(row.category);
      const bookTypeId = row.bookType ? bookTypeMap.get(row.bookType) : undefined;

      const authorConnects = row.authors.split(',')
        .map(a => a.trim())
        .filter(Boolean)
        .map(a => ({ id: authorMap.get(a) }))
        .filter(a => a.id !== undefined) as { id: string }[];

      const subjectConnects = row.subjects ? row.subjects.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => ({ id: subjectMap.get(s) }))
        .filter(s => s.id !== undefined) as { id: string }[] : [];

      return {
        title,
        subtitle: row.subtitle,
        slug,
        isbn13: row.isbn13,
        isbn10: row.isbn10,
        sku: row.sku,
        bookCode: row.bookCode,
        edition: row.edition,
        language: row.language || 'English',
        description: row.description || '',
        price: row.price,
        mrp: row.mrp,
        stock: row.stock,
        pages: row.pages,
        publicationDate: row.publicationDate ? new Date(row.publicationDate) : null,
        publicationYear: row.publicationYear,
        printYear: row.printYear,
        reprintNumber: row.reprintNumber,
        bindingType: row.bindingType,
        coverType: row.coverType,
        university: row.university,
        semester: row.semester,
        course: row.course,
        examination: row.examination,
        classStandard: row.classStandard,
        barcode: row.barcode,
        series: row.series,
        volume: row.volume,
        coverUrl: row.coverUrl || '/placeholder-book.jpg',
        categoryId,
        bookTypeId,
        publisherId: publisherMap.get(row.publisher),
        tags: row.tags,
        status: 'PUBLISHED' as const, // Auto-publish imported books
        visibility: true,
        authors: { connect: authorConnects },
        subjects: { connect: subjectConnects },
      };
    };

    // 1. Process Insertions
    if (toAdd.length > 0) {
      for (const row of toAdd) {
        try {
          const data = mapToBookInput(row);
          await prisma.book.create({ data });
          recordsAdded++;
        } catch (e: any) {
           errors.push({ row: row.row, message: `Insert failed: ${e.message}` });
        }
      }
    }

    // 2. Process Duplicates based on strategy
    if (toUpdate.length > 0) {
      if (strategy === 'SKIP') {
        recordsSkipped += toUpdate.length;
      } 
      else if (strategy === 'UPDATE' || strategy === 'REPLACE') {
        for (const row of toUpdate) {
          try {
            const data = mapToBookInput(row);
            
            // Find existing book by any unique identifier available
            const orConditions = [];
            if (row.isbn13) orConditions.push({ isbn13: row.isbn13 });
            if (row.isbn10) orConditions.push({ isbn10: row.isbn10 });
            if (row.bookCode) orConditions.push({ bookCode: row.bookCode });
            if (row.sku) orConditions.push({ sku: row.sku });

            // If we have nothing to search by, we can't update it safely
            if (orConditions.length === 0) {
              errors.push({ row: row.row, message: `Update failed: No unique identifier (ISBN/SKU/Code) provided to find the book.` });
              continue;
            }

            const existing = await prisma.book.findFirst({
              where: { OR: orConditions }
            });

            if (existing) {
              if (strategy === 'REPLACE') {
                // Overwrite all fields (Prisma merge style)
                await prisma.book.update({
                  where: { id: existing.id },
                  data: {
                    ...data,
                    authors: { set: data.authors.connect }, // replace authors
                    subjects: { set: data.subjects.connect }, // replace subjects
                  }
                });
              } else {
                // UPDATE: Merge fields (only update if new value exists)
                const mergeData: any = {};
                for (const key of Object.keys(data) as (keyof typeof data)[]) {
                  if (data[key as keyof typeof data] !== undefined && data[key as keyof typeof data] !== null) {
                    mergeData[key] = data[key as keyof typeof data];
                  }
                }
                
                // For relations on update, we append or replace. Let's just set.
                if (data.authors.connect.length > 0) mergeData.authors = { set: data.authors.connect };
                if (data.subjects.connect.length > 0) mergeData.subjects = { set: data.subjects.connect };
                
                await prisma.book.update({
                  where: { id: existing.id },
                  data: mergeData
                });
              }
              recordsUpdated++;
            } else {
              // Should not happen since we checked existing in Analyze, but fallback to insert
              await prisma.book.create({ data });
              recordsAdded++;
            }
          } catch (e: any) {
             errors.push({ row: row.row, message: `Update failed: ${e.message}` });
          }
        }
      }
    }

    return { recordsAdded, recordsUpdated, recordsSkipped, errors };
  }
}
