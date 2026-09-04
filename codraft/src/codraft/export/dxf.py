"""Writing DXF R12.

R12 is deliberately old. It is also the dialect that every CAD program
still opens without a word -- AutoCAD, BricsCAD, DraftSight, LibreCAD,
QCAD, and every viewer written since. A newer DXF would carry more, and be
read by less.

The file is plain ASCII group codes: a number on one line, a value on the
next. There is no library here because there does not need to be one.
"""

from __future__ import annotations

import io
from pathlib import Path

from ..annotate import dimension_storey, room_dimension_text
from ..model import Building, Function
from ..symbols import NAMES, symbol
from ..units import fmt_area
from ._plan import storey_walls
from .elevation import elevations as build_elevations

SHEETS = ("architectural", "electrical", "plumbing", "elevations")

# Layer name, then an AutoCAD colour index.
# Layer names follow the AIA/NCS convention, so the file drops into an
# office standard rather than arriving with layers called "stuff".
# A DXF R12 file is written as ASCII, and `errors="replace"` turns anything
# else into a question mark. Every area label in every DXF this program has
# written reads "12.3 m?" -- sixteen of them on one ground floor -- which is
# not a smaller version of "12.3 m2", it is a figure with its unit removed.
#
# Transliterated at the point the text is recorded rather than at write
# time, so the file says what the drawing says. Superscript two becomes a
# plain two, which is how a CAD drawing writes square metres anyway.
_ASCII = {
    "\u00b2": "2", "\u00b3": "3", "\u00d7": "x", "\u00b0": " deg",
    "\u2014": "--", "\u2013": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00a0": " ",
}


def _ascii(value: str) -> str:
    for source, plain in _ASCII.items():
        value = value.replace(source, plain)
    return value


LAYERS = {
    "A-WALL-EXTR": 7,    # white/black -- exterior walls
    "A-WALL-INTR": 8,    # grey -- interior walls
    "A-DOOR": 3,         # green
    "A-GLAZ": 4,         # cyan
    "A-AREA-IDEN": 2,    # yellow -- room names
    "A-ANNO-DIMS": 1,    # red -- dimensions
    "A-ANNO-NOTE": 7,    # drawing notes: what the plan says about itself
    "A-SITE-BNDY": 5,    # blue -- plot boundary
    "A-SITE-SETB": 6,    # magenta -- setback lines
    "E-LITE": 2,         # lighting points and switches
    "E-POWR": 32,        # socket outlets
    "E-CIRC": 42,        # circuit and switch-leg runs
    "E-ANNO": 7,
    "P-SANR": 7,         # sanitary fittings
    "P-SANR-WAST": 8,    # waste and vent pipework
    "P-DOMW-CWTR": 5,    # cold water
    "P-DOMW-HWTR": 1,    # hot water
    "P-ANNO": 7,
    "A-ELEV": 7,          # elevation outlines
    "A-ELEV-ROOF": 8,
    "A-ELEV-GLAZ": 4,
    "A-ELEV-DOOR": 3,
    "A-ELEV-LEVL": 1,     # levels and their labels
}

RUN_LAYERS = {
    "circuit_light": "E-CIRC",
    "circuit_power": "E-CIRC",
    "switch_leg": "E-CIRC",
    "cold": "P-DOMW-CWTR",
    "hot": "P-DOMW-HWTR",
    "waste": "P-SANR-WAST",
    "vent": "P-SANR-WAST",
}

FIXTURE_LAYERS = {
    "light_ceiling": "E-LITE", "light_wall": "E-LITE", "fan_ceiling": "E-LITE",
    "switch": "E-LITE", "switch_2": "E-LITE", "exhaust_fan": "E-LITE",
    "socket": "E-POWR", "socket_protected": "E-POWR",
    "socket_appliance": "E-POWR", "distribution_board": "E-POWR",
}


