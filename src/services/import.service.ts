import * as xlsx from 'xlsx';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { CloudinaryService } from './cloudinary.service.js';

const ExcelRowSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  subtitle: z.string().optional(),
  authors: z.string().min(1, 'At least one author is required (comma separated)'),
  publisher: z.string().min(1, 'Publisher is required'),
  isbn10: z.string().optional(),
  isbn13: z.string().optional(),
  bookCode: z.string().optional(), // Publication Number
  edition: z.string().optional(),
  language: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  subcategory: z.string().optional(),
  bookType: z.string().optional(),
  subjects: z.string().optional(), // Comma separated
  tags: z.string().optional(), // Comma separated
  price: z.coerce.number().min(0, 'Price must be >= 0'),
  mrp: z.coerce.number().min(0, 'MRP must be >= 0'),
  stock: z.coerce.number().min(0, 'Stock must be >= 0').default(0),
  sku: z.string().optional(),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  coverPublicId: z.string().optional(),
  galleryUrls: z.string().optional(),
  galleryPublicIds: z.string().optional(),
  previewPdfUrl: z.string().optional(),
  previewPdfPublicId: z.string().optional(),
  pages: z.coerce.number().optional(),
  publicationDate: z.string().optional(),
  publicationYear: z.coerce.number().optional(),
  printYear: z.coerce.number().optional(),
  reprintNumber: z.coerce.number().optional(),
  bindingType: z.string().optional(),
  coverType: z.string().optional(),
  university: z.string().optional(),
  semester: z.string().optional(),
  course: z.string().optional(),
  examination: z.string().optional(),
  classStandard: z.string().optional(),
  barcode: z.string().optional(),
  series: z.string().optional(),
  volume: z.string().optional(),
});

export type ExcelRow = z.infer<typeof ExcelRowSchema>;

