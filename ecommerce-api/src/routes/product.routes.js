import { Router } from 'express';
import * as productController from '../controllers/product.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate, authenticateOptional } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/requireRole.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  productIdSchema,
  productSlugSchema,
} from '../validators/product.validators.js';

export const productRouter = Router();

// Reads are public, but run through authenticateOptional so an admin browsing
// the catalogue can also see withdrawn products. A signed-out visitor gets the
// same route with req.user === null.
productRouter.get(
  '/',
  authenticateOptional,
  validate({ query: listProductsSchema }),
  productController.list,
);

productRouter.get(
  '/:slug',
  authenticateOptional,
  validate({ params: productSlugSchema }),
  productController.getBySlug,
);

// Writes are admin-only. authenticate before requireAdmin so a signed-out
// caller gets 401 and a signed-in non-admin gets 403.
productRouter.post(
  '/',
  authenticate,
  requireAdmin,
  validate({ body: createProductSchema }),
  productController.create,
);

// Writes address products by id, not slug: a slug is editable, so using it as
// the write target means a rename silently changes what a stored URL points at.
productRouter.patch(
  '/:id',
  authenticate,
  requireAdmin,
  validate({ params: productIdSchema, body: updateProductSchema }),
  productController.update,
);

productRouter.delete(
  '/:id',
  authenticate,
  requireAdmin,
  validate({ params: productIdSchema }),
  productController.deactivate,
);
