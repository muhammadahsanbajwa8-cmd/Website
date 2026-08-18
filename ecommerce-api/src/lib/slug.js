// Turning a product name into a URL-safe slug.

export function slugify(value) {
  return value
    .normalize('NFD')                  // split accented letters into letter + mark
    .replace(/[\u0300-\u036f]/g, '')  // drop the marks, so "Café" becomes "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // anything else becomes a separator
    .slice(0, 80)
    // Trimmed after the slice, not before: cutting at 80 characters can land
    // on a separator and leave a trailing dash behind.
    .replace(/^-+|-+$/g, '');
}

// Finds a slug nobody is using, by appending -2, -3, and so on.
//
// This is a check-then-act race, and losing it is handled rather than
// prevented: the unique index on Product.slug still rejects the insert, and the
// error handler turns that into a 409. This loop makes the common case produce
// a nice slug; the index is what makes it correct.
export async function uniqueSlug(prisma, base, { excludeId } = {}) {
  const root = slugify(base) || 'product';

  for (let suffix = 1; suffix < 50; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    const clash = await prisma.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === excludeId) return candidate;
  }

  // Give up on being pretty rather than looping forever.
  return `${root}-${Date.now()}`;
}
