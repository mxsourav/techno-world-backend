import { PrismaClient, Prisma } from '@prisma/client';
import { ExcelRow } from '../import.service.js';
import { Normalizer } from './normalizer.js';

export type DuplicateStrategy = 'SKIP' | 'UPDATE' | 'ADD_STOCK' | 'REPLACE';

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

    // 1. Process Insertions in concurrent batches for high speed
    const BATCH_SIZE = 25;
    if (toAdd.length > 0) {
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const chunk = toAdd.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map(async (row) => {
            try {
              const data = mapToBookInput(row);
              await prisma.book.create({ data });
              recordsAdded++;
            } catch (e: any) {
              errors.push({ row: row.row, message: `Insert failed: ${e.message}` });
            }
          })
        );
      }
    }

    // 2. Process Duplicates based on strategy
    if (toUpdate.length > 0) {
      if (strategy === 'SKIP') {
        recordsSkipped += toUpdate.length;
      } 
      else if (strategy === 'UPDATE' || strategy === 'ADD_STOCK' || strategy === 'REPLACE') {
        // Collect identifiers to batch pre-fetch existing records in 1 query
        const isbn13s = toUpdate.map(r => r.isbn13).filter(Boolean) as string[];
        const isbn10s = toUpdate.map(r => r.isbn10).filter(Boolean) as string[];
        const bookCodes = toUpdate.map(r => r.bookCode).filter(Boolean) as string[];
        const skus = toUpdate.map(r => r.sku).filter(Boolean) as string[];

        const orConditions: any[] = [];
        if (isbn13s.length > 0) orConditions.push({ isbn13: { in: isbn13s } });
        if (isbn10s.length > 0) orConditions.push({ isbn10: { in: isbn10s } });
        if (bookCodes.length > 0) orConditions.push({ bookCode: { in: bookCodes } });
        if (skus.length > 0) orConditions.push({ sku: { in: skus } });

        const existingBooks = orConditions.length > 0 ? await prisma.book.findMany({
          where: { OR: orConditions },
          select: { id: true, isbn13: true, isbn10: true, bookCode: true, sku: true, stock: true }
        }) : [];

        // Fast in-memory lookup map
        const existingMap = new Map<string, any>();
        for (const bk of existingBooks) {
          if (bk.isbn13) existingMap.set(`isbn13:${bk.isbn13}`, bk);
          if (bk.isbn10) existingMap.set(`isbn10:${bk.isbn10}`, bk);
          if (bk.bookCode) existingMap.set(`code:${bk.bookCode}`, bk);
          if (bk.sku) existingMap.set(`sku:${bk.sku}`, bk);
        }

        const findExisting = (row: any) => {
          if (row.isbn13 && existingMap.has(`isbn13:${row.isbn13}`)) return existingMap.get(`isbn13:${row.isbn13}`);
          if (row.isbn10 && existingMap.has(`isbn10:${row.isbn10}`)) return existingMap.get(`isbn10:${row.isbn10}`);
          if (row.bookCode && existingMap.has(`code:${row.bookCode}`)) return existingMap.get(`code:${row.bookCode}`);
          if (row.sku && existingMap.has(`sku:${row.sku}`)) return existingMap.get(`sku:${row.sku}`);
          return null;
        };

        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
          const chunk = toUpdate.slice(i, i + BATCH_SIZE);
          await Promise.all(
            chunk.map(async (row) => {
              try {
                const data = mapToBookInput(row);
                const existing = findExisting(row);

                if (existing) {
                  if (strategy === 'REPLACE') {
                    await prisma.book.update({
                      where: { id: existing.id },
                      data: {
                        ...data,
                        authors: { set: data.authors.connect },
                        subjects: { set: data.subjects.connect },
                      }
                    });
                  } else {
                    const mergeData: any = {};
                    for (const key of Object.keys(data) as (keyof typeof data)[]) {
                      if (data[key as keyof typeof data] !== undefined && data[key as keyof typeof data] !== null) {
                        mergeData[key] = data[key as keyof typeof data];
                      }
                    }

                    if (data.authors.connect.length > 0) mergeData.authors = { set: data.authors.connect };
                    if (data.subjects.connect.length > 0) mergeData.subjects = { set: data.subjects.connect };

                    if (strategy === 'ADD_STOCK') {
                      mergeData.stock = (existing.stock || 0) + (row.stock || 0);
                    } else if (strategy === 'UPDATE') {
                      mergeData.stock = row.stock !== undefined ? row.stock : existing.stock;
                    }

                    await prisma.book.update({
                      where: { id: existing.id },
                      data: mergeData
                    });
                  }
                  recordsUpdated++;
                } else {
                  await prisma.book.create({ data });
                  recordsAdded++;
                }
              } catch (e: any) {
                errors.push({ row: row.row, message: `Update failed: ${e.message}` });
              }
            })
          );
        }
      }
    }

    return { recordsAdded, recordsUpdated, recordsSkipped, errors };
  }
}