class _Writer:
    def __init__(self) -> None:
        self.out = io.StringIO()

    def tag(self, code: int, value) -> None:
        self.out.write(f"{code}\n{value}\n")

    def line(self, x0, y0, x1, y1, layer: str) -> None:
        self.tag(0, "LINE")
        self.tag(8, layer)
        self.tag(10, float(x0))
        self.tag(20, float(y0))
        self.tag(30, 0.0)
        self.tag(11, float(x1))
        self.tag(21, float(y1))
        self.tag(31, 0.0)

    def arc(self, cx, cy, radius, start, end, layer: str) -> None:
        self.tag(0, "ARC")
        self.tag(8, layer)
        self.tag(10, float(cx))
        self.tag(20, float(cy))
        self.tag(30, 0.0)
        self.tag(40, float(radius))
        self.tag(50, float(start))
        self.tag(51, float(end))

    def circle(self, cx, cy, radius, layer: str) -> None:
        self.tag(0, "CIRCLE")
        self.tag(8, layer)
        self.tag(10, float(cx))
        self.tag(20, float(cy))
        self.tag(30, 0.0)
        self.tag(40, float(radius))

    def text(self, x, y, height, value: str, layer: str, centred: bool = True,
             rotation: float = 0.0) -> None:
        self.tag(0, "TEXT")
        self.tag(8, layer)
        self.tag(10, float(x))
        self.tag(20, float(y))
        self.tag(30, 0.0)
        self.tag(40, float(height))
        self.tag(1, _ascii(value))
        if rotation:
            self.tag(50, float(rotation))
        if centred:
            self.tag(72, 1)      # horizontally centred
            self.tag(11, float(x))
            self.tag(21, float(y))
            self.tag(31, 0.0)

    def rectangle(self, rect, layer: str) -> None:
        for a, b in rect.edges():
            self.line(a.x, a.y, b.x, b.y, layer)


def _header(w: _Writer) -> None:
    w.tag(0, "SECTION")
    w.tag(2, "HEADER")
    w.tag(9, "$ACADVER")
    w.tag(1, "AC1009")          # R12
    w.tag(9, "$INSUNITS")
    w.tag(70, 4)                # millimetres
    w.tag(9, "$EXTMIN")
    w.tag(10, 0.0)
    w.tag(20, 0.0)
    w.tag(9, "$EXTMAX")
    w.tag(10, 100000.0)
    w.tag(20, 100000.0)
    w.tag(0, "ENDSEC")


def _tables(w: _Writer) -> None:
    w.tag(0, "SECTION")
    w.tag(2, "TABLES")
    w.tag(0, "TABLE")
    w.tag(2, "LAYER")
    w.tag(70, len(LAYERS))
    for name, colour in LAYERS.items():
        w.tag(0, "LAYER")
        w.tag(2, name)
        w.tag(70, 0)
        w.tag(62, colour)
        w.tag(6, "CONTINUOUS")
    w.tag(0, "ENDTAB")
    w.tag(0, "ENDSEC")


def _polyline(w: _Writer, points, layer: str, dx: int = 0) -> None:
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        w.line(x0 + dx, y0, x1 + dx, y1, layer)


def _symbol(w: _Writer, kind: str, x: int, y: int, rotation: int, layer: str,
            dx: int = 0) -> None:
    geometry = symbol(kind, x + dx, y, rotation)
    for line in geometry.lines:
        w.line(line.x0, line.y0, line.x1, line.y1, layer)
    for circle in geometry.circles:
        w.circle(circle.cx, circle.cy, circle.r, layer)
    for arc in geometry.arcs:
        w.arc(arc.cx, arc.cy, arc.r, arc.a0, arc.a1, layer)
    for label in geometry.labels:
        w.text(label.x, label.y, label.height, label.text, layer)


def _dimensions(w: _Writer, storey, footprint, dx: int, system: str) -> None:
    """Dimension chains, drawn as lines and text.

    Not DXF DIMENSION entities: those are associative and carry a style
    that every CAD program interprets slightly differently. Exploded lines
    and text look identical everywhere and cannot be accidentally
    re-measured against geometry they were not taken from.
    """
    for dim in dimension_storey(storey, footprint, system):
        w.line(dim.line.x0 + dx, dim.line.y0, dim.line.x1 + dx, dim.line.y1,
               "A-ANNO-DIMS")
        for witness in dim.witness:
            w.line(witness.x0 + dx, witness.y0, witness.x1 + dx, witness.y1,
                   "A-ANNO-DIMS")
        for tick in dim.ticks:
            w.line(tick.x0 + dx, tick.y0, tick.x1 + dx, tick.y1, "A-ANNO-DIMS")
        height = 260 if dim.is_overall else 230
        offset = 140
        if dim.vertical:
            w.text(dim.text_x + dx - offset, dim.text_y, height, dim.text,
                   "A-ANNO-DIMS", rotation=90)
        else:
            w.text(dim.text_x + dx, dim.text_y + offset, height, dim.text,
                   "A-ANNO-DIMS")


def _dxf_notes(w, building, notes, below: int) -> None:
    """What the plan says about itself, under the drawing in model space.

    Wrapped by hand rather than left as one long line: a DXF TEXT entity
    does not wrap, and a 200-character note runs the length of three houses
    across the model.
    """
    if not notes:
        return
    height = 250
    y = below - height * 4
    for note in notes:
        for line in _wrapped(note, 90):
            w.text(0, y, height, line, "A-ANNO-NOTE", centred=False)
            y -= height * 1.6
        y -= height * 0.8


