"""A PDF reader, in the standard library.

PDF is a container of compressed byte streams describing marks on a page.
Everything needed to get the marks back out is in the standard library --
`zlib` for the compression, `re` for the syntax -- so there is no
dependency here, which matters for a reader that has to run wherever the
drawings are.

What it recovers: page sizes, every straight line segment in device
coordinates, and every piece of text with its position. What it does not
recover: any notion of what those lines MEAN. A PDF has no idea which of
its lines are walls. That inference lives in `survey.py`, and it is
reported as inference.

Deliberate limits, all of which are reported rather than hidden:
  - curves are flattened to chords, so an arc becomes a few segments
  - shading, images and clipping paths are ignored
  - text in a font with no usable ToUnicode map is returned as raw bytes
    and flagged, instead of being guessed at
"""

from __future__ import annotations

import base64
import re
import zlib
from dataclasses import dataclass, field
from pathlib import Path


class PdfError(ValueError):
    """The file could not be read as a PDF."""


# ---------------------------------------------------------------------------
# Object model
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Ref:
    """An indirect reference: `12 0 R`."""

    num: int
    gen: int


@dataclass(slots=True)
class Stream:
    d: dict
    raw: bytes

    def data(self) -> bytes:
        """Decompressed contents, as far as the filters are understood."""
        filters = self.d.get("Filter")
        if filters is None:
            return self.raw
        if isinstance(filters, (str, Ref)):
            filters = [filters]
        out = self.raw
        for f in filters:
            name = f if isinstance(f, str) else ""
            if name in ("FlateDecode", "Fl"):
                try:
                    out = zlib.decompress(out)
                except zlib.error:
                    # Truncated or subtly malformed streams are common in the
                    # wild; recover what decompressed before the error.
                    try:
                        out = zlib.decompressobj().decompress(out)
                    except zlib.error as exc:
                        raise PdfError(f"could not decompress a stream: {exc}") from exc
                params = self.d.get("DecodeParms") or {}
                if isinstance(params, dict) and params.get("Predictor", 1) > 1:
                    out = _undo_png_predictor(out, params)
            elif name in ("ASCII85Decode", "A85"):
                body = out.split(b"~>")[0]
                if body.startswith(b"<~"):
                    body = body[2:]
                try:
                    out = base64.a85decode(re.sub(rb"\s", b"", body))
                except ValueError as exc:
                    raise PdfError(f"could not decode an ASCII85 stream: {exc}") from exc
            elif name in ("RunLengthDecode", "RL"):
                out = _undo_run_length(out)
            elif name in ("ASCIIHexDecode", "AHx"):
                hexed = re.sub(rb"[^0-9A-Fa-f]", b"", out.split(b">")[0])
                if len(hexed) % 2:
                    hexed += b"0"
                out = bytes.fromhex(hexed.decode("ascii"))
            else:
                raise PdfError(
                    f"stream filter {name!r} is not supported; the drawing may "
                    "use an image or compression codraft cannot read"
                )
        return out


def _undo_run_length(data: bytes) -> bytes:
    """Reverse PDF run-length encoding."""
    out = bytearray()
    i = 0
    while i < len(data):
        length = data[i]
        i += 1
        if length == 128:
            break
        if length < 128:
            out.extend(data[i:i + length + 1])
            i += length + 1
        else:
            if i < len(data):
                out.extend(bytes([data[i]]) * (257 - length))
            i += 1
    return bytes(out)


