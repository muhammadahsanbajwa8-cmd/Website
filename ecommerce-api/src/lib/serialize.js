// Turning database rows into API responses.
//
// These exist so that `passwordHash` cannot reach a client by accident. A route
// that returns a Prisma user object directly leaks it; a route that returns
// publicUser(user) cannot. Every response shape goes through a function here.

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

// A product as the catalogue shows it.
//
// priceCents stays an integer all the way to the client. The server never
// divides by 100, because formatting money needs the reader's locale and
// currency conventions, and those live in the client, not here.
export function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    stock: product.stock,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
