import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { productRouter } from './product.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/products', productRouter);
