import { Router } from 'express';
import healthRoutes from './health.js';
import v1Routes from './v1/index.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Techno World Books API',
    status: 'Active',
    documentation: '/docs',
    api: '/api/v1',
  });
});

router.use(healthRoutes);
router.use('/api/v1', v1Routes);

export default router;
