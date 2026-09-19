import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';


export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.status(200).json({
      success: true,
      message: 'Categories fetched successfully',
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoryBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const category = await prisma.category.findUnique({
      where: { slug },
    });

    if (!category) {
      res.status(404).json({
        success: false,
        message: 'Category not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Category fetched successfully',
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllCategoriesAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { books: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'All categories fetched successfully',
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

export const reorderCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryIds, items } = req.body;

    let updates: { id: string; sortOrder: number }[] = [];

    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
      updates = categoryIds.map((id: string, index: number) => ({
        id: String(id),
        sortOrder: index,
      }));
    } else if (Array.isArray(items) && items.length > 0) {
      updates = items.map((item: any, index: number) => ({
        id: String(item.id),
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
      }));
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid payload. Expected categoryIds array or items array.',
      });
      return;
    }

    // Update in a transaction
    await prisma.$transaction(
      updates.map((u) =>
        prisma.category.update({
          where: { id: u.id },
          data: { sortOrder: u.sortOrder },
        })
      )
    );

    const updatedCategories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.status(200).json({
      success: true,
      message: 'Categories reordered successfully',
      data: updatedCategories,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, slug, description, imageUrl, iconUrl, sortOrder, isActive } = req.body;

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(iconUrl !== undefined && { iconUrl }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};
