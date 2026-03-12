import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import * as controller from './request.controller';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  requireRole('REQUESTER'),
  controller.create,
);

router.get('/', controller.list);
router.get('/:id', controller.getById);

router.patch(
  '/:id/decision',
  requireRole('APPROVER'),
  controller.decide,
);

export { router as requestRoutes };
