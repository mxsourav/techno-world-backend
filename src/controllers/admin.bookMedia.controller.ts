import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { CloudinaryService } from '../services/cloudinary.service.js';

/**
 * GET /api/v1/admin/books/:id/images
 * Lists all gallery images for a book ordered by sortOrder
 */
export const getBookImages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const images = await prisma.bookImage.findMany({
      where: { bookId: id },
      orderBy: { sortOrder: 'asc' },
    });
    res.status(200).json({ success: true, data: images });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/books/:id/cover
 * Uploads/replaces the primary cover image in Home/books/{slug}/images/
 */
export const uploadBookCover = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ success: false, message: 'No cover image file uploaded' });
      return;
    }

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    // If an existing cover publicId exists, clean it up
    if (book.coverPublicId) {
      try {
        await CloudinaryService.deleteAsset(book.coverPublicId, 'image');
      } catch (err) {
        console.warn(`[BookMedia] Failed to delete previous cover ${book.coverPublicId}:`, err);
      }
    }

    const folder = CloudinaryService.getBookImagesFolder(book.slug);
    const publicId = `cover_${Date.now()}`;

    const uploadResult = await CloudinaryService.uploadBuffer(file.buffer, {
      folder,
      publicId,
      resourceType: 'image',
    });

    // Reset isCover on existing images for this book
    await prisma.bookImage.updateMany({
      where: { bookId: id },
      data: { isCover: false },
    });

    // Create or link a BookImage record for the new cover
    const coverImageRecord = await prisma.bookImage.create({
      data: {
        bookId: id,
        publicId: uploadResult.publicId,
        secureUrl: uploadResult.secureUrl,
        resourceType: uploadResult.resourceType || 'image',
        format: uploadResult.format,
        width: uploadResult.width,
        height: uploadResult.height,
        bytes: uploadResult.bytes,
        sortOrder: 0,
        isCover: true,
      },
    });

    // Update Book record with coverUrl and coverPublicId
    const updatedBook = await prisma.book.update({
      where: { id },
      data: {
        coverUrl: uploadResult.secureUrl,
        coverPublicId: uploadResult.publicId,
      },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Cover image uploaded successfully',
      data: {
        book: updatedBook,
        image: coverImageRecord,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/books/:id/images
 * Uploads one or multiple gallery images to Home/books/{slug}/images/
 */
export const uploadBookGalleryImages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, message: 'No images provided for upload' });
      return;
    }

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    // Get current maximum sortOrder
    const maxSort = await prisma.bookImage.aggregate({
      where: { bookId: id },
      _max: { sortOrder: true },
    });
    let currentSortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    const folder = CloudinaryService.getBookImagesFolder(book.slug);
    const createdImages = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const publicId = `gallery_${currentSortOrder + i + 1}_${Date.now()}`;

      const uploadResult = await CloudinaryService.uploadBuffer(file.buffer, {
        folder,
        publicId,
        resourceType: 'image',
      });

      const imageRecord = await prisma.bookImage.create({
        data: {
          bookId: id,
          publicId: uploadResult.publicId,
          secureUrl: uploadResult.secureUrl,
          resourceType: uploadResult.resourceType || 'image',
          format: uploadResult.format,
          width: uploadResult.width,
          height: uploadResult.height,
          bytes: uploadResult.bytes,
          sortOrder: currentSortOrder + i,
          isCover: false,
        },
      });

      createdImages.push(imageRecord);
    }

    // Synchronize galleryUrls string array on Book for backward compatibility
    const allGalleryImages = await prisma.bookImage.findMany({
      where: { bookId: id },
      orderBy: { sortOrder: 'asc' },
    });
    await prisma.book.update({
      where: { id },
      data: {
        galleryUrls: JSON.stringify(allGalleryImages.map((img) => img.secureUrl)),
      },
    });

    res.status(200).json({
      success: true,
      message: `${createdImages.length} gallery image(s) uploaded successfully`,
      data: createdImages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/books/:id/images/:imageId
 * Deletes a single image from Cloudinary and database
 */
export const deleteBookImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, imageId } = req.params;

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    const image = await prisma.bookImage.findFirst({
      where: { id: imageId, bookId: id },
    });

    if (!image) {
      res.status(404).json({ success: false, message: 'Image not found' });
      return;
    }

    // Delete asset from Cloudinary
    try {
      await CloudinaryService.deleteAsset(image.publicId, (image.resourceType as any) || 'image');
    } catch (err) {
      console.warn(`[BookMedia] Cloudinary asset deletion error for ${image.publicId}:`, err);
    }

    const wasCover = image.isCover || book.coverPublicId === image.publicId;

    // Remove BookImage record
    await prisma.bookImage.delete({ where: { id: imageId } });

    // If deleted image was cover, pick the next available image or reset
    let nextCoverUrl = book.coverUrl;
    let nextCoverPublicId = book.coverPublicId;

    if (wasCover) {
      const fallbackImage = await prisma.bookImage.findFirst({
        where: { bookId: id },
        orderBy: { sortOrder: 'asc' },
      });

      if (fallbackImage) {
        await prisma.bookImage.update({
          where: { id: fallbackImage.id },
          data: { isCover: true },
        });
        nextCoverUrl = fallbackImage.secureUrl;
        nextCoverPublicId = fallbackImage.publicId;
      } else {
        nextCoverUrl = null;
        nextCoverPublicId = null;
      }
    }

    // Refresh galleryUrls on Book
    const remainingImages = await prisma.bookImage.findMany({
      where: { bookId: id },
      orderBy: { sortOrder: 'asc' },
    });

    await prisma.book.update({
      where: { id },
      data: {
        coverUrl: nextCoverUrl,
        coverPublicId: nextCoverPublicId,
        galleryUrls: JSON.stringify(remainingImages.map((img) => img.secureUrl)),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      data: {
        newCoverUrl: nextCoverUrl,
        remainingImages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/books/:id/images/reorder
 * Reorders gallery images based on an array of image IDs
 */
export const reorderBookImages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds)) {
      res.status(400).json({ success: false, message: 'imageIds must be an array of image IDs' });
      return;
    }

    // Update sortOrder in transaction
    const updateOperations = imageIds.map((imgId: string, index: number) =>
      prisma.bookImage.updateMany({
        where: { id: imgId, bookId: id },
        data: { sortOrder: index },
      })
    );

    await prisma.$transaction(updateOperations);

    // Refresh galleryUrls
    const orderedImages = await prisma.bookImage.findMany({
      where: { bookId: id },
      orderBy: { sortOrder: 'asc' },
    });

    await prisma.book.update({
      where: { id },
      data: {
        galleryUrls: JSON.stringify(orderedImages.map((img) => img.secureUrl)),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Images reordered successfully',
      data: orderedImages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/books/:id/images/:imageId/cover
 * Sets a specific gallery image as the primary book cover
 */
export const setBookCoverImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, imageId } = req.params;

    const image = await prisma.bookImage.findFirst({
      where: { id: imageId, bookId: id },
    });

    if (!image) {
      res.status(404).json({ success: false, message: 'Image not found' });
      return;
    }

    // Reset all images for this book
    await prisma.bookImage.updateMany({
      where: { bookId: id },
      data: { isCover: false },
    });

    // Mark target as cover
    await prisma.bookImage.update({
      where: { id: imageId },
      data: { isCover: true },
    });

    // Update Book
    const updatedBook = await prisma.book.update({
      where: { id },
      data: {
        coverUrl: image.secureUrl,
        coverPublicId: image.publicId,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Cover image updated successfully',
      data: {
        coverUrl: updatedBook.coverUrl,
        coverPublicId: updatedBook.coverPublicId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/books/:id/pdf
 * Uploads/replaces preview PDF in Home/books/{slug}/documents/
 */
export const uploadBookPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ success: false, message: 'No PDF file uploaded' });
      return;
    }

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    // If an existing preview PDF exists, clean it up
    if (book.previewPdfPublicId) {
      try {
        await CloudinaryService.deleteAsset(
          book.previewPdfPublicId,
          (book.previewPdfResourceType as any) || 'raw'
        );
      } catch (err) {
        console.warn(`[BookMedia] Error deleting previous PDF ${book.previewPdfPublicId}:`, err);
      }
    }

    const folder = CloudinaryService.getBookDocsFolder(book.slug);
    const publicId = `preview_${Date.now()}`;

    const uploadResult = await CloudinaryService.uploadBuffer(file.buffer, {
      folder,
      publicId,
      resourceType: 'raw',
    });

    const updatedBook = await prisma.book.update({
      where: { id },
      data: {
        previewPdfUrl: uploadResult.secureUrl,
        previewPdfPublicId: uploadResult.publicId,
        previewPdfResourceType: 'raw',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Preview PDF uploaded successfully',
      data: {
        previewPdfUrl: updatedBook.previewPdfUrl,
        previewPdfPublicId: updatedBook.previewPdfPublicId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/books/:id/pdf
 * Deletes the preview PDF from Cloudinary and database
 */
export const deleteBookPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) {
      res.status(404).json({ success: false, message: 'Book not found' });
      return;
    }

    if (book.previewPdfPublicId) {
      try {
        await CloudinaryService.deleteAsset(
          book.previewPdfPublicId,
          (book.previewPdfResourceType as any) || 'raw'
        );
      } catch (err) {
        console.warn(`[BookMedia] Error deleting PDF asset ${book.previewPdfPublicId}:`, err);
      }
    }

    await prisma.book.update({
      where: { id },
      data: {
        previewPdfUrl: null,
        previewPdfPublicId: null,
        previewPdfResourceType: 'raw',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Preview PDF removed successfully',
    });
  } catch (error) {
    next(error);
  }
};
