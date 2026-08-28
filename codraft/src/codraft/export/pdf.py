"""The drawing set as a PDF, which is the file a customer is actually given.

DXF opens in CAD, IFC opens in a BIM tool, SVG opens in a browser. None of
them opens on a builder's phone in a car park, and none of them is what gets
emailed to a client. This writes the set as one PDF, a page per sheet, at the
same scale and with the same title block as the printed sheets -- because it
IS the same drawing: both writers render the display list that `build_sheet`
produces, so a line cannot come out in one format and not the other.

Written by hand, against the PDF spec, with no dependency beyond zlib. That
matches the reader already in `codraft.ingest.pdfread`, and it buys the test
that matters: codraft writes a set, reads it back with its own reader, and
checks the geometry that comes out is the geometry that went in.

Two things are approximations and are worth knowing about:

  * TEXT IS PLACED, NOT LAID OUT. The base-14 fonts need no embedding, which
    keeps the file small and the code honest, but centring a label needs the
    string's width. Courier is exactly 0.6 em a character so its centring is
    exact; Helvetica is proportional and is estimated. A label may sit a
    millimetre off centre. Nothing dimensional depends on it.

  * COLOUR IS RGB, NOT A PLOT STYLE. A drawing office plots by pen weight and
    colour table. This writes what the screen shows.
"""

from __future__ import annotations

import re
import zlib
from pathlib import Path

from ..model import Building
from ..sheet import MARGIN, TITLE_BLOCK_WIDTH, SheetError, TitleBlock, fit_scale

MM_TO_PT = 72.0 / 25.4

# Base-14 fonts, so nothing is embedded and the file stays small.
_FONTS = {"F1": "Helvetica", "F2": "Helvetica-Bold", "F3": "Courier",
          "F4": "Courier-Bold"}

# Courier is exactly 0.6 em a character, so text set in it centres exactly.
# Helvetica is proportional; this is the average that lands closest across
# the strings these drawings actually carry -- room names, dimensions, codes.
_COURIER_EM = 0.6
_HELVETICA_EM = 0.52


# ---------------------------------------------------------------------------
# The stylesheet is the SVG's own. Parsing it rather than restating it is
# what stops the two formats drifting: change a wall's line weight in one
# place and both follow.
# ---------------------------------------------------------------------------
def parse_style(css: str) -> dict[str, dict[str, str]]:
    """Read `.class { prop: value; ... }` into a lookup."""
    out: dict[str, dict[str, str]] = {}
    for match in re.finditer(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}", css):
        name, body = match.group(1), match.group(2)
        props: dict[str, str] = {}
        for declaration in body.split(";"):
            if ":" not in declaration:
                continue
            key, _, value = declaration.partition(":")
            props[key.strip()] = value.strip()
        out[name] = props
    return out