def _undo_png_predictor(data: bytes, params: dict) -> bytes:
    """Reverse the PNG row predictors that xref and object streams often use."""
    columns = int(params.get("Columns", 1))
    colors = int(params.get("Colors", 1))
    bpc = int(params.get("BitsPerComponent", 8))
    stride = (columns * colors * bpc + 7) // 8
    step = max(1, colors * bpc // 8)

    out = bytearray()
    previous = bytearray(stride)
    for start in range(0, len(data), stride + 1):
        row = data[start:start + stride + 1]
        if len(row) < 2:
            break
        tag, row = row[0], bytearray(row[1:])
        if len(row) < stride:
            row.extend(bytes(stride - len(row)))
        if tag == 1:      # Sub
            for i in range(step, stride):
                row[i] = (row[i] + row[i - step]) & 0xFF
        elif tag == 2:    # Up
            for i in range(stride):
                row[i] = (row[i] + previous[i]) & 0xFF
        elif tag == 3:    # Average
            for i in range(stride):
                left = row[i - step] if i >= step else 0
                row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif tag == 4:    # Paeth
            for i in range(stride):
                a = row[i - step] if i >= step else 0
                b = previous[i]
                c = previous[i - step] if i >= step else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pred) & 0xFF
        out.extend(row)
        previous = row
    return bytes(out)


# ---------------------------------------------------------------------------
# Syntax
# ---------------------------------------------------------------------------
_WS = b"\x00\t\n\x0c\r "
_DELIM = b"()<>[]{}/%"
_TOKEN = re.compile(rb"[^\x00\t\n\x0c\r ()<>\[\]{}/%]+")


