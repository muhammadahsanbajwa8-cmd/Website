import 'server-only';

import { DocBuilder, INK, MARGIN, fitText, toWinAnsi } from './document';
import { formatAbn, formatBsb, formatDate, formatMoney } from '@/lib/format';
import { lineTotalCents, milliToInput } from '@/lib/money';
import type { Business, Customer } from '@/lib/database.types';

/**
 * The quote and tax invoice PDF.
 *
 * One layout for both: an Australian tax invoice and a quote differ in their
 * heading, their date fields and their footer, not in their bones, and having
 * one implementation means the totals block can never disagree between the two
 * documents a customer receives for the same job.
 */

export interface PricedLine {
  description: string;
  detail?: string | null;
  quantity_milli: number;
  unit: string;
  unit_price_cents: number;
  taxable: boolean;
}

export interface PricedDocumentInput {
  kind: 'quote' | 'invoice';
  business: Pick<
    Business,
    | 'name' | 'abn' | 'email' | 'phone' | 'address_line1' | 'address_line2'
    | 'suburb' | 'state' | 'postcode' | 'gst_registered'
    | 'bank_account_name' | 'bank_bsb' | 'bank_account_number'
  >;
  customer: Pick<
    Customer,
    'name' | 'company' | 'email' | 'phone' | 'address_line1' | 'suburb' | 'state' | 'postcode'
  > | null;
  number: string;
  title?: string | null;
  issueDate: string;
  /** Expiry for a quote, due date for an invoice. */
  secondaryDate?: string | null;
  jobReference?: string | null;
  siteAddress?: string | null;
  scope?: string | null;
  terms?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  items: PricedLine[];
  discountCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents?: number;
  gstApplies: boolean;
  status?: string | null;
  logo?: { bytes: Uint8Array; mime: string } | null;
}

const COLUMNS = {
  description: { x: MARGIN.left, width: 250 },
  qty: { x: MARGIN.left + 258, width: 55 },
  unit: { x: MARGIN.left + 318, width: 45 },
  rate: { x: MARGIN.left + 366, width: 65 },
  total: { x: MARGIN.left + 436, width: 63 },
};

