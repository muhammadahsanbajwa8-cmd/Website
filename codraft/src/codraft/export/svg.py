"""SVG sheets, for looking at without opening CAD.

Three sheet types come out of the same geometry: the architectural plan
with its dimension chains, and the electrical and plumbing layouts, which
draw the architecture greyed back so the services read on top of it -- the
way a services drawing is always presented, because the reader needs the
walls for context and the fixtures for information.

SVG's y axis points down and a plan's points up, so everything is mirrored
once, at the top, rather than by negating coordinates all over the file.
"""

from __future__ import annotations

import html
import math
from pathlib import Path

from ..annotate import dimension_storey, room_dimension_text
from .elevation import elevations as build_elevations
from ..sheet import (
    MARGIN,
    TITLE_BLOCK_WIDTH,
    Frame,
    SheetError,
    TitleBlock,
    fit_scale,
)
from ..geom import Rect
from ..model import Building, Function
from ..symbols import NAMES, footprint, symbol
from ..units import fmt_area
from ._plan import storey_walls

SHEETS = ("architectural", "electrical", "plumbing", "elevations", "sections")

STYLE = """
  .sheet { fill: #fbfaf7; }
  .plot { fill: none; stroke: #9aa0a6; stroke-width: 20; stroke-dasharray: 400 200; }
  .pool { fill: #d6ecf7; stroke: #1565c0; stroke-width: 26; }
  .pool-barrier { fill: none; stroke: #b8860b; stroke-width: 30; stroke-dasharray: 240 120; }
  .pool-ncz { fill: none; stroke: #b03030; stroke-width: 12; stroke-dasharray: 90 110; }
  .pool-text { font: 600 260px system-ui, sans-serif; fill: #1565c0; text-anchor: middle; }
  /* The driveway is paving, so it reads as ground rather than as building:
     a light fill and a thin edge, under the house rather than over it. */
  .drive { fill: #ecebe6; stroke: #8a8577; stroke-width: 18; }
  .drive-cross { fill: none; stroke: #8a8577; stroke-width: 18; stroke-dasharray: 200 140; }
  .drive-text { font: 600 240px system-ui, sans-serif; fill: #6b6357; text-anchor: middle; }

  /* A section shows two things at once and they must not read alike: what
     the plane CUTS is structure and is heavy, what is seen BEYOND it is air
     and is light. Same weight for both and the drawing stops meaning
     anything. */
  .sect-cut { stroke: #14110d; stroke-width: 56; fill: none; stroke-linecap: square; }
  .sect-beyond { stroke: #9aa0a6; stroke-width: 18; fill: none; }
  .sect-roof { stroke: #14110d; stroke-width: 40; fill: none; }
  .sect-ground { stroke: #6b6357; stroke-width: 34; }
  .sect-name { font: 500 230px system-ui, sans-serif; fill: #6b6357; text-anchor: middle; }
  /* The cut line on the plan, without which a section is a picture. */
  .mark-line { stroke: #b03030; stroke-width: 34; stroke-dasharray: 900 260 160 260; }
  .mark-text { font: 700 420px system-ui, sans-serif; fill: #b03030; text-anchor: middle; }
  .setback { fill: none; stroke: #b4508c; stroke-width: 12; stroke-dasharray: 150 150; }
  .room { fill: #ffffff; }
  .room-wet { fill: #eef4fa; }
  .room-circ { fill: #f4f1ea; }
  .wall-ext { stroke: #14110d; stroke-width: 40; stroke-linecap: square; }
  .wall-int { stroke: #14110d; stroke-width: 26; stroke-linecap: square; }
  .jamb { stroke: #14110d; stroke-width: 20; }
  .door { stroke: #2f7d32; stroke-width: 18; fill: none; }
  .glaz { stroke: #1565c0; stroke-width: 26; }
  .tread { stroke: #8a8577; stroke-width: 14; }
  .name { font: 600 300px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
  .area { font: 260px system-ui, sans-serif; fill: #6b6357; text-anchor: middle; }
  .roomdim { font: 240px system-ui, sans-serif; fill: #8a8577; text-anchor: middle; }
  .title { font: 700 460px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }

  /* Dimensions */
  .dim { stroke: #b03030; stroke-width: 12; }
  .dim-wit { stroke: #b03030; stroke-width: 8; }
  .dim-tick { stroke: #b03030; stroke-width: 16; }
  .dim-text { font: 600 250px system-ui, sans-serif; fill: #b03030; text-anchor: middle; }
  .dim-overall { font: 700 280px system-ui, sans-serif; fill: #8c1c1c; text-anchor: middle; }

  /* Services: the architecture drops back so the services read on top */
  .ghost-wall { stroke: #c9c4bb; stroke-width: 34; stroke-linecap: square; }
  .ghost-room { fill: #ffffff; }
  .ghost-name { font: 250px system-ui, sans-serif; fill: #b3ada2; text-anchor: middle; }

  .sym { stroke: #14110d; stroke-width: 22; fill: none; }
  .sym-fill { fill: #14110d; stroke: none; }
  .sym-text { font: 600 150px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }

  .run-circuit_light { stroke: #b8860b; stroke-width: 16; fill: none;
                       stroke-dasharray: 300 180; }
  .run-circuit_power { stroke: #a0522d; stroke-width: 16; fill: none;
                       stroke-dasharray: 300 180; }
  .run-switch_leg { stroke: #b8860b; stroke-width: 12; fill: none;
                    stroke-dasharray: 120 120; }
  .run-cold { stroke: #1565c0; stroke-width: 18; fill: none; }
  .run-hot { stroke: #c62828; stroke-width: 18; fill: none;
             stroke-dasharray: 400 160; }
  .run-waste { stroke: #4a4a4a; stroke-width: 26; fill: none; }
  .run-vent { stroke: #4a4a4a; stroke-width: 14; fill: none;
              stroke-dasharray: 200 140 60 140; }

  /* Elevations */
  .elev-wall { stroke: #14110d; stroke-width: 34; fill: none; }
  .elev-roof { stroke: #14110d; stroke-width: 34; fill: #f0ede6; }
  .elev-glaz { stroke: #1565c0; stroke-width: 22; fill: #eaf1f8; }
  .elev-door { stroke: #2f7d32; stroke-width: 22; fill: #f0f5f0; }
  .elev-ground { stroke: #6b6357; stroke-width: 40; }
  .elev-level { stroke: #b03030; stroke-width: 10; stroke-dasharray: 260 140; }
  .elev-level-text { font: 600 210px "IBM Plex Mono", ui-monospace, monospace;
                     fill: #b03030; }
  .elev-note { font: 210px system-ui, sans-serif; fill: #6b6357; }
  .elev-code { font: 600 180px "IBM Plex Mono", ui-monospace, monospace;
               fill: #3a352d; text-anchor: middle; }

  .legend-box { fill: #ffffff; stroke: #d6d1c7; stroke-width: 10; }
  .legend-title { font: 700 320px system-ui, sans-serif; fill: #14110d; }
  .legend-item { font: 250px system-ui, sans-serif; fill: #3a352d; }
  .note { font: 235px system-ui, sans-serif; fill: #6b6357; }
  .note-strong { font: 600 250px system-ui, sans-serif; fill: #8c1c1c; }

  /* Sheet furniture. Drawn in millimetres of PAPER, outside the scaled
     group, so a title block reads the same at 1:50 and at 1:200 -- which is
     the whole point of it being on the sheet rather than in the drawing. */
  .tb-border { fill: none; stroke: #14110d; stroke-width: 0.7; }
  .tb-rule { stroke: #14110d; stroke-width: 0.25; }
  .tb-hair { stroke: #9aa0a6; stroke-width: 0.15; }
  .tb-label { font: 500 2.1px "IBM Plex Mono", ui-monospace, monospace;
              fill: #8a8577; letter-spacing: 0.12px; }
  .tb-value { font: 600 3.2px system-ui, sans-serif; fill: #14110d; }
  .tb-big { font: 700 5.4px system-ui, sans-serif; fill: #14110d; }
  .tb-scale { font: 700 6.6px "IBM Plex Mono", ui-monospace, monospace;
              fill: #14110d; }
  .tb-small { font: 2.4px system-ui, sans-serif; fill: #6b6357; }
  .tb-warn { font: 600 2.4px system-ui, sans-serif; fill: #8c1c1c; }
  .tb-blank { stroke: #c9c4bb; stroke-width: 0.3; }
"""


