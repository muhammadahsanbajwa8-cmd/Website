import { createApp } from './app.js';
import { config } from './config/index.js';
import { disconnectPrisma } from './lib/prisma.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT} [${config.NODE_ENV}]`);
});

// Stop accepting connections, let in-flight requests finish, then close the
// database pool. Without this a deploy kills requests mid-transaction.
async function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
