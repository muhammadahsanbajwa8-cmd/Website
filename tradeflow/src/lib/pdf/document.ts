import 'server-only';

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

/**
 * A small typesetting layer over pdf-lib.
 *
 * Quotes, invoices and reports are laid out with the same builder, so they
 * share margins, type scale and table rules and look like documents from one
 * business rather than three different tools. Everything is measured in
 * points from the top-left, which is the opposite of pdf-lib's own origin —
 * `y()` does the flip once so no caller has to think about it.
 */

export const A4 = { width: 595.28, height: 841.89 };

export const MARGIN = { top: 48, right: 48, bottom: 56, left: 48 };

export const INK = {
  strong: rgb(0.09, 0.12, 0.18),
  body: rgb(0.28, 0.32, 0.4),
  muted: rgb(0.51, 0.55, 0.63),
  line: rgb(0.85, 0.87, 0.9),
  lineStrong: rgb(0.66, 0.7, 0.75),
  accent: rgb(0.85, 0.45, 0.1),
  white: rgb(1, 1, 1),
  sunken: rgb(0.97, 0.975, 0.98),
  danger: rgb(0.79, 0.24, 0.19),
  ok: rgb(0.13, 0.53, 0.35),
};

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * The standard PDF fonts encode WinAnsi, which is Latin-1 plus 27 extras.
 * Everything else — a minus sign, an arrow, a CJK character, an emoji in a
 * customer's note — throws when pdf-lib measures it.
 *
 * Rather than let a stray character stop an invoice being produced, text is
 * folded to what the font can carry: near-equivalents are substituted, and
 * anything with no equivalent becomes a question mark. Every string that
 * reaches a drawing call goes through here.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const SUBSTITUTIONS: Record<string, string> = {
  '−': '-', // minus sign
  '‐': '-', '‑': '-', '‒': '-', '―': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
  '→': '->', '←': '<-', '⇒': '=>',
  '≤': '<=', '≥': '>=', '≠': '!=',
  '×': 'x', '⁄': '/',
  '✓': 'Y', '✔': 'Y', '✗': 'N', '✘': 'N',
  '³': '3', '⅓': '1/3', '¼': '1/4', '½': '1/2', '¾': '3/4',
  '\r': '',
  '\t': '    ',
};

export function toWinAnsi(value: string): string {
  let out = '';
  for (const char of String(value ?? '')) {
    const replacement = SUBSTITUTIONS[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += char;
      continue;
    }
    out += WINANSI_EXTRAS.has(code) ? char : '?';
  }
  return out;
}

export class DocBuilder {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  page: PDFPage;
  /** Distance from the top of the page, in points. */
  cursor = MARGIN.top;
  private pageNumber = 1;
  private readonly onNewPage?: (builder: DocBuilder) => void;

  private constructor(doc: PDFDocument, fonts: Fonts, onNewPage?: (b: DocBuilder) => void) {
    this.doc = doc;
    this.fonts = fonts;
    this.onNewPage = onNewPage;
    this.page = doc.addPage([A4.width, A4.height]);
  }

  static async create(options: { onNewPage?: (b: DocBuilder) => void } = {}) {
    const doc = await PDFDocument.create();
    doc.setProducer('TradeFlow');
    doc.setCreator('TradeFlow');
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    return new DocBuilder(doc, fonts, options.onNewPage);
  }

  get contentWidth() {
    return A4.width - MARGIN.left - MARGIN.right;
  }

  get right() {
    return A4.width - MARGIN.right;
  }

  /** Convert a from-the-top measurement into pdf-lib's from-the-bottom y. */
  y(fromTop: number) {
    return A4.height - fromTop;
  }

