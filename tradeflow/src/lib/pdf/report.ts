import 'server-only';

import { DocBuilder, INK, MARGIN } from './document';
import { formatAbn, formatDate, formatDateTime } from '@/lib/format';
import type { ReportField, ReportSection } from '@/lib/reports';

/**
 * The site report PDF: the answers as filled in, then the photos, then the
 * signature. Fields the person left blank are omitted rather than printed
 * empty — a defect report with nine "—" rows reads as a form, not a record.
 */

export interface ReportPdfPhoto {
  bytes: Uint8Array;
  mime: string;
  caption?: string | null;
  category?: string | null;
  takenAt?: string | null;
}

export interface ReportPdfInput {
  business: {
    name: string;
    abn: string | null;
    phone: string | null;
    email: string | null;
  };
  logo?: { bytes: Uint8Array; mime: string } | null;
  templateName: string;
  sections: ReportSection[];
  number: string;
  title: string;
  reportDate: string;
  status: string;
  jobLabel?: string | null;
  customerLabel?: string | null;
  siteAddress?: string | null;
  summary?: string | null;
  data: Record<string, unknown>;
  photos: ReportPdfPhoto[];
  signatureName?: string | null;
  signedAt?: string | null;
  preparedBy?: string | null;
}

export async function renderReport(input: ReportPdfInput): Promise<Uint8Array> {
  const builder = await DocBuilder.create({
    onNewPage: (b) => {
      b.text(`${input.title} · ${input.number}`, {
        size: 9,
        font: b.fonts.bold,
        color: INK.muted,
      });
      b.cursor += 22;
    },
  });

  // --- masthead -------------------------------------------------------------
  let top = builder.cursor;
  if (input.logo) {
    const placed = await builder.image(input.logo.bytes, input.logo.mime, {
      x: MARGIN.left, y: top, width: 130, height: 44,
    });
    if (placed) top += 52;
  }
  if (top === builder.cursor) {
    builder.text(input.business.name, { size: 15, font: builder.fonts.bold, color: INK.strong });
    top += 22;
  }

  builder.text(input.templateName.toUpperCase(), {
    y: builder.cursor,
    x: MARGIN.left + 250,
    width: builder.contentWidth - 250,
    align: 'right',
    size: 16,
    font: builder.fonts.bold,
    color: INK.strong,
  });
  builder.text(input.number, {
    y: builder.cursor + 20,
    x: MARGIN.left + 250,
    width: builder.contentWidth - 250,
    align: 'right',
    size: 10,
    color: INK.muted,
  });

  builder.cursor = top + 8;
  builder.rect({ height: 1, color: INK.line });
  builder.cursor += 14;

  builder.line(input.title, { size: 15, font: builder.fonts.bold, color: INK.strong, leading: 22 });

  // --- header facts ---------------------------------------------------------
  const facts: [string, string][] = [
    ['Date', formatDate(input.reportDate)],
    ['Status', input.status.replace(/^./, (c) => c.toUpperCase())],
  ];
  if (input.jobLabel) facts.push(['Job', input.jobLabel]);
  if (input.customerLabel) facts.push(['Customer', input.customerLabel]);
  if (input.siteAddress) facts.push(['Site', input.siteAddress]);
  if (input.preparedBy) facts.push(['Prepared by', input.preparedBy]);

  const boxTop = builder.cursor;
  const rows = Math.ceil(facts.length / 2);
  const boxHeight = rows * 26 + 14;
  builder.rect({ height: boxHeight, color: INK.sunken, borderColor: INK.line, borderWidth: 0.75 });

  facts.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN.left + 14 + column * (builder.contentWidth / 2);
    const y = boxTop + 12 + row * 26;
    builder.text(label.toUpperCase(), { y, x, width: 200, size: 7, color: INK.muted, font: builder.fonts.bold });
    builder.text(value, {
      y: y + 10,
      x,
      width: builder.contentWidth / 2 - 28,
      size: 9.5,
      color: INK.strong,
    });
  });

  builder.cursor = boxTop + boxHeight + 18;

  if (input.summary?.trim()) {
    builder.line('SUMMARY', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 14 });
    builder.paragraph(input.summary.trim(), { size: 10, color: INK.body });
    builder.cursor += 14;
  }

  // --- sections -------------------------------------------------------------
  for (const section of input.sections) {
    const answered = section.fields.filter(
      (field) => field.type !== 'photos' && field.type !== 'signature' && hasValue(input.data[field.id])
    );
    if (answered.length === 0) continue;

    builder.ensure(60);
    builder.line(section.title.toUpperCase(), {
      size: 9,
      font: builder.fonts.bold,
      color: INK.accent,
      leading: 6,
    });
    builder.rule({ color: INK.line });
    builder.cursor += 10;

    for (const field of answered) {
      builder.ensure(34);
      builder.line(field.label, { size: 8.5, font: builder.fonts.bold, color: INK.muted, leading: 12 });
      const rendered = renderValue(field, input.data[field.id]);
      builder.paragraph(rendered, { size: 10, color: INK.body });
      builder.cursor += 8;
    }
    builder.cursor += 6;
  }

  // --- photos ---------------------------------------------------------------
  if (input.photos.length > 0) {
    builder.ensure(200);
    builder.cursor += 6;
    builder.line('PHOTOS', { size: 9, font: builder.fonts.bold, color: INK.accent, leading: 6 });
    builder.rule({ color: INK.line });
    builder.cursor += 12;

    // Two per row, each with its caption underneath.
    const cellWidth = (builder.contentWidth - 16) / 2;
    const imageHeight = 150;
    const cellHeight = imageHeight + 30;

    for (let index = 0; index < input.photos.length; index += 2) {
      builder.ensure(cellHeight + 8);
      const rowTop = builder.cursor;

      for (const offset of [0, 1]) {
        const photo = input.photos[index + offset];
        if (!photo) continue;
        const x = MARGIN.left + offset * (cellWidth + 16);

        builder.rect({
          x, y: rowTop, width: cellWidth, height: imageHeight,
          color: INK.sunken, borderColor: INK.line, borderWidth: 0.75,
        });
        await builder.image(photo.bytes, photo.mime, {
          x: x + 3, y: rowTop + 3, width: cellWidth - 6, height: imageHeight - 6,
        });

        const caption = photo.caption?.trim() || '';
        const meta = [
          photo.category && photo.category !== 'general'
            ? photo.category.replace(/^./, (c) => c.toUpperCase())
            : null,
          photo.takenAt ? formatDateTime(photo.takenAt) : null,
        ]
          .filter(Boolean)
          .join(' · ');

        if (caption) {
          builder.text(caption, {
            y: rowTop + imageHeight + 6, x, width: cellWidth, size: 8.5, color: INK.strong,
          });
        }
        if (meta) {
          builder.text(meta, {
            y: rowTop + imageHeight + (caption ? 17 : 6), x, width: cellWidth,
            size: 7.5, color: INK.muted,
          });
        }
      }

      builder.cursor = rowTop + cellHeight + 10;
    }
  }

  // --- signature ------------------------------------------------------------
  if (input.signatureName?.trim()) {
    builder.ensure(90);
    builder.cursor += 12;
    builder.line('SIGNED', { size: 8, font: builder.fonts.bold, color: INK.muted, leading: 16 });

    const lineTop = builder.cursor + 22;
    builder.page.drawLine({
      start: { x: MARGIN.left, y: builder.y(lineTop) },
      end: { x: MARGIN.left + 220, y: builder.y(lineTop) },
      thickness: 0.75,
      color: INK.lineStrong,
    });
    builder.text(input.signatureName.trim(), {
      y: lineTop + 6, size: 10, font: builder.fonts.bold, color: INK.strong,
    });
    if (input.signedAt) {
      builder.text(formatDateTime(input.signedAt), {
        y: lineTop + 20, size: 8.5, color: INK.muted,
      });
    }
    builder.cursor = lineTop + 40;
  }

  const footer = [
    input.business.name,
    input.business.abn ? `ABN ${formatAbn(input.business.abn)}` : null,
    input.business.phone,
  ]
    .filter(Boolean)
    .join('  ·  ');
  builder.stampFooters(footer);

  return builder.save();
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  return true;
}

function renderValue(field: ReportField, value: unknown): string {
  if (field.type === 'checkbox') {
    return value === true || value === 'true' || value === 'on' ? 'Yes' : 'No';
  }
  if (field.type === 'date' && typeof value === 'string') return formatDate(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry && typeof entry === 'object'
          ? Object.values(entry as Record<string, unknown>).filter(Boolean).join(' — ')
          : String(entry)
      )
      .join('\n');
  }
  if (field.type === 'number' && typeof value === 'number') return String(value);
  return String(value ?? '');
}
