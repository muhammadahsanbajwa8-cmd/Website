import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { uniqueSlug } from '../lib/slug.js';

const SORT_ORDERS = {
  newest:     { createdAt: 'desc' },
  oldest:     { createdAt: 'asc' },
  price_asc:  { priceCents: 'asc' },
  price_desc: { priceCents: 'desc' },
  name:       { name: 'asc' },
};

// Translates the query into a Prisma filter.
//
// `status` is resolved by the controller, which is the only layer that knows
// who is asking. By the time it reaches here it is already an authorised value.
function buildWhere({ q, minPriceCents, maxPriceCents, inStock, status }) {
  const where = {};

  if (status === 'active') where.isActive = true;
  else if (status === 'inactive') where.isActive = false;
  // 'all' adds no filter.

  if (q) {
    // Case-insensitive substring match, which Postgres runs as ILIKE '%q%'.
    // That cannot use a normal B-tree index, so this is a sequential scan and
    // will not scale — see the README for the pg_trgm index it needs first.
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (minPriceCents !== undefined || maxPriceCents !== undefined) {
    where.priceCents = {};
    if (minPriceCents !== undefined) where.priceCents.gte = minPriceCents;
    if (maxPriceCents !== undefined) where.priceCents.lte = maxPriceCents;
  }

  if (inStock === 'true') where.stock = { gt: 0 };
  else if (inStock === 'false') where.stock = 0;

  return where;
}

export async function listProducts(query) {
  const { page, limit, sort } = query;
  const where = buildWhere(query);

  // One round trip for both. Counting separately is unavoidable for page totals,
  // but it does not need to be a second round trip.
  const [total, items] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [SORT_ORDERS[sort], { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    items,
    page: {
      number: page,
      size: limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// `includeInactive` is the caller's authority, not their request. Public reads
// pass false and get a 404 for a withdrawn product — the same answer as for one
// that never existed, which is the point.
export async function getProductBySlug(slug, { includeInactive = false } = {}) {
  const product = await prisma.product.findUnique({ where: { slug } });
  if (!product || (!includeInactive && !product.isActive)) {
    throw notFound('No product matches that slug.');
  }
  return product;
}

export async function getProductById(id, { includeInactive = false } = {}) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || (!includeInactive && !product.isActive)) {
    throw notFound('No product matches that id.');
  }
  return product;
}

export async function createProduct(input) {
  const slug = input.slug ?? (await uniqueSlug(prisma, input.name));

  try {
    return await prisma.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? '',
        priceCents: input.priceCents,
        currency: input.currency ?? 'USD',
        stock: input.stock ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  } catch (error) {
    // Only reachable when the caller supplied the slug, or lost the race in
    // uniqueSlug. Either way the index is what decided, and this turns its
    // verdict into a message naming the field.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('A product with that slug already exists.');
    }
    throw error;
  }
}

export async function updateProduct(id, input) {
  // Admin-only route, so a withdrawn product is still visible and editable —
  // otherwise reactivating one would be impossible.
  await getProductById(id, { includeInactive: true });

  try {
    return await prisma.product.update({ where: { id }, data: input });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('A product with that slug already exists.');
    }
    throw error;
  }
}

// Withdrawal, not deletion.
//
// Order lines point at products with onDelete: Restrict, so a hard delete of
// anything ever sold would fail at the database anyway. Deactivating keeps
// order history readable and lets the product come back.
export async function deactivateProduct(id) {
  const product = await getProductById(id, { includeInactive: true });

  if (!product.isActive) {
    throw conflict('That product is already deactivated.');
  }

  return prisma.product.update({ where: { id }, data: { isActive: false } });
}