def _draw_section(canvas: _Canvas, view, dx: int = 0, dy: int = 0) -> None:
    """One section: what the plane cuts, what is seen past it, and the roof."""
    for line in view.beyond:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy,
                    "sect-beyond")
    for line in view.roof:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy,
                    "sect-roof")
    # Cut lines last, so the heavy structure sits over the light stuff rather
    # than being crossed by it.
    for line in view.cut:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy,
                    "sect-cut")
    if view.ground:
        g = view.ground
        canvas.line(g.x0 + dx, g.y0 + dy, g.x1 + dx, g.y1 + dy, "sect-ground")

    # Name each room the cut passes through, so a reader can place themselves.
    for piece in view.slices:
        if piece.x1 - piece.x0 < 1400:
            continue
        canvas.text((piece.x0 + piece.x1) // 2 + dx,
                    piece.floor + (piece.ceiling - piece.floor) // 2 + dy,
                    piece.name, "sect-name", dy=-60)

    left = min((l.x0 for l in view.cut), default=0) + dx
    right = max((l.x1 for l in view.cut), default=0) + dx
    for true_y, label_y, label in _level_labels(view.levels):
        canvas.line(left - 2600, true_y + dy, right + 400, true_y + dy,
                    "elev-level")
        canvas.text(left - 2500, label_y + dy, label, "elev-level-text", dy=-120)
        canvas.saw(left - 2600, true_y + dy, 400)


