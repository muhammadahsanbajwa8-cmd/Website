// Demo data: one admin, one customer, a few products.
// Safe to run repeatedly — every write is an upsert keyed on a natural key.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const products = [
  { name: 'Enamel Mug',        slug: 'enamel-mug',        priceCents: 1499, stock: 40 },
  { name: 'Cotton T-Shirt',    slug: 'cotton-t-shirt',    priceCents: 2450, stock: 25 },
  { name: 'Notebook, A5',      slug: 'notebook-a5',       priceCents:  899, stock: 100 },
  { name: 'Cold Brew Kit',     slug: 'cold-brew-kit',     priceCents: 5999, stock: 8 },
  { name: 'Discontinued Cap',  slug: 'discontinued-cap',  priceCents: 1999, stock: 0, isActive: false },
];

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN', passwordHash },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'ada@example.com' },
    update: {},
    create: { email: 'ada@example.com', name: 'Ada', passwordHash },
  });

  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: { description: `${product.name}, for the demo catalogue.`, ...product },
    });
  }

  console.log(`Seeded: ${admin.email} (ADMIN), ${customer.email} (USER), ${products.length} products.`);
  console.log('Both demo accounts use the password: password123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
