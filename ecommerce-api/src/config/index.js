// Every environment variable the API reads is parsed and validated here, once,
// at startup. Nothing else in the codebase touches process.env.
//
// The point is that a misconfigured deployment fails immediately with a message
// naming the variable, instead of starting happily and throwing a confusing
// error on the first request that happens to need it.

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),

  // 32 characters is the floor because a short secret makes the signature
  // brute-forceable, and a forged token is a total authentication bypass.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().default('15m'),

  // bcrypt work factor. Higher is slower for us and much slower for an
  // attacker with a stolen database.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGINS: z.string().default(''),

  GUEST_CART_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

// A fast work factor is a legitimate choice in tests, where hashing happens
// hundreds of times and nothing real is being protected. It is never a
// legitimate choice in production, so refuse rather than quietly allow it.
if (config.isProduction && config.BCRYPT_ROUNDS < 10) {
  console.error(
    `BCRYPT_ROUNDS is ${config.BCRYPT_ROUNDS} in production. Use at least 10.`,
  );
  process.exit(1);
}
