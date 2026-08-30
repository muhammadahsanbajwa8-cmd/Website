/**
 * Reading the line-item editor's indexed fields back out of a FormData.
 *
 * The editor posts `items.0.description`, `items.0.quantity` and so on. Indexes
 * are not contiguous after a row is deleted client-side, so the parser walks
 * the actual keys rather than counting from zero, and preserves the order the
 * indexes imply.
 */

import { moneyToCents, quantityToMilli } from './money';
import type { CostKind } from './calc';

const COST_KINDS = new Set<CostKind>([
  'labour', 'materials', 'equipment', 'travel', 'subcontractor', 'other',
]);

export interface ParsedItem {
  id?: string;
  kind: CostKind;
  description: string;
  detail: string | null;
  quantityMilli: number;
  unit: string;
  amountCents: number;
  taxable: boolean;
}

export function parseItems(formData: FormData): ParsedItem[] {
  const indexes = new Set<number>();
  for (const key of formData.keys()) {
    const match = /^items\.(\d+)\./.exec(key);
    if (match) indexes.add(Number(match[1]));
  }

  const items: ParsedItem[] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const read = (field: string) => {
      const value = formData.get(`items.${index}.${field}`);
      return typeof value === 'string' ? value : '';
    };

    const description = read('description').trim();
    // A row the person started and abandoned has no description and no price;
    // drop it rather than failing the whole document on it.
    if (description === '' && read('amount').trim() === '') continue;

    const kind = read('kind') as CostKind;

    items.push({
      id: read('id') || undefined,
      kind: COST_KINDS.has(kind) ? kind : 'materials',
      description: description.slice(0, 500),
      detail: read('detail').trim().slice(0, 2000) || null,
      quantityMilli: Math.max(quantityToMilli(read('quantity')), 0),
      unit: read('unit').trim().slice(0, 20) || 'each',
      amountCents: moneyToCents(read('amount')),
      // An unchecked checkbox posts nothing at all.
      taxable: formData.get(`items.${index}.taxable`) !== null,
    });
  }

  return items;
}

/** Percent field ("12.5") to basis points (1250), clamped to something sane. */
export function readPercent(formData: FormData, name: string, fallback = 0): number {
  const raw = formData.get(name);
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw.replace(/[%\s]/g, ''));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value * 100), 0), 100_000);
}
