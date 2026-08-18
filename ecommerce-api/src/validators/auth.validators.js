import { z } from 'zod';

// Emails are lower-cased here, at the boundary, so every layer below this can
// assume they already are. The database CHECK constraint added in the init
// migration is the backstop if a code path ever forgets.
const email = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .email('Must be a valid email address.')
  .max(254, 'Must be at most 254 characters.'); // RFC 5321 limit

// Length is the only rule. Composition rules ("one uppercase, one symbol")
// push people toward Password1! and rule out long passphrases, and NIST
// SP 800-63B recommends against them. 8 is the floor, 72 is where bcrypt
// silently stops reading — so reject above it rather than let a user believe
// their 100-character password is fully used.
const password = z
  .string({ required_error: 'Password is required.' })
  .min(8, 'Must be at least 8 characters.')
  .max(72, 'Must be at most 72 characters.');

export const registerSchema = z.object({
  email,
  password,
  name: z
    .string()
    .trim()
    .min(1, 'Must not be empty.')
    .max(120, 'Must be at most 120 characters.')
    .optional(),
});

// Deliberately lax compared with registerSchema: a login is checking a
// credential, not creating one. Applying the 8-character minimum here would
// reject a legacy short password with a 422 that names the rule, which both
// leaks policy and confuses someone whose password genuinely is that.
export const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required.' }).trim().toLowerCase(),
  password: z.string({ required_error: 'Password is required.' }),
});