export async function renderPricedDocument(input: PricedDocumentInput): Promise<Uint8Array> {
  const isInvoice = input.kind === 'invoice';
  const heading = isInvoice
    ? input.business.gst_registered && input.gstApplies
      ? 'TAX INVOICE'
      : 'INVOICE'
    : 'QUOTE';

  const builder = await DocBuilder.create({
    onNewPage: (b) => {
      // Continuation pages repeat the document reference and the column heads.
      b.text(`${heading} ${input.number} (continued)`, {
        size: 9,
        font: b.fonts.bold,
        color: INK.muted,
      });
      b.cursor += 20;
      drawTableHead(b);
    },
  });

  // --- masthead -------------------------------------------------------------
  let headerBottom = builder.cursor;

  if (input.logo) {
    const placed = await builder.image(input.logo.bytes, input.logo.mime, {
      x: MARGIN.left,
      y: builder.cursor,
      width: 150,
      height: 52,
    });
    if (placed) headerBottom = builder.cursor + 60;
  }

  if (headerBottom === builder.cursor) {
    builder.text(input.business.name, { size: 17, font: builder.fonts.bold, color: INK.strong });
    headerBottom = builder.cursor + 24;
  }

  // Business block, left.
  let leftY = headerBottom;
  const businessLines = [
    input.logo ? input.business.name : null,
    input.business.abn ? `ABN ${formatAbn(input.business.abn)}` : null,
    input.business.address_line1,
    input.business.address_line2,
    [input.business.suburb, input.business.state, input.business.postcode]
      .filter(Boolean)
      .join(' ') || null,
    input.business.phone,
    input.business.email,
  ].filter((v): v is string => Boolean(v));

  for (const text of businessLines) {
    builder.text(text, { y: leftY, size: 9, color: INK.muted, width: 240 });
    leftY += 13;
  }

  // Document block, right.
  const rightX = MARGIN.left + 300;
  const rightWidth = builder.contentWidth - 300;
  builder.text(heading, {
    y: headerBottom - 24,
    x: rightX,
    width: rightWidth,
    align: 'right',
    size: 22,
    font: builder.fonts.bold,
    color: INK.strong,
  });

  let rightY = headerBottom + 4;
  const metaRows: [string, string][] = [
    [isInvoice ? 'Invoice number' : 'Quote number', input.number],
    [isInvoice ? 'Issue date' : 'Date', formatDate(input.issueDate)],
  ];
  if (input.secondaryDate) {
    metaRows.push([isInvoice ? 'Due date' : 'Valid until', formatDate(input.secondaryDate)]);
  }
  if (input.jobReference) metaRows.push(['Job', input.jobReference]);

  for (const [label, value] of metaRows) {
    builder.text(label, {
      y: rightY,
      x: rightX,
      width: rightWidth - 100,
      align: 'right',
      size: 9,
      color: INK.muted,
    });
    builder.text(value, {
      y: rightY,
      x: rightX + rightWidth - 100,
      width: 100,
      align: 'right',
      size: 9,
      font: builder.fonts.bold,
      color: INK.strong,
    });
    rightY += 14;
  }

  builder.cursor = Math.max(leftY, rightY) + 18;

  // --- bill to --------------------------------------------------------------
  builder.rect({ height: 1, color: INK.line });
  builder.cursor += 14;

  builder.text(isInvoice ? 'BILL TO' : 'PREPARED FOR', {
    size: 8,
    font: builder.fonts.bold,
    color: INK.muted,
  });
  builder.cursor += 14;

  const customerLines = [
    input.customer?.company || input.customer?.name || 'Customer',
    input.customer?.company && input.customer?.name ? `Attn: ${input.customer.name}` : null,
    input.customer?.address_line1,
    [input.customer?.suburb, input.customer?.state, input.customer?.postcode]
      .filter(Boolean)
      .join(' ') || null,
    input.customer?.email,
  ].filter((v): v is string => Boolean(v));

  for (const [index, text] of customerLines.entries()) {
    builder.line(text, {
      size: index === 0 ? 11 : 9,
      font: index === 0 ? builder.fonts.bold : builder.fonts.regular,
      color: index === 0 ? INK.strong : INK.muted,
      leading: index === 0 ? 15 : 12,
    });
  }

  if (input.siteAddress) {
    builder.cursor += 4;
    builder.line(`Site: ${input.siteAddress}`, { size: 9, color: INK.muted });
  }

  builder.cursor += 12;

  if (input.title) {
    builder.line(input.title, { size: 13, font: builder.fonts.bold, color: INK.strong, leading: 18 });
  }

  // --- scope ----------------------------------------------------------------
  if (input.scope?.trim()) {
    builder.cursor += 4;
    builder.line('SCOPE OF WORK', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 13 });
    builder.paragraph(input.scope.trim(), { size: 9.5, color: INK.body });
    builder.cursor += 10;
  }

  // --- line items -----------------------------------------------------------
  builder.ensure(70);
  drawTableHead(builder);

  for (const item of input.items) {
    const total = lineTotalCents(item.quantity_milli, item.unit_price_cents);
    const descriptionLines = wrapForColumn(builder, item.description, 9.5, COLUMNS.description.width);
    const detailLines = item.detail?.trim()
      ? wrapForColumn(builder, item.detail.trim(), 8.5, COLUMNS.description.width)
      : [];
    const rowHeight = descriptionLines.length * 13 + detailLines.length * 11 + 10;

    builder.ensure(rowHeight + 4);
    const rowTop = builder.cursor;

    let textY = rowTop + 4;
    for (const text of descriptionLines) {
      builder.text(text, {
        y: textY,
        x: COLUMNS.description.x,
        width: COLUMNS.description.width,
        size: 9.5,
        color: INK.strong,
      });
      textY += 13;
    }
    for (const text of detailLines) {
      builder.text(text, {
        y: textY,
        x: COLUMNS.description.x,
        width: COLUMNS.description.width,
        size: 8.5,
        color: INK.muted,
      });
      textY += 11;
    }

    const numberY = rowTop + 4;
    builder.text(milliToInput(item.quantity_milli), {
      y: numberY, x: COLUMNS.qty.x, width: COLUMNS.qty.width, align: 'right', size: 9.5,
    });
    builder.text(fitText(item.unit, builder.fonts.regular, 9.5, COLUMNS.unit.width), {
      y: numberY, x: COLUMNS.unit.x, width: COLUMNS.unit.width, align: 'right', size: 9.5,
    });
    builder.text(formatMoney(item.unit_price_cents), {
      y: numberY, x: COLUMNS.rate.x, width: COLUMNS.rate.width, align: 'right', size: 9.5,
    });
    builder.text(formatMoney(total), {
      y: numberY, x: COLUMNS.total.x, width: COLUMNS.total.width, align: 'right',
      size: 9.5, font: builder.fonts.bold, color: INK.strong,
    });

    // A GST-free line is marked, because on a mixed document the customer will
    // otherwise try to work out why the GST is not a tenth of the total.
    if (input.gstApplies && !item.taxable) {
      builder.text('GST-free', {
        y: textY, x: COLUMNS.description.x, width: COLUMNS.description.width,
        size: 7.5, color: INK.muted,
      });
      textY += 10;
    }

    builder.cursor = Math.max(rowTop + rowHeight, textY + 4);
    builder.rule();
  }

  // --- totals ---------------------------------------------------------------
  builder.ensure(120);
  builder.cursor += 10;

  const totalsX = MARGIN.left + 300;
  const totalsWidth = builder.contentWidth - 300;
  const labelWidth = totalsWidth - 90;

  const totalRow = (label: string, value: string, options: { strong?: boolean; color?: typeof INK.strong } = {}) => {
    builder.text(label, {
      x: totalsX, width: labelWidth, align: 'right', size: options.strong ? 11 : 9.5,
      font: options.strong ? builder.fonts.bold : builder.fonts.regular,
      color: options.color ?? (options.strong ? INK.strong : INK.muted),
    });
    builder.text(value, {
      x: totalsX + labelWidth, width: 90, align: 'right', size: options.strong ? 11 : 9.5,
      font: options.strong ? builder.fonts.bold : builder.fonts.regular,
      color: options.color ?? (options.strong ? INK.strong : INK.body),
    });
    builder.cursor += options.strong ? 20 : 16;
  };

  totalRow('Subtotal', formatMoney(input.subtotalCents));
  if (input.discountCents > 0) {
    totalRow('Discount', `−${formatMoney(input.discountCents)}`);
  }
  if (input.gstApplies) {
    totalRow('GST', formatMoney(input.taxCents));
  }

  builder.rect({
    x: totalsX, width: totalsWidth, height: 1, color: INK.lineStrong,
  });
  builder.cursor += 8;
  totalRow(isInvoice ? 'Total due' : 'Total', formatMoney(input.totalCents), { strong: true });

  if (isInvoice && (input.paidCents ?? 0) > 0) {
    totalRow('Paid', `−${formatMoney(input.paidCents ?? 0)}`, { color: INK.ok });
    builder.rect({ x: totalsX, width: totalsWidth, height: 1, color: INK.lineStrong });
    builder.cursor += 8;
    const outstanding = Math.max(input.totalCents - (input.paidCents ?? 0), 0);
    totalRow('Balance', formatMoney(outstanding), {
      strong: true,
      color: outstanding > 0 ? INK.danger : INK.ok,
    });
  }

  if (!input.gstApplies) {
    builder.cursor += 2;
    builder.text('No GST has been charged on this document.', {
      x: totalsX, width: totalsWidth, align: 'right', size: 8, color: INK.muted,
    });
    builder.cursor += 14;
  }

  builder.cursor += 14;

  // --- payment, terms, notes ------------------------------------------------
  if (isInvoice && (input.business.bank_bsb || input.business.bank_account_number)) {
    builder.ensure(76);
    const boxTop = builder.cursor;
    builder.rect({ height: 62, color: INK.sunken, borderColor: INK.line, borderWidth: 0.75 });
    builder.cursor = boxTop + 12;
    builder.text('PAYMENT DETAILS', {
      x: MARGIN.left + 12, size: 8, font: builder.fonts.bold, color: INK.muted,
    });
    builder.cursor += 14;
    const payLines = [
      input.business.bank_account_name ? `Account name: ${input.business.bank_account_name}` : null,
      input.business.bank_bsb ? `BSB: ${formatBsb(input.business.bank_bsb)}` : null,
      input.business.bank_account_number
        ? `Account number: ${input.business.bank_account_number}`
        : null,
      `Reference: ${input.number}`,
    ].filter((v): v is string => Boolean(v));
    for (const text of payLines.slice(0, 3)) {
      builder.text(text, { x: MARGIN.left + 12, size: 9, color: INK.body });
      builder.cursor += 12;
    }
    builder.text(`Reference: ${input.number}`, {
      x: MARGIN.left + 300, y: boxTop + 26, size: 9, font: builder.fonts.bold, color: INK.strong,
    });
    builder.cursor = boxTop + 74;
  }

  if (input.paymentTerms?.trim()) {
    builder.ensure(40);
    builder.line('PAYMENT TERMS', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 13 });
    builder.paragraph(input.paymentTerms.trim(), { size: 9, color: INK.body });
    builder.cursor += 8;
  }

  if (input.terms?.trim()) {
    builder.ensure(40);
    builder.line('TERMS AND CONDITIONS', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 13 });
    builder.paragraph(input.terms.trim(), { size: 8.5, color: INK.muted });
    builder.cursor += 8;
  }

  if (input.notes?.trim()) {
    builder.ensure(40);
    builder.line('NOTES', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 13 });
    builder.paragraph(input.notes.trim(), { size: 9, color: INK.body });
  }

  if (!isInvoice) {
    builder.ensure(40);
    builder.cursor += 10;
    builder.paragraph(
      'To accept this quote, use the link in the email it was sent with, or reply to ' +
        'confirm in writing. Prices are in Australian dollars.',
      { size: 8.5, color: INK.muted }
    );
  }

  builder.stampFooters(`${input.business.name}  ·  ${heading} ${input.number}`);
  return builder.save();
}

