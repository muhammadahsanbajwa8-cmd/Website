'use client';

import { useMemo, useState } from 'react';
import {
  Icon,
  Input,
  MoneyInput,
  Select,
  buttonClass,
  cn,
  icons,
} from '@/components/ui';
import { UNITS } from '@/lib/domain';
import { COST_KINDS, computeDocumentTotals, computeEstimateTotals, type CostKind } from '@/lib/calc';
import { centsToInput, milliToInput, moneyToCents, quantityToMilli } from '@/lib/money';
import { formatBasisPoints, formatMoney } from '@/lib/format';

/**
 * The pricing editor.
 *
 * Rows are held in React state and posted as indexed form fields
 * (`items.0.description`, `items.1.unit_cost`, …), so the whole document
 * arrives in one submission with no draft-saving round trips. The totals shown
 * here are computed by the same functions the server and the database use, so
 * the figure on screen is the figure that gets saved.
 */

export interface EditorLine {
  key: string;
  id?: string;
  kind: CostKind;
  description: string;
  detail: string;
  quantity: string;
  unit: string;
  amount: string;
  taxable: boolean;
}

let counter = 0;
const nextKey = () => `line-${(counter += 1)}`;

export function blankLine(kind: CostKind = 'materials'): EditorLine {
  return {
    key: nextKey(),
    kind,
    description: '',
    detail: '',
    quantity: '1',
    unit: 'each',
    amount: '',
    taxable: true,
  };
}

export function toEditorLines(
  rows: {
    id: string;
    description: string;
    detail?: string | null;
    quantity_milli: number;
    unit: string;
    taxable: boolean;
    kind?: CostKind;
    unit_cost_cents?: number;
    unit_price_cents?: number;
  }[]
): EditorLine[] {
  return rows.map((row) => ({
    key: nextKey(),
    id: row.id,
    kind: row.kind ?? 'materials',
    description: row.description,
    detail: row.detail ?? '',
    quantity: milliToInput(row.quantity_milli),
    unit: row.unit,
    amount: centsToInput(row.unit_cost_cents ?? row.unit_price_cents ?? 0),
    taxable: row.taxable,
  }));
}

interface CommonProps {
  initial?: EditorLine[];
  gstApplies: boolean;
  gstBasisPoints?: number;
  discountCents?: number;
}

// --- estimate ---------------------------------------------------------------

/**
 * Cost-plus estimating: cost lines by kind, then markup and contingency on
 * top, and the margin shown while you type.
 */
