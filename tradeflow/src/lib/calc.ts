/**
 * Estimate, quote and invoice arithmetic.
 *
 * `computeDocumentTotals` is deliberately a mirror of the `document_totals()`
 * SQL function in migration 0002: quotes and invoices carry denormalised
 * totals maintained by a database trigger, and the form in the browser shows a
 * running total before anything is saved. Those two numbers must agree to the
 * cent, so tests/calc.test.ts checks a table of cases against both.
 */

import { applyBasisPoints, lineTotalCents, roundHalfAwayFromZero } from './money';

export type CostKind = 'labour' | 'materials' | 'equipment' | 'travel' | 'subcontractor' | 'other';

export const COST_KINDS: { value: CostKind; label: string }[] = [
  { value: 'labour', label: 'Labour' },
  { value: 'materials', label: 'Materials' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'travel', label: 'Travel' },
  { value: 'subcontractor', label: 'Subcontractors' },
  { value: 'other', label: 'Other' },
];

export interface LineInput {
  quantityMilli: number;
  unitPriceCents: number;
  taxable: boolean;
}

export interface DocumentTotals {
  subtotalCents: number;
  discountCents: number;
  netCents: number;
  taxableBaseCents: number;
  taxCents: number;
  totalCents: number;
}

export interface DocumentTotalsInput {
  lines: LineInput[];
  discountCents?: number;
  gstBasisPoints?: number;
  gstApplies?: boolean;
}

/**
 * Totals for a priced document.
 *
 * A discount is spread across the lines pro rata, so it reduces the taxable
 * base in the same proportion it reduces the bill. Discounting only the
 * GST-free lines (or only the taxable ones) would change the tax owed on an
 * otherwise identical job.
 */
export function computeDocumentTotals(input: DocumentTotalsInput): DocumentTotals {
  const gstBasisPoints = input.gstBasisPoints ?? 1000;
  const gstApplies = input.gstApplies ?? true;

  let subtotalCents = 0;
  let taxableSubtotalCents = 0;
  for (const line of input.lines) {
    const total = lineTotalCents(line.quantityMilli, line.unitPriceCents);
    subtotalCents += total;
    if (line.taxable) taxableSubtotalCents += total;
  }

  const discountCents = Math.min(Math.max(input.discountCents ?? 0, 0), Math.max(subtotalCents, 0));

  const taxableBaseCents =
    subtotalCents > 0
      ? Math.max(
          taxableSubtotalCents -
            roundHalfAwayFromZero((discountCents * taxableSubtotalCents) / subtotalCents),
          0
        )
      : 0;

  const netCents = subtotalCents - discountCents;
  const taxCents = gstApplies ? applyBasisPoints(taxableBaseCents, gstBasisPoints) : 0;

  return {
    subtotalCents,
    discountCents,
    netCents,
    taxableBaseCents,
    taxCents,
    totalCents: netCents + taxCents,
  };
}

// --- estimating -------------------------------------------------------------

export interface EstimateItemInput {
  kind: CostKind;
  quantityMilli: number;
  unitCostCents: number;
  taxable: boolean;
}

export interface EstimateTotals {
  /** What the work costs the business, before any markup. */
  estimatedCostCents: number;
  costByKind: Record<CostKind, number>;
  markupCents: number;
  contingencyCents: number;
  /** What the customer is charged, ex GST. */
  subtotalCents: number;
  taxableBaseCents: number;
  gstCents: number;
  totalCents: number;
  estimatedProfitCents: number;
  /** Margin on the sell price, in basis points. 2500 = 25%. */
  marginBasisPoints: number;
  /** Markup on cost, in basis points — the number a builder quotes at. */
  markupBasisPoints: number;
}

export interface EstimateInput {
  items: EstimateItemInput[];
  markupBasisPoints?: number;
  contingencyBasisPoints?: number;
  gstBasisPoints?: number;
  gstApplies?: boolean;
}

const ZERO_BY_KIND = (): Record<CostKind, number> => ({
  labour: 0,
  materials: 0,
  equipment: 0,
  travel: 0,
  subcontractor: 0,
  other: 0,
});

/**
 * Cost-plus estimating: total the costs, add markup and contingency on cost,
 * then GST on the sell price.
 *
 * Markup and contingency inherit the taxability of the costs they sit on, in
 * proportion. If every cost line is taxable — the usual case — the whole sell
 * price is taxable and the proportion is 1.
 */
