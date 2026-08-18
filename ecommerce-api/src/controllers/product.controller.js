import * as productService from '../services/product.service.js';
import { publicProduct } from '../lib/serialize.js';
import { forbidden } from '../lib/errors.js';

const isAdmin = (req) => req.user?.role === 'ADMIN';

// Decides what this caller is allowed to see, and it is the ONLY place that
// decision is made. The service takes the answer as a parameter rather than
// inspecting req itself, which is what keeps it testable without HTTP.
function resolveStatus(req) {
  const requested = req.query.status;

  if (requested && !isAdmin(req)) {
    // A 403 rather than quietly ignoring the parameter. Silently dropping
    // something a caller deliberately sent is how people debug the wrong thing
    // for an hour.
    throw forbidden('Only an admin may filter products by status.');
  }

  return requested ?? 'active';
}

export async function list(req, res, next) {
  try {
    const { items, page } = await productService.listProducts({
      ...req.query,
      status: resolveStatus(req),
    });
    res.status(200).json({ data: items.map(publicProduct), page });
  } catch (error) {
    next(error);
  }
}

export async function getBySlug(req, res, next) {
  try {
    const product = await productService.getProductBySlug(req.params.slug, {
      includeInactive: isAdmin(req),
    });
    res.status(200).json({ product: publicProduct(product) });
  } catch (error) {
    next(error);
  }
}

export async function create(req, res, next) {
  try {
    const product = await productService.createProduct(req.body);
    res
      .status(201)
      .location(`/api/products/${product.slug}`)
      .json({ product: publicProduct(product) });
  } catch (error) {
    next(error);
  }
}

export async function update(req, res, next) {
  try {
    const product = await productService.updateProduct(req.params.id, req.body);
    res.status(200).json({ product: publicProduct(product) });
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req, res, next) {
  try {
    const product = await productService.deactivateProduct(req.params.id);
    // 200 with the updated resource rather than 204, because the product still
    // exists and the caller should see its new state.
    res.status(200).json({ product: publicProduct(product) });
  } catch (error) {
    next(error);
  }
}
