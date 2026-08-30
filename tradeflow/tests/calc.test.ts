import { describe, it, expect } from 'vitest';
import {
  computeDocumentTotals,
  computeEstimateTotals,
  workedMinutes,
  minutesToDecimalHours,
  deriveInvoiceStatus,
  amountDueCents,
  computeJobProfitability,
  formatMinutes,
} from '@/lib/calc';
import {
  parseMoneyToCents,
  parseQuantityToMilli,
  lineTotalCents,
  applyBasisPoints,
  centsToInput,
  milliToInput,
  percentToBasisPoints,
} from '@/lib/money';

describe('money parsing', () => {
  it('reads the ways a person actually types an amount', () => {
    expect(parseMoneyToCents('1250.50')).toBe(125050);
    expect(parseMoneyToCents('$1,250.50')).toBe(125050);
    expect(parseMoneyToCents(' 1250 ')).toBe(125000);
    expect(parseMoneyToCents('0.1')).toBe(10);
    expect(parseMoneyToCents('.5')).toBe(50);
    expect(parseMoneyToCents(1250.5)).toBe(125050);
  });

  it('tells an empty field from a zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('0')).toBe(0);
  });

  it('rounds half away from zero rather than to even', () => {
    // 0.005 dollars is half a cent. Postgres round() gives 1; so must we.
    expect(parseMoneyToCents('0.005')).toBe(1);
    expect(parseMoneyToCents('0.015')).toBe(2);
    expect(parseMoneyToCents('0.025')).toBe(3);
  });

  it('round-trips through the input formatters', () => {
    expect(centsToInput(125050)).toBe('1250.50');
    expect(centsToInput(0)).toBe('0.00');
    expect(milliToInput(2500)).toBe('2.5');
    expect(milliToInput(1000)).toBe('1');
    expect(milliToInput(375)).toBe('0.375');
    expect(parseQuantityToMilli('2.5')).toBe(2500);
    expect(percentToBasisPoints('12.5')).toBe(1250);
    expect(percentToBasisPoints('10%')).toBe(1000);
  });

  it('keeps fractional quantities exact', () => {
    // 3 × 0.1 in floating point is 0.30000000000000004; in milli it is 300.
    const q = parseQuantityToMilli('0.1')!;
    expect(q * 3).toBe(300);
    expect(lineTotalCents(q, 10_000)).toBe(1000); // 0.1 × $100 = $10.00
  });
});

describe('line totals', () => {
  it('multiplies a fractional quantity by a unit price', () => {
    expect(lineTotalCents(2500, 8500)).toBe(21250); // 2.5 × $85.00 = $212.50
    expect(lineTotalCents(1000, 12345)).toBe(12345);
    expect(lineTotalCents(0, 9999)).toBe(0);
  });

  it('rounds the half-cent up', () => {
    expect(lineTotalCents(1500, 1)).toBe(2); // 1.5 × 1c = 1.5c -> 2c
    expect(lineTotalCents(500, 1)).toBe(1); // 0.5 × 1c = 0.5c -> 1c
  });

  it('applies basis points', () => {
    expect(applyBasisPoints(100_000, 1000)).toBe(10_000); // 10% GST on $1000
    expect(applyBasisPoints(9999, 1000)).toBe(1000); // 999.9c -> 1000c
    expect(applyBasisPoints(0, 1000)).toBe(0);
  });
});

