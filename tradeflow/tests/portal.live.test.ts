import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The customer's half of the same question.
 *
 *   Can Customer A see Customer B's reports, invoices, payments or messages?
 *   Can a customer of one business see anything belonging to another?
 *   Can a customer read the working notes a business keeps about them?
 *
 * Two businesses, two customers, one signed-in person each — and then every
 * way in: the portal's own definer functions, the tables behind them, an id
 * typed into a function that belongs to somebody else, and a write aimed at
 * another customer's thread.
 *
 * Needs a database with the migrations applied; without DATABASE_URL it
 * reports as skipped rather than passing quietly.
 */

const url = process.env.DATABASE_URL;

async function asUser<T>(
  sql: postgres.Sql,
  userId: string,
  work: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
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

describe.skipIf(!url)('a customer sees their own account and nothing else', () => {
  let sql: postgres.Sql;

  const ownerA = '31111111-1111-4111-8111-111111111111';
  const ownerB = '32222222-2222-4222-8222-222222222222';
  const daisy = '33333333-3333-4333-8333-333333333333'; // customer of business A
  const errol = '34444444-4444-4444-8444-444444444444'; // customer of business B

  let businessA = '';
  let businessB = '';
  let customerDaisy = '';
  let customerErrol = '';
  let jobDaisy = '';
  let jobErrol = '';
  let reportDaisy = '';
  let reportErrol = '';
  let invoiceErrol = '';
  let serviceA = '';

  beforeAll(async () => {
    sql = postgres(url!, { max: 2, onnotice: () => {} });

    for (const [id, email] of [
      [ownerA, 'owner-a@portal.test'],
      [ownerB, 'owner-b@portal.test'],
      [daisy, 'daisy@portal.test'],
      [errol, 'errol@portal.test'],
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

    businessA = await asUser(sql, ownerA, async (tx) => {
      const [row] = await tx`select create_business_with_owner('Portal Plumbing') as id`;
      return row.id as string;
    });
    businessB = await asUser(sql, ownerB, async (tx) => {
      const [row] = await tx`select create_business_with_owner('Rival Roofing') as id`;
      return row.id as string;
    });

    // Business A: a customer with a login, a job, a sent report, a service.
    const a = await asUser(sql, ownerA, async (tx) => {
      const [customer] = await tx`
        insert into customers (business_id, name, email, notes)
        values (${businessA}::uuid, 'Daisy Okonkwo', 'daisy@portal.test',
                'Slow payer — chase on day 20')
        returning id`;
      const [job] = await tx`
        insert into jobs (business_id, customer_id, number, name, status, notes)
        values (${businessA}::uuid, ${customer.id}::uuid,
                next_document_number(${businessA}::uuid, 'job'),
                'Bathroom re-pipe', 'scheduled', 'Watch the neighbour, he complains')
        returning id`;
      const [report] = await tx`
        insert into reports (business_id, customer_id, job_id, number, title, status, sent_at, share_token)
        values (${businessA}::uuid, ${customer.id}::uuid, ${job.id}::uuid,
                next_document_number(${businessA}::uuid, 'report'),
                'Day one on site', 'final', now(), encode(gen_random_bytes(24), 'hex'))
        returning id`;
      const [service] = await tx`
        insert into services (business_id, name, price_from_cents)
        values (${businessA}::uuid, 'Blocked drains', 18000)
        returning id`;
      await tx`
        insert into customer_users (business_id, customer_id, user_id, email, accepted_at)
        values (${businessA}::uuid, ${customer.id}::uuid, ${daisy}::uuid, 'daisy@portal.test', now())`;
      return {
        customer: customer.id as string,
        job: job.id as string,
        report: report.id as string,
        service: service.id as string,
      };
    });
    customerDaisy = a.customer;
    jobDaisy = a.job;
    reportDaisy = a.report;
    serviceA = a.service;

    // Business B: the same again, for somebody else entirely.
    const b = await asUser(sql, ownerB, async (tx) => {
      const [customer] = await tx`
        insert into customers (business_id, name, email)
        values (${businessB}::uuid, 'Errol Vance', 'errol@portal.test')
        returning id`;
      const [job] = await tx`
        insert into jobs (business_id, customer_id, number, name, status)
        values (${businessB}::uuid, ${customer.id}::uuid,
                next_document_number(${businessB}::uuid, 'job'), 'Roof restoration', 'in_progress')
        returning id`;
      const [report] = await tx`
        insert into reports (business_id, customer_id, job_id, number, title, status, sent_at)
        values (${businessB}::uuid, ${customer.id}::uuid, ${job.id}::uuid,
                next_document_number(${businessB}::uuid, 'report'), 'Roof inspection', 'final', now())
        returning id`;
      const [invoice] = await tx`
        insert into invoices (business_id, customer_id, number, status, title, total_cents)
        values (${businessB}::uuid, ${customer.id}::uuid,
                next_document_number(${businessB}::uuid, 'invoice'), 'sent', 'Roof restoration', 250000)
        returning id`;
      await tx`
        insert into customer_users (business_id, customer_id, user_id, email, accepted_at)
        values (${businessB}::uuid, ${customer.id}::uuid, ${errol}::uuid, 'errol@portal.test', now())`;
      return {
        customer: customer.id as string,
        job: job.id as string,
        report: report.id as string,
        invoice: invoice.id as string,
      };
    });
    customerErrol = b.customer;
    jobErrol = b.job;
    reportErrol = b.report;
    invoiceErrol = b.invoice;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from businesses where id in (${businessA}::uuid, ${businessB}::uuid)`;
    await sql`delete from auth.users where id in (${ownerA}::uuid, ${ownerB}::uuid, ${daisy}::uuid, ${errol}::uuid)`;
    await sql.end();
  });

  it('set two customers up at two businesses', () => {
    expect(customerDaisy).toBeTruthy();
    expect(customerErrol).toBeTruthy();
    expect(customerDaisy).not.toBe(customerErrol);
  });

  // --- what the portal hands back ------------------------------------------

  it('gives each customer exactly one link, to their own business', async () => {
    const [row] = await asUser(sql, daisy, (tx) => tx`select portal_links() as links`);
    const links = row.links as { business_id: string; customer_id: string; business_name: string }[];
    expect(links).toHaveLength(1);
    expect(links[0]!.business_id).toBe(businessA);
    expect(links[0]!.customer_id).toBe(customerDaisy);
    expect(links[0]!.business_name).toBe('Portal Plumbing');
  });

  it('never puts the business’s working notes in a portal payload', async () => {
    const [links] = await asUser(sql, daisy, (tx) => tx`select portal_links()::text as text`);
    const [jobs] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_jobs(${businessA}::uuid)::text as text`
    );
    const [job] = await asUser(sql, daisy, (tx) => tx`select portal_job(${jobDaisy}::uuid)::text as text`);

    for (const payload of [links.text as string, jobs.text as string, job.text as string]) {
      expect(payload).not.toContain('Slow payer');
      expect(payload).not.toContain('the neighbour');
    }
  });

  it('shows a customer their own booking, and not the other business’s', async () => {
    const [mine] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_jobs(${businessA}::uuid) as jobs`
    );
    const jobs = mine.jobs as { id: string; name: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(jobDaisy);

    // The same function, pointed at the business she is not a customer of.
    const [theirs] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_jobs(${businessB}::uuid) as jobs`
    );
    expect(theirs.jobs).toEqual([]);
  });

  it('returns nothing when a customer asks for another customer’s job by id', async () => {
    const [row] = await asUser(sql, daisy, (tx) => tx`select portal_job(${jobErrol}::uuid) as job`);
    expect(row.job).toBeNull();
  });

  it('refuses to summarise an account that is not theirs', async () => {
    const [mine] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_summary(${businessA}::uuid, ${customerDaisy}::uuid) as summary`
    );
    expect(mine.summary).not.toBeNull();

    const [theirs] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_summary(${businessB}::uuid, ${customerErrol}::uuid) as summary`
    );
    expect(theirs.summary).toBeNull();
  });

  // --- the tables behind it -------------------------------------------------

  it('shows a customer only their own reports', async () => {
    const rows = await asUser(sql, daisy, (tx) => tx`select id from reports`);
    expect(rows.map((row) => row.id)).toEqual([reportDaisy]);

    const direct = await asUser(
      sql,
      daisy,
      (tx) => tx`select id from reports where id = ${reportErrol}::uuid`
    );
    expect(direct).toEqual([]);
  });

  it('shows a customer only their own invoices', async () => {
    const rows = await asUser(sql, daisy, (tx) => tx`select id from invoices`);
    expect(rows).toEqual([]);

    const errolsOwn = await asUser(sql, errol, (tx) => tx`select id from invoices`);
    expect(errolsOwn.map((row) => row.id)).toEqual([invoiceErrol]);
  });

  it('no longer exposes the customers table to a customer', async () => {
    // Their name and address reach them through portal_links(); the row
    // itself, with the notes on it, does not.
    const rows = await asUser(sql, daisy, (tx) => tx`select id from customers`);
    expect(rows).toEqual([]);
  });

  it('no longer exposes the jobs table to a customer', async () => {
    const rows = await asUser(sql, daisy, (tx) => tx`select id from jobs`);
    expect(rows).toEqual([]);
  });

  it('shows a customer the services of their own business only', async () => {
    const mine = await asUser(sql, daisy, (tx) => tx`select id from services`);
    expect(mine.map((row) => row.id)).toEqual([serviceA]);

    const theirs = await asUser(sql, errol, (tx) => tx`select id from services`);
    expect(theirs).toEqual([]);
  });

  // --- writing --------------------------------------------------------------

  it('lets a customer ask their own business for work', async () => {
    const [row] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_create_request(${businessA}::uuid, ${customerDaisy}::uuid,
                                              ${serviceA}::uuid, 'The kitchen tap drips constantly',
                                              null, null, null) as id`
    );
    expect(row.id).toBeTruthy();

    const [lead] = await sql`select business_id, customer_id, source, status from leads where id = ${row.id}::uuid`;
    expect(lead.business_id).toBe(businessA);
    expect(lead.customer_id).toBe(customerDaisy);
    expect(lead.source).toBe('portal');
    expect(lead.status).toBe('new');
  });

  it('refuses a request made on another customer’s behalf', async () => {
    await expect(
      asUser(
        sql,
        daisy,
        (tx) => tx`select portal_create_request(${businessB}::uuid, ${customerErrol}::uuid,
                                                null, 'Book me in for a free roof', null, null, null)`
      )
    ).rejects.toThrow(/not your account/);
  });

  it('keeps the leads table itself out of reach', async () => {
    const rows = await asUser(sql, daisy, (tx) => tx`select id from leads`);
    expect(rows).toEqual([]);
  });

  it('lets a customer write to their own business', async () => {
    await asUser(
      sql,
      daisy,
      (tx) => tx`insert into messages (business_id, customer_id, sender, author_id, body)
                 values (${businessA}::uuid, ${customerDaisy}::uuid, 'customer', ${daisy}::uuid,
                         'Can you come Thursday instead?')`
    );
    const rows = await asUser(sql, daisy, (tx) => tx`select body from messages`);
    expect(rows).toHaveLength(1);
  });

  it('refuses a message planted in another customer’s thread', async () => {
    await expect(
      asUser(
        sql,
        daisy,
        (tx) => tx`insert into messages (business_id, customer_id, sender, author_id, body)
                   values (${businessB}::uuid, ${customerErrol}::uuid, 'customer', ${daisy}::uuid, 'hello')`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses a message that claims to be from the business', async () => {
    await expect(
      asUser(
        sql,
        daisy,
        (tx) => tx`insert into messages (business_id, customer_id, sender, author_id, body)
                   values (${businessA}::uuid, ${customerDaisy}::uuid, 'business', ${daisy}::uuid,
                           'This one is on us')`
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let a customer rewrite what the business said', async () => {
    await asUser(
      sql,
      ownerA,
      (tx) => tx`insert into messages (business_id, customer_id, sender, author_id, body)
                 values (${businessA}::uuid, ${customerDaisy}::uuid, 'business', ${ownerA}::uuid,
                         'Thursday works, see you at 8')`
    );
    await asUser(
      sql,
      daisy,
      (tx) => tx`update messages set body = 'Thursday is free of charge' where sender = 'business'`
    );
    const [row] = await sql`
      select body from messages
       where business_id = ${businessA}::uuid and sender = 'business'`;
    expect(row.body).toBe('Thursday works, see you at 8');
  });

  it('lets a customer correct their own details, and only the named ones', async () => {
    await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_update_customer(${customerDaisy}::uuid, 'daisy.new@portal.test',
                                               '0412 000 111', '9 Rivett Street', null,
                                               'Marrickville', 'NSW', '2204')`
    );
    const [row] = await sql`select email, phone, suburb, notes, name from customers where id = ${customerDaisy}::uuid`;
    expect(row.email).toBe('daisy.new@portal.test');
    expect(row.suburb).toBe('Marrickville');
    // The business's own note, and the name it keeps, are untouched.
    expect(row.notes).toBe('Slow payer — chase on day 20');
    expect(row.name).toBe('Daisy Okonkwo');
  });

  it('refuses to update another customer’s details', async () => {
    await expect(
      asUser(
        sql,
        daisy,
        (tx) => tx`select portal_update_customer(${customerErrol}::uuid, 'hijack@portal.test',
                                                 null, null, null, null, null, null)`
      )
    ).rejects.toThrow(/not your account/);
  });

  // --- the document tokens --------------------------------------------------

  it('hands over a token for the customer’s own invoice only', async () => {
    const [theirs] = await asUser(
      sql,
      errol,
      (tx) => tx`select portal_document_token('invoice', ${invoiceErrol}::uuid) as token`
    );
    expect(typeof theirs.token).toBe('string');
    expect((theirs.token as string).length).toBeGreaterThan(20);

    const [mine] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_document_token('invoice', ${invoiceErrol}::uuid) as token`
    );
    expect(mine.token).toBeNull();
  });

  it('will not mint a token for a report that was never sent', async () => {
    const [draft] = await asUser(
      sql,
      ownerA,
      (tx) => tx`insert into reports (business_id, customer_id, number, title, status)
                 values (${businessA}::uuid, ${customerDaisy}::uuid,
                         next_document_number(${businessA}::uuid, 'report'), 'Draft only', 'draft')
                 returning id`
    );
    const [row] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_document_token('report', ${draft.id}::uuid) as token`
    );
    expect(row.token).toBeNull();

    // And the draft is not readable either.
    const rows = await asUser(
      sql,
      daisy,
      (tx) => tx`select id from reports where id = ${draft.id}::uuid`
    );
    expect(rows).toEqual([]);
  });

  // --- notifications --------------------------------------------------------

  it('lets a customer read their own notifications and nobody else’s', async () => {
    await sql`
      insert into notifications (business_id, user_id, kind, title)
      values (${businessA}::uuid, ${daisy}::uuid, 'report.sent', 'Your report is ready'),
             (${businessB}::uuid, ${errol}::uuid, 'report.sent', 'Roof report ready')`;

    const rows = await asUser(sql, daisy, (tx) => tx`select title from notifications`);
    expect(rows.map((row) => row.title)).toEqual(['Your report is ready']);
  });

  it('closes the account the moment access is withdrawn', async () => {
    await asUser(
      sql,
      ownerA,
      (tx) => tx`update customer_users set deleted_at = now() where customer_id = ${customerDaisy}::uuid`
    );

    const [links] = await asUser(sql, daisy, (tx) => tx`select portal_links() as links`);
    expect(links.links).toEqual([]);

    const reports = await asUser(sql, daisy, (tx) => tx`select id from reports`);
    expect(reports).toEqual([]);

    const [jobs] = await asUser(
      sql,
      daisy,
      (tx) => tx`select portal_jobs(${businessA}::uuid) as jobs`
    );
    expect(jobs.jobs).toEqual([]);

    // Put it back so the ordering of these tests is not a trap for the next
    // person to add one.
    await asUser(
      sql,
      ownerA,
      (tx) => tx`update customer_users set deleted_at = null where customer_id = ${customerDaisy}::uuid`
    );
  });
});
