import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { registerSchema, loginSchema } from '../validators/auth.validators.js';
import { config } from '../config/index.js';

// Auth endpoints are the ones worth attacking, so they get a tighter limit than
// the rest of the API. Without this, bcrypt's cost protects the stored hashes
// but does nothing to stop someone trying ten thousand passwords against one
// account over the network.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 10_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again later.',
    },
  },
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  authController.register,
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  authController.login,
);

authRouter.get('/me', authenticate, authController.me);