export function computeEstimateTotals(input: EstimateInput): EstimateTotals {
  const markupBp = input.markupBasisPoints ?? 0;
  const contingencyBp = input.contingencyBasisPoints ?? 0;
  const gstBp = input.gstBasisPoints ?? 1000;
  const gstApplies = input.gstApplies ?? true;

  const costByKind = ZERO_BY_KIND();
  let estimatedCostCents = 0;
  let taxableCostCents = 0;

  for (const item of input.items) {
    const cost = lineTotalCents(item.quantityMilli, item.unitCostCents);
    costByKind[item.kind] += cost;
    estimatedCostCents += cost;
    if (item.taxable) taxableCostCents += cost;
  }

  const markupCents = applyBasisPoints(estimatedCostCents, markupBp);
  const contingencyCents = applyBasisPoints(estimatedCostCents, contingencyBp);
  const subtotalCents = estimatedCostCents + markupCents + contingencyCents;

  const taxableBaseCents =
    estimatedCostCents > 0
      ? roundHalfAwayFromZero((subtotalCents * taxableCostCents) / estimatedCostCents)
      : subtotalCents;

  const gstCents = gstApplies ? applyBasisPoints(taxableBaseCents, gstBp) : 0;
  const estimatedProfitCents = subtotalCents - estimatedCostCents;

  return {
    estimatedCostCents,
    costByKind,
    markupCents,
    contingencyCents,
    subtotalCents,
    taxableBaseCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
    estimatedProfitCents,
    marginBasisPoints:
      subtotalCents > 0
        ? roundHalfAwayFromZero((estimatedProfitCents / subtotalCents) * 10000)
        : 0,
    markupBasisPoints:
      estimatedCostCents > 0
        ? roundHalfAwayFromZero((estimatedProfitCents / estimatedCostCents) * 10000)
        : 0,
  };
}

// --- work logs --------------------------------------------------------------

/**
 * Minutes worked between two clock times, less breaks. A finish time earlier
 * than the start means the shift ran past midnight, which is normal for
 * security and maintenance crews. Mirrors trg_work_log_minutes().
 */
export function workedMinutes(
  startTime: string | null | undefined,
  finishTime: string | null | undefined,
  breakMinutes = 0
): number {
  const start = parseClock(startTime);
  const finish = parseClock(finishTime);
  if (start === null || finish === null) return 0;
  let span = finish - start;
  if (span < 0) span += 24 * 60;
  return Math.max(span - Math.max(breakMinutes, 0), 0);
}

function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Hours as a decimal, to two places — how a timesheet is billed. */
export function minutesToDecimalHours(minutes: number): number {
  return roundHalfAwayFromZero((minutes / 60) * 100) / 100;
}

// --- invoices ---------------------------------------------------------------

export function amountDueCents(totalCents: number, paidCents: number): number {
  return Math.max(totalCents - paidCents, 0);
}

/**
 * The status an invoice should hold given what has been paid and the date.
 * Mirrors recalc_invoice_payments(); `draft` and `cancelled` are decisions a
 * person made and are never overwritten by arithmetic.
 */
export function deriveInvoiceStatus(input: {
  current: string;
  totalCents: number;
  paidCents: number;
  dueDate: string | null;
  viewedAt: string | null;
  today: string;
}): string {
  if (input.current === 'draft' || input.current === 'cancelled') return input.current;
  if (input.paidCents <= 0) {
    if (input.dueDate && input.dueDate < input.today) return 'overdue';
    return input.viewedAt ? 'viewed' : 'sent';
  }
  if (input.paidCents < input.totalCents) return 'partially_paid';
  return 'paid';
}

// --- job profitability ------------------------------------------------------

export interface JobProfitability {
  invoicedExGstCents: number;
  expensesExGstCents: number;
  profitCents: number;
  marginBasisPoints: number;
}

export function computeJobProfitability(
  invoicedExGstCents: number,
  expensesExGstCents: number
): JobProfitability {
  const profitCents = invoicedExGstCents - expensesExGstCents;
  return {
    invoicedExGstCents,
    expensesExGstCents,
    profitCents,
    marginBasisPoints:
      invoicedExGstCents > 0
        ? roundHalfAwayFromZero((profitCents / invoicedExGstCents) * 10000)
        : 0,
  };
}
