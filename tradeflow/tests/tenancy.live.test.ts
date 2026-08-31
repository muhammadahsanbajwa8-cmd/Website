import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The question, asked of a real database.
 *
 *   Can Business A access Business B's data?
 *
 * Two businesses, two owners, one row each. Then every way a caller could try:
 * a plain select, a select by the other business's id, an update naming the
 * row directly, a delete, an insert carrying someone else's business_id, and
 * the same again through the definer functions the customer portal uses.
 *
 * This needs a database. Set DATABASE_URL to a Postgres that has had the
 * migrations applied (`npm run db:push`) and it runs; without one it reports
 * as skipped rather than passing quietly.
 *
 *     DATABASE_URL=postgresql://… npx vitest run tests/tenancy.live.test.ts
 *
 * It writes only rows it creates and removes them afterwards.
 */

const url = process.env.DATABASE_URL;

/** Run as `authenticated` with a given user id, exactly as PostgREST does. */
async function asUser<T>(
  sql: postgres.Sql,
  userId: string,
  work: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  // `begin` unwraps a returned result set, which the generic cannot express;
  // the cast is on the return type only, not on anything the test asserts.
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({
      sub: userId,
      role: 'authenticated',
    })}, true)`;
    await tx`set local role authenticated`;
    return work(tx);
  });
  return result as T;
}

describe.skipIf(!url)('Business A cannot reach Business B', () => {
  let sql: postgres.Sql;

  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  let businessA = '';
  let businessB = '';
  let customerA = '';
  let customerB = '';
  let quoteB = '';
  let tokenB = '';

  beforeAll(async () => {
    sql = postgres(url!, { max: 2, onnotice: () => {} });

    // Two users, as Supabase Auth would have created them.
    for (const [id, email] of [
      [alice, 'alice@tenancy.test'],
      [bob, 'bob@tenancy.test'],
    ]) {
      await sql`
        insert into auth.users (id, email, instance_id, aud, role)
        values (${id}::uuid, ${email}, '00000000-0000-0000-0000-000000000000'::uuid,
                'authenticated', 'authenticated')
        on conflict (id) do nothing`;
      await sql`
        insert into profiles (id, email, full_name)
        values (${id}::uuid, ${email}, ${email})
        on conflict (id) do update set email = excluded.email`;
    }

    // Each creates their own business, through the same function the app uses.
    businessA = await asUser(sql, alice, async (tx) => {
      const [row] = await tx`select create_business_with_owner('Alice Bricklaying') as id`;
      return row.id as string;
    });
    businessB = await asUser(sql, bob, async (tx) => {
      const [row] = await tx`select create_business_with_owner('Bob Electrical') as id`;
      return row.id as string;
    });

    customerA = await asUser(sql, alice, async (tx) => {
      const [row] = await tx`
        insert into customers (business_id, name) values (${businessA}::uuid, 'Alice customer')
        returning id`;
      return row.id as string;
    });

    const created = await asUser(sql, bob, async (tx) => {
      const [customer] = await tx`
        insert into customers (business_id, name) values (${businessB}::uuid, 'Bob customer')
        returning id`;
      // The share token is minted when a quote is sent, as the send action
      // does: a long random string, not the row's id.
      const [quote] = await tx`
        insert into quotes (business_id, customer_id, number, title, status, share_token, sent_at)
        values (${businessB}::uuid, ${customer.id}::uuid,
                next_document_number(${businessB}::uuid, 'quote'), 'Bob quote', 'sent',
                encode(gen_random_bytes(24), 'hex'), now())
        returning id, share_token`;
      return { customer: customer.id as string, quote: quote.id as string, token: quote.share_token as string };
    });
    customerB = created.customer;
    quoteB = created.quote;
    tokenB = created.token;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    // Owner-level cleanup: businesses cascade to everything below them.
    await sql`delete from businesses where id in (${businessA}::uuid, ${businessB}::uuid)`;
    await sql`delete from auth.users where id in (${alice}::uuid, ${bob}::uuid)`;
    await sql.end();
  });

  it('set up two separate businesses', () => {
    expect(businessA).toBeTruthy();
    expect(businessB).toBeTruthy();
    expect(businessA).not.toBe(businessB);
  });

  it('shows each owner only their own customers', async () => {
    const forAlice = await asUser(sql, alice, (tx) => tx`select id, name from customers`);
    expect(forAlice.map((row) => row.id)).toEqual([customerA]);

    const forBob = await asUser(sql, bob, (tx) => tx`select id, name from customers`);
    expect(forBob.map((row) => row.id)).toEqual([customerB]);
  });

  it('returns nothing when Alice asks for Bob’s customer by id', async () => {
    // The URL-tampering case: the id is correct, the caller is not.
    const rows = await asUser(sql, alice, (tx) =>
      tx`select * from customers where id = ${customerB}::uuid`
    );
    expect(rows).toHaveLength(0);
  });

  it('returns nothing when Alice filters by Bob’s business id', async () => {
    const rows = await asUser(sql, alice, (tx) =>
      tx`select * from customers where business_id = ${businessB}::uuid`
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot see Bob’s business row', async () => {
    const rows = await asUser(sql, alice, (tx) =>
      tx`select * from businesses where id = ${businessB}::uuid`
    );
    expect(rows).toHaveLength(0);
  });

  it('changes nothing when Alice updates Bob’s customer', async () => {
    await asUser(sql, alice, (tx) =>
      tx`update customers set name = 'taken over' where id = ${customerB}::uuid`
    );
    const [row] = await sql`select name from customers where id = ${customerB}::uuid`;
    expect(row.name).toBe('Bob customer');
  });

  it('deletes nothing when Alice deletes Bob’s customer', async () => {
    await asUser(sql, alice, (tx) => tx`delete from customers where id = ${customerB}::uuid`);
    const [row] = await sql`select count(*)::int as n from customers where id = ${customerB}::uuid`;
    expect(row.n).toBe(1);
  });

  it('refuses an insert carrying another business’s id', async () => {
    await expect(
      asUser(
        sql,
        alice,
        (tx) =>
          tx`insert into customers (business_id, name) values (${businessB}::uuid, 'planted')`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses to add Alice to Bob’s team', async () => {
    await expect(
      asUser(
        sql,
        alice,
        (tx) => tx`
          insert into team_members (business_id, user_id, email, role, accepted_at)
          values (${businessB}::uuid, ${alice}::uuid, 'alice@tenancy.test', 'owner', now())`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('hides Bob’s quotes, and the money on them', async () => {
    const rows = await asUser(sql, alice, (tx) => tx`select * from quotes`);
    expect(rows).toHaveLength(0);
  });

  it('keeps Bob’s audit log and activity out of Alice’s reach', async () => {
    for (const table of ['audit_logs', 'activities', 'notifications']) {
      const rows = await asUser(
        sql,
        alice,
        (tx) => tx`select * from ${tx(table)} where business_id = ${businessB}::uuid`
      );
      expect(rows, `${table} leaked`).toHaveLength(0);
    }
  });

  it('gives an anonymous caller nothing at all through the tables', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select * from customers`;
      })
    ).rejects.toThrow(/permission denied/i);
  });

  it('serves the portal by token, and only the quote that token names', async () => {
    // The function returns exactly the fields a customer may see, as jsonb.
    // `anon` has no table privileges at all, so this is the only way in.
    const [found] = await sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select public_quote_by_token(${tokenB}) as payload`;
    });
    expect(found.payload.quote.id).toBe(quoteB);

    // It builds the payload field by field, so nothing internal rides along:
    // no business id, no customer id, no share token, no created_by.
    const flat = JSON.stringify(found.payload);
    expect(flat).not.toContain(businessB);
    expect(flat).not.toContain(customerB);
    expect(flat).not.toContain(tokenB);
    expect(found.payload.customer.id).toBeUndefined();

    const [wrong] = await sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select public_quote_by_token('not-a-real-token-but-long-enough') as payload`;
    });
    expect(wrong.payload).toBeNull();
  });

  it('does not let a worker see priced work', async () => {
    const worker = '33333333-3333-4333-8333-333333333333';
    await sql`
      insert into auth.users (id, email, instance_id, aud, role)
      values (${worker}::uuid, 'worker@tenancy.test', '00000000-0000-0000-0000-000000000000'::uuid,
              'authenticated', 'authenticated')
      on conflict (id) do nothing`;
    await sql`
      insert into profiles (id, email) values (${worker}::uuid, 'worker@tenancy.test')
      on conflict (id) do nothing`;
    await sql`
      insert into team_members (business_id, user_id, email, role, accepted_at)
      values (${businessB}::uuid, ${worker}::uuid, 'worker@tenancy.test', 'worker', now())
      on conflict do nothing`;

    // A member of Bob's business: the jobs are theirs to see…
    const customers = await asUser(sql, worker, (tx) => tx`select id from customers`);
    expect(customers).toHaveLength(1);

    // …but what the work was quoted at is not.
    const quotes = await asUser(sql, worker, (tx) => tx`select id from quotes`);
    expect(quotes).toHaveLength(0);

    const invoices = await asUser(sql, worker, (tx) => tx`select id from invoices`);
    expect(invoices).toHaveLength(0);

    await sql`delete from auth.users where id = ${worker}::uuid`;
  });
});

describe.skipIf(url)('the live tenancy suite', () => {
  it('is skipped without DATABASE_URL', () => {
    // Here so a run with no database says so out loud rather than looking green
    // because nothing ran.
    expect(url).toBeUndefined();
  });
});
