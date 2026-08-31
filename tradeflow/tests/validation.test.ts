import { describe, it, expect } from 'vitest';
import {
  signUpSchema,
  customerSchema,
  jobSchema,
  quoteSchema,
  invoiceSchema,
  paymentSchema,
  workLogSchema,
  expenseSchema,
  inviteSchema,
  composeEmailSchema,
  fieldErrors,
  firstError,
} from '@/lib/validation';
import {
  isValidAbn,
  formatAbn,
  formatBsb,
  formatPhone,
  formatMoney,
  formatDate,
  addDays,
  daysBetween,
  todayInAustralia,
  formatAddress,
  initials,
  pluralise,
  truncate,
} from '@/lib/format';

/**
 * Forms fail in front of the person, not behind them.
 *
 * Every server action parses its input through one of these schemas before it
 * touches the database, so what they refuse is what the person is told to fix.
 */

describe('signing up', () => {
  it('wants a password worth having', () => {
    const weak = signUpSchema.safeParse({
      fullName: 'Sam Rivers',
      email: 'sam@example.com',
      password: 'short1',
      confirmPassword: 'short1',
    });
    expect(weak.success).toBe(false);
    expect(fieldErrors(weak.error!).password?.[0]).toMatch(/at least 10/);
  });

  it('wants a letter and a number', () => {
    const parsed = signUpSchema.safeParse({
      fullName: 'Sam Rivers',
      email: 'sam@example.com',
      password: 'aaaaaaaaaaaa',
      confirmPassword: 'aaaaaaaaaaaa',
    });
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!).password?.[0]).toMatch(/letter and one number/);
  });

  it('puts the mismatch on the field that is wrong', () => {
    const parsed = signUpSchema.safeParse({
      fullName: 'Sam Rivers',
      email: 'sam@example.com',
      password: 'correct-horse-1',
      confirmPassword: 'correct-horse-2',
    });
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!).confirmPassword?.[0]).toMatch(/do not match/);
  });

  it('accepts a reasonable one', () => {
    expect(
      signUpSchema.safeParse({
        fullName: 'Sam Rivers',
        email: ' sam@example.com ',
        password: 'bricks-and-mortar-92',
        confirmPassword: 'bricks-and-mortar-92',
      }).success
    ).toBe(true);
  });
});

describe('a customer', () => {
  it('needs a name and nothing else', () => {
    const parsed = customerSchema.safeParse({ name: 'Dana Whitfield' });
    expect(parsed.success).toBe(true);
  });

  it('says so when the name is blank', () => {
    const parsed = customerSchema.safeParse({ name: '   ' });
    expect(parsed.success).toBe(false);
    expect(firstError(fieldErrors(parsed.error!))).toMatch(/Customer name/i);
  });

  it('refuses an ABN that fails the checksum', () => {
    const parsed = customerSchema.safeParse({ name: 'Dana', abn: '12345678901' });
    expect(parsed.success).toBe(false);
  });

  it('accepts an ABN that passes it, however it was typed', () => {
    expect(customerSchema.safeParse({ name: 'Dana', abn: '51 824 753 556' }).success).toBe(true);
  });

  it('refuses a postcode that is not four digits', () => {
    expect(customerSchema.safeParse({ name: 'Dana', postcode: '20099' }).success).toBe(false);
    expect(customerSchema.safeParse({ name: 'Dana', postcode: '2009' }).success).toBe(true);
  });
});

describe('a job', () => {
  const base = { name: 'Retaining wall', status: 'scheduled' as const };

  it('cannot finish before it starts', () => {
    const parsed = jobSchema.safeParse({
      ...base,
      startDate: '2026-03-10',
      expectedCompletionDate: '2026-03-01',
    });
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!).expectedCompletionDate?.[0]).toMatch(/before the start/);
  });

  it('is happy with dates the right way round', () => {
    expect(
      jobSchema.safeParse({
        ...base,
        startDate: '2026-03-01',
        expectedCompletionDate: '2026-03-10',
      }).success
    ).toBe(true);
  });

  it('is happy with no dates at all', () => {
    expect(jobSchema.safeParse(base).success).toBe(true);
  });
});