def _section_canvas(building: Building):
    """The section on its own sheet, with the notes under it."""
    from .section import section

    view = section(building)
    canvas = _Canvas()
    _draw_section(canvas, view)
    canvas.text(view.width_mm // 2, -2400, view.title, "title")

    # Wrap the notes to the width of the drawing itself. Left at a fixed
    # character count they ran far wider than the section, and since the sheet
    # scales to whatever the canvas covers, the notes were deciding the scale
    # -- the drawing came out at 1:200 to make room for its own footnotes.
    columns = max(40, min(110, view.width_mm // 150))
    top = -4200
    for note in view.notes:
        for piece in _wrap(note, columns):
            canvas.text(view.width_mm // 2, top, piece, "elev-note")
            top -= 700
    content_w = int(canvas.maxx - canvas.minx) + 7000
    content_h = int(canvas.maxy - canvas.miny) + 7000
    return (
        canvas,
        (int(-canvas.minx) + 3500, int(canvas.maxy) + 3500),
        content_w, content_h, "Section",
    )


def _crossover(plot, drive):
    """The strip over the verge, drawn outside the front boundary.

    Shown dashed and outside the lot line because it is not the builder's:
    it is the council's, on the council's land.
    """
    lot = plot.rect
    depth = 4000
    width = drive.crossover_width_mm
    if drive.road_side == "south":
        return Rect(drive.rect.centre.x - width // 2, lot.y0 - depth, width, depth)
    if drive.road_side == "north":
        return Rect(drive.rect.centre.x - width // 2, lot.y1, width, depth)
    if drive.road_side == "west":
        return Rect(lot.x0 - depth, drive.rect.centre.y - width // 2, depth, width)
    return Rect(lot.x1, drive.rect.centre.y - width // 2, depth, width)


def _fill(function: Function) -> str:
    if function.is_circulation:
        return "room-circ"
    if function.is_wet:
        return "room-wet"
    return "room"


class _Canvas:
    """Accumulates SVG in plan coordinates; the caller flips it once."""

    def __init__(self) -> None:
        self.parts: list[str] = []
        # The same drawing, recorded as a display list rather than markup, so
        # a second backend can render it without re-deriving any geometry.
        # Every primitive appends to BOTH; nothing may reach `parts` alone, or
        # the PDF quietly loses whatever it was.
        self.ops: list[tuple] = []
        self.minx = self.miny = 10**9
        self.maxx = self.maxy = -(10**9)

    def add(self, markup: str) -> None:
        self.parts.append(markup)

    def saw(self, x: float, y: float, pad: float = 0,
            pad_y: float | None = None) -> None:
        """Record a point so the sheet can be sized to fit its contents.

        Sizing the page from the plot rectangle leaves a services sheet
        mostly empty, because the building covers a third of the plot and
        the plot is not drawn on that sheet at all.

        `pad_y` exists because text is wide and short. Padding y by the same
        amount as x -- which is what a single `pad` did -- made a long note
        claim as much vertical room as it did horizontal, so a line of small
        print at the foot of a sheet stretched the page fourteen metres and
        the drawing above it was scaled down to make room for it.
        """
        if pad_y is None:
            pad_y = pad
        self.minx = min(self.minx, x - pad)
        self.maxx = max(self.maxx, x + pad)
        self.miny = min(self.miny, y - pad_y)
        self.maxy = max(self.maxy, y + pad_y)

    @property
    def has_content(self) -> bool:
        return self.maxx > self.minx

    def rect(self, r, cls: str, dx: int = 0) -> None:
        self.box(r.x + dx, r.y, r.w, r.h, cls)

    def box(self, x, y, w, h, cls: str) -> None:
        self.add(f'<rect class="{cls}" x="{x}" y="{y}" '
                 f'width="{w}" height="{h}"/>')
        self.ops.append(("rect", cls, float(x), float(y), float(w), float(h)))
        self.saw(x, y)
        self.saw(x + w, y + h)

    def line(self, x0, y0, x1, y1, cls: str) -> None:
        self.add(f'<line class="{cls}" x1="{x0:.0f}" y1="{y0:.0f}" '
                 f'x2="{x1:.0f}" y2="{y1:.0f}"/>')
        self.ops.append(("line", cls, float(x0), float(y0), float(x1), float(y1)))
        self.saw(x0, y0)
        self.saw(x1, y1)

    def circle(self, cx, cy, r, cls: str) -> None:
        self.add(f'<circle class="{cls}" cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}"/>')
        self.ops.append(("circle", cls, float(cx), float(cy), float(r)))
        self.saw(cx, cy, r)

    def arc(self, cx, cy, r, a0, a1, cls: str) -> None:
        x0 = cx + r * math.cos(math.radians(a0))
        y0 = cy + r * math.sin(math.radians(a0))
        x1 = cx + r * math.cos(math.radians(a1))
        y1 = cy + r * math.sin(math.radians(a1))
        large = 1 if (a1 - a0) % 360 > 180 else 0
        self.add(f'<path class="{cls}" d="M {x0:.0f} {y0:.0f} '
                 f'A {r:.0f} {r:.0f} 0 {large} 1 {x1:.0f} {y1:.0f}"/>')
        self.ops.append(("arc", cls, float(cx), float(cy), float(r),
                         float(a0), float(a1)))
        self.saw(cx, cy, r)

    def polyline(self, points, cls: str, dx: int = 0) -> None:
        if len(points) < 2:
            return
        d = " ".join(f"{x + dx:.0f},{y:.0f}" for x, y in points)
        self.add(f'<polyline class="{cls}" points="{d}"/>')
        self.ops.append(("polyline", cls,
                         tuple((float(x + dx), float(y)) for x, y in points)))
        for x, y in points:
            self.saw(x + dx, y)

    def text(self, x, y, value: str, cls: str, dy: int = 0,
             rotate: int = 0) -> None:
        """Text is flipped back upright, one label at a time."""
        spin = f" rotate({rotate})" if rotate else ""
        self.add(
            f'<g transform="translate({x:.0f},{y:.0f}) scale(1,-1){spin}">'
            f'<text class="{cls}" y="{dy}">{html.escape(value)}</text></g>'
        )
        self.ops.append(("text", cls, float(x), float(y), float(dy),
                         float(rotate), value))
        # Text is centred, so allow for roughly half its run either side --
        # but only a line's height above and below it.
        self.saw(x, y - dy, max(600, len(value) * 90), pad_y=400)


def _draw_symbol(canvas: _Canvas, kind: str, x: int, y: int, rotation: int,
                 dx: int = 0, scale: float = 1.0) -> None:
    geometry = symbol(kind, x + dx, y, rotation, scale)
    for line in geometry.lines:
        canvas.line(line.x0, line.y0, line.x1, line.y1, "sym")
    for circle in geometry.circles:
        canvas.circle(circle.cx, circle.cy, circle.r,
                      "sym-fill" if circle.filled else "sym")
    for arc in geometry.arcs:
        canvas.arc(arc.cx, arc.cy, arc.r, arc.a0, arc.a1, "sym")
    for label in geometry.labels:
        canvas.text(label.x, label.y, label.text, "sym-text", dy=-50)


def _draw_architecture(canvas: _Canvas, building, storey, dx: int, ghost: bool) -> None:
    plot = building.plot
    if not ghost:
        canvas.rect(plot.rect, "plot", dx)
        canvas.rect(plot.buildable, "setback", dx)
        # Paving goes down before anything else, so the house sits on it
        # rather than under it.
        drive = getattr(building, "driveway", None)
        if drive is not None and storey.index == 0:
            canvas.rect(drive.rect, "drive", dx)
            if drive.crossover_width_mm:
                canvas.rect(_crossover(building.plot, drive), "drive-cross", dx)
            centre = drive.rect.centre
            canvas.text(centre.x + dx, centre.y, "DRIVEWAY", "drive-text", dy=-80)
            canvas.text(
                centre.x + dx, centre.y,
                f"{drive.width_mm} wide x {drive.length_mm} long",
                "drive-text", dy=180,
            )

        # Where the section was cut. A section without this on the plan is a
        # picture of a building, not a drawing of this one.
        if not ghost and building.roof is not None:
            from .section import section_marker

            axis, position, run_from, run_to = section_marker(building)
            if run_to > run_from:
                if axis == "x":
                    canvas.line(run_from + dx, position, run_to + dx, position,
                                "mark-line")
                    for end, label in ((run_from, "A"), (run_to, "A")):
                        canvas.text(end + dx, position, label, "mark-text",
                                    dy=-620)
                else:
                    canvas.line(position + dx, run_from, position + dx, run_to,
                                "mark-line")
                    for end, label in ((run_from, "A"), (run_to, "A")):
                        canvas.text(position + dx, end, label, "mark-text",
                                    dy=-150)

        pool = building.pool
        if pool is not None and storey.index == 0:
            canvas.rect(pool.barrier.inset(-pool.non_climbable_zone_mm),
                        "pool-ncz", dx)
            canvas.rect(pool.barrier, "pool-barrier", dx)
            canvas.rect(pool.rect, "pool", dx)
            centre = pool.rect.centre
            canvas.text(centre.x + dx, centre.y, "POOL", "pool-text", dy=-90)
            canvas.text(centre.x + dx, centre.y,
                        f"{pool.rect.w} x {pool.rect.h}", "area", dy=260)

    for space in storey.spaces:
        canvas.rect(space.rect, "ghost-room" if ghost else _fill(space.function), dx)

    if not ghost:
        for stair in storey.stairs:
            r = stair.rect
            along_y = r.h >= r.w
            run = r.h if along_y else r.w
            treads = max(1, min(stair.risers, run // max(1, stair.tread_depth)))
            for i in range(1, treads):
                offset = i * stair.tread_depth
                if offset >= run:
                    break
                if along_y:
                    canvas.line(r.x0 + dx, r.y0 + offset, r.x1 + dx, r.y0 + offset, "tread")
                else:
                    canvas.line(r.x0 + offset + dx, r.y0, r.x0 + offset + dx, r.y1, "tread")

    for wall, drawn in storey_walls(storey):
        if ghost:
            cls = "ghost-wall"
        else:
            cls = "wall-ext" if wall.is_exterior else "wall-int"
        for s in drawn.faces:
            canvas.line(s.x0 + dx, s.y0, s.x1 + dx, s.y1, cls)
        if ghost:
            continue
        for s in drawn.jambs:
            canvas.line(s.x0 + dx, s.y0, s.x1 + dx, s.y1, "jamb")
        for s in drawn.door_leaves:
            canvas.line(s.x0 + dx, s.y0, s.x1 + dx, s.y1, "door")
        for a in drawn.door_swings:
            canvas.arc(a.cx + dx, a.cy, a.radius, a.start_deg, a.end_deg, "door")
        for s in drawn.window_lines:
            canvas.line(s.x0 + dx, s.y0, s.x1 + dx, s.y1, "glaz")


def _level_labels(levels, min_gap: int = 520):
    """Level lines at their true heights, with labels nudged apart.

    A storey's ceiling and the floor above it are 200 mm apart -- the floor
    structure -- and at 1:100 that is 2 mm on paper, so the two labels print
    on top of each other and neither can be read. The LINE stays where the
    level actually is, because that is what a surveyor measures to; only the
    text moves, which is what a draughtsman does by hand.
    """
    out = []
    previous = None
    for level in sorted(levels, key=lambda l: l.y):
        if out and level.y == out[-1][0]:
            continue
        label_y = level.y
        if previous is not None and label_y - previous < min_gap:
            label_y = previous + min_gap
        out.append((level.y, label_y, level.label))
        previous = label_y
    return out


def _draw_elevation(canvas: _Canvas, view, dx: int, dy: int = 0) -> None:
    """One elevation: walls, roof, openings and the levels up the side.

    `dy` shifts the whole view so several can be stacked in rows on a sheet.
    """
    for line in view.roof:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy, "elev-roof")
    for line in view.outline:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy, "elev-wall")

    for panel in view.panels:
        cls = "elev-door" if panel.kind == "door" else "elev-glaz"
        canvas.box(panel.x + dx, panel.y + dy, panel.width, panel.height, cls)
        if panel.label:
            canvas.text(panel.x + dx + panel.width // 2,
                        panel.y + dy + panel.height + 250, panel.label, "elev-code")

    if view.ground:
        g = view.ground
        canvas.line(g.x0 + dx, g.y0 + dy, g.x1 + dx, g.y1 + dy, "elev-ground")

    # Levels run off to the left of the drawing, as a sheet sets them out.
    left = min((l.x0 for l in view.outline), default=0) + dx
    right = max((l.x1 for l in view.outline), default=0) + dx
    for true_y, label_y, label in _level_labels(view.levels):
        canvas.line(left - 2600, true_y + dy, right + 400, true_y + dy, "elev-level")
        canvas.text(left - 2500, label_y + dy, label, "elev-level-text", dy=-120)
        canvas.saw(left - 2600, true_y + dy, 400)


def _draw_dimensions(canvas: _Canvas, storey, footprint, dx: int, system: str) -> None:
    for dim in dimension_storey(storey, footprint, system):
        canvas.line(dim.line.x0 + dx, dim.line.y0, dim.line.x1 + dx, dim.line.y1, "dim")
        for w in dim.witness:
            canvas.line(w.x0 + dx, w.y0, w.x1 + dx, w.y1, "dim-wit")
        for t in dim.ticks:
            canvas.line(t.x0 + dx, t.y0, t.x1 + dx, t.y1, "dim-tick")
        cls = "dim-overall" if dim.is_overall else "dim-text"
        if dim.vertical:
            canvas.text(dim.text_x + dx, dim.text_y, dim.text, cls,
                        dy=-110, rotate=-90)
        else:
            canvas.text(dim.text_x + dx, dim.text_y, dim.text, cls, dy=-110)


def _draw_services(canvas: _Canvas, plan, dx: int) -> None:
    for run in plan.runs:
        canvas.polyline(run.points, f"run-{run.kind}", dx)
    for fixture in plan.fixtures:
        _draw_symbol(canvas, fixture.kind, fixture.x, fixture.y, fixture.rotation, dx)


def _legend(canvas: _Canvas, x: int, y: int, width: int, title: str,
            entries: list[tuple[str, str]], notes: list[str]) -> int:
    """A legend and notes block. Returns the height it used."""
    # Plumbing fixtures are drawn at their real sizes on the plan, which is
    # right there and unusable in a legend column. Each entry is scaled to
    # a common height instead.
    line_height = 620
    header = 700
    note_height = 340
    legend_size = 420
    height = header + line_height * len(entries) + 260 + note_height * (
        sum(len(_wrap(n, 44)) for n in notes)
    ) + 400

    canvas.box(x, y - height, width, height, "legend-box")
    cursor = y - 520
    canvas.text(x + 300, cursor, title, "legend-title")
    cursor -= 420

    for kind, label in entries:
        along, out = footprint(kind)
        scale = min(1.0, legend_size / max(along, out, 1))
        _draw_symbol(canvas, kind, x + 700, cursor + 60, 0, scale=scale)
        canvas.text(x + 1600, cursor, label, "legend-item")
        cursor -= line_height

    cursor -= 200
    for note in notes:
        wrapped = _wrap(note, 44)
        for index, piece in enumerate(wrapped):
            cls = "note-strong" if index == 0 and note.startswith("Not ") else "note"
            canvas.text(x + 300, cursor, piece, cls)
            cursor -= note_height
        cursor -= 80
    return height


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
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


def _title_block(frame, block, sheet_name: str, sheet_no: int, sheet_of: int,
                 scale_note: str) -> str:
    """Draw the box down the right edge, in paper millimetres.

    y here runs DOWN from the top of the sheet, like SVG's own axis: this is
    furniture on the page, not geometry in the building, and flipping it
    would only make the arithmetic harder to read.
    """
    x = frame.title_x
    w = TITLE_BLOCK_WIDTH
    top = MARGIN
    bottom = frame.height - MARGIN
    out: list[str] = []
    esc = html.escape

    def line(x0, y0, x1, y1, cls="tb-rule"):
        out.append(f'<line class="{cls}" x1="{x0:.2f}" y1="{y0:.2f}" '
                   f'x2="{x1:.2f}" y2="{y1:.2f}"/>')

    def text(tx, ty, value, cls):
        out.append(f'<text class="{cls}" x="{tx:.2f}" y="{ty:.2f}">{esc(value)}</text>')

    # Sheet border, and the block itself.
    out.append(f'<rect class="tb-border" x="{MARGIN}" y="{MARGIN}" '
               f'width="{frame.width - MARGIN * 2}" '
               f'height="{frame.height - MARGIN * 2}"/>')
    line(x, top, x, bottom, "tb-border")

    cursor = top + 9
    text(x + 4, cursor, sheet_name.upper(), "tb-big")
    cursor += 4
    text(x + 4, cursor, "codraft", "tb-small")
    cursor += 4
    line(x, cursor, x + w, cursor)

    # The named fields. An empty one is ruled through: an obviously empty box
    # is worth more than a plausible invention.
    for label, value in block.rows():
        # Wrap rather than truncate. A site address cut off at "Lot 55 Purple
        # Court, Baldi" still looks like an address, which is the worst thing
        # a field on a drawing can do -- it reads as complete and is not.
        lines = _wrap(value, 26)[:2] if value else []
        cursor += 8.5 + (3.4 if len(lines) > 1 else 0)
        text(x + 4, cursor - 4.0 - (3.4 if len(lines) > 1 else 0), label, "tb-label")
        if lines:
            for i, piece in enumerate(lines):
                text(x + 4, cursor - 0.6 - (len(lines) - 1 - i) * 3.4,
                     piece, "tb-value")
            if len(_wrap(value, 26)) > 2:
                # Two lines is what the box holds. Say that the rest is not
                # shown rather than let it look like the whole of it.
                text(x + w - 5, cursor - 0.6, "...", "tb-small")
        else:
            line(x + 4, cursor - 1.6, x + w - 5, cursor - 1.6, "tb-blank")
        line(x, cursor, x + w, cursor, "tb-hair")

    # Scale and sheet number, which are the two things read most often.
    cursor += 11
    text(x + 4, cursor - 6.0, "SCALE", "tb-label")
    text(x + 4, cursor - 0.8, f"1:{frame.scale}", "tb-scale")
    text(x + 40, cursor - 6.0, "SHEET", "tb-label")
    text(x + 40, cursor - 0.8, f"{sheet_no} of {sheet_of}", "tb-scale")
    text(x + 4, cursor + 3.4, f"at {frame.size}. {scale_note}", "tb-small")
    cursor += 7
    line(x, cursor, x + w, cursor)

    # Revisions, newest last, the way a drawing set reads them.
    cursor += 5
    text(x + 4, cursor, "REVISIONS", "tb-label")
    cursor += 1.5
    line(x, cursor, x + w, cursor, "tb-hair")
    for revision in block.revisions[-6:]:
        cursor += 5
        text(x + 4, cursor - 1.4, revision.mark, "tb-value")
        text(x + 10, cursor - 1.4, revision.date, "tb-small")
        text(x + 28, cursor - 1.4, revision.description[:24], "tb-small")
        if revision.by:
            text(x + w - 12, cursor - 1.4, revision.by[:4], "tb-small")
        line(x, cursor, x + w, cursor, "tb-hair")

    # The disclaimer sits at the foot of the block, where a drawing set puts
    # its status. It is the same sentence the report ends with, because a
    # sheet gets separated from its report and has to carry it alone.
    foot = bottom - 15
    line(x, foot - 4, x + w, foot - 4, "tb-hair")
    text(x + 4, foot, "NOT FOR CONSTRUCTION", "tb-warn")
    for i, chunk in enumerate(_wrap(
        "Concept only. Not a compliance certificate. A registered building "
        "surveyor certifies; an engineer designs the footings and lintels.",
        46,
    )[:4]):
        text(x + 4, foot + 3.4 + i * 3.0, chunk, "tb-small")
    return "".join(out)


def build_sheet(
    building: Building,
    storey_index: int | None = None,
    sheet: str = "architectural",
    services: dict[int, object] | None = None,
    footprint=None,
    system: str = "metric",
) -> tuple["_Canvas", tuple[int, int], int, int, str]:
    """Draw one sheet onto a canvas, without deciding what it is written to.

    Returns the canvas, the origin that maps plan coordinates into a box of
    content_w x content_h, those two sizes, and the sheet's name. Both the SVG
    and the PDF writer go through here, so a drawing cannot come out different
    in one format from the other -- there is only one drawing.
    """
    if sheet not in SHEETS:
        raise ValueError(f"unknown sheet {sheet!r}; choose from {', '.join(SHEETS)}")

    storeys = (
        [s for s in building.storeys if s.index == storey_index]
        if storey_index is not None
        else building.storeys
    )
    if not storeys:
        raise ValueError(f"the building has no storey {storey_index}")

    if sheet == "elevations":
        return _elevation_canvas(building)
    if sheet == "sections":
        return _section_canvas(building)

    margin = 3000
    ghost = sheet != "architectural"
    # An architectural sheet shows the plot and its setbacks, so the storeys
    # are spaced by the plot. A services sheet does not, so spacing by the
    # plot would leave two thirds of the page empty.
    reference = building.plot.rect if not ghost else (
        footprint or _bounds(storeys[0])
    )
    step = reference.w + (7000 if not ghost else 5000)

    canvas = _Canvas()

    # Fix the title line once. Computing it inside the loop puts each
    # storey's title below the previous one's, marching down the sheet.
    plan_bottom = min(
        (footprint or _bounds(storey)).y0 for storey in storeys
    )
    title_y = plan_bottom - (5200 if sheet == "architectural" else 2600)
    titles: list[tuple[int, str]] = []

    for column, storey in enumerate(storeys):
        dx = column * step
        _draw_architecture(canvas, building, storey, dx, ghost)
        bounds = footprint or _bounds(storey)

        if sheet == "architectural":
            _draw_dimensions(canvas, storey, bounds, dx, system)
            for space in storey.spaces:
                c = space.rect.centre
                canvas.text(c.x + dx, c.y, space.name, "name", dy=-160)
                canvas.text(c.x + dx, c.y, fmt_area(space.area), "area", dy=180)
                # A third line of text will not fit in a small room without
                # colliding with the first two.
                if space.area >= 5_000_000:
                    canvas.text(c.x + dx, c.y, room_dimension_text(space, system),
                                "roomdim", dy=470)
        else:
            for space in storey.spaces:
                c = space.rect.centre
                canvas.text(c.x + dx, c.y, space.name, "ghost-name",
                            dy=int(-space.rect.h * 0.35))
            plan = (services or {}).get(storey.index)
            if plan is not None:
                _draw_services(canvas, plan, dx)

        titles.append((reference.centre.x + dx,
                       f"{storey.name} — {sheet.title()}"))

    # The titles go on last, below everything actually drawn. Positioning them
    # from the PLAN's bottom edge put them through the driveway the moment
    # there was one -- paving runs from the garage to the street boundary,
    # which is well below the house.
    title_y = min(title_y, canvas.miny - 1400)
    for tx, label in titles:
        canvas.text(tx, title_y, label, "title")

    if ghost and services:
        entries: list[tuple[str, str]] = []
        notes: list[str] = []
        seen: set[str] = set()
        for plan in services.values():
            for kind, _ in plan.schedule():
                if kind not in seen:
                    seen.add(kind)
                    entries.append((kind, NAMES.get(kind, kind)))
            for note in plan.notes + plan.warnings:
                if note not in notes:
                    notes.append(note)
        _legend(
            canvas,
            x=canvas.maxx + 3500,
            y=canvas.maxy,
            width=13000,
            title=f"{sheet.title()} legend",
            entries=sorted(entries, key=lambda e: e[1]),
            notes=notes,
        )

    if not canvas.has_content:
        raise ValueError("nothing was drawn on this sheet")

    content_w = int(canvas.maxx - canvas.minx) + margin * 2
    content_h = int(canvas.maxy - canvas.miny) + margin * 2
    return (
        canvas,
        (int(-canvas.minx) + margin, int(canvas.maxy) + margin),
        content_w, content_h, f"{sheet.title()} plan",
    )


def write_svg(
    building: Building,
    path: str | Path,
    storey_index: int | None = None,
    sheet: str = "architectural",
    services: dict[int, object] | None = None,
    footprint=None,
    system: str = "metric",
    title: TitleBlock | None = None,
    sheet_no: int = 1,
    sheet_of: int = 1,
    sheet_size: str = "A3",
) -> Path:
    """Write one sheet as SVG. `services` maps a storey index to its plan."""
    canvas, origin, content_w, content_h, name = build_sheet(
        building, storey_index, sheet, services, footprint, system
    )
    return _write_sheet(
        Path(path), "\n".join(canvas.parts), content_w, content_h,
        origin=origin,
        title=title or TitleBlock(project=building.name or ""),
        sheet_name=name,
        sheet_no=sheet_no, sheet_of=sheet_of, size=sheet_size,
    )


def _write_sheet(
    path: Path,
    body: str,
    content_w: int,
    content_h: int,
    origin: tuple[int, int],
    title: TitleBlock,
    sheet_name: str,
    sheet_no: int,
    sheet_of: int,
    size: str,
) -> Path:
    """Place a drawing on a real sheet, at a real scale, with a title block.

    The drawing group is scaled by 1/frame.scale, so every line weight and
    text size in STYLE -- all of them in real millimetres -- lands at a
    sensible size on paper without a second set of numbers to keep in step.
    A 40 mm wall stroke becomes 0.4 mm of ink at 1:100, which is a pen width;
    300 mm room text becomes 3 mm, which is drawing text.
    """
    frame = fit_scale(content_w, content_h, size=size)

    # Centre the drawing in the window rather than jamming it into a corner.
    drawn_w = content_w / frame.scale
    drawn_h = content_h / frame.scale
    # Both measured from the top-left, which is where SVG's own axis starts
    # and where the title block is drawn from. The frame's margins are
    # symmetric, so centring in the window is the same arithmetic either way.
    pad_x = frame.x + (frame.w - drawn_w) / 2
    pad_y_top = MARGIN + (frame.h - drawn_h) / 2

    # Read right to left, the way SVG composes them: flip the canvas's y-up
    # geometry to y-down and shift it into a box of content_w x content_h,
    # divide by the scale to turn real millimetres into paper ones, then move
    # that box into the window. The inner pair is exactly the transform this
    # writer used before there was a sheet, kept intact so the drawing itself
    # is unchanged -- only where it lands is new.
    ox, oy = origin
    place = (
        f"translate({pad_x:.3f},{pad_y_top:.3f}) "
        f"scale({1 / frame.scale:.6f}) "
        f"translate({ox},{oy}) scale(1,-1)"
    )
    covers_w, covers_h = frame.covers_mm()
    scale_note = (
        f"window {frame.w} x {frame.h} mm holds "
        f"{covers_w / 1000:.1f} x {covers_h / 1000:.1f} m"
    )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {frame.width} {frame.height}" '
        f'width="100%" style="max-width:100%;height:auto">'
        f"<style>{STYLE}</style>"
        f'<rect class="sheet" x="0" y="0" width="{frame.width}" '
        f'height="{frame.height}"/>'
        f'<g transform="{place}">{body}</g>'
        f"{_title_block(frame, title, sheet_name, sheet_no, sheet_of, scale_note)}"
        f"</svg>"
    )
    path.write_text(svg, encoding="utf-8")
    return path


def _elevation_canvas(building: Building):
    """All four elevations on one canvas, numbered from the street."""
    views = build_elevations(building)
    canvas = _Canvas()
    margin = 3500

    # Two by two, not four in a row. Four abreast makes the drawing 106 m
    # wide against 26 m tall, and the sheet then scales to the width: 1:500,
    # where a 2 x 2 block of the same views fits at 1:200. Same paper, same
    # information, two and a half times the size.
    spans = [
        (min((l.x0 for l in v.roof + v.outline), default=0),
         max((l.x1 for l in v.roof + v.outline), default=0))
        for v in views
    ]
    column_w = max((right - left for left, right in spans), default=0) + 9000
    row_h = max(
        (max((l.y1 for l in v.roof + v.outline), default=0) for v in views),
        default=0,
    ) + 9000

    for index, (view, (left, right)) in enumerate(zip(views, spans)):
        column, row = index % 2, index // 2
        dx = column * column_w - left
        dy = -row * row_h
        _draw_elevation(canvas, view, dx, dy)
        canvas.text((left + right) // 2 + dx, dy - 2400, view.title, "title")

    notes_top = -((len(views) + 1) // 2 - 1) * row_h - 4200
    for index, note in enumerate(views[0].notes):
        canvas.text(0, notes_top - index * 700, note, "elev-note")
        # Register where the note actually IS. Sawing the positive y
        # instead pushed the sheet bounds 13 m the wrong way and left
        # the notes themselves outside them.
        canvas.saw(0, notes_top - index * 700, 3000)

    content_w = int(canvas.maxx - canvas.minx) + margin * 2
    content_h = int(canvas.maxy - canvas.miny) + margin * 2
    return (
        canvas,
        (int(-canvas.minx) + margin, int(canvas.maxy) + margin),
        content_w, content_h, "Elevations",
    )




def _bounds(storey):
    """The footprint of a storey, when the caller did not pass one."""
    from ..geom import Rect

    xs = [s.rect.x0 for s in storey.spaces] + [s.rect.x1 for s in storey.spaces]
    ys = [s.rect.y0 for s in storey.spaces] + [s.rect.y1 for s in storey.spaces]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
