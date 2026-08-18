import { z } from 'zod';

// Money arrives as an integer number of cents and is validated as one. A body
// sending 19.99 is rejected outright rather than rounded, because guessing what
// someone meant by a fractional cent is how pricing bugs start.
const priceCents = z
  .number({ required_error: 'Price is required.', invalid_type_error: 'Must be a whole number of cents.' })
  .int('Must be a whole number of cents — 1999 means $19.99.')
  .min(0, 'Must not be negative.')
  // A 32-bit signed integer caps out here. Beyond it Postgres would reject the
  // insert with an out-of-range error, so catch it where we can say why.
  .max(2_147_483_647, 'Must be at most 2147483647 cents ($21,474,836.47).');

const stock = z
  .number({ invalid_type_error: 'Must be a whole number.' })
  .int('Must be a whole number.')
  .min(0, 'Must not be negative.')
  .max(1_000_000, 'Must be at most 1000000.');

// The regex already fixes the length, so there is no separate .length() check.
// Two rules that fail together would put the same message in `details` twice,
// and a form rendering that list would show the field's error twice.
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a three-letter ISO 4217 code, such as USD.');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Must not be empty.')
  .max(80, 'Must be at most 80 characters.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lower-case letters, numbers and single dashes.');

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Must not be empty.').max(200, 'Must be at most 200 characters.'),
  description: z.string().trim().max(5000, 'Must be at most 5000 characters.').optional(),
  priceCents,
  currency: currency.optional(),
  stock: stock.optional(),
  // Optional: derived from the name when omitted.
  slug: slug.optional(),
  isActive: z.boolean().optional(),
});

// Every field optional, but at least one required — a PATCH with an empty body
// is a mistake worth naming rather than a silent no-op.
export const updateProductSchema = createProductSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const productIdSchema = z.object({
  id: z.string().trim().min(1, 'Must not be empty.'),
});

export const productSlugSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Must not be empty.'),
});

export const listProductsSchema = z.object({
  q: z.string().trim().max(200, 'Must be at most 200 characters.').optional(),

  // Query strings are always text, so these are coerced. z.coerce.number turns
  // "" and "abc" into NaN, which .int() then rejects with a real message rather
  // than silently paginating from page NaN.
  page: z.coerce.number().int('Must be a whole number.').min(1, 'Must be at least 1.').default(1),

  // The cap is the point: without it, ?limit=1000000 is a denial-of-service
  // request that our own database happily serves.
  limit: z.coerce.number().int('Must be a whole number.').min(1, 'Must be at least 1.')
    .max(100, 'Must be at most 100.').default(20),

  minPriceCents: z.coerce.number().int('Must be a whole number of cents.').min(0).optional(),
  maxPriceCents: z.coerce.number().int('Must be a whole number of cents.').min(0).optional(),

  inStock: z.enum(['true', 'false']).optional(),

  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'name'], {
    errorMap: () => ({ message: 'Must be one of: newest, oldest, price_asc, price_desc, name.' }),
  }).default('newest'),

  // Admin-only. A non-admin who sends it gets a 403 rather than having it
  // quietly ignored, because silently dropping a parameter someone deliberately
  // sent is how people end up debugging the wrong thing.
  status: z.enum(['active', 'inactive', 'all'], {
    errorMap: () => ({ message: 'Must be one of: active, inactive, all.' }),
  }).optional(),
}).refine(
  (query) => query.minPriceCents === undefined || query.maxPriceCents === undefined
    || query.minPriceCents <= query.maxPriceCents,
  { message: 'minPriceCents must not be greater than maxPriceCents.', path: ['minPriceCents'] },
);
