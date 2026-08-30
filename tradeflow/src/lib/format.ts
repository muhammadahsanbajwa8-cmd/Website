/**
 * Australian formatting. Dates are d/m/Y, money is AUD, and the timezone the
 * business day is measured in is Australia/Sydney unless a business says
 * otherwise.
 */

export const AU_TIMEZONE = 'Australia/Sydney';
export const AU_LOCALE = 'en-AU';

const currencyFormatter = new Intl.NumberFormat(AU_LOCALE, {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyWholeFormatter = new Intl.NumberFormat(AU_LOCALE, {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 125050 -> "$1,250.50" */
export function formatMoney(cents: number | null | undefined): string {
  return currencyFormatter.format((cents ?? 0) / 100);
}

/** For headline figures where cents are noise: 125050 -> "$1,251" */
export function formatMoneyCompact(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  }
  if (Math.abs(value) >= 10_000) {
    return `$${Math.round(value / 1000)}k`;
  }
  return currencyWholeFormatter.format(value);
}

export function formatBasisPoints(bp: number | null | undefined): string {
  const value = (bp ?? 0) / 100;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

/** A `YYYY-MM-DD` date column, never shifted by a timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return formatDateTime(value.toISOString()).split(',')[0]!;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateLong(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(AU_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** A timestamptz, rendered in the business's timezone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(AU_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: AU_TIMEZONE,
  }).format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(AU_LOCALE, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** Today in the business timezone as `YYYY-MM-DD`. */
export function todayInAustralia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: AU_TIMEZONE,
  }).format(new Date());
  return parts;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 51824753556 -> "51 824 753 556", the ATO's own spacing. */
export function formatAbn(abn: string | null | undefined): string {
  if (!abn) return '';
  const digits = abn.replace(/\D/g, '');
  if (digits.length !== 11) return abn;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

/**
 * The ATO's ABN checksum. Subtract 1 from the first digit, weight the eleven
 * digits, and the sum must divide by 89.
 */
export function isValidAbn(abn: string | null | undefined): boolean {
  if (!abn) return false;
  const digits = abn.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const digit = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += digit * weights[i]!;
  }
  return sum % 89 === 0;
}

export function formatBsb(bsb: string | null | undefined): string {
  if (!bsb) return '';
  const digits = bsb.replace(/\D/g, '');
  if (digits.length !== 6) return bsb;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  if (/^04\d{8}$/.test(digits)) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (/^0[2378]\d{8}$/.test(digits)) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

export interface AddressParts {
  address_line1?: string | null;
  address_line2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}

export function formatAddress(parts: AddressParts | null | undefined): string {
  if (!parts) return '';
  const street = [parts.address_line1, parts.address_line2].filter(Boolean).join(', ');
  const locality = [parts.suburb, parts.state, parts.postcode].filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

export function formatAddressLines(parts: AddressParts | null | undefined): string[] {
  if (!parts) return [];
  return [
    parts.address_line1,
    parts.address_line2,
    [parts.suburb, parts.state, parts.postcode].filter(Boolean).join(' ') || null,
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function truncate(text: string | null | undefined, length: number): string {
  if (!text) return '';
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}
