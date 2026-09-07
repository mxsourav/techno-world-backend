import { Router } from 'express';
import {
  getBlogPosts,
  getBlogPostBySlug,
  getAdminBlogPosts,
  createBlogPost,
  updateBlogPost,
  toggleBlogPostStatus,
  deleteBlogPost,
} from '../../controllers/blog.controller.js';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public routes
router.get('/', getBlogPosts);
router.get('/:slug', getBlogPostBySlug);

// Admin routes
router.get('/admin/all', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), getAdminBlogPosts);
router.post('/admin', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), createBlogPost);
router.put('/admin/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), updateBlogPost);
router.patch('/admin/:id/toggle-status', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), toggleBlogPostStatus);
router.delete('/admin/:id', requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN']), deleteBlogPost);

export default router;