describe('a priced document', () => {
  // Quantities are thousandths and money is cents by the time a schema sees
  // them: the form converts what was typed before it is parsed.
  const line = {
    description: 'Brickwork',
    quantityMilli: 20_000,
    unitPriceCents: 9500,
    unit: 'm2',
  };
  const quote = {
    title: 'Front fence',
    customerId: '11111111-1111-4111-8111-111111111111',
    issueDate: '2026-03-01',
    items: [line],
  };

  it('needs at least one line', () => {
    const parsed = quoteSchema.safeParse({ ...quote, items: [] });
    expect(parsed.success).toBe(false);
    expect(firstError(fieldErrors(parsed.error!))).toMatch(/at least one line/);
  });

  it('takes a line and a customer', () => {
    expect(quoteSchema.safeParse(quote).success).toBe(true);
  });

  it('will not have an invoice due before it is issued', () => {
    const parsed = invoiceSchema.safeParse({
      customerId: quote.customerId,
      issueDate: '2026-03-10',
      dueDate: '2026-03-01',
      items: [line],
    });
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!).dueDate?.[0]).toMatch(/before the issue date/);
  });

  it('refuses a GST rate outside nought to a hundred per cent', () => {
    expect(quoteSchema.safeParse({ ...quote, gstBp: 20_000 }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...quote, gstBp: 1000 }).success).toBe(true);
  });

  it('refuses a payment of nothing', () => {
    const payment = {
      invoiceId: '11111111-1111-4111-8111-111111111111',
      amountCents: 0,
      method: 'bank_transfer',
      paidOn: '2026-03-01',
    };
    expect(paymentSchema.safeParse(payment).success).toBe(false);
    expect(paymentSchema.safeParse({ ...payment, amountCents: 1 }).success).toBe(true);
  });
});

describe('a day on site', () => {
  const base = { jobId: '11111111-1111-4111-8111-111111111111', workDate: '2026-03-01' };

  it('takes the times a worker actually enters', () => {
    const parsed = workLogSchema.safeParse({
      ...base,
      startTime: '07:00',
      finishTime: '15:30',
      breakMinutes: '30',
      workerCount: '3',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.breakMinutes).toBe(30);
    expect(parsed.data!.workerCount).toBe(3);
  });

  it('refuses a break longer than a day', () => {
    expect(workLogSchema.safeParse({ ...base, breakMinutes: 2000 }).success).toBe(false);
  });

  it('refuses a date that is not a date', () => {
    expect(workLogSchema.safeParse({ ...base, workDate: '1 March' }).success).toBe(false);
  });
});

describe('a receipt', () => {
  it('needs a category the reports know about', () => {
    const base = { description: 'Bricks', amountCents: 42_000, spentOn: '2026-03-01' };
    expect(expenseSchema.safeParse({ ...base, category: 'materials' }).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, category: 'miscellaneous' }).success).toBe(false);
  });
});

describe('inviting someone', () => {
  it('will not invite them as an owner by accident', () => {
    const parsed = inviteSchema.safeParse({ email: 'new@example.com', role: 'not-a-role' });
    expect(parsed.success).toBe(false);
  });

  it('takes an email and a role', () => {
    expect(inviteSchema.safeParse({ email: 'new@example.com', role: 'worker' }).success).toBe(true);
  });
});

describe('composing an email', () => {
  it('needs somewhere to send it', () => {
    const parsed = composeEmailSchema.safeParse({ to: '', subject: 'Hello', body: 'Hi' });
    expect(parsed.success).toBe(false);
  });

  it('reads a comma-separated list of addresses', () => {
    const parsed = composeEmailSchema.safeParse({
      to: 'one@example.com, two@example.com',
      subject: 'Quote attached',
      body: 'As discussed.',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.to).toEqual(['one@example.com', 'two@example.com']);
  });

  it('refuses an address that is not one', () => {
    expect(
      composeEmailSchema.safeParse({ to: 'not-an-address', subject: 'x', body: 'y' }).success
    ).toBe(false);
  });
});

describe('Australian formatting', () => {
  it('checks an ABN against the ATO algorithm', () => {
    expect(isValidAbn('51824753556')).toBe(true);
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('51824753557')).toBe(false);
    expect(isValidAbn('123')).toBe(false);
    expect(isValidAbn(null)).toBe(false);
  });

  it('writes an ABN the way the ATO prints it', () => {
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
  });

  it('writes a BSB with its hyphen', () => {
    expect(formatBsb('062000')).toBe('062-000');
  });

  it('writes a mobile in threes', () => {
    expect(formatPhone('0412555108')).toBe('0412 555 108');
    expect(formatPhone('0299998888')).toBe('(02) 9999 8888');
  });

  it('writes money in dollars and cents', () => {
    expect(formatMoney(125050)).toBe('$1,250.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(null)).toBe('$0.00');
  });

  it('writes a date day-first', () => {
    expect(formatDate('2026-03-09')).toBe('09/03/2026');
  });

  it('counts days without tripping over a month end', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
  });

  it("knows today in the business's own timezone", () => {
    expect(todayInAustralia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lays out an address the way it goes on an envelope', () => {
    expect(
      formatAddress({
        address_line1: '88 Wharf Road',
        suburb: 'Pyrmont',
        state: 'NSW',
        postcode: '2009',
      })
    ).toBe('88 Wharf Road, Pyrmont NSW 2009');
  });

  it('handles the small things', () => {
    expect(initials('Dana Whitfield')).toBe('DW');
    expect(initials(null)).toBe('?');
    expect(pluralise(1, 'job')).toBe('1 job');
    expect(pluralise(2, 'job')).toBe('2 jobs');
    expect(truncate('a'.repeat(30), 10)).toHaveLength(10);
  });
});