def _rgb(value: str) -> tuple[float, float, float] | None:
    value = value.strip()
    if not value.startswith("#"):
        return None
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    if len(digits) != 6:
        return None
    return tuple(int(digits[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _font_of(props: dict[str, str]) -> tuple[str, float]:
    """Font id and size in drawing units, from a CSS `font:` shorthand."""
    spec = props.get("font", "")
    size = 100.0
    match = re.search(r"([0-9.]+)px", spec)
    if match:
        size = float(match.group(1))
    bold = bool(re.search(r"\b([6-9]00|bold)\b", spec))
    mono = "mono" in spec.lower() or "courier" in spec.lower() or "plex" in spec.lower()
    if mono:
        return ("F4" if bold else "F3"), size
    return ("F2" if bold else "F1"), size


def _escape(text: str) -> str:
    """Escape for a PDF literal string, and drop what WinAnsi cannot carry.

    The fonts are base-14 with WinAnsiEncoding, which has the em dash and the
    superscript two these drawings use but not much beyond Latin-1. Anything
    outside it is replaced rather than written as a byte that would render as
    a different character -- a wrong glyph on a drawing is worse than a
    missing one, because it looks deliberate.
    """
    text = text.encode("cp1252", "replace").decode("cp1252")
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _text_width(value: str, font: str, size: float) -> float:
    em = _COURIER_EM if font in ("F3", "F4") else _HELVETICA_EM
    return len(value) * size * em


# ---------------------------------------------------------------------------
# Content streams
# ---------------------------------------------------------------------------
class _Stream:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self._stroke: tuple | None = None
        self._fill: tuple | None = None
        self._width: float | None = None
        self._dash: str | None = None

    def op(self, text: str) -> None:
        self.parts.append(text)

    def stroke_colour(self, rgb) -> None:
        if rgb != self._stroke:
            self._stroke = rgb
            self.op(f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} RG")

    def fill_colour(self, rgb) -> None:
        if rgb != self._fill:
            self._fill = rgb
            self.op(f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg")

    def line_width(self, width: float) -> None:
        if width != self._width:
            self._width = width
            self.op(f"{width:.3f} w")

    def dash(self, pattern: str) -> None:
        if pattern != self._dash:
            self._dash = pattern
            self.op(pattern)

    def render(self) -> bytes:
        return "\n".join(self.parts).encode("cp1252", "replace")


def _emit(stream: _Stream, ops: list[tuple], styles: dict, scale_hint: float) -> int:
    """Draw a display list. Returns how many ops could not be drawn."""
    skipped = 0
    for op in ops:
        kind, cls = op[0], op[1]
        props = styles.get(cls, {})
        stroke = _rgb(props.get("stroke", ""))
        fill = _rgb(props.get("fill", ""))
        width = props.get("stroke-width")
        dash = props.get("stroke-dasharray")

        if kind == "text":
            _, _, x, y, dy, rotate, value = op
            colour = fill or _rgb(props.get("stroke", "")) or (0, 0, 0)
            font, size = _font_of(props)
            anchor = props.get("text-anchor", "start")
            shift = 0.0
            if anchor == "middle":
                shift = -_text_width(value, font, size) / 2
            elif anchor == "end":
                shift = -_text_width(value, font, size)
            stream.fill_colour(colour)
            stream.op("BT")
            stream.op(f"/{font} {size:.2f} Tf")
            # The canvas puts text at (x, y) with a baseline offset of dy in a
            # y-DOWN frame; PDF is y-up, so the offset changes sign.
            if rotate:
                radians = -rotate * 3.14159265358979 / 180
                import math as _math
                cos, sin = _math.cos(radians), _math.sin(radians)
                ox = shift * cos - (-dy) * sin
                oy = shift * sin + (-dy) * cos
                stream.op(f"{cos:.5f} {sin:.5f} {-sin:.5f} {cos:.5f} "
                          f"{x + ox:.2f} {y + oy:.2f} Tm")
            else:
                stream.op(f"1 0 0 1 {x + shift:.2f} {y - dy:.2f} Tm")
            stream.op(f"({_escape(value)}) Tj")
            stream.op("ET")
            continue

        if stroke:
            stream.stroke_colour(stroke)
        if width:
            stream.line_width(float(width))
        stream.dash(f"[{dash.replace(',', ' ')}] 0 d" if dash else "[] 0 d")

        if kind == "rect":
            _, _, x, y, w, h = op
            stream.op(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re")
            if fill and stroke:
                stream.fill_colour(fill)
                stream.op("B")
            elif fill:
                stream.fill_colour(fill)
                stream.op("f")
            elif stroke:
                stream.op("S")
            else:
                stream.op("n")
        elif kind == "line":
            _, _, x0, y0, x1, y1 = op
            stream.op(f"{x0:.2f} {y0:.2f} m {x1:.2f} {y1:.2f} l S")
        elif kind == "polyline":
            _, _, points = op
            first, *rest = points
            stream.op(f"{first[0]:.2f} {first[1]:.2f} m")
            for x, y in rest:
                stream.op(f"{x:.2f} {y:.2f} l")
            stream.op("S")
        elif kind == "circle":
            _, _, cx, cy, r = op
            _circle(stream, cx, cy, r)
            if fill:
                stream.fill_colour(fill)
                stream.op("f")
            else:
                stream.op("S")
        elif kind == "arc":
            _, _, cx, cy, r, a0, a1 = op
            _arc(stream, cx, cy, r, a0, a1)
            stream.op("S")
        else:
            skipped += 1
    return skipped


# A circle is four Beziers; k is the classic control-point ratio.
_K = 0.5522847498307936


def _circle(stream: _Stream, cx: float, cy: float, r: float) -> None:
    k = r * _K
    stream.op(f"{cx + r:.2f} {cy:.2f} m")
    stream.op(f"{cx + r:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r:.2f} {cx:.2f} {cy + r:.2f} c")
    stream.op(f"{cx - k:.2f} {cy + r:.2f} {cx - r:.2f} {cy + k:.2f} {cx - r:.2f} {cy:.2f} c")
    stream.op(f"{cx - r:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r:.2f} {cx:.2f} {cy - r:.2f} c")
    stream.op(f"{cx + k:.2f} {cy - r:.2f} {cx + r:.2f} {cy - k:.2f} {cx + r:.2f} {cy:.2f} c")


def _arc(stream: _Stream, cx: float, cy: float, r: float, a0: float, a1: float) -> None:
    """A door swing, as Beziers of at most 90 degrees each."""
    import math

    sweep = (a1 - a0) % 360 or 360
    steps = max(1, int(sweep // 90) + (1 if sweep % 90 else 0))
    step = sweep / steps
    angle = a0
    stream.op(f"{cx + r * math.cos(math.radians(a0)):.2f} "
              f"{cy + r * math.sin(math.radians(a0)):.2f} m")
    for _ in range(steps):
        nxt = angle + step
        k = 4 / 3 * math.tan(math.radians(step) / 4) * r
        x0, y0 = cx + r * math.cos(math.radians(angle)), cy + r * math.sin(math.radians(angle))
        x1, y1 = cx + r * math.cos(math.radians(nxt)), cy + r * math.sin(math.radians(nxt))
        c1x = x0 - k * math.sin(math.radians(angle))
        c1y = y0 + k * math.cos(math.radians(angle))
        c2x = x1 + k * math.sin(math.radians(nxt))
        c2y = y1 - k * math.cos(math.radians(nxt))
        stream.op(f"{c1x:.2f} {c1y:.2f} {c2x:.2f} {c2y:.2f} {x1:.2f} {y1:.2f} c")
        angle = nxt


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------
def _title_block_ops(frame, block: TitleBlock, sheet_name: str,
                     sheet_no: int, sheet_of: int, scale_note: str,
                     sheet_notes: list[str] | None = None) -> list[tuple]:
    """The same title block the sheets carry, as a display list in paper mm.

    Built here rather than shared with the SVG because the two coordinate
    systems run opposite ways -- SVG measures down from the top of the page,
    PDF up from the bottom -- and converting one to the other in the middle of
    a layout is how a block ends up upside down. The CONTENT is the same
    because it comes from the same TitleBlock.
    """
    ops: list[tuple] = []
    x = frame.title_x
    w = TITLE_BLOCK_WIDTH
    top = frame.height - MARGIN          # paper mm, measured UP from the foot
    bottom = MARGIN

    def line(x0, y0, x1, y1, cls="tb-rule"):
        ops.append(("line", cls, x0, y0, x1, y1))

    def text(tx, ty, value, cls):
        ops.append(("text", cls, tx, ty, 0.0, 0.0, value))

    ops.append(("rect", "tb-border", MARGIN, MARGIN,
                frame.width - MARGIN * 2, frame.height - MARGIN * 2))
    line(x, bottom, x, top, "tb-border")

    cursor = top - 9
    text(x + 4, cursor, sheet_name.upper(), "tb-big")
    cursor -= 4
    text(x + 4, cursor, "codraft", "tb-small")
    cursor -= 4
    line(x, cursor, x + w, cursor)

    for label, value in block.rows():
        pieces = _wrap(value, 26)[:2] if value else []
        cursor -= 8.5 + (3.4 if len(pieces) > 1 else 0)
        text(x + 4, cursor + 4.0 + (3.4 if len(pieces) > 1 else 0), label, "tb-label")
        if pieces:
            for i, piece in enumerate(pieces):
                text(x + 4, cursor + 0.6 + (len(pieces) - 1 - i) * 3.4,
                     piece, "tb-value")
        else:
            line(x + 4, cursor + 1.6, x + w - 5, cursor + 1.6, "tb-blank")
        line(x, cursor, x + w, cursor, "tb-hair")

    cursor -= 11
    text(x + 4, cursor + 6.0, "SCALE", "tb-label")
    from .svg import NOT_TO_SCALE
    text(x + 4, cursor + 0.8,
         "NTS" if sheet_name in NOT_TO_SCALE else f"1:{frame.scale}",
         "tb-scale")
    text(x + 40, cursor + 6.0, "SHEET", "tb-label")
    text(x + 40, cursor + 0.8, f"{sheet_no} of {sheet_of}", "tb-scale")
    text(x + 4, cursor - 3.4, f"at {frame.size}. {scale_note}", "tb-small")
    cursor -= 7
    line(x, cursor, x + w, cursor)

    cursor -= 5
    text(x + 4, cursor, "REVISIONS", "tb-label")
    cursor -= 1.5
    line(x, cursor, x + w, cursor, "tb-hair")
    for revision in block.revisions[-6:]:
        cursor -= 5
        text(x + 4, cursor + 1.4, revision.mark, "tb-value")
        text(x + 10, cursor + 1.4, revision.date, "tb-small")
        text(x + 28, cursor + 1.4, revision.description[:24], "tb-small")
        if revision.by:
            text(x + w - 12, cursor + 1.4, revision.by[:4], "tb-small")
        line(x, cursor, x + w, cursor, "tb-hair")

    # Areas, under the revisions, matching the SVG line for line. Two
    # renderers is two chances to disagree, so the arithmetic here is the
    # same as export/svg.py's with the sign of the cursor flipped.
    if block.areas:
        cursor -= 6
        text(x + 4, cursor, "AREAS", "tb-label")
        cursor -= 1.5
        line(x, cursor, x + w, cursor, "tb-hair")
        for index, (label, value) in enumerate(block.areas):
            cursor -= 5
            strong = index >= len(block.areas) - 2
            text(x + 4, cursor + 1.4, label,
                 "tb-value" if strong else "tb-small")
            text(x + w - 5, cursor + 1.4, value,
                 "tb-fig-strong" if strong else "tb-fig")
            line(x, cursor, x + w, cursor, "tb-hair")
        if block.area_note:
            wrapped = _wrap(block.area_note, 46)
            if len(wrapped) > 3:
                # The box holds three lines. Saying the rest is missing beats
                # letting a truncated note read as the whole of it.
                wrapped = wrapped[:3] + ["..."]
            for i, chunk in enumerate(wrapped):
                text(x + 4, cursor - 4.0 - i * 3.0, chunk, "tb-small")
            # Advance past what was just printed. Leaving this out in one
            # renderer and not the other is how the areas note came out
            # printed through the NOTES heading below it in the PDF and
            # cleanly in the SVG -- the same block, two arithmetics.
            cursor -= 4.0 + 3.0 * len(wrapped)

    if sheet_notes:
        cursor -= 6
        text(x + 4, cursor, "NOTES", "tb-label")
        cursor -= 1.5
        line(x, cursor, x + w, cursor, "tb-hair")
        cursor -= 2.6
        for note in sheet_notes:
            for chunk in _wrap(note, 44):
                text(x + 4, cursor, chunk, "tb-small")
                cursor -= 3.0
            cursor -= 1.2

    foot = bottom + 15
    line(x, foot + 4, x + w, foot + 4, "tb-hair")
    text(x + 4, foot, "NOT FOR CONSTRUCTION", "tb-warn")
    for i, chunk in enumerate(_wrap(
        "Concept only. Not a compliance certificate. A registered building "
        "surveyor certifies; an engineer designs the footings and lintels.",
        46,
    )[:4]):
        text(x + 4, foot - 3.4 - i * 3.0, chunk, "tb-small")
    return ops


def _wrap(text: str, width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _page_stream(canvas, origin, content_w, content_h, frame, block,
                 sheet_name, sheet_no, sheet_of, styles,
                 sheet_notes=None) -> tuple[bytes, int]:
    """One page: the drawing placed at scale, then the title block."""
    drawn_w = content_w / frame.scale
    drawn_h = content_h / frame.scale
    pad_x = frame.x + (frame.w - drawn_w) / 2
    pad_y_top = MARGIN + (frame.h - drawn_h) / 2
    ox, oy = origin

    stream = _Stream()
    stream.op("q")
    # Plan millimetres straight into page points. PDF's y runs UP, which is
    # the direction the canvas already draws in, so unlike the SVG there is no
    # flip -- only a scale and a shift.
    # The SVG places a point at   y_down = pad_y_top + (oy - Y) / scale,
    # measured from the TOP of the page. PDF measures from the foot, so
    #     y_up = height - y_down = (height - pad_y_top - oy/scale) + Y/scale
    # which is a scale of 1/scale on Y and a constant that does NOT include
    # the drawing's own height -- putting drawn_h in here is what pushed the
    # first sheet off the top of the page.
    k = MM_TO_PT / frame.scale
    e = MM_TO_PT * (pad_x + ox / frame.scale)
    f = MM_TO_PT * (frame.height - pad_y_top - oy / frame.scale)
    stream.op(f"{k:.6f} 0 0 {k:.6f} {e:.4f} {f:.4f} cm")
    stream.op("1 j 1 J")
    skipped = _emit(stream, canvas.ops, styles, frame.scale)
    stream.op("Q")

    stream.op("q")
    stream.op(f"{MM_TO_PT:.6f} 0 0 {MM_TO_PT:.6f} 0 0 cm")
    covers_w, covers_h = frame.covers_mm()
    note = (f"window {frame.w} x {frame.h} mm holds "
            f"{covers_w / 1000:.1f} x {covers_h / 1000:.1f} m")
    skipped += _emit(
        stream,
        _title_block_ops(frame, block, sheet_name, sheet_no, sheet_of, note,
                         sheet_notes),
        styles, 1.0,
    )
    stream.op("Q")
    return stream.render(), skipped


def write_pdf(
    building: Building,
    path: str | Path,
    pages: list[tuple[str, int | None]] | None = None,
    title: TitleBlock | None = None,
    services: dict[str, dict] | None = None,
    footprint=None,
    system: str = "metric",
    sheet_size: str = "A3",
    compress: bool = True,
    notes: list[str] | None = None,
) -> Path:
    """Write the whole set as one PDF, a page per sheet.

    One file, because that is what gets emailed. `pages` is a list of
    (sheet, storey_index); omit it for the architectural plans and the
    elevations, which is the set a customer is given.
    """
    from .svg import STYLE, build_sheet

    path = Path(path)
    block = title or TitleBlock(project=building.name or "")
    styles = parse_style(STYLE)

    if pages is None:
        # The order a set reads: where it sits, then what it is, then how it
        # looks, then how it is put together.
        pages = [("site", None)]
        pages += [("architectural", s.index) for s in building.storeys]
        if len(building.storeys) == 1:
            pages = [("site", None), ("architectural", None)]
        if building.roof is not None:
            # A permit set is plans, elevations and at least one section.
            # Two elevations to a sheet, which is what gets them to the same
            # 1:100 as the floor plan rather than a quarter of the size.
            from .svg import elevation_sheets

            pages += [("elevations", page)
                      for page in range(elevation_sheets(building))]
            pages.append(("sections", None))
        # The schedules belong in the set, not only in a text file beside it.
        # A drawing gets separated from the files that came with it, and a
        # builder holding the plans and no schedule has the sizes of nothing.
        pages.append(("schedules", None))

    contents: list[bytes] = []
    sizes: list[tuple[float, float]] = []
    unsupported = 0
    for number, (sheet, storey_index) in enumerate(pages, start=1):
        canvas, origin, content_w, content_h, name = build_sheet(
            building, storey_index, sheet,
            (services or {}).get(sheet), footprint, system,
        )
        frame = fit_scale(content_w, content_h, size=sheet_size)
        stream, skipped = _page_stream(
            canvas, origin, content_w, content_h, frame, block,
            name, number, len(pages), styles,
            canvas.sheet_notes + [n for n in (notes or ())
                                  if n not in canvas.sheet_notes],
        )
        unsupported += skipped
        contents.append(stream)
        sizes.append((frame.width * MM_TO_PT, frame.height * MM_TO_PT))

    if unsupported:
        # Never silently. A drawing missing a line it was asked to carry is
        # exactly the failure the rest of this project is built to avoid.
        raise SheetError(
            f"{unsupported} drawing operations have no PDF equivalent and "
            "would have been left off the sheet"
        )

    path.write_bytes(_document(contents, sizes, block, compress))
    return path


def _document(contents: list[bytes], sizes: list[tuple[float, float]],
              block: TitleBlock, compress: bool) -> bytes:
    """Assemble the objects, the cross-reference table and the trailer."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)          # PDF object numbers start at 1

    font_ids = {}
    for key, name in _FONTS.items():
        font_ids[key] = add(
            f"<< /Type /Font /Subtype /Type1 /BaseFont /{name} "
            f"/Encoding /WinAnsiEncoding >>".encode("latin-1")
        )
    resources = "<< /Font << " + " ".join(
        f"/{key} {font_ids[key]} 0 R" for key in _FONTS
    ) + " >> >>"

    pages_id = len(objects) + 1 + len(contents) * 2   # reserved below
    page_ids: list[int] = []
    for stream, (width, height) in zip(contents, sizes):
        payload = zlib.compress(stream) if compress else stream
        filters = " /Filter /FlateDecode" if compress else ""
        content_id = add(
            f"<< /Length {len(payload)}{filters} >>\nstream\n".encode("latin-1")
            + payload + b"\nendstream"
        )
        page_ids.append(add(
            f"<< /Type /Page /Parent {pages_id} 0 R "
            f"/MediaBox [0 0 {width:.2f} {height:.2f}] "
            f"/Resources {resources} /Contents {content_id} 0 R >>".encode("latin-1")
        ))

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    tree_id = add(
        f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1")
    )
    assert tree_id == pages_id, "page tree object number was mispredicted"
    info_id = add(
        f"<< /Producer (codraft) /Title ({_escape(block.project or 'Drawing set')}) "
        f"/Creator (codraft) >>".encode("latin-1")
    )
    catalog_id = add(
        f"<< /Type /Catalog /Pages {tree_id} 0 R >>".encode("latin-1")
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode("latin-1") + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode("latin-1")
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R "
        f"/Info {info_id} 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    ).encode("latin-1")
    return bytes(out)
