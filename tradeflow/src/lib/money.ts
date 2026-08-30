/**
 * Money and quantity primitives.
 *
 * Every monetary amount in this application is an integer number of cents, and
 * every quantity is an integer number of thousandths ("milli"). Nothing here
 * or downstream holds a price or a quantity in a float, because 0.1 + 0.2 on a
 * tax line is a bug someone eventually finds on an invoice.
 */

/** Round half away from zero — what a person does on paper, and what Postgres `round()` does. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Parse a typed money value ("1,250.50", "$1250.5", "1250") into cents.
 * Returns null for anything that is not a number, so callers can tell an empty
 * field from a zero.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return roundHalfAwayFromZero(input * 100);
  }
  const cleaned = input.replace(/[$\s,]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return roundHalfAwayFromZero(value * 100);
}

/** Same, but a blank or unparseable value becomes 0. For optional cost fields. */
export function moneyToCents(input: string | number | null | undefined): number {
  return parseMoneyToCents(input) ?? 0;
}

/** Parse a quantity ("2.5", "0.375") into thousandths. */
export function parseQuantityToMilli(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return roundHalfAwayFromZero(input * 1000);
  }
  const cleaned = input.replace(/[\s,]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return roundHalfAwayFromZero(value * 1000);
}

export function quantityToMilli(input: string | number | null | undefined): number {
  return parseQuantityToMilli(input) ?? 0;
}

/** Cents to a plain decimal string with no symbol: 125050 -> "1250.50". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/** Milli to a plain decimal string, trailing zeros trimmed: 2500 -> "2.5". */
export function milliToInput(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return '';
  const text = (milli / 1000).toFixed(3);
  return text.replace(/\.?0+$/, '') || '0';
}

/** One line's money value. Mirrors line_total_cents() in the database. */
export function lineTotalCents(quantityMilli: number, unitPriceCents: number): number {
  return roundHalfAwayFromZero((quantityMilli * unitPriceCents) / 1000);
}

/** Basis points of a value, e.g. 10% GST is 1000bp. */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  return roundHalfAwayFromZero((cents * basisPoints) / 10000);
}

export const GST_BASIS_POINTS = 1000; // Australian GST: 10%

/** Percent as typed ("12.5") to basis points (1250). */
export function percentToBasisPoints(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const value = typeof input === 'number' ? input : Number(String(input).replace(/[%\s]/g, ''));
  if (!Number.isFinite(value)) return null;
  return roundHalfAwayFromZero(value * 100);
}

export function basisPointsToPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '';
  const text = (bp / 100).toFixed(2);
  return text.replace(/\.?0+$/, '') || '0';
}
