import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside a React Server Component. Under
      // the test runner there is no such distinction, so it resolves to an
      // empty module; the guard still applies to the real build.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tenant-isolation tests talk to a real database when one is configured;
    // they are slower than the pure-logic suites.
    testTimeout: 30_000,
  },
});
