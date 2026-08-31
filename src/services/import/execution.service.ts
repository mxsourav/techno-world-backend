import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { ExcelRow } from '../import.service.js';
import { EntityCreator } from './entityCreator.js';
import { Writer, DuplicateStrategy } from './writer.js';

export class ExecutionService {
  /**
   * Executes the import using the analyzed payload.
   * Runs sequentially to ensure fault-tolerance (never stops because of a few invalid rows).
   */
  static async executeImport(
    userId: string | null,
    filename: string,
    toAdd: (ExcelRow & { row: number })[],
    toUpdate: (ExcelRow & { row: number })[],
    newCategories: string[],
    newAuthors: string[],
    newPublishers: string[],
    newBookTypes: string[],
    newSubjects: string[],
    warnings: { row: number; message: string }[],
    strategy: DuplicateStrategy
  ) {
    const startTime = Date.now();

    // Deduplicate lists before creating
    const uniqueAuthors = new Set(newAuthors);
    const uniquePublishers = new Set(newPublishers);
    const uniqueCategories = new Set(newCategories);
    const uniqueBookTypes = new Set(newBookTypes);
    const uniqueSubjects = new Set(newSubjects);

    let importResult: any;

    try {
      // 1. Create missing entities and get mapping
      const { authorMap, publisherMap, categoryMap, bookTypeMap, subjectMap } = await EntityCreator.createMissingEntities(
        prisma,
        uniqueAuthors,
        uniquePublishers,
        uniqueCategories,
        uniqueBookTypes,
        uniqueSubjects
      );

      // Fetch existing entity IDs to merge with the newly created ones
      const allAuthors = await prisma.author.findMany({ select: { id: true, name: true } });
      const allPublishers = await prisma.publisher.findMany({ select: { id: true, name: true } });
      const allCategories = await prisma.category.findMany({ select: { id: true, name: true } });
      const allBookTypes = await prisma.bookType.findMany({ select: { id: true, name: true } });
      const allSubjects = await prisma.subject.findMany({ select: { id: true, name: true } });

      for (const a of allAuthors) authorMap.set(a.name, a.id);
      for (const p of allPublishers) publisherMap.set(p.name, p.id);
      for (const c of allCategories) categoryMap.set(c.name, c.id);
      for (const bt of allBookTypes) bookTypeMap.set(bt.name, bt.id);
      for (const s of allSubjects) subjectMap.set(s.name, s.id);

      // 2. Write books
      importResult = await Writer.executeImport(
        prisma,
        toAdd,
        toUpdate,
        strategy,
        authorMap,
        publisherMap,
        categoryMap,
        bookTypeMap,
        subjectMap
      );

    } catch (err: any) {
      throw new Error(`Import failed during entity creation or writer initialization. Reason: ${err.message}`);
    }

    const executionTimeMs = Date.now() - startTime;
    const allErrors = importResult.errors;
    const status = allErrors.length > 0 ? 'PARTIAL' : 'SUCCESS';
    
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'IMPORT',
        entity: 'Catalog',
        entityId: filename,
        details: JSON.stringify({
          strategy,
          recordsAdded: importResult.recordsAdded,
          recordsUpdated: importResult.recordsUpdated,
          recordsSkipped: importResult.recordsSkipped,
          errors: allErrors,
          warnings,
          executionTimeMs
        }),
        ipAddress: 'System',
        userAgent: 'ImportEngine'
      }
    });

    return {
      success: true,
      recordsAdded: importResult.recordsAdded,
      recordsUpdated: importResult.recordsUpdated,
      recordsSkipped: importResult.recordsSkipped,
      errors: allErrors,
      warnings,
      executionTimeMs,
      status
    };
  }
}
