// Guest cart session tokens.

import crypto from 'node:crypto';
import { config } from '../config/index.js';

// 256 bits from the OS CSPRNG. This is a bearer credential — whoever presents
// it owns that cart — so it must not be a UUIDv4 (only 122 bits, and some
// versions encode a timestamp) or anything derived from the visitor.
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function guestCartExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + config.GUEST_CART_TTL_DAYS);
  return expires;
}