export function EstimateEditor({
  initial,
  gstApplies,
  markupBpDefault = 1500,
  contingencyBpDefault = 0,
}: CommonProps & { markupBpDefault?: number; contingencyBpDefault?: number }) {
  const [lines, setLines] = useState<EditorLine[]>(
    initial?.length ? initial : [blankLine('labour')]
  );
  const [markupPercent, setMarkupPercent] = useState(String(markupBpDefault / 100));
  const [contingencyPercent, setContingencyPercent] = useState(String(contingencyBpDefault / 100));
  const [gst, setGst] = useState(gstApplies);

  const totals = useMemo(
    () =>
      computeEstimateTotals({
        items: lines.map((line) => ({
          kind: line.kind,
          quantityMilli: quantityToMilli(line.quantity),
          unitCostCents: moneyToCents(line.amount),
          taxable: line.taxable,
        })),
        markupBasisPoints: Math.round((Number(markupPercent) || 0) * 100),
        contingencyBasisPoints: Math.round((Number(contingencyPercent) || 0) * 100),
        gstApplies: gst,
      }),
    [lines, markupPercent, contingencyPercent, gst]
  );

  const update = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="space-y-4">
      <input type="hidden" name="markupPercent" value={markupPercent} />
      <input type="hidden" name="contingencyPercent" value={contingencyPercent} />
      <input type="hidden" name="gstApplies" value={gst ? 'on' : ''} />

      <div className="space-y-3">
        {lines.map((line, index) => (
          <LineRow
            key={line.key}
            index={index}
            line={line}
            showKind
            amountLabel="Unit cost"
            onChange={(patch) => update(line.key, patch)}
            onRemove={
              lines.length > 1
                ? () => setLines((current) => current.filter((l) => l.key !== line.key))
                : undefined
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {COST_KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            onClick={() => setLines((current) => [...current, blankLine(kind.value)])}
            className={buttonClass('secondary', 'sm')}
          >
            <Icon path={icons.plus} size={14} />
            {kind.label}
          </button>
        ))}
      </div>

      {/* Markup, contingency, and what it all means */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
              Markup on cost
            </span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={markupPercent}
                onChange={(event) => setMarkupPercent(event.target.value)}
                className="field-input pr-8 text-right tabular"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                %
              </span>
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
              Contingency
            </span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={contingencyPercent}
                onChange={(event) => setContingencyPercent(event.target.value)}
                className="field-input pr-8 text-right tabular"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">
                %
              </span>
            </div>
          </label>

          <label className="flex items-end pb-2.5">
            <span className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={gst}
                onChange={(event) => setGst(event.target.checked)}
                className="h-5 w-5 rounded border-[var(--line-strong)] accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--text-strong)]">Add GST</span>
            </span>
          </label>
        </div>

        <div className="mt-5 grid gap-x-8 gap-y-2 border-t border-[var(--line-default)] pt-4 sm:grid-cols-2">
          <TotalRow label="Labour" value={formatMoney(totals.costByKind.labour)} muted />
          <TotalRow label="Materials" value={formatMoney(totals.costByKind.materials)} muted />
          <TotalRow label="Equipment" value={formatMoney(totals.costByKind.equipment)} muted />
          <TotalRow label="Travel" value={formatMoney(totals.costByKind.travel)} muted />
          <TotalRow label="Subcontractors" value={formatMoney(totals.costByKind.subcontractor)} muted />
          <TotalRow label="Other" value={formatMoney(totals.costByKind.other)} muted />
        </div>

        <div className="mt-4 space-y-2 border-t border-[var(--line-default)] pt-4">
          <TotalRow label="Estimated cost" value={formatMoney(totals.estimatedCostCents)} />
          <TotalRow label="Markup" value={formatMoney(totals.markupCents)} />
          {totals.contingencyCents > 0 ? (
            <TotalRow label="Contingency" value={formatMoney(totals.contingencyCents)} />
          ) : null}
          <TotalRow label="Subtotal (ex GST)" value={formatMoney(totals.subtotalCents)} strong />
          {gst ? <TotalRow label="GST" value={formatMoney(totals.gstCents)} /> : null}
          <TotalRow label="Total" value={formatMoney(totals.totalCents)} strong />
        </div>

        <div className="mt-4 grid gap-3 border-t border-[var(--line-default)] pt-4 sm:grid-cols-2">
          <div className="rounded-[0.625rem] bg-[var(--surface-card)] p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Estimated profit
            </div>
            <div
              className={cn(
                'mt-1 text-xl font-semibold tabular',
                totals.estimatedProfitCents >= 0 ? 'text-[var(--ok)]' : 'text-[var(--bad)]'
              )}
            >
              {formatMoney(totals.estimatedProfitCents)}
            </div>
          </div>
          <div className="rounded-[0.625rem] bg-[var(--surface-card)] p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Margin on sell price
            </div>
            <div className="mt-1 text-xl font-semibold tabular text-[var(--text-strong)]">
              {formatBasisPoints(totals.marginBasisPoints)}
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
              {formatBasisPoints(totals.markupBasisPoints)} markup on cost
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- quote and invoice ------------------------------------------------------

/** Sell-price lines, with the same live totals a customer will see. */
export function DocumentEditor({
  initial,
  gstApplies,
  discountCents = 0,
  showDiscount = true,
}: CommonProps & { showDiscount?: boolean }) {
  const [lines, setLines] = useState<EditorLine[]>(initial?.length ? initial : [blankLine()]);
  const [discount, setDiscount] = useState(discountCents ? centsToInput(discountCents) : '');
  const [gst, setGst] = useState(gstApplies);

  const totals = useMemo(
    () =>
      computeDocumentTotals({
        lines: lines.map((line) => ({
          quantityMilli: quantityToMilli(line.quantity),
          unitPriceCents: moneyToCents(line.amount),
          taxable: line.taxable,
        })),
        discountCents: moneyToCents(discount),
        gstApplies: gst,
      }),
    [lines, discount, gst]
  );

  const update = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="space-y-4">
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="gstApplies" value={gst ? 'on' : ''} />

      <div className="space-y-3">
        {lines.map((line, index) => (
          <LineRow
            key={line.key}
            index={index}
            line={line}
            showDetail
            amountLabel="Unit price"
            onChange={(patch) => update(line.key, patch)}
            onRemove={
              lines.length > 1
                ? () => setLines((current) => current.filter((l) => l.key !== line.key))
                : undefined
            }
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLines((current) => [...current, blankLine()])}
        className={buttonClass('secondary', 'md')}
      >
        <Icon path={icons.plus} size={16} />
        Add a line
      </button>

      <div className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-4">
        <div className="flex flex-wrap items-end gap-4">
          {showDiscount ? (
            <label className="block w-40">
              <span className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                Discount
              </span>
              <MoneyInput
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
            </label>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2.5 pb-2.5">
            <input
              type="checkbox"
              checked={gst}
              onChange={(event) => setGst(event.target.checked)}
              className="h-5 w-5 rounded border-[var(--line-strong)] accent-[var(--accent)]"
            />
            <span className="text-sm font-medium text-[var(--text-strong)]">Add GST</span>
          </label>
        </div>

        <div className="mt-4 space-y-2 border-t border-[var(--line-default)] pt-4">
          <TotalRow label="Subtotal" value={formatMoney(totals.subtotalCents)} />
          {totals.discountCents > 0 ? (
            <TotalRow label="Discount" value={`−${formatMoney(totals.discountCents)}`} />
          ) : null}
          {gst ? <TotalRow label="GST" value={formatMoney(totals.taxCents)} /> : null}
          <TotalRow label="Total" value={formatMoney(totals.totalCents)} strong />
        </div>

        {!gst ? (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            No GST will be shown on this document.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// --- shared pieces ----------------------------------------------------------

function LineRow({
  index,
  line,
  onChange,
  onRemove,
  showKind = false,
  showDetail = false,
  amountLabel,
}: {
  index: number;
  line: EditorLine;
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove?: () => void;
  showKind?: boolean;
  showDetail?: boolean;
  amountLabel: string;
}) {
  const lineTotal =
    (quantityToMilli(line.quantity) * moneyToCents(line.amount)) / 1000;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-3.5">
      {line.id ? <input type="hidden" name={`items.${index}.id`} value={line.id} /> : null}
      {showKind ? <input type="hidden" name={`items.${index}.kind`} value={line.kind} /> : null}

      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            {showKind ? (
              <Select
                aria-label="Cost type"
                value={line.kind}
                onChange={(event) => onChange({ kind: event.target.value as CostKind })}
                className="h-10 w-auto min-w-32 py-0 text-sm"
              >
                {COST_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Input
              name={`items.${index}.description`}
              value={line.description}
              onChange={(event) => onChange({ description: event.target.value })}
              placeholder="What the line is for"
              aria-label={`Line ${index + 1} description`}
              required
              className="h-10 py-0"
            />
          </div>

          {showDetail ? (
            <Input
              name={`items.${index}.detail`}
              value={line.detail}
              onChange={(event) => onChange({ detail: event.target.value })}
              placeholder="Extra detail shown under the line on the PDF (optional)"
              aria-label={`Line ${index + 1} detail`}
              className="h-10 py-0 text-sm"
            />
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">Qty</span>
              <Input
                name={`items.${index}.quantity`}
                value={line.quantity}
                onChange={(event) => onChange({ quantity: event.target.value })}
                inputMode="decimal"
                className="h-10 py-0 text-right tabular"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">Unit</span>
              <Select
                name={`items.${index}.unit`}
                value={line.unit}
                onChange={(event) => onChange({ unit: event.target.value })}
                className="h-10 py-0 text-sm"
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-[var(--text-muted)]">{amountLabel}</span>
              <MoneyInput
                name={`items.${index}.amount`}
                value={line.amount}
                onChange={(event) => onChange({ amount: event.target.value })}
                className="h-10 py-0"
              />
            </label>

            <div>
              <span className="mb-1 block text-xs text-[var(--text-muted)]">Line total</span>
              <div className="flex h-10 items-center justify-end rounded-[0.625rem] bg-[var(--surface-sunken)] px-3 text-sm font-medium tabular text-[var(--text-strong)]">
                {formatMoney(Math.round(lineTotal))}
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 pt-1">
            <input
              type="checkbox"
              name={`items.${index}.taxable`}
              checked={line.taxable}
              onChange={(event) => onChange({ taxable: event.target.checked })}
              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-muted)]">GST applies to this line</span>
          </label>
        </div>

        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove line ${index + 1}`}
            className="h-9 shrink-0 rounded-[0.5rem] px-2 text-[var(--text-muted)] hover:bg-[var(--bad-soft)] hover:text-[var(--bad)]"
          >
            <Icon path={icons.trash} size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  if (muted && value === '$0.00') return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={cn(
          'text-sm',
          strong ? 'font-semibold text-[var(--text-strong)]' : 'text-[var(--text-muted)]'
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'tabular',
          strong
            ? 'text-lg font-semibold text-[var(--text-strong)]'
            : 'text-sm text-[var(--text-default)]'
        )}
      >
        {value}
      </span>
    </div>
  );
}
