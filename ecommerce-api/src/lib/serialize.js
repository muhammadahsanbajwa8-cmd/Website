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
