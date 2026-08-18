import { prisma } from '../lib/prisma.js';

// Merging a guest cart into an account at login or registration.
//
// This runs inside the same transaction as the sign-in itself, so a visitor
// never ends up authenticated with their cart half-merged.

export async function claimGuestCart(tx, userId, sessionToken) {
  if (!sessionToken) return null;

  const guestCart = await tx.cart.findUnique({
    where: { sessionToken },
    include: { items: true },
  });

  // An unknown token, or one belonging to a cart already claimed, is not an
  // error. A visitor with a stale token in localStorage should still be able to
  // log in; there is simply nothing to merge.
  if (!guestCart || guestCart.userId) return null;

  const existingCart = await tx.cart.findUnique({ where: { userId } });

  // The simple case: this user has no cart, so the guest cart becomes theirs.
  // All three columns change together — the CHECK constraint
  // `carts_guest_carts_expire` rejects this update if expiresAt is left set,
  // which is what stops a claimed cart from being swept away days later.
  if (!existingCart) {
    return tx.cart.update({
      where: { id: guestCart.id },
      data: { userId, sessionToken: null, expiresAt: null },
    });
  }

  // Both carts exist: fold the guest lines into the user's cart. A product in
  // both has its quantities summed, which is what "I added two at work and one
  // at home" should mean.
  //
  // The sum can exceed available stock, and that is left alone on purpose.
  // Silently trimming someone's quantity during a login is worse than telling
  // them at checkout, and checkout validates stock regardless.
  for (const item of guestCart.items) {
    await tx.cartItem.upsert({
      where: {
        cartId_productId: { cartId: existingCart.id, productId: item.productId },
      },
      create: {
        cartId: existingCart.id,
        productId: item.productId,
        quantity: item.quantity,
      },
      update: { quantity: { increment: item.quantity } },
    });
  }

  // Cascades to its items.
  await tx.cart.delete({ where: { id: guestCart.id } });

  return existingCart;
}
