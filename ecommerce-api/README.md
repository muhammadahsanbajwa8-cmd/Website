# E-commerce Backend API

Node.js + Express + PostgreSQL (Prisma). Auth, catalogue, cart, orders.

This lives in its own directory with its own `package.json` and its own
dependency tree. The static site generator at the repository root is a separate
project and is not affected by anything here.

## Status

| Phase | Scope                          | State       |
| ----- | ------------------------------ | ----------- |
| 1     | Data model + folder structure  | done        |
| 2     | Auth                           | in review   |
| 3     | Products                       | not started |
| 4     | Cart                           | not started |
| 5     | Orders + checkout              | not started |
| 6     | Tests for the main flows       | not started |

## Getting started

```bash
cd ecommerce-api
npm install
cp .env.example .env      # then fill in DATABASE_URL and JWT_SECRET
npm run prisma:migrate    # creates the schema
npm run dev
```

## Folder structure

```
ecommerce-api/
├── prisma/
│   ├── schema.prisma        # the data model
│   ├── migrations/          # generated SQL, committed, never edited by hand
│   └── seed.js              # a demo admin, a demo user, a few products
├── src/
│   ├── server.js            # reads config, starts listening, handles shutdown
│   ├── app.js               # builds the Express app; exported for tests
│   ├── config/              # env parsing and validation, one place only
│   ├── routes/              # URL -> middleware -> controller wiring
│   ├── controllers/         # HTTP in, HTTP out; no business rules
│   ├── services/            # business rules and database work; no req/res
│   ├── middleware/          # auth, role checks, validation, error handler
│   ├── validators/          # zod schemas, one per request body/query
│   └── lib/                 # prisma client, password hashing, tokens, errors
└── tests/                   # node:test + supertest, one file per flow
```

The layering rule that keeps this honest: a **controller** never touches Prisma,
and a **service** never touches `req` or `res`. Anything that needs both is in
the wrong file. This is what makes the services testable without HTTP, and it
is the first thing a reviewer checks.

## Request flow

```
route  ->  authenticate  ->  requireRole  ->  validate  ->  controller  ->  service  ->  prisma
                                                                 |
                                                            errorHandler
```

`authenticate` comes in two flavours. Most protected routes use the strict one,
which 401s without a valid token. Cart routes use a permissive one that resolves
a signed-in user *or* an anonymous `sessionToken`, and mints a new guest cart if
it finds neither — that is what lets a logged-out visitor build a cart.

## Error shape

Every failure — from a bad password to an unhandled exception — leaves the API
in exactly one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body is invalid.",
    "details": [
      { "field": "email", "message": "Must be a valid email address." },
      { "field": "password", "message": "Must be at least 8 characters." }
    ]
  }
}
```

`details` is present only for 422. Everything else omits it.

| Status | `code`                  | Used when                                                     |
| ------ | ----------------------- | ------------------------------------------------------------- |
| 400    | `BAD_REQUEST`           | Malformed request — unparseable JSON, bad pagination cursor    |
| 401    | `UNAUTHENTICATED`       | No token, expired token, bad token, wrong password             |
| 403    | `FORBIDDEN`             | Valid token, but not allowed to touch this resource            |
| 404    | `NOT_FOUND`             | No such resource, or one this caller may not know exists       |
| 409    | `CONFLICT`              | Email already registered; cancelling an order that isn't PENDING |
| 409    | `INSUFFICIENT_STOCK`    | Checkout wanted more units than exist                          |
| 422    | `VALIDATION_ERROR`      | Well-formed request, contents failed validation                |
| 500    | `INTERNAL_ERROR`        | Anything unhandled. Never leaks a stack trace to the client    |

400 vs 422 is the distinction people argue about, so to be explicit: 400 means
we could not read the request, 422 means we read it fine and disagreed with it.

## Endpoints

### Auth

| Method | Path                 | Access | Notes                                    |
| ------ | -------------------- | ------ | ---------------------------------------- |
| POST   | `/api/auth/register` | public | 201 with the user and an access token    |
| POST   | `/api/auth/login`    | public | 200 with the user and an access token    |
| GET    | `/api/auth/me`       | token  | The caller's own record                  |

Both `register` and `login` accept an optional `X-Cart-Session` header. If it
names a live guest cart, that cart is claimed or merged into the account in the
same transaction as the sign-in.

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery","name":"Ada"}'
```

```json
{
  "user": { "id": "cmsy…", "email": "ada@example.com", "name": "Ada",
            "role": "USER", "createdAt": "2026-08-18T14:47:35.062Z" },
  "accessToken": "eyJhbGciOiJIUzI1NiIs…"
}
```

Send it back as `Authorization: Bearer <accessToken>`.

### Auth decisions worth knowing about

- **Login never says which half was wrong.** An unknown email and a wrong
  password produce the same 401 and the same message. The unknown-email path
  also hashes a decoy, so the two take the same time — otherwise response
  latency turns login into a "does this person have an account here?" oracle.
- **`authenticate` re-reads the user from the database** on every request rather
  than trusting the `role` claim inside the token. That costs one primary-key
  lookup and means demoting an admin takes effect immediately, instead of
  whenever their current token happens to expire.
- **Unknown body fields are dropped, not ignored.** `validate` replaces
  `req.body` with zod's parsed output, and zod strips keys the schema does not
  mention. A registration body carrying `"role": "ADMIN"` creates an ordinary
  user, because the extra key is gone before any code could read it.
- **Auth routes are rate limited** to 20 attempts per 15 minutes. bcrypt's cost
  protects stored hashes; it does nothing about someone trying thousands of
  passwords against one account over the network.