describe('computeDocumentTotals', () => {
  const line = (qty: number, price: number, taxable = true) => ({
    quantityMilli: qty,
    unitPriceCents: price,
    taxable,
  });

  it('totals a simple quote with GST', () => {
    const totals = computeDocumentTotals({
      lines: [line(1000, 100_000), line(2000, 25_000)],
    });
    expect(totals.subtotalCents).toBe(150_000); // $1500 ex GST
    expect(totals.taxCents).toBe(15_000); // $150 GST
    expect(totals.totalCents).toBe(165_000); // $1650 inc GST
  });

  it('leaves GST-free lines out of the tax', () => {
    const totals = computeDocumentTotals({
      lines: [line(1000, 100_000, true), line(1000, 50_000, false)],
    });
    expect(totals.subtotalCents).toBe(150_000);
    expect(totals.taxableBaseCents).toBe(100_000);
    expect(totals.taxCents).toBe(10_000);
    expect(totals.totalCents).toBe(160_000);
  });

  it('charges no GST when the business is not registered', () => {
    const totals = computeDocumentTotals({
      lines: [line(1000, 100_000)],
      gstApplies: false,
    });
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(100_000);
  });

  it('spreads a discount across taxable and free lines in proportion', () => {
    const totals = computeDocumentTotals({
      lines: [line(1000, 100_000, true), line(1000, 100_000, false)],
      discountCents: 20_000, // $200 off $2000: 10%
    });
    expect(totals.netCents).toBe(180_000);
    // Half the bill is taxable, so half the discount comes off the taxable base.
    expect(totals.taxableBaseCents).toBe(90_000);
    expect(totals.taxCents).toBe(9_000);
    expect(totals.totalCents).toBe(189_000);
  });

  it('never discounts below zero', () => {
    const totals = computeDocumentTotals({
      lines: [line(1000, 10_000)],
      discountCents: 999_999,
    });
    expect(totals.discountCents).toBe(10_000);
    expect(totals.netCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(0);
  });

  it('handles an empty document', () => {
    const totals = computeDocumentTotals({ lines: [] });
    expect(totals).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });

  it('adds up the same as summing the lines, cent for cent', () => {
    // A long ragged document is where a percentage-based tax calculation
    // usually drifts by a cent or two.
    const lines = Array.from({ length: 97 }, (_, i) =>
      line(((i % 7) + 1) * 333, 1234 + i * 17, i % 3 !== 0)
    );
    const totals = computeDocumentTotals({ lines });
    const sum = lines.reduce((n, l) => n + lineTotalCents(l.quantityMilli, l.unitPriceCents), 0);
    expect(totals.subtotalCents).toBe(sum);
    expect(totals.totalCents).toBe(totals.netCents + totals.taxCents);
  });
});

describe('computeEstimateTotals', () => {
  const item = (kind: 'labour' | 'materials', qty: number, cost: number, taxable = true) => ({
    kind,
    quantityMilli: qty,
    unitCostCents: cost,
    taxable,
  });

  it('adds markup and contingency on cost, then GST on the sell price', () => {
    const totals = computeEstimateTotals({
      items: [
        item('labour', 40_000, 8500), // 40h × $85 = $3400
        item('materials', 1000, 120_000), // $1200
      ],
      markupBasisPoints: 2000, // 20%
      contingencyBasisPoints: 500, // 5%
    });

    expect(totals.estimatedCostCents).toBe(460_000); // $4600
    expect(totals.costByKind.labour).toBe(340_000);
    expect(totals.costByKind.materials).toBe(120_000);
    expect(totals.markupCents).toBe(92_000); // 20% of $4600
    expect(totals.contingencyCents).toBe(23_000); // 5% of $4600
    expect(totals.subtotalCents).toBe(575_000); // $5750 ex GST
    expect(totals.gstCents).toBe(57_500);
    expect(totals.totalCents).toBe(632_500); // $6325 inc GST
    expect(totals.estimatedProfitCents).toBe(115_000); // $1150
    expect(totals.marginBasisPoints).toBe(2000); // 20% margin on sell
    expect(totals.markupBasisPoints).toBe(2500); // 25% markup on cost
  });

  it('separates margin from markup', () => {
    // The classic trade mix-up: 50% markup on cost is 33.3% margin on sell.
    const totals = computeEstimateTotals({
      items: [item('materials', 1000, 100_000)],
      markupBasisPoints: 5000,
    });
    expect(totals.markupBasisPoints).toBe(5000);
    expect(totals.marginBasisPoints).toBe(3333);
  });

  it('taxes only the share of the sell price that sits on taxable cost', () => {
    const totals = computeEstimateTotals({
      items: [item('materials', 1000, 100_000, true), item('labour', 1000, 100_000, false)],
      markupBasisPoints: 1000,
    });
    expect(totals.subtotalCents).toBe(220_000);
    expect(totals.taxableBaseCents).toBe(110_000); // half of the sell price
    expect(totals.gstCents).toBe(11_000);
  });

  it('is all zeros for an estimate with no lines', () => {
    const totals = computeEstimateTotals({ items: [], markupBasisPoints: 2000 });
    expect(totals.estimatedCostCents).toBe(0);
    expect(totals.subtotalCents).toBe(0);
    expect(totals.marginBasisPoints).toBe(0);
    expect(totals.markupBasisPoints).toBe(0);
  });

  it('reports zero profit at zero markup', () => {
    const totals = computeEstimateTotals({
      items: [item('materials', 1000, 100_000)],
      markupBasisPoints: 0,
    });
    expect(totals.estimatedProfitCents).toBe(0);
    expect(totals.marginBasisPoints).toBe(0);
  });
});

describe('work log hours', () => {
  it('subtracts the break', () => {
    expect(workedMinutes('07:00', '15:30', 30)).toBe(480); // 8h
    expect(minutesToDecimalHours(480)).toBe(8);
  });

  it('handles a shift that runs past midnight', () => {
    // Night patrol: 22:00 to 06:00 is eight hours, not minus sixteen.
    expect(workedMinutes('22:00', '06:00', 0)).toBe(480);
    expect(workedMinutes('23:30', '00:30', 0)).toBe(60);
  });

  it('never goes negative when the break is longer than the shift', () => {
    expect(workedMinutes('09:00', '09:15', 60)).toBe(0);
  });

  it('is zero until both times are entered', () => {
    expect(workedMinutes('07:00', null, 0)).toBe(0);
    expect(workedMinutes(null, '15:00', 0)).toBe(0);
    expect(workedMinutes('', '', 0)).toBe(0);
  });

  it('accepts seconds on the clock value, as Postgres returns them', () => {
    expect(workedMinutes('07:00:00', '15:00:00', 0)).toBe(480);
  });

  it('formats for a timesheet', () => {
    expect(formatMinutes(480)).toBe('8h');
    expect(formatMinutes(495)).toBe('8h 15m');
    expect(formatMinutes(45)).toBe('45m');
    expect(minutesToDecimalHours(495)).toBe(8.25);
  });
});

describe('invoice status', () => {
  const base = {
    totalCents: 100_000,
    paidCents: 0,
    dueDate: '2026-01-31',
    viewedAt: null,
    today: '2026-01-15',
  };

  it('goes overdue once the due date passes', () => {
    expect(deriveInvoiceStatus({ ...base, current: 'sent', today: '2026-02-01' })).toBe('overdue');
    expect(deriveInvoiceStatus({ ...base, current: 'sent' })).toBe('sent');
  });

  it('tracks partial payment', () => {
    expect(deriveInvoiceStatus({ ...base, current: 'sent', paidCents: 40_000 })).toBe('partially_paid');
    expect(deriveInvoiceStatus({ ...base, current: 'sent', paidCents: 100_000 })).toBe('paid');
    // Overpaid still counts as paid, not as an error.
    expect(deriveInvoiceStatus({ ...base, current: 'sent', paidCents: 150_000 })).toBe('paid');
  });

  it('leaves a decision a person made alone', () => {
    expect(deriveInvoiceStatus({ ...base, current: 'draft', today: '2027-01-01' })).toBe('draft');
    expect(deriveInvoiceStatus({ ...base, current: 'cancelled', paidCents: 100_000 })).toBe('cancelled');
  });

  it('computes what is still owed', () => {
    expect(amountDueCents(100_000, 40_000)).toBe(60_000);
    expect(amountDueCents(100_000, 150_000)).toBe(0);
  });
});

describe('job profitability', () => {
  it('works in ex-GST money on both sides', () => {
    const p = computeJobProfitability(500_000, 320_000);
    expect(p.profitCents).toBe(180_000);
    expect(p.marginBasisPoints).toBe(3600); // 36%
  });

  it('reports a loss rather than clamping to zero', () => {
    const p = computeJobProfitability(100_000, 150_000);
    expect(p.profitCents).toBe(-50_000);
    expect(p.marginBasisPoints).toBe(-5000);
  });

  it('does not divide by zero on a job with nothing invoiced', () => {
    const p = computeJobProfitability(0, 50_000);
    expect(p.marginBasisPoints).toBe(0);
    expect(p.profitCents).toBe(-50_000);
  });
});
