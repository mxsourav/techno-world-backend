import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
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
    const errors: { row: number; message: string }[] = [];

    // Helper to map an ExcelRow to book fields and relation lists
    const mapRowToBook = (row: ExcelRow, assignedId?: string) => {
      const id = assignedId || randomUUID();
      const title = row.title.trim();
      const uniqueToken = row.isbn13 || row.isbn10 || row.sku || row.bookCode || randomUUID().substring(0, 8);
      const slug = Normalizer.generateSlug(title, uniqueToken);

      const categoryId = row.subcategory
        ? (categoryMap.get(row.subcategory) || categoryMap.get(row.subcategory.toLowerCase().trim()))
        : (row.category ? (categoryMap.get(row.category) || categoryMap.get(row.category.toLowerCase().trim())) : undefined);

      const bookTypeId = row.bookType
        ? (bookTypeMap.get(row.bookType) || bookTypeMap.get(row.bookType.toLowerCase().trim()))
        : undefined;

      const publisherId = row.publisher
        ? (publisherMap.get(row.publisher) || publisherMap.get(row.publisher.toLowerCase().trim()))
        : undefined;

      const authorIds: string[] = [];
      if (row.authors) {
        const authorTokens = row.authors.split(',').map(a => a.trim()).filter(Boolean);
        for (const authRaw of authorTokens) {
          const authId = authorMap.get(authRaw) || authorMap.get(Normalizer.normalizeName(authRaw)) || authorMap.get(authRaw.toLowerCase().trim());
          if (authId) authorIds.push(authId);
        }
      }

      const subjectIds: string[] = [];
      if (row.subjects) {
        const subjectTokens = row.subjects.split(',').map(s => s.trim()).filter(Boolean);
        for (const subRaw of subjectTokens) {
          const subId = subjectMap.get(subRaw) || subjectMap.get(Normalizer.normalizeName(subRaw)) || subjectMap.get(subRaw.toLowerCase().trim());
          if (subId) subjectIds.push(subId);
        }
      }

      const bookData = {
        id,
        title,
        subtitle: row.subtitle || null,
        slug,
        isbn13: row.isbn13 || null,
        isbn10: row.isbn10 || null,
        sku: row.sku || null,
        bookCode: row.bookCode || null,
        edition: row.edition || null,
        language: row.language || 'English',
        description: row.description || '',
        price: row.price,
        mrp: row.mrp,
        stock: row.stock,
        pages: row.pages || null,
        publicationDate: row.publicationDate ? new Date(row.publicationDate) : null,
        publicationYear: row.publicationYear || null,
        printYear: row.printYear || null,
        reprintNumber: row.reprintNumber || null,
        bindingType: row.bindingType || null,
        coverType: row.coverType || null,
        university: row.university || null,
        semester: row.semester || null,
        course: row.course || null,
        examination: row.examination || null,
        classStandard: row.classStandard || null,
        barcode: row.barcode || null,
        series: row.series || null,
        volume: row.volume || null,
        coverUrl: row.coverUrl || '/placeholder-book.jpg',
        categoryId: categoryId || null,
        bookTypeId: bookTypeId || null,
        publisherId: publisherId || null,
        tags: row.tags || '[]',
        status: 'PUBLISHED' as const,
        visibility: true,
      };

      return { id, bookData, authorIds: [...new Set(authorIds)], subjectIds: [...new Set(subjectIds)] };
    };

    // 1. High-Speed Bulk Insertions for toAdd
    if (toAdd.length > 0) {
      const booksToInsert: any[] = [];
      const authorRelations: { A: string; B: string }[] = [];
      const subjectRelations: { A: string; B: string }[] = [];

      for (const row of toAdd) {
        try {
          const { id, bookData, authorIds, subjectIds } = mapRowToBook(row);
          booksToInsert.push(bookData);

          for (const aId of authorIds) {
            authorRelations.push({ A: aId, B: id });
          }
          for (const sId of subjectIds) {
            subjectRelations.push({ A: id, B: sId });
          }
        } catch (e: any) {
          errors.push({ row: row.row, message: `Data mapping failed: ${e.message}` });
        }
      }

      // Bulk write books in chunks of 250
      const CHUNK_SIZE = 250;
      for (let i = 0; i < booksToInsert.length; i += CHUNK_SIZE) {
        const chunk = booksToInsert.slice(i, i + CHUNK_SIZE);
        try {
          const res = await prisma.book.createMany({
            data: chunk,
            skipDuplicates: true,
          });
          recordsAdded += res.count;
        } catch (err: any) {
          console.warn('Batch createMany warning, falling back to granular insert:', err.message);
          for (const single of chunk) {
            try {
              await prisma.book.create({ data: single });
              recordsAdded++;
            } catch (e: any) {
              errors.push({ row: 0, message: `Insert failed: ${e.message}` });
            }
          }
        }
      }

      // Fast bulk insert author relations into _AuthorToBook in chunks of 500
      if (authorRelations.length > 0) {
        const REL_CHUNK = 500;
        for (let i = 0; i < authorRelations.length; i += REL_CHUNK) {
          const chunk = authorRelations.slice(i, i + REL_CHUNK);
          try {
            await prisma.$executeRaw`
              INSERT IGNORE INTO _AuthorToBook (A, B) VALUES 
              ${Prisma.join(chunk.map(r => Prisma.sql`(${r.A}, ${r.B})`))}
            `;
          } catch (err: any) {
            console.warn('Batch author relation link warning:', err.message);
          }
        }
      }

      // Fast bulk insert subject relations into _BookToSubject in chunks of 500
      if (subjectRelations.length > 0) {
        const REL_CHUNK = 500;
        for (let i = 0; i < subjectRelations.length; i += REL_CHUNK) {
          const chunk = subjectRelations.slice(i, i + REL_CHUNK);
          try {
            await prisma.$executeRaw`
              INSERT IGNORE INTO _BookToSubject (A, B) VALUES 
              ${Prisma.join(chunk.map(r => Prisma.sql`(${r.A}, ${r.B})`))}
            `;
          } catch (err: any) {
            console.warn('Batch subject relation link warning:', err.message);
          }
        }
      }
    }

    // 2. Process Duplicates based on strategy
    if (toUpdate.length > 0) {
      if (strategy === 'SKIP') {
        recordsSkipped += toUpdate.length;
      } else if (strategy === 'UPDATE' || strategy === 'ADD_STOCK' || strategy === 'REPLACE') {
        const isbn13s = toUpdate.map(r => r.isbn13).filter(Boolean) as string[];
        const isbn10s = toUpdate.map(r => r.isbn10).filter(Boolean) as string[];
        const bookCodes = toUpdate.map(r => r.bookCode).filter(Boolean) as string[];
        const skus = toUpdate.map(r => r.sku).filter(Boolean) as string[];

        const orConditions: any[] = [];
        if (isbn13s.length > 0) orConditions.push({ isbn13: { in: isbn13s } });
        if (isbn10s.length > 0) orConditions.push({ isbn10: { in: isbn10s } });
        if (bookCodes.length > 0) orConditions.push({ bookCode: { in: bookCodes } });
        if (skus.length > 0) orConditions.push({ sku: { in: skus } });

        const existingBooks = orConditions.length > 0
          ? await prisma.book.findMany({
              where: { OR: orConditions },
              select: { id: true, slug: true, isbn13: true, isbn10: true, bookCode: true, sku: true, stock: true }
            })
          : [];

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

        if (strategy === 'ADD_STOCK') {
          const stockUpdates: { id: string; stockAdd: number }[] = [];
          for (const row of toUpdate) {
            const existing = findExisting(row);
            if (existing) {
              stockUpdates.push({ id: existing.id, stockAdd: Number(row.stock) || 0 });
            }
          }

          const CHUNK = 200;
          for (let i = 0; i < stockUpdates.length; i += CHUNK) {
            const chunk = stockUpdates.slice(i, i + CHUNK);
            const cases = chunk.map(u => Prisma.sql`WHEN ${u.id} THEN ${u.stockAdd}`);
            const ids = chunk.map(u => u.id);

            try {
              await prisma.$executeRaw`
                UPDATE Book
                SET stock = stock + CASE id
                  ${Prisma.join(cases, ' ')}
                  ELSE 0
                END,
                updatedAt = NOW()
                WHERE id IN (${Prisma.join(ids)})
              `;
              recordsUpdated += chunk.length;
            } catch (err: any) {
              console.warn('Batch stock update warning, falling back to granular update:', err.message);
              for (const item of chunk) {
                try {
                  await prisma.book.update({
                    where: { id: item.id },
                    data: { stock: { increment: item.stockAdd } }
                  });
                  recordsUpdated++;
                } catch (e: any) {
                  errors.push({ row: 0, message: `Stock update failed: ${e.message}` });
                }
              }
            }
          }
        } else if (strategy === 'UPDATE' || strategy === 'REPLACE') {
          const bulkValues: any[] = [];
          const updatedBookIds: string[] = [];
          const authorRelations: { A: string; B: string }[] = [];
          const subjectRelations: { A: string; B: string }[] = [];

          for (const row of toUpdate) {
            try {
              const existing = findExisting(row);
              if (existing) {
                const { id, bookData, authorIds, subjectIds } = mapRowToBook(row, existing.id);
                updatedBookIds.push(id);

                bulkValues.push(Prisma.sql`(
                  ${id},
                  ${bookData.title},
                  ${bookData.subtitle},
                  ${existing.slug || bookData.slug},
                  ${bookData.isbn13},
                  ${bookData.isbn10},
                  ${bookData.sku},
                  ${bookData.bookCode},
                  ${bookData.edition},
                  ${bookData.language},
                  ${bookData.description},
                  ${bookData.price},
                  ${bookData.mrp},
                  ${bookData.stock},
                  ${bookData.pages},
                  ${bookData.publicationDate},
                  ${bookData.publicationYear},
                  ${bookData.printYear},
                  ${bookData.reprintNumber},
                  ${bookData.bindingType},
                  ${bookData.coverType},
                  ${bookData.university},
                  ${bookData.semester},
                  ${bookData.course},
                  ${bookData.examination},
                  ${bookData.classStandard},
                  ${bookData.barcode},
                  ${bookData.series},
                  ${bookData.volume},
                  ${bookData.coverUrl},
                  ${bookData.categoryId},
                  ${bookData.bookTypeId},
                  ${bookData.publisherId},
                  ${bookData.tags},
                  ${bookData.status},
                  ${bookData.visibility},
                  NOW()
                )`);

                for (const aId of authorIds) {
                  authorRelations.push({ A: aId, B: id });
                }
                for (const sId of subjectIds) {
                  subjectRelations.push({ A: id, B: sId });
                }
              }
            } catch (e: any) {
              errors.push({ row: row.row, message: `Data mapping failed: ${e.message}` });
            }
          }

          // Bulk update books in chunks of 150
          const CHUNK = 150;
          for (let i = 0; i < bulkValues.length; i += CHUNK) {
            const chunk = bulkValues.slice(i, i + CHUNK);
            try {
              await prisma.$executeRaw`
                INSERT INTO Book (
                  id, title, subtitle, slug, isbn13, isbn10, sku, bookCode, edition,
                  language, description, price, mrp, stock, pages, publicationDate,
                  publicationYear, printYear, reprintNumber, bindingType, coverType,
                  university, semester, course, examination, classStandard, barcode,
                  series, volume, coverUrl, categoryId, bookTypeId, publisherId,
                  tags, status, visibility, updatedAt
                ) VALUES
                  ${Prisma.join(chunk)}
                ON DUPLICATE KEY UPDATE
                  title = VALUES(title),
                  subtitle = VALUES(subtitle),
                  edition = VALUES(edition),
                  language = VALUES(language),
                  description = VALUES(description),
                  price = VALUES(price),
                  mrp = VALUES(mrp),
                  stock = VALUES(stock),
                  pages = VALUES(pages),
                  publicationDate = VALUES(publicationDate),
                  publicationYear = VALUES(publicationYear),
                  printYear = VALUES(printYear),
                  reprintNumber = VALUES(reprintNumber),
                  bindingType = VALUES(bindingType),
                  coverType = VALUES(coverType),
                  university = VALUES(university),
                  semester = VALUES(semester),
                  course = VALUES(course),
                  examination = VALUES(examination),
                  classStandard = VALUES(classStandard),
                  barcode = VALUES(barcode),
                  series = VALUES(series),
                  volume = VALUES(volume),
                  coverUrl = VALUES(coverUrl),
                  categoryId = VALUES(categoryId),
                  bookTypeId = VALUES(bookTypeId),
                  publisherId = VALUES(publisherId),
                  tags = VALUES(tags),
                  status = VALUES(status),
                  visibility = VALUES(visibility),
                  updatedAt = NOW()
              `;
              recordsUpdated += chunk.length;
            } catch (err: any) {
              console.warn('Batch bulk update warning, falling back to granular update:', err.message);
              for (const row of toUpdate.slice(i, i + CHUNK)) {
                try {
                  const existing = findExisting(row);
                  if (existing) {
                    const { bookData } = mapRowToBook(row, existing.id);
                    await prisma.book.update({
                      where: { id: existing.id },
                      data: bookData
                    });
                    recordsUpdated++;
                  }
                } catch (e: any) {
                  errors.push({ row: row.row, message: `Update failed: ${e.message}` });
                }
              }
            }
          }

          // Fast bulk author relation updates
          if (authorRelations.length > 0 && updatedBookIds.length > 0) {
            const DEL_CHUNK = 250;
            for (let i = 0; i < updatedBookIds.length; i += DEL_CHUNK) {
              const idChunk = updatedBookIds.slice(i, i + DEL_CHUNK);
              try {
                await prisma.$executeRaw`
                  DELETE FROM _AuthorToBook WHERE B IN (${Prisma.join(idChunk)})
                `;
              } catch (e: any) {
                console.warn('Batch relation delete warning:', e.message);
              }
            }
            const INS_CHUNK = 500;
            for (let i = 0; i < authorRelations.length; i += INS_CHUNK) {
              const relChunk = authorRelations.slice(i, i + INS_CHUNK);
              try {
                await prisma.$executeRaw`
                  INSERT IGNORE INTO _AuthorToBook (A, B) VALUES 
                  ${Prisma.join(relChunk.map(r => Prisma.sql`(${r.A}, ${r.B})`))}
                `;
              } catch (e: any) {
                console.warn('Batch author relation insert warning:', e.message);
              }
            }
          }

          // Fast bulk subject relation updates
          if (subjectRelations.length > 0 && updatedBookIds.length > 0) {
            const DEL_CHUNK = 250;
            for (let i = 0; i < updatedBookIds.length; i += DEL_CHUNK) {
              const idChunk = updatedBookIds.slice(i, i + DEL_CHUNK);
              try {
                await prisma.$executeRaw`
                  DELETE FROM _BookToSubject WHERE A IN (${Prisma.join(idChunk)})
                `;
              } catch (e: any) {
                console.warn('Batch subject relation delete warning:', e.message);
              }
            }
            const INS_CHUNK = 500;
            for (let i = 0; i < subjectRelations.length; i += INS_CHUNK) {
              const relChunk = subjectRelations.slice(i, i + INS_CHUNK);
              try {
                await prisma.$executeRaw`
                  INSERT IGNORE INTO _BookToSubject (A, B) VALUES 
                  ${Prisma.join(relChunk.map(r => Prisma.sql`(${r.A}, ${r.B})`))}
                `;
              } catch (e: any) {
                console.warn('Batch subject relation insert warning:', e.message);
              }
            }
          }
        }
      }
    }

    return { recordsAdded, recordsUpdated, recordsSkipped, errors };
  }
}
