import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware.js';
import {
  listTickets,
  getTicket,
  replyTicket,
  updateTicketStatus,
  triggerSync,
} from '../../controllers/ticket.controller.js';

const router = Router();

// Protect all support desk endpoints with admin/staff authentication
router.use(requireAuth, requireRole(['ADMIN', 'SUPER_ADMIN', 'EMPLOYEE', 'ORDER_MANAGER']));

router.get('/tickets', listTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/reply', replyTicket);
router.patch('/tickets/:id/status', updateTicketStatus);
router.post('/sync', triggerSync);

export default router;