function drawTableHead(builder: DocBuilder) {
  const top = builder.cursor;
  builder.rect({ height: 24, color: INK.sunken });
  const y = top + 8;
  builder.text('DESCRIPTION', {
    y, x: COLUMNS.description.x + 4, width: COLUMNS.description.width,
    size: 7.5, font: builder.fonts.bold, color: INK.muted,
  });
  builder.text('QTY', {
    y, x: COLUMNS.qty.x, width: COLUMNS.qty.width, align: 'right',
    size: 7.5, font: builder.fonts.bold, color: INK.muted,
  });
  builder.text('UNIT', {
    y, x: COLUMNS.unit.x, width: COLUMNS.unit.width, align: 'right',
    size: 7.5, font: builder.fonts.bold, color: INK.muted,
  });
  builder.text('RATE', {
    y, x: COLUMNS.rate.x, width: COLUMNS.rate.width, align: 'right',
    size: 7.5, font: builder.fonts.bold, color: INK.muted,
  });
  builder.text('AMOUNT', {
    y, x: COLUMNS.total.x, width: COLUMNS.total.width, align: 'right',
    size: 7.5, font: builder.fonts.bold, color: INK.muted,
  });
  builder.cursor = top + 26;
}

function wrapForColumn(builder: DocBuilder, text: string, size: number, width: number): string[] {
  const font = builder.fonts.regular;
  const words = toWinAnsi(text).replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width - 8) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
