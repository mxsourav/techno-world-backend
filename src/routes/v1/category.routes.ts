import { Router } from 'express';
import { getCategories, getCategoryBySlug } from '../../controllers/category.controller.js';

const router = Router();

router.get('/', getCategories);
router.get('/:slug', getCategoryBySlug);

export default router;
