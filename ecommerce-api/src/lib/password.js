// Password hashing, and the one trick that makes login not leak.

import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// A bcrypt hash of a value nobody knows, generated once at startup.
//
// When login is given an email that does not exist, the obvious code returns
// immediately — while a real email with a wrong password spends ~100ms hashing.
// That timing difference is measurable over the network, and it turns login
// into an oracle for "is this person registered here?". Comparing against this
// decoy makes both paths cost the same.
const decoyHash = bcrypt.hashSync('a-password-no-account-has', config.BCRYPT_ROUNDS);

export async function burnTimeLikeAVerification() {
  await bcrypt.compare('a-password-no-account-has', decoyHash);
}