  /** Start a new page, running the header callback if one was given. */
  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pageNumber += 1;
    this.cursor = MARGIN.top;
    this.onNewPage?.(this);
    return this.page;
  }

  /** Move to a new page if `needed` points will not fit above the footer. */
  ensure(needed: number) {
    if (this.cursor + needed > A4.height - MARGIN.bottom) this.newPage();
  }

  space(points: number) {
    this.cursor += points;
  }

  text(
    value: string,
    options: {
      x?: number;
      size?: number;
      font?: PDFFont;
      color?: RGB;
      align?: 'left' | 'right' | 'center';
      width?: number;
      y?: number;
    } = {}
  ) {
    const size = options.size ?? 10;
    const font = options.font ?? this.fonts.regular;
    const color = options.color ?? INK.body;
    const width = options.width ?? this.contentWidth;
    const baseX = options.x ?? MARGIN.left;
    // A newline inside a single drawText call renders as a glyph, so the one
    // place that puts text on the page also flattens them.
    const safe = toWinAnsi(value).replace(/\n/g, ' ');
    const textWidth = font.widthOfTextAtSize(safe, size);

    let x = baseX;
    if (options.align === 'right') x = baseX + width - textWidth;
    else if (options.align === 'center') x = baseX + (width - textWidth) / 2;

    const top = options.y ?? this.cursor;
    this.page.drawText(safe, { x, y: this.y(top + size), size, font, color });
    return textWidth;
  }

  /** Text with a line break, advancing the cursor. */
  line(
    value: string,
    options: Parameters<DocBuilder['text']>[1] & { leading?: number } = {}
  ) {
    const size = options.size ?? 10;
    this.ensure(size + 6);
    this.text(value, options);
    this.cursor += options.leading ?? size + 4;
  }

  /**
   * Word-wrapped paragraph. Long words that exceed the column are broken
   * rather than allowed to run off the page — a 60-character part number in a
   * scope of work would otherwise disappear into the margin.
   */
  paragraph(
    value: string,
    options: {
      x?: number;
      width?: number;
      size?: number;
      font?: PDFFont;
      color?: RGB;
      leading?: number;
      maxLines?: number;
    } = {}
  ) {
    const size = options.size ?? 10;
    const font = options.font ?? this.fonts.regular;
    const width = options.width ?? this.contentWidth;
    const leading = options.leading ?? size * 1.45;
    const lines = wrapText(value, font, size, width);
    const limited = options.maxLines ? lines.slice(0, options.maxLines) : lines;

    for (const text of limited) {
      this.ensure(leading);
      this.text(text, { x: options.x, size, font, color: options.color, width });
      this.cursor += leading;
    }
    return limited.length;
  }

  rule(options: { color?: RGB; thickness?: number; inset?: number } = {}) {
    const inset = options.inset ?? 0;
    this.page.drawLine({
      start: { x: MARGIN.left + inset, y: this.y(this.cursor) },
      end: { x: this.right - inset, y: this.y(this.cursor) },
      thickness: options.thickness ?? 0.75,
      color: options.color ?? INK.line,
    });
    this.cursor += options.thickness ?? 0.75;
  }

  rect(options: {
    x?: number;
    width?: number;
    height: number;
    color: RGB;
    y?: number;
    borderColor?: RGB;
    borderWidth?: number;
  }) {
    const top = options.y ?? this.cursor;
    this.page.drawRectangle({
      x: options.x ?? MARGIN.left,
      y: this.y(top + options.height),
      width: options.width ?? this.contentWidth,
      height: options.height,
      color: options.color,
      borderColor: options.borderColor,
      borderWidth: options.borderWidth,
    });
  }

  async image(bytes: Uint8Array, mime: string, box: { x: number; y: number; width: number; height: number }) {
    try {
      const embedded = mime.includes('png')
        ? await this.doc.embedPng(bytes)
        : await this.doc.embedJpg(bytes);
      // Fit inside the box without distorting the aspect ratio.
      const scale = Math.min(box.width / embedded.width, box.height / embedded.height);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      this.page.drawImage(embedded, {
        x: box.x + (box.width - width) / 2,
        y: this.y(box.y + box.height) + (box.height - height) / 2,
        width,
        height,
      });
      return true;
    } catch {
      // A logo in an unsupported format should not stop an invoice going out.
      return false;
    }
  }

  /** Page numbers, drawn on every page once the content is finished. */
  stampFooters(text: string) {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      const label = `${text}    Page ${index + 1} of ${pages.length}`;
      const size = 8;
      const width = this.fonts.regular.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: (A4.width - width) / 2,
        y: MARGIN.bottom / 2,
        size,
        font: this.fonts.regular,
        color: INK.muted,
      });
    });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }

  get pages() {
    return this.pageNumber;
  }
}

/** Greedy wrap, splitting any single word that cannot fit on its own line. */
export function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const out: string[] = [];
  const paragraphs = toWinAnsi(value).split('\n');

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) out.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      // A single unbreakable run: chop it to fit.
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
          out.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    if (current) out.push(current);
  }
  return out;
}

/** Truncate with an ellipsis so a long description cannot overflow a column. */
export function fitText(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = toWinAnsi(value).replace(/\n/g, ' ');
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let text = safe;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, size) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text.trimEnd()}…`;
}
