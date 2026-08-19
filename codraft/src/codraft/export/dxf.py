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

from ..model import Building, Function
from ..units import fmt_area, fmt_len
from ._plan import storey_walls

# Layer name, then an AutoCAD colour index.
LAYERS = {
    "A-WALL-EXTR": 7,    # white/black -- exterior walls
    "A-WALL-INTR": 8,    # grey -- interior walls
    "A-DOOR": 3,         # green
    "A-GLAZ": 4,         # cyan
    "A-AREA-IDEN": 2,    # yellow -- room names
    "A-ANNO-DIMS": 1,    # red
    "A-SITE-BNDY": 5,    # blue -- plot boundary
    "A-SITE-SETB": 6,    # magenta -- setback lines
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

    def text(self, x, y, height, value: str, layer: str, centred: bool = True) -> None:
        self.tag(0, "TEXT")
        self.tag(8, layer)
        self.tag(10, float(x))
        self.tag(20, float(y))
        self.tag(30, 0.0)
        self.tag(40, float(height))
        self.tag(1, value)
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


def write_dxf(building: Building, path: str | Path, storey_index: int | None = None) -> Path:
    """Write one storey, or every storey side by side, as a DXF plan.

    Storeys are laid out left to right with a gap between them, which is how
    a drawing sheet shows them and means the whole building opens in one
    view rather than as overlapping plans at the same coordinates.
    """
    path = Path(path)
    w = _Writer()
    _header(w)
    _tables(w)
    w.tag(0, "SECTION")
    w.tag(2, "ENTITIES")

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

    for column, storey in enumerate(storeys):
        dx = column * step

        def sx(value: int) -> int:
            return value + dx

        # Site: the plot boundary, and the line setbacks hold the building to.
        w.rectangle(
            type(plot.rect)(sx(plot.rect.x), plot.rect.y, plot.rect.w, plot.rect.h),
            "A-SITE-BNDY",
        )
        buildable = plot.buildable
        w.rectangle(
            type(buildable)(sx(buildable.x), buildable.y, buildable.w, buildable.h),
            "A-SITE-SETB",
        )

        for wall, drawn in storey_walls(storey):
            layer = "A-WALL-EXTR" if wall.is_exterior else "A-WALL-INTR"
            for seg in drawn.faces:
                w.line(sx(seg.x0), seg.y0, sx(seg.x1), seg.y1, layer)
            for seg in drawn.jambs:
                w.line(sx(seg.x0), seg.y0, sx(seg.x1), seg.y1, layer)
            for seg in drawn.door_leaves:
                w.line(sx(seg.x0), seg.y0, sx(seg.x1), seg.y1, "A-DOOR")
            for arc in drawn.door_swings:
                w.arc(sx(arc.cx), arc.cy, arc.radius, arc.start_deg, arc.end_deg, "A-DOOR")
            for seg in drawn.window_lines:
                w.line(sx(seg.x0), seg.y0, sx(seg.x1), seg.y1, "A-GLAZ")

        for space in storey.spaces:
            centre = space.rect.centre
            w.text(sx(centre.x), centre.y + text_height, text_height,
                   space.name.upper(), "A-AREA-IDEN")
            w.text(sx(centre.x), centre.y - text_height * 1.4, text_height * 0.8,
                   fmt_area(space.area), "A-AREA-IDEN")
            if space.function is not Function.STAIR:
                w.text(
                    sx(centre.x), centre.y - text_height * 2.6, text_height * 0.7,
                    f"{fmt_len(space.rect.w)} x {fmt_len(space.rect.h)}",
                    "A-ANNO-DIMS",
                )

        # The stair, drawn as its treads.
        for stair in storey.stairs:
            _draw_stair(w, stair, dx)

        title = f"{storey.name.upper()}  --  {fmt_area(storey.floor_area)}"
        w.text(sx(plot.rect.centre.x), plot.rect.y - 1500, text_height * 1.6,
               title, "A-ANNO-DIMS")

    w.tag(0, "ENDSEC")
    w.tag(0, "EOF")
    path.write_text(w.out.getvalue(), encoding="ascii", errors="replace")
    return path


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