def _wrapped(text: str, columns: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > columns:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


def write_dxf(
    building: Building,
    path: str | Path,
    storey_index: int | None = None,
    sheet: str = "architectural",
    services: dict[int, object] | None = None,
    footprint=None,
    system: str = "metric",
    title=None,
    sheet_no: int = 1,
    sheet_of: int = 1,
    sheet_size: str = "A3",
    notes: list[str] | None = None,
) -> Path:
    """Write one sheet as a DXF.

    The PAPER arguments are accepted and ignored. A DXF carries model-space
    geometry at full size -- it has no paper, so it has no scale and no title
    block, and CAD lays those out in its own paper space. Taking the
    arguments keeps one call signature across the writers; pretending to
    honour them would be worse than not having them.

    `notes` is not one of those. It is what the plan has to SAY about itself
    -- which rooms came out under the size the brief asked for -- and it
    reaches the other writers. This one did not take the argument at all, so
    `--formats dxf` raised a TypeError before writing a byte: the format was
    broken outright, on every invocation, and nothing exercised the CLI's
    format loop. Dropping the notes instead would have been the other
    failure: geometry handed over without the caveat that goes with it. They
    go into model space under the plan, on the notes layer, where a drafter
    can move them into their own title block.

    Storeys are laid out left to right with a gap between them, which is how
    a drawing sheet shows them and means the whole building opens in one
    view rather than as overlapping plans at the same coordinates.
    """
    path = Path(path)
    if sheet not in SHEETS:
        raise ValueError(f"unknown sheet {sheet!r}; choose from {', '.join(SHEETS)}")

    w = _Writer()
    _header(w)
    _tables(w)
    w.tag(0, "SECTION")
    w.tag(2, "ENTITIES")

    if sheet == "elevations":
        _dxf_elevations(w, building)
        _dxf_notes(w, building, notes, 0)
        w.tag(0, "ENDSEC")
        w.tag(0, "EOF")
        path.write_text(w.out.getvalue(), encoding="ascii", errors="replace")
        return path

    storeys = (
        [s for s in building.storeys if s.index == storey_index]
        if storey_index is not None
        else building.storeys
    )
    if not storeys:
        raise ValueError(f"the building has no storey {storey_index}")

    plot = building.plot
    step = plot.rect.w + 5000
    text_height = 250
    architectural = sheet == "architectural"

    for column, storey in enumerate(storeys):
        dx = column * step
        bounds = footprint or _storey_bounds(storey)

        if architectural:
            # Site: the plot boundary, and the line setbacks hold it to.
            w.rectangle(
                type(plot.rect)(plot.rect.x + dx, plot.rect.y, plot.rect.w, plot.rect.h),
                "A-SITE-BNDY",
            )
            buildable = plot.buildable
            w.rectangle(
                type(buildable)(buildable.x + dx, buildable.y, buildable.w, buildable.h),
                "A-SITE-SETB",
            )

        for wall, drawn in storey_walls(storey):
            layer = "A-WALL-EXTR" if wall.is_exterior else "A-WALL-INTR"
            for seg in drawn.faces:
                w.line(seg.x0 + dx, seg.y0, seg.x1 + dx, seg.y1, layer)
            for seg in drawn.jambs:
                w.line(seg.x0 + dx, seg.y0, seg.x1 + dx, seg.y1, layer)
            if not architectural:
                continue
            for seg in drawn.door_leaves:
                w.line(seg.x0 + dx, seg.y0, seg.x1 + dx, seg.y1, "A-DOOR")
            for arc in drawn.door_swings:
                w.arc(arc.cx + dx, arc.cy, arc.radius, arc.start_deg, arc.end_deg,
                      "A-DOOR")
            for seg in drawn.window_lines:
                w.line(seg.x0 + dx, seg.y0, seg.x1 + dx, seg.y1, "A-GLAZ")

        for space in storey.spaces:
            centre = space.rect.centre
            w.text(centre.x + dx, centre.y + text_height, text_height,
                   space.name.upper(), "A-AREA-IDEN")
            if architectural:
                w.text(centre.x + dx, centre.y - text_height * 1.4,
                       text_height * 0.8, fmt_area(space.area, system),
                       "A-AREA-IDEN")
                if space.area >= 5_000_000:
                    w.text(centre.x + dx, centre.y - text_height * 2.6,
                           text_height * 0.7, room_dimension_text(space, system),
                           "A-ANNO-DIMS")

        if architectural:
            for stair in storey.stairs:
                _draw_stair(w, stair, dx)
            _dimensions(w, storey, bounds, dx, system)
        else:
            plan = (services or {}).get(storey.index)
            if plan is not None:
                for run in plan.runs:
                    _polyline(w, run.points, RUN_LAYERS.get(run.kind, "E-CIRC"), dx)
                for fixture in plan.fixtures:
                    _symbol(
                        w, fixture.kind, fixture.x, fixture.y, fixture.rotation,
                        FIXTURE_LAYERS.get(fixture.kind, "P-SANR"), dx,
                    )

        title = f"{storey.name.upper()}  --  {sheet.upper()}"
        w.text(bounds.centre.x + dx, bounds.y0 - 5800, text_height * 1.6,
               title, "A-ANNO-DIMS")

    if not architectural and services:
        _dxf_legend(w, building, services, sheet, step * len(storeys))

    _dxf_notes(w, building, notes,
               min((_storey_bounds(st).y0 for st in storeys), default=0) - 7000)

    w.tag(0, "ENDSEC")
    w.tag(0, "EOF")
    path.write_text(w.out.getvalue(), encoding="ascii", errors="replace")
    return path


def _dxf_elevations(w: _Writer, building: Building) -> None:
    """All four elevations, side by side, with their levels."""
    cursor = 0
    for view in build_elevations(building):
        lines = view.roof + view.outline
        left = min((l.x0 for l in lines), default=0)
        right = max((l.x1 for l in lines), default=0)
        dx = cursor - left

        for line in view.roof:
            w.line(line.x0 + dx, line.y0, line.x1 + dx, line.y1, "A-ELEV-ROOF")
        for line in view.outline:
            w.line(line.x0 + dx, line.y0, line.x1 + dx, line.y1, "A-ELEV")
        for panel in view.panels:
            layer = "A-ELEV-DOOR" if panel.kind == "door" else "A-ELEV-GLAZ"
            x0, y0 = panel.x + dx, panel.y
            x1, y1 = x0 + panel.width, y0 + panel.height
            w.line(x0, y0, x1, y0, layer)
            w.line(x1, y0, x1, y1, layer)
            w.line(x1, y1, x0, y1, layer)
            w.line(x0, y1, x0, y0, layer)
        if view.ground:
            g = view.ground
            w.line(g.x0 + dx, g.y0, g.x1 + dx, g.y1, "A-ELEV")

        seen: set[int] = set()
        for level in sorted(view.levels, key=lambda l: l.y):
            if level.y in seen:
                continue
            seen.add(level.y)
            w.line(left + dx - 2600, level.y, right + dx + 400, level.y,
                   "A-ELEV-LEVL")
            w.text(left + dx - 2500, level.y + 120, 200, level.label,
                   "A-ELEV-LEVL", centred=False)

        w.text((left + right) // 2 + dx, -2400, 400,
               f"{view.title.upper()}  1:100", "A-ANNO-DIMS")
        cursor += (right - left) + 9000


def _dxf_legend(w: _Writer, building, services, sheet: str, x: int) -> None:
    """A legend column beside the plans."""
    seen: list[str] = []
    notes: list[str] = []
    for plan in services.values():
        for kind, _ in plan.schedule():
            if kind not in seen:
                seen.append(kind)
        for note in plan.notes + plan.warnings:
            if note not in notes:
                notes.append(note)

    y = building.plot.rect.y1
    w.text(x + 600, y, 400, f"{sheet.upper()} LEGEND", "E-ANNO")
    y -= 900
    for kind in sorted(seen, key=lambda k: NAMES.get(k, k)):
        _symbol(w, kind, x + 600, y, 0, "E-ANNO")
        w.text(x + 2200, y, 240, NAMES.get(kind, kind), "E-ANNO")
        y -= 900
    y -= 400
    for note in notes:
        w.text(x + 600, y, 220, note[:110], "E-ANNO")
        y -= 500


def _storey_bounds(storey):
    from ..geom import Rect

    xs = [s.rect.x0 for s in storey.spaces] + [s.rect.x1 for s in storey.spaces]
    ys = [s.rect.y0 for s in storey.spaces] + [s.rect.y1 for s in storey.spaces]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def _draw_stair(w: _Writer, stair, dx: int) -> None:
    """Treads, and an arrow showing which way is up."""
    rect = stair.rect
    along_y = rect.h >= rect.w
    run = rect.h if along_y else rect.w
    treads = max(1, min(stair.risers, run // max(1, stair.tread_depth)))
    for i in range(1, treads):
        offset = i * stair.tread_depth
        if offset >= run:
            break
        if along_y:
            w.line(rect.x0 + dx, rect.y0 + offset, rect.x1 + dx, rect.y0 + offset,
                   "A-WALL-INTR")
        else:
            w.line(rect.x0 + offset + dx, rect.y0, rect.x0 + offset + dx, rect.y1,
                   "A-WALL-INTR")
    centre = rect.centre
    w.text(centre.x + dx, centre.y, 200,
           f"UP {stair.risers}R", "A-ANNO-DIMS")