export class ImportService {
  static async analyzeImport(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = (xlsx.utils.sheet_to_json(sheet) as any[]).map((row: any) => {
      if (!row || typeof row !== 'object') return {};
      const cleanRow: Record<string, any> = {};
      for (const [key, val] of Object.entries(row)) {
        const lowerKey = key.toLowerCase().trim();
        if (lowerKey === '__proto__' || lowerKey === 'constructor' || lowerKey === 'prototype') {
          continue;
        }
        cleanRow[key] = val;
      }
      return cleanRow;
    });

    const result = {
      toAdd: [] as any[],
      toUpdate: [] as any[],
      newCategories: new Set<string>(),
      newAuthors: new Set<string>(),
      newPublishers: new Set<string>(),
      newBookTypes: new Set<string>(),
      newSubjects: new Set<string>(),
      warnings: [] as any[],
      errors: [] as any[],
      totalProcessed: 0,
    };

    // Pre-fetch existing entities to map
    const categoriesRaw = await prisma.category.findMany({ select: { name: true } });
    const authorsRaw = await prisma.author.findMany({ select: { name: true } });
    const publishersRaw = await prisma.publisher.findMany({ select: { name: true } });
    const bookTypesRaw = await prisma.bookType.findMany({ select: { name: true } });
    const subjectsRaw = await prisma.subject.findMany({ select: { name: true } });
    const booksRaw = await prisma.book.findMany({ select: { isbn13: true, isbn10: true, bookCode: true, sku: true } });

    const existingCats = new Set(categoriesRaw.map(c => c.name.toLowerCase()));
    const existingAuthors = new Set(authorsRaw.map(a => a.name.toLowerCase()));
    const existingPublishers = new Set(publishersRaw.map(p => p.name.toLowerCase()));
    const existingBookTypes = new Set(bookTypesRaw.map(bt => bt.name.toLowerCase()));
    const existingSubjects = new Set(subjectsRaw.map(s => s.name.toLowerCase()));

    const existingIsbn13s = new Set(booksRaw.filter(b => b.isbn13).map(b => b.isbn13 as string));
    const existingIsbn10s = new Set(booksRaw.filter(b => b.isbn10).map(b => b.isbn10 as string));
    const existingCodes = new Set(booksRaw.filter(b => b.bookCode).map(b => b.bookCode as string));
    const existingSkus = new Set(booksRaw.filter(b => b.sku).map(b => b.sku as string));

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 2; // +1 for 0-index, +1 for header
      result.totalProcessed++;

      // Rule-based metadata detection
      let detectedBookType = row['Book Type'] || row.bookType;
      let detectedSubjects = row['Subjects'] || row.subjects;

      if (!detectedBookType) {
        const titleLower = (row['Book Title'] || row.title || '').toLowerCase();
        if (titleLower.includes('exam') || titleLower.includes('jee') || titleLower.includes('neet')) detectedBookType = 'Competitive Exam';
        else if (titleLower.includes('guide') || titleLower.includes('solution')) detectedBookType = 'Reference';
        else if (row['Category']?.toLowerCase().includes('fiction')) detectedBookType = 'Fiction';
      }

      if (!detectedSubjects) {
        const titleLower = (row['Book Title'] || row.title || '').toLowerCase();
        if (titleLower.includes('physics')) detectedSubjects = 'Physics';
        else if (titleLower.includes('chemistry')) detectedSubjects = 'Chemistry';
        else if (titleLower.includes('mathematics') || titleLower.includes('math')) detectedSubjects = 'Mathematics';
        else if (titleLower.includes('history')) detectedSubjects = 'History';
      }

      const mappedRow: any = {
        title: row['Book Title'] || row.title,
        subtitle: row['Subtitle'] || row.subtitle,
        authors: row['Authors'] || row['Author'] || row.author,
        publisher: row['Publisher'] || row.publisher,
        isbn13: row['ISBN-13'] || row.isbn13 || row['isbn13'] || (row['ISBN'] && String(row['ISBN']).replace(/[^0-9X]/gi,'').length >= 13 ? String(row['ISBN']).replace(/[^0-9X]/gi,'') : undefined) || (row['isbn'] && String(row['isbn']).replace(/[^0-9X]/gi,'').length >= 13 ? String(row['isbn']).replace(/[^0-9X]/gi,'') : undefined),
        isbn10: row['ISBN-10'] || row.isbn10 || row['isbn10'] || (row['ISBN'] && String(row['ISBN']).replace(/[^0-9X]/gi,'').length === 10 ? String(row['ISBN']).replace(/[^0-9X]/gi,'') : undefined) || (row['isbn'] && String(row['isbn']).replace(/[^0-9X]/gi,'').length === 10 ? String(row['isbn']).replace(/[^0-9X]/gi,'') : undefined),
        bookCode: row['Publication Number'] || row['Book Code'] || row.bookCode,
        edition: row['Edition'] || row.edition,
        language: row['Language'] || row.language,
        category: row['Category'] || row.category,
        subcategory: row['Subcategory'] || row.subcategory,
        bookType: detectedBookType,
        subjects: detectedSubjects,
        tags: row['Tags'] || row.tags,
        price: row['Price'] ?? row.price,
        mrp: row['MRP'] ?? row.mrp,
        stock: row['Stock'] ?? row.stock,
        sku: row['SKU'] || row.sku,
        description: row['Description'] || row.description,
        coverUrl: row['Cover Image'] || row['Cover URL'] || row['Thumbnail URL'] || row.coverUrl || row.thumbnail_url,
        coverPublicId: row['Cover Public ID'] || row['Thumbnail Public ID'] || row.coverPublicId || row.thumbnail_public_id,
        galleryUrls: row['Gallery Images'] || row['Gallery URLs'] || row.galleryUrls || row.gallery_urls,
        galleryPublicIds: row['Gallery Public IDs'] || row.galleryPublicIds || row.gallery_public_ids,
        previewPdfUrl: row['Preview PDF URL'] || row['Preview PDF'] || row['Sample PDF'] || row.previewPdfUrl || row.preview_pdf_url,
        previewPdfPublicId: row['Preview PDF Public ID'] || row.previewPdfPublicId || row.preview_pdf_public_id,
        pages: row['Pages'] || row.pages,
        publicationDate: row['Publication Date'] || row.publicationDate,
        publicationYear: row['Publication Year'] || row.publicationYear,
        printYear: row['Print Year'] || row.printYear,
        reprintNumber: row['Reprint Number'] || row.reprintNumber,
        bindingType: row['Binding Type'] || row.bindingType,
        coverType: row['Cover Type'] || row.coverType,
        university: row['University'] || row.university,
        semester: row['Semester'] || row.semester,
        course: row['Course'] || row.course,
        examination: row['Examination'] || row.examination,
        classStandard: row['Class'] || row['Standard'] || row.classStandard,
        barcode: row['Barcode'] || row.barcode,
        series: row['Series'] || row.series,
        volume: row['Volume'] || row.volume,
      };

      // Smart Cloudinary Public ID Extraction if missing
      if (mappedRow.coverUrl && !mappedRow.coverPublicId) {
        const extracted = CloudinaryService.extractPublicIdFromUrl(String(mappedRow.coverUrl));
        if (extracted) {
          mappedRow.coverPublicId = extracted.publicId;
        }
      }

      if (mappedRow.previewPdfUrl && !mappedRow.previewPdfPublicId) {
        const extracted = CloudinaryService.extractPublicIdFromUrl(String(mappedRow.previewPdfUrl));
        if (extracted) {
          mappedRow.previewPdfPublicId = extracted.publicId;
        }
      }

      if (mappedRow.galleryUrls) {
        let gUrls: string[] = [];
        try {
          const rawG = String(mappedRow.galleryUrls).trim();
          if (rawG.startsWith('[')) {
            gUrls = JSON.parse(rawG);
          } else {
            gUrls = rawG.split(/[;,]/).map((u: string) => u.trim()).filter(Boolean);
          }
        } catch {
          gUrls = [];
        }
        mappedRow.galleryUrls = JSON.stringify(gUrls);

        if (!mappedRow.galleryPublicIds && gUrls.length > 0) {
          const extractedIds = gUrls
            .map((u) => CloudinaryService.extractPublicIdFromUrl(u)?.publicId)
            .filter(Boolean) as string[];
          mappedRow.galleryPublicIds = JSON.stringify(extractedIds);
        }
      }

      const parsed = ExcelRowSchema.safeParse(mappedRow);
      if (!parsed.success) {
        parsed.error.errors.forEach(err => {
          result.errors.push({ row: rowNum, message: `${err.path.join('.')}: ${err.message}` });
        });
        continue;
      }

      const data = parsed.data;

      // Duplicate detection
      let isDuplicate = false;
      if (data.isbn13 && existingIsbn13s.has(data.isbn13)) isDuplicate = true;
      if (data.isbn10 && existingIsbn10s.has(data.isbn10)) isDuplicate = true;
      if (data.bookCode && existingCodes.has(data.bookCode)) isDuplicate = true;
      if (data.sku && existingSkus.has(data.sku)) isDuplicate = true;

      if (isDuplicate) {
        result.toUpdate.push({ row: rowNum, ...data });
      } else {
        result.toAdd.push({ row: rowNum, ...data });
      }

      // Track missing entities
      if (data.category && !existingCats.has(data.category.toLowerCase())) {
        result.newCategories.add(data.category);
        existingCats.add(data.category.toLowerCase());
      }
      if (data.subcategory && !existingCats.has(data.subcategory.toLowerCase())) {
        result.newCategories.add(data.subcategory);
        existingCats.add(data.subcategory.toLowerCase());
      }
      if (data.publisher && !existingPublishers.has(data.publisher.toLowerCase())) {
        result.newPublishers.add(data.publisher);
        existingPublishers.add(data.publisher.toLowerCase());
      }
      if (data.bookType && !existingBookTypes.has(data.bookType.toLowerCase())) {
        result.newBookTypes.add(data.bookType);
        existingBookTypes.add(data.bookType.toLowerCase());
      }
      
      const rowAuthors = data.authors.split(',').map(a => a.trim()).filter(Boolean);
      rowAuthors.forEach(a => {
        if (!existingAuthors.has(a.toLowerCase())) {
          result.newAuthors.add(a);
          existingAuthors.add(a.toLowerCase());
        }
      });

      if (data.subjects) {
        const rowSubjects = data.subjects.split(',').map(s => s.trim()).filter(Boolean);
        rowSubjects.forEach(s => {
          if (!existingSubjects.has(s.toLowerCase())) {
            result.newSubjects.add(s);
            existingSubjects.add(s.toLowerCase());
          }
        });
      }

      if (!data.coverUrl) {
        result.warnings.push({ row: rowNum, message: 'Missing cover image. Will use placeholder.' });
      }
    }

    return {
      toAdd: result.toAdd,
      toUpdate: result.toUpdate,
      newCategories: Array.from(result.newCategories),
      newAuthors: Array.from(result.newAuthors),
      newPublishers: Array.from(result.newPublishers),
      newBookTypes: Array.from(result.newBookTypes),
      newSubjects: Array.from(result.newSubjects),
      warnings: result.warnings,
      errors: result.errors,
      totalProcessed: result.totalProcessed,
    };
  }
}
