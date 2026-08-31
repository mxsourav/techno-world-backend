import { Router } from 'express';
import { instantSearch } from '../../controllers/search.controller.js';

const router = Router();

router.get('/', instantSearch);

export default router;
