import { Router } from 'express';
import { createToken, listUsers } from './auth.controller';

const router = Router();

router.post('/token', createToken);
router.get('/users', listUsers);

export { router as authRoutes };