## Money

Prices are integer cents, everywhere, end to end. `priceCents: 1999` is $19.99.

- No `Float`, no `Decimal`, no `"19.99"` strings anywhere in the database or in
  a JSON response.
- No division by 100 on the server. The API returns `1999` and the client
  formats it, because that is where the user's locale and currency conventions
  actually live.
- Multiply before you ever consider dividing. `quantity * unitPriceCents` is
  exact; a percentage discount will need an explicit, documented rounding rule
  when it arrives.

## Data model

See `prisma/schema.prisma` — every non-obvious column is commented there.

```
                 Cart 1---* CartItem *---1 Product
                  |                            |
User 0..1---------+                            |
  |          (or an anonymous sessionToken)    |
  1                                            1
  |                                            |
  *                                            *
Order 1--------------* OrderItem *-------------+
```

- **User** — email, password hash, `role` of `USER` or `ADMIN`.
- **Product** — name, unique slug, `priceCents`, `stock`, `isActive`.
- **Cart** — owned by *either* a user *or* an anonymous visitor, never both.
- **CartItem** — unique on `(cartId, productId)`; prices are read live from the
  product, never copied.
- **Order** — always belongs to a real user. `status`, and a `totalCents`
  frozen at checkout.
- **OrderItem** — quantity plus a snapshot of the name and unit price as they
  were at checkout.

### Guest carts

An anonymous visitor gets a cart keyed by an opaque `sessionToken` — 256 bits
from `crypto.randomBytes`, returned once and presented on later requests. It is
a bearer credential: whoever holds the token holds the cart.

`Cart.userId` and `Cart.sessionToken` are both nullable and both unique, and a
CHECK constraint requires exactly one of them to be set. Nullable-unique is the
right tool here because a Postgres unique index ignores NULLs, so "one cart per
user" still holds while any number of guest carts coexist.

**Claiming a cart at login.** When a visitor with a guest cart registers or logs
in, the guest cart is merged into their account inside one transaction:

- The user had no cart → the guest cart is claimed in place: set `userId`, clear
  `sessionToken`, clear `expiresAt`.
- The user already had a cart → lines are merged into it and the guest cart is
  deleted. A product present in both has its **quantities summed**, which is
  what the major storefronts do and what a customer expects from "I added two
  at work and one at home".

Summing can exceed available stock. That is deliberately *not* corrected at
merge time — silently reducing someone's quantity is worse than telling them at
checkout, and checkout is already the place that validates stock and fails
cleanly. The merge never loses a line.

**Expiry.** Guest carts accumulate one row per visitor who ever added an item,
so they carry an `expiresAt` and a periodic sweep deletes the stale ones. Carts
owned by a user never expire. A second CHECK ties these together — `expiresAt`
is set if and only if `sessionToken` is — which means a claim that forgets to
clear the expiry is rejected by the database rather than leaving a user's cart
scheduled for deletion.

**Checkout stays authenticated.** There is no anonymous order, so every order
has a real `userId` and "you may only read your own orders" needs no special
case. A guest checking out is asked to log in or register first, and their cart
comes with them.

### Order lifecycle

```
PENDING ──(admin)──> PAID ──(admin)──> SHIPPED
   │
   └──(owner or admin)──> CANCELLED
```

Checkout creates a `PENDING` order and decrements stock. There is no payment
gateway, so an admin moves an order to `PAID` and then `SHIPPED`. Only a
`PENDING` order can be cancelled; cancelling anything else is a 409.

## Verifying the data model

The migration in `prisma/migrations/20260818000000_init/` has been applied to a
real PostgreSQL 16 database and each invariant checked by trying to violate it.
All of the following are rejected by the database, not merely by application
code:

| Attempted write                                  | Rejected by                          |
| ------------------------------------------------ | ------------------------------------ |
| Email stored as `Ada@Example.com`                 | `users_email_lowercase`              |
| Second account on an existing email               | `users_email_key`                    |
| Product with `stock = -1`                         | `products_stock_non_negative`        |
| Product with `priceCents = -1`                    | `products_price_non_negative`        |
| Currency `usd` instead of `USD`                   | `products_currency_iso4217`          |
| Second cart for a user who already has one        | `carts_userId_key`                   |
| Two guest carts sharing one session token         | `carts_sessionToken_key`             |
| A cart owned by nobody                            | `carts_owner_exclusive`              |
| A cart owned by a user *and* a session            | `carts_owner_exclusive`              |
| A guest cart with no expiry                       | `carts_guest_carts_expire`           |
| A user's cart carrying an expiry                  | `carts_guest_carts_expire`           |
| Claiming a guest cart without clearing its expiry | `carts_guest_carts_expire`           |
| Same product added twice as two cart lines        | `cart_items_cartId_productId_key`    |
| Cart line with `quantity = 0`                     | `cart_items_quantity_positive`       |
| Deleting a product sitting in someone's cart      | `cart_items_productId_fkey`          |
| Order line claiming `2 x 1999 = 100`              | `order_items_line_total_consistent`  |
| Deleting a user who has order history             | `orders_userId_fkey`                 |

Writes that *should* succeed do: a second guest cart, the same product in two
different carts, a correctly claimed cart, and a line total that matches its own
arithmetic.

To repeat this against your own database:

```bash
npm run prisma:deploy
psql "$DATABASE_URL" -c "insert into products (id,name,slug,\"priceCents\",stock,\"updatedAt\")
                         values ('x','Mug','mug',1999,-1,now());"
# ERROR:  new row violates check constraint "products_stock_non_negative"
```

`prisma migrate diff` reports no drift between `schema.prisma` and the applied
migration.
