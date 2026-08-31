import { Router } from 'express';
import { getBooks, getBookBySlug } from '../../controllers/book.controller.js';

const router = Router();

router.get('/', getBooks);
router.get('/:slug', getBookBySlug);

export default router;