class _Lexer:
    """Just enough PDF syntax to walk objects and content streams."""

    def __init__(self, data: bytes, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    def skip(self) -> None:
        data, n = self.data, len(self.data)
        while self.pos < n:
            ch = data[self.pos]
            if ch in _WS:
                self.pos += 1
            elif ch == 0x25:  # '%' comment
                end = data.find(b"\n", self.pos)
                self.pos = n if end < 0 else end + 1
            else:
                return

    def parse(self):
        self.skip()
        if self.pos >= len(self.data):
            return None
        data, ch = self.data, self.data[self.pos]

        if ch == 0x2F:  # /Name
            self.pos += 1
            m = _TOKEN.match(data, self.pos)
            if not m:
                return ""
            self.pos = m.end()
            return _decode_name(m.group())
        if ch == 0x28:  # (string)
            return self._literal_string()
        if ch == 0x3C:  # << dict  or <hex>
            if data[self.pos:self.pos + 2] == b"<<":
                return self._dict()
            return self._hex_string()
        if ch == 0x5B:  # [array]
            self.pos += 1
            out = []
            while True:
                self.skip()
                if self.pos >= len(data):
                    break
                if data[self.pos] == 0x5D:
                    self.pos += 1
                    break
                out.append(self.parse())
            return out
        if ch in b"]>}":
            self.pos += 1
            return None

        m = _TOKEN.match(data, self.pos)
        if not m:
            self.pos += 1
            return None
        token = m.group()
        self.pos = m.end()
        return self._atom(token)

    def _atom(self, token: bytes):
        if token == b"true":
            return True
        if token == b"false":
            return False
        if token == b"null":
            return None
        if re.fullmatch(rb"[+-]?\d+", token):
            # Might be `n g R`, an indirect reference.
            save = self.pos
            self.skip()
            m2 = _TOKEN.match(self.data, self.pos)
            if m2 and re.fullmatch(rb"\d+", m2.group()):
                after = m2.end()
                lex = _Lexer(self.data, after)
                lex.skip()
                m3 = _TOKEN.match(self.data, lex.pos)
                if m3 and m3.group() == b"R":
                    self.pos = m3.end()
                    return Ref(int(token), int(m2.group()))
            self.pos = save
            return int(token)
        if re.fullmatch(rb"[+-]?(\d*\.\d*|\d+)", token):
            try:
                return float(token)
            except ValueError:
                return 0.0
        return _Op(token.decode("latin-1"))

    def _dict(self) -> dict:
        self.pos += 2
        out: dict = {}
        while True:
            self.skip()
            if self.pos >= len(self.data):
                break
            if self.data[self.pos:self.pos + 2] == b">>":
                self.pos += 2
                break
            key = self.parse()
            if not isinstance(key, str):
                continue
            out[key] = self.parse()
        return out

    def _literal_string(self) -> bytes:
        self.pos += 1
        depth = 1
        out = bytearray()
        data = self.data
        while self.pos < len(data):
            ch = data[self.pos]
            if ch == 0x5C:  # backslash
                self.pos += 1
                if self.pos >= len(data):
                    break
                nxt = data[self.pos]
                mapping = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
                if nxt in mapping:
                    out.append(mapping[nxt])
                    self.pos += 1
                elif 0x30 <= nxt <= 0x37:
                    octal = ""
                    while len(octal) < 3 and self.pos < len(data) and 0x30 <= data[self.pos] <= 0x37:
                        octal += chr(data[self.pos])
                        self.pos += 1
                    out.append(int(octal, 8) & 0xFF)
                else:
                    out.append(nxt)
                    self.pos += 1
                continue
            if ch == 0x28:
                depth += 1
            elif ch == 0x29:
                depth -= 1
                if depth == 0:
                    self.pos += 1
                    break
            out.append(ch)
            self.pos += 1
        return bytes(out)

    def _hex_string(self) -> bytes:
        end = self.data.find(b">", self.pos)
        if end < 0:
            end = len(self.data)
        hexed = re.sub(rb"[^0-9A-Fa-f]", b"", self.data[self.pos + 1:end])
        self.pos = end + 1
        if len(hexed) % 2:
            hexed += b"0"
        return bytes.fromhex(hexed.decode("ascii"))


@dataclass(frozen=True, slots=True)
class _Op:
    name: str


def _decode_name(raw: bytes) -> str:
    return re.sub(
        rb"#([0-9A-Fa-f]{2})",
        lambda m: bytes([int(m.group(1), 16)]),
        raw,
    ).decode("latin-1")


# ---------------------------------------------------------------------------
# Marks on the page
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Segment:
    """A straight line on the page, in PDF points, y upwards."""

    x0: float
    y0: float
    x1: float
    y1: float
    width: float = 0.0
    page: int = 0

    @property
    def length(self) -> float:
        return ((self.x1 - self.x0) ** 2 + (self.y1 - self.y0) ** 2) ** 0.5

    @property
    def horizontal(self) -> bool:
        return abs(self.y1 - self.y0) < 0.5

    @property
    def vertical(self) -> bool:
        return abs(self.x1 - self.x0) < 0.5


@dataclass(slots=True)
class TextRun:
    """A piece of text and where it sits, in PDF points."""

    text: str
    x: float
    y: float
    size: float = 0.0
    page: int = 0
    decoded: bool = True   # False when the font had no usable ToUnicode map


@dataclass(slots=True)
class Page:
    index: int
    width: float
    height: float
    segments: list[Segment] = field(default_factory=list)
    texts: list[TextRun] = field(default_factory=list)


@dataclass(slots=True)
class PdfDocument:
    path: Path
    pages: list[Page] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    producer: str = ""

    @property
    def segments(self) -> list[Segment]:
        return [s for p in self.pages for s in p.segments]

    @property
    def texts(self) -> list[TextRun]:
        return [t for p in self.pages for t in p.texts]

    @property
    def looks_like_a_scan(self) -> bool:
        """A page with almost no vectors and no text is a picture of a drawing.

        Worth knowing before anything else: on a scan there is nothing to
        measure, and the only honest path is the printed dimensions -- if
        the scan even has them and they can be read.
        """
        return all(len(p.segments) < 20 and len(p.texts) < 5 for p in self.pages)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
_OBJ = re.compile(rb"(\d+)\s+(\d+)\s+obj\b")


def _scan_objects(data: bytes, warnings: list[str]) -> dict[int, object]:
    """Find every indirect object by scanning the file.

    The cross-reference table is the official way in, but it comes in two
    forms, can be wrong, and is routinely rebuilt by tools that then leave
    the old one behind. Scanning for `N G obj` finds everything a valid
    file contains and does not care which xref dialect it uses.
    """
    objects: dict[int, object] = {}
    for match in _OBJ.finditer(data):
        num = int(match.group(1))
        lexer = _Lexer(data, match.end())
        try:
            value = lexer.parse()
        except (ValueError, IndexError):
            continue

        lexer.skip()
        if data[lexer.pos:lexer.pos + 6] == b"stream" and isinstance(value, dict):
            start = lexer.pos + 6
            if data[start:start + 2] == b"\r\n":
                start += 2
            elif data[start:start + 1] in (b"\n", b"\r"):
                start += 1
            length = value.get("Length")
            end = -1
            if isinstance(length, int) and length >= 0:
                candidate = start + length
                nearby = data[candidate:candidate + 20]
                if b"endstream" in nearby:
                    end = candidate
            if end < 0:
                end = data.find(b"endstream", start)
                if end < 0:
                    warnings.append(f"object {num} has a stream with no end")
                    continue
                while end > start and data[end - 1] in b"\r\n":
                    end -= 1
            objects[num] = Stream(value, data[start:end])
        else:
            objects[num] = value
    return objects


def _expand_object_streams(objects: dict[int, object], warnings: list[str]) -> None:
    """Unpack /ObjStm containers, which hold most objects in modern PDFs."""
    for holder in list(objects.values()):
        if not isinstance(holder, Stream) or holder.d.get("Type") != "ObjStm":
            continue
        try:
            payload = holder.data()
        except PdfError as exc:
            warnings.append(f"an object stream could not be read: {exc}")
            continue
        count = holder.d.get("N")
        first = holder.d.get("First")
        if not isinstance(count, int) or not isinstance(first, int):
            continue
        header = _Lexer(payload[:first])
        pairs: list[tuple[int, int]] = []
        for _ in range(count):
            num = header.parse()
            offset = header.parse()
            if not isinstance(num, int) or not isinstance(offset, int):
                break
            pairs.append((num, offset))
        for num, offset in pairs:
            if num in objects:
                continue  # a real object outside the stream wins
            try:
                objects[num] = _Lexer(payload, first + offset).parse()
            except (ValueError, IndexError):
                continue


class _Resolver:
    def __init__(self, objects: dict[int, object]) -> None:
        self.objects = objects

    def __call__(self, value, depth: int = 0):
        while isinstance(value, Ref) and depth < 32:
            value = self.objects.get(value.num)
            depth += 1
        return value


def _collect_pages(objects: dict[int, object], resolve) -> list[dict]:
    """Every page dictionary, in document order where that can be told."""
    pages = [
        obj for obj in objects.values()
        if isinstance(obj, dict) and obj.get("Type") == "Page"
    ]
    if pages:
        return pages
    # Some files omit /Type on page objects; fall back on structure.
    return [
        obj for obj in objects.values()
        if isinstance(obj, dict) and "MediaBox" in obj and "Contents" in obj
    ]


def _inherited(page: dict, key: str, objects: dict, resolve, depth: int = 0):
    """MediaBox and Resources may live on an ancestor rather than the page."""
    if key in page:
        return resolve(page[key])
    parent = resolve(page.get("Parent"))
    if isinstance(parent, dict) and depth < 32:
        return _inherited(parent, key, objects, resolve, depth + 1)
    return None


# ---------------------------------------------------------------------------
# Fonts: turning byte codes back into characters
# ---------------------------------------------------------------------------
_BFCHAR = re.compile(rb"beginbfchar(.*?)endbfchar", re.S)
_BFRANGE = re.compile(rb"beginbfrange(.*?)endbfrange", re.S)
_HEX = re.compile(rb"<([0-9A-Fa-f]+)>")


def _parse_tounicode(data: bytes) -> dict[int, str]:
    """Read a ToUnicode CMap into a code -> text mapping.

    Without this, text from a subset-embedded font comes back as arbitrary
    byte codes -- which on a drawing means the dimension strings, the very
    thing worth reading, are unreadable.
    """
    mapping: dict[int, str] = {}

    for block in _BFCHAR.findall(data):
        items = _HEX.findall(block)
        for i in range(0, len(items) - 1, 2):
            code = int(items[i], 16)
            mapping[code] = _utf16_be(items[i + 1])

    for block in _BFRANGE.findall(data):
        # Two shapes: <lo> <hi> <dst>, and <lo> <hi> [<d1> <d2> ...]
        for line in block.split(b"\n"):
            hexes = _HEX.findall(line)
            if b"[" in line and len(hexes) >= 3:
                lo = int(hexes[0], 16)
                for offset, item in enumerate(hexes[2:]):
                    mapping[lo + offset] = _utf16_be(item)
            elif len(hexes) >= 3:
                lo, hi = int(hexes[0], 16), int(hexes[1], 16)
                base = int(hexes[2], 16)
                for offset in range(min(hi - lo + 1, 65536)):
                    try:
                        mapping[lo + offset] = chr(base + offset)
                    except ValueError:
                        break
    return mapping


def _utf16_be(hexed: bytes) -> str:
    try:
        return bytes.fromhex(hexed.decode("ascii")).decode("utf-16-be", "replace")
    except ValueError:
        return ""


@dataclass(slots=True)
class _Font:
    tounicode: dict[int, str] = field(default_factory=dict)
    two_byte: bool = False

    def decode(self, raw: bytes) -> tuple[str, bool]:
        if self.tounicode:
            out = []
            if self.two_byte:
                codes = [int.from_bytes(raw[i:i + 2], "big")
                         for i in range(0, len(raw) - 1, 2)]
            else:
                codes = list(raw)
            unknown = 0
            for code in codes:
                mapped = self.tounicode.get(code)
                if mapped is None:
                    unknown += 1
                    out.append(chr(code) if 32 <= code < 127 else "")
                else:
                    out.append(mapped)
            return "".join(out), unknown == 0
        # No map: assume the codes are the characters, which holds for the
        # standard encodings and fails visibly for subset CID fonts.
        text = raw.decode("latin-1", "replace")
        printable = sum(1 for c in text if c.isprintable())
        return text, printable >= max(1, len(text) * 0.8)


def _load_fonts(resources, objects: dict, resolve) -> dict[str, _Font]:
    fonts: dict[str, _Font] = {}
    if not isinstance(resources, dict):
        return fonts
    font_dict = resolve(resources.get("Font"))
    if not isinstance(font_dict, dict):
        return fonts
    for name, ref in font_dict.items():
        font_obj = resolve(ref)
        if not isinstance(font_obj, dict):
            continue
        font = _Font()
        subtype = font_obj.get("Subtype")
        font.two_byte = subtype == "Type0"
        stream = resolve(font_obj.get("ToUnicode"))
        if isinstance(stream, Stream):
            try:
                font.tounicode = _parse_tounicode(stream.data())
            except PdfError:
                pass
        fonts[name] = font
    return fonts


# ---------------------------------------------------------------------------
# Content streams
# ---------------------------------------------------------------------------
def _multiply(a: tuple, b: tuple) -> tuple:
    """Compose two PDF matrices [a b c d e f]."""
    a0, a1, a2, a3, a4, a5 = a
    b0, b1, b2, b3, b4, b5 = b
    return (
        a0 * b0 + a1 * b2, a0 * b1 + a1 * b3,
        a2 * b0 + a3 * b2, a2 * b1 + a3 * b3,
        a4 * b0 + a5 * b2 + b4, a4 * b1 + a5 * b3 + b5,
    )


def _apply(m: tuple, x: float, y: float) -> tuple[float, float]:
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

# A curve becomes this many chords. Enough that a door swing reads as a
# curve rather than a triangle, few enough that a plan does not turn into
# a hundred thousand segments.
CURVE_STEPS = 8


class _Interpreter:
    """Walks a content stream and records the marks it makes."""

    def __init__(self, page_index: int, fonts: dict[str, _Font]) -> None:
        self.page = page_index
        self.fonts = fonts
        self.segments: list[Segment] = []
        self.texts: list[TextRun] = []
        self.ctm = IDENTITY
        self.stack: list[tuple] = []
        self.line_width = 1.0
        self.width_stack: list[float] = []
        self.path: list[list[tuple[float, float]]] = []
        self.current: list[tuple[float, float]] = []
        self.start: tuple[float, float] | None = None
        self.tm = IDENTITY
        self.tlm = IDENTITY
        self.font: _Font | None = None
        self.font_size = 0.0
        self.undecodable = 0

    # -- paths -----------------------------------------------------------
    def _moveto(self, x, y):
        if len(self.current) > 1:
            self.path.append(self.current)
        point = _apply(self.ctm, x, y)
        self.current = [point]
        self.start = point

    def _lineto(self, x, y):
        self.current.append(_apply(self.ctm, x, y))

    def _curveto(self, points):
        """Flatten a cubic Bezier into chords."""
        if not self.current:
            return
        p0 = self.current[-1]
        p1, p2, p3 = (_apply(self.ctm, points[i], points[i + 1]) for i in (0, 2, 4))
        for step in range(1, CURVE_STEPS + 1):
            t = step / CURVE_STEPS
            u = 1 - t
            x = (u ** 3 * p0[0] + 3 * u * u * t * p1[0]
                 + 3 * u * t * t * p2[0] + t ** 3 * p3[0])
            y = (u ** 3 * p0[1] + 3 * u * u * t * p1[1]
                 + 3 * u * t * t * p2[1] + t ** 3 * p3[1])
            self.current.append((x, y))

    def _rect(self, x, y, w, h):
        if len(self.current) > 1:
            self.path.append(self.current)
        corners = [
            _apply(self.ctm, x, y), _apply(self.ctm, x + w, y),
            _apply(self.ctm, x + w, y + h), _apply(self.ctm, x, y + h),
        ]
        self.path.append(corners + [corners[0]])
        self.current = []
        self.start = None

    def _close(self):
        if self.current and self.start:
            self.current.append(self.start)

    def _paint(self, stroke: bool):
        if len(self.current) > 1:
            self.path.append(self.current)
        if stroke:
            # Scale the nominal line width by the transform, so a hairline
            # set inside a scaled block is still reported as a hairline.
            scale = ((self.ctm[0] ** 2 + self.ctm[1] ** 2) ** 0.5 +
                     (self.ctm[2] ** 2 + self.ctm[3] ** 2) ** 0.5) / 2
            width = self.line_width * (scale or 1)
            for run in self.path:
                for a, b in zip(run, run[1:]):
                    if abs(a[0] - b[0]) > 1e-6 or abs(a[1] - b[1]) > 1e-6:
                        self.segments.append(
                            Segment(a[0], a[1], b[0], b[1], width, self.page)
                        )
        self.path = []
        self.current = []
        self.start = None

    # -- text ------------------------------------------------------------
    def _show(self, raw: bytes):
        if not isinstance(raw, bytes):
            return
        font = self.font or _Font()
        text, ok = font.decode(raw)
        if not text.strip():
            return
        if not ok:
            self.undecodable += 1
        matrix = _multiply(self.tm, self.ctm)
        x, y = matrix[4], matrix[5]
        size = self.font_size * ((matrix[0] ** 2 + matrix[1] ** 2) ** 0.5 or 1)
        self.texts.append(TextRun(text, x, y, size, self.page, ok))
        # Advance crudely: enough to keep successive runs apart, not enough
        # to be a typesetter. Positions come from Td/Tm in practice.
        self.tm = _multiply((1, 0, 0, 1, len(text) * size * 0.5, 0), self.tm)

    def run(self, data: bytes) -> None:
        lexer = _Lexer(data)
        operands: list = []
        while True:
            try:
                item = lexer.parse()
            except (ValueError, IndexError):
                break
            if item is None and lexer.pos >= len(lexer.data):
                break
            if not isinstance(item, _Op):
                operands.append(item)
                if len(operands) > 64:
                    del operands[:-32]
                continue

            op = item.name
            nums = [o for o in operands if isinstance(o, (int, float))]
            try:
                self._operator(op, operands, nums, lexer)
            except (IndexError, ValueError, TypeError):
                pass
            operands = []

    def _operator(self, op, operands, nums, lexer):
        if op == "q":
            self.stack.append(self.ctm)
            self.width_stack.append(self.line_width)
        elif op == "Q":
            if self.stack:
                self.ctm = self.stack.pop()
            if self.width_stack:
                self.line_width = self.width_stack.pop()
        elif op == "cm" and len(nums) >= 6:
            self.ctm = _multiply(tuple(nums[-6:]), self.ctm)
        elif op == "w" and nums:
            self.line_width = float(nums[-1])
        elif op == "m" and len(nums) >= 2:
            self._moveto(nums[-2], nums[-1])
        elif op == "l" and len(nums) >= 2:
            self._lineto(nums[-2], nums[-1])
        elif op == "c" and len(nums) >= 6:
            self._curveto(nums[-6:])
        elif op == "v" and len(nums) >= 4 and self.current:
            last = self.current[-1]
            self._curveto([last[0], last[1], nums[-4], nums[-3], nums[-2], nums[-1]])
        elif op == "y" and len(nums) >= 4:
            self._curveto([nums[-4], nums[-3], nums[-2], nums[-1], nums[-2], nums[-1]])
        elif op == "re" and len(nums) >= 4:
            self._rect(*nums[-4:])
        elif op == "h":
            self._close()
        elif op in ("S", "s"):
            if op == "s":
                self._close()
            self._paint(stroke=True)
        elif op in ("f", "F", "f*", "n"):
            # A filled path is usually a solid, hatch or text background, not
            # a line. Recording its edges as lines would bury the real ones.
            self._paint(stroke=False)
        elif op in ("B", "B*", "b", "b*"):
            if op.startswith("b"):
                self._close()
            self._paint(stroke=True)
        elif op == "BT":
            self.tm = self.tlm = IDENTITY
        elif op == "ET":
            pass
        elif op == "Tf" and len(operands) >= 2:
            name = operands[-2] if isinstance(operands[-2], str) else ""
            self.font = self.fonts.get(name, _Font())
            self.font_size = float(nums[-1]) if nums else 0.0
        elif op == "Tm" and len(nums) >= 6:
            self.tm = self.tlm = tuple(nums[-6:])
        elif op in ("Td", "TD") and len(nums) >= 2:
            self.tlm = _multiply((1, 0, 0, 1, nums[-2], nums[-1]), self.tlm)
            self.tm = self.tlm
        elif op == "T*":
            self.tlm = _multiply((1, 0, 0, 1, 0, -self.font_size * 1.2), self.tlm)
            self.tm = self.tlm
        elif op == "TL" and nums:
            pass
        elif op == "Tj" and operands:
            self._show(operands[-1])
        elif op == "'" and operands:
            self.tlm = _multiply((1, 0, 0, 1, 0, -self.font_size * 1.2), self.tlm)
            self.tm = self.tlm
            self._show(operands[-1])
        elif op == '"' and operands:
            self._show(operands[-1])
        elif op == "TJ" and operands:
            array = operands[-1]
            if isinstance(array, list):
                for element in array:
                    if isinstance(element, bytes):
                        self._show(element)


def merge_runs(texts: list[TextRun], gap_ratio: float = 0.9) -> list[TextRun]:
    """Join glyph runs back into words and numbers.

    Most producers emit text a glyph or two at a time so they can control
    kerning, which is why raw extraction yields "3", "6", "5", "3" instead
    of "3653". Runs on the same baseline, close enough together, are the
    same string -- and on a drawing that string is usually the dimension
    that makes the whole exercise worthwhile.
    """
    if not texts:
        return []

    ordered = sorted(texts, key=lambda t: (t.page, -round(t.y, 1), t.x))
    merged: list[TextRun] = []
    current: TextRun | None = None
    last_x = 0.0

    for run in ordered:
        size = run.size or 10.0
        if (
            current is not None
            and run.page == current.page
            and abs(run.y - current.y) <= size * 0.3
            # A small negative gap is kerning, not a new run: the advance
            # is estimated from an average glyph width, and narrow letters
            # like "t" make that estimate overshoot by a fraction of a point.
            and -size * 0.35 <= run.x - last_x <= size * gap_ratio
        ):
            # A gap of roughly a space width means a space, not a new run.
            joiner = " " if run.x - last_x > size * 0.30 else ""
            current.text += joiner + run.text
            current.decoded = current.decoded and run.decoded
        else:
            if current is not None:
                merged.append(current)
            current = TextRun(run.text, run.x, run.y, run.size, run.page, run.decoded)
        last_x = run.x + len(run.text) * size * 0.48

    if current is not None:
        merged.append(current)
    return merged


def read_pdf(path: str | Path, merge_text: bool = True) -> PdfDocument:
    """Read every page's line work and text out of a PDF."""
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise PdfError(f"could not open {path}: {exc}") from exc
    if not data.startswith(b"%PDF"):
        raise PdfError(
            f"{path.name} does not begin with %PDF. If this is a DWG or an "
            "image renamed to .pdf, say so and it can be handled differently."
        )

    document = PdfDocument(path=path)
    objects = _scan_objects(data, document.warnings)
    _expand_object_streams(objects, document.warnings)
    resolve = _Resolver(objects)

    for obj in objects.values():
        if isinstance(obj, dict) and "Producer" in obj:
            producer = resolve(obj["Producer"])
            if isinstance(producer, bytes):
                document.producer = producer.decode("latin-1", "replace")
                break

    pages = _collect_pages(objects, resolve)
    if not pages:
        raise PdfError(
            f"{path.name} has no readable page objects. It may be encrypted, "
            "in which case codraft cannot open it and neither can anything "
            "else without the password."
        )

    undecodable_total = 0
    for index, page in enumerate(pages):
        box = _inherited(page, "MediaBox", objects, resolve) or [0, 0, 595, 842]
        box = [float(resolve(v) or 0) for v in box]
        width, height = abs(box[2] - box[0]), abs(box[3] - box[1])

        resources = _inherited(page, "Resources", objects, resolve)
        fonts = _load_fonts(resources, objects, resolve)

        contents = resolve(page.get("Contents"))
        streams = contents if isinstance(contents, list) else [contents]
        payload = b""
        for item in streams:
            stream = resolve(item)
            if isinstance(stream, Stream):
                try:
                    payload += stream.data() + b"\n"
                except PdfError as exc:
                    document.warnings.append(f"page {index + 1}: {exc}")

        interpreter = _Interpreter(index, fonts)
        if payload:
            interpreter.run(payload)
        undecodable_total += interpreter.undecodable

        # Shift so the page's own origin is at (0, 0).
        dx, dy = min(box[0], box[2]), min(box[1], box[3])
        for segment in interpreter.segments:
            segment.x0 -= dx; segment.y0 -= dy
            segment.x1 -= dx; segment.y1 -= dy
        for text in interpreter.texts:
            text.x -= dx; text.y -= dy

        texts = (
            merge_runs(interpreter.texts) if merge_text else interpreter.texts
        )
        document.pages.append(
            Page(index, width, height, interpreter.segments, texts)
        )

    if undecodable_total:
        document.warnings.append(
            f"{undecodable_total} text runs came from fonts with no usable "
            "ToUnicode map, so their characters could not be recovered. Any "
            "dimension printed in those fonts is unreadable -- it is left as "
            "raw codes rather than guessed at."
        )
    if document.looks_like_a_scan:
        document.warnings.append(
            "This PDF carries almost no vector line work or text, which means "
            "it is a scan or an exported image. There is nothing in it to "
            "measure. The only usable route is the dimensions printed on the "
            "drawing, and those have to be readable."
        )
    return document
