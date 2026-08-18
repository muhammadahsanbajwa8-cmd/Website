// A single PrismaClient for the whole process.
//
// Each client owns a connection pool, so constructing one per request or per
// module exhausts Postgres connections under load. Node's module cache makes
// this a singleton for free.

import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';

export const prisma = new PrismaClient({
  log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
