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
import re
from pathlib import Path

from ..courses import COURSE_MM
from ..annotate import (
    dimension_site, dimension_storey, room_dimension_text,
)
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
from ..schedule import marks as opening_marks
from ..units import fmt_area
from ._plan import storey_walls

SHEETS = ("site", "architectural", "electrical", "plumbing", "elevations",
          "sections", "schedules")

# Sheets that carry no geometry, by the name `build_sheet` gives them. A
# schedule is a table: printing "1:100" on it invites somebody to scale a
# size off a column of type, and the sizes are written in the table.
NOT_TO_SCALE = frozenset({"Schedules"})

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
  /* Poche: the wall filled through its thickness. Without it a wall reads as
     a line on a diagram; with it, it reads as something solid, which is the
     single change that most makes a plan look like a plan. */
  .wall-fill { fill: #14110d; stroke: none; }
  .wall-fill-int { fill: #4a453d; stroke: none; }
  .wall-gap { fill: #fbfaf7; stroke: none; }
  .wall-ext { stroke: #14110d; stroke-width: 40; stroke-linecap: square; }
  .wall-int { stroke: #14110d; stroke-width: 26; stroke-linecap: square; }
  .jamb { stroke: #14110d; stroke-width: 20; }
  .door { stroke: #2f7d32; stroke-width: 18; fill: none; }
  .glaz { stroke: #1565c0; stroke-width: 26; }
  .tread { stroke: #8a8577; stroke-width: 14; }
  .name { font: 600 300px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
  .name-sm { font: 600 210px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
  .name-xs { font: 600 150px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
  .area { font: 260px system-ui, sans-serif; fill: #6b6357; text-anchor: middle; }
  .roomdim { font: 240px system-ui, sans-serif; fill: #8a8577; text-anchor: middle; }
  .tag { font: 600 200px "IBM Plex Mono", ui-monospace, monospace; fill: #2c4a7c; text-anchor: middle; }
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
  /* Fittings and joinery on the architectural plan. Lighter than the walls,
     because they are what is IN the room rather than what encloses it. */
  .fixture { stroke: #4a453d; stroke-width: 20; fill: none; }
  .bench { fill: #f1efe9; stroke: #8a8577; stroke-width: 18; }
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
  /* The schedule is a TABLE, so it is set in a monospaced face and drawn
     from the same lines the schedule text file carries. Columns that line
     up are the whole point of a schedule. */
  .sched-row { font: 210px "IBM Plex Mono", ui-monospace, monospace; fill: #3a352d; }
  .north { stroke: #14110d; stroke-width: 30; fill: none; stroke-linecap: round; }
  .north-text { font: 700 420px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
  .sched-head { font: 600 210px "IBM Plex Mono", ui-monospace, monospace; fill: #14110d; }
  .elev-code { font: 600 180px "IBM Plex Mono", ui-monospace, monospace;
               fill: #3a352d; text-anchor: middle; }

  .elev-course { stroke: #cfc9bd; stroke-width: 8; }
  .elev-frame { fill: none; stroke: #6b7f9e; stroke-width: 14; }
  .elev-sill { stroke: #4a453d; stroke-width: 22; stroke-linecap: square; }
  .legend-box { fill: #ffffff; stroke: #d6d1c7; stroke-width: 10; }
  .legend-title { font: 700 320px system-ui, sans-serif; fill: #14110d; }
  .legend-item { font: 250px system-ui, sans-serif; fill: #3a352d; }
  .area-head { font: 700 260px system-ui, sans-serif; fill: #14110d; letter-spacing: 30px; }
  .area-row { font: 250px system-ui, sans-serif; fill: #3a352d; }
  .area-fig { font: 250px "IBM Plex Mono", ui-monospace, monospace; fill: #3a352d; text-anchor: end; }
  .area-total { font: 700 250px system-ui, sans-serif; fill: #14110d; }
  .area-total-fig { font: 700 250px "IBM Plex Mono", ui-monospace, monospace; fill: #14110d; text-anchor: end; }
  .area-rule { stroke: #d6d1c7; stroke-width: 12; }
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
  .tb-fig { font: 2.6px "IBM Plex Mono", ui-monospace, monospace; fill: #3a352d; text-anchor: end; }
  .tb-fig-strong { font: 600 3.0px "IBM Plex Mono", ui-monospace, monospace; fill: #14110d; text-anchor: end; }
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

    # The notes go in the TITLE BLOCK, not under the drawing -- the same
    # decision `_elevation_canvas` makes, for the same reason, and this sheet
    # was the one place still making the other one.
    #
    # Wrapping them to the drawing's width kept them from running wider than
    # the section, but it did not make them free: they are still deducted
    # from the paper before a scale is chosen, and they were still costing
    # five of the sixty-five section sheets in the AU-WA lot sweep a step.
    # Twenty of the sixty-five were at 1:200 while their own floor plans were
    # at 1:100, which is a set drawn at two scales.
    canvas.sheet_notes.extend(view.notes)

    # The same 1500 the elevation sheet settled on, and for the same reason:
    # every millimetre of it is deducted from the paper before a scale is
    # chosen. At 3500 a side the box came out 31160 mm wide against the 30800
    # an A3 holds at 1:100 -- over by 360 mm of white, on a drawing using less
    # than 60 per cent of the sheet's height. Fifteen of the sixty-five
    # sections in the AU-WA lot sweep were at 1:200 while their own floor
    # plans were at 1:100.
    margin = 1500
    content_w = int(canvas.maxx - canvas.minx) + margin * 2
    content_h = int(canvas.maxy - canvas.miny) + margin * 2
    return (
        canvas,
        (int(-canvas.minx) + margin, int(canvas.maxy) + margin),
        content_w, content_h, "Section",
    )


def _schedule_canvas(building: Building):
    """The window, door and opening schedules on a sheet of their own.

    Drawn from the very lines `format_schedule` writes to the text file, so
    the sheet and the file cannot disagree. A schedule that says one thing on
    paper and another in a file beside it is worse than one schedule, because
    somebody will build from whichever they happen to be holding.

    On its own sheet rather than beside the plan: the plan's scale is deducted
    from the paper before anything else, and twenty rows of table under a
    floor plan is how a 1:100 drawing becomes 1:200.
    """
    from ..model import OpeningKind
    from ..schedule import format_schedule, schedule

    rows, _warnings = schedule(building)
    lines: list[str] = []
    for kind, title in ((OpeningKind.WINDOW, "WINDOW SCHEDULE"),
                        (OpeningKind.DOOR, "DOOR SCHEDULE"),
                        (OpeningKind.OPENING, "OPENING SCHEDULE")):
        block = format_schedule([r for r in rows if r.kind is kind], title)
        if block:
            lines += block + [""]

    if not lines:
        lines = ["No openings are scheduled."]

    canvas = _Canvas()
    pitch = 380
    top = 0
    for line in lines:
        if line and not line.startswith("  "):
            # A heading or its rule.
            canvas.text(0, top, line, "sched-head" if line.strip("- ") else "sched-row")
        elif line:
            canvas.text(0, top, line, "sched-row")
        top -= pitch

    # The content box is measured, not read off the canvas. `_Canvas.saw`
    # allows for text that is CENTRED on its point and roughly 90 units a
    # character either side of it -- which is right for a room label and
    # wrong twice over for a left-anchored line of a table: wrong about where
    # it starts and about twice as wide as it is. It made this sheet 39400
    # units across for a table 14000 wide, and the scale that comes of that
    # put the rows at 1.05 mm on paper.
    #
    # A monospaced face advances 0.6 of its size per character. That is a
    # property of the face, not a figure chosen here.
    font = 210
    across = int(max(len(line) for line in lines) * font * 0.6)
    down = pitch * len(lines)
    margin = 900
    return (
        canvas,
        (margin, down + margin),
        across + 2 * margin, down + 2 * margin, "Schedules",
    )


def _north_point(canvas: _Canvas, plot, dx: int) -> None:
    """A north arrow on the site plan.

    North is +y and always has been: `road_side` names the compass edge the
    road is on, and the drawing is set out with north up whichever edge that
    is. So the arrow is not a decoration or a guess -- it is the one fact the
    plot already asserts, drawn.

    It goes in the corner diagonally opposite the road, INSIDE the lot. The
    building is pushed against its frontage, so that corner is open ground by
    construction; outside the lot it would widen the sheet by a quarter and
    cost the drawing a scale step, which is what the arrow is worth.
    """
    lot = plot.rect
    reach = max(2000, min(lot.w, lot.h) // 8)
    inset = reach
    # Away from the street, in both axes, so a corner block still has it in
    # the quiet corner.
    x = lot.x0 + inset if plot.road_side == "east" else lot.x1 - inset
    y = lot.y0 + inset if plot.road_side == "north" else lot.y1 - inset
    foot = y - reach // 2
    head = y + reach // 2
    canvas.line(x + dx, foot, x + dx, head, "north")
    wing = reach // 5
    canvas.line(x + dx, head, x - wing + dx, head - wing, "north")
    canvas.line(x + dx, head, x + wing + dx, head - wing, "north")
    canvas.text(x + dx, head + reach // 4, "N", "north-text")


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
        # Anything the drawing found and the reader needs told -- a fitting
        # with nowhere to go, so far. Collected here because the drawing is
        # where it is discovered.
        self.notes: list[str] = []
        # Notes that belong on the SHEET, as opposed to `notes`, which is
        # what the drawing DISCOVERED and which goes to the report. Kept
        # apart because they land in different places and mixing them put
        # "WC has no wall left for its pan" in the title block.
        self.sheet_notes: list[str] = []
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


# How far outside the wall a schedule mark sits. Far enough to clear the
# wall poché and the dimension witness lines that run just outside it.
MARK_OFFSET = 620


def _draw_architecture(canvas: _Canvas, building, storey, dx: int, ghost: bool,
                       site: bool = True, marks: dict[str, str] | None = None) -> None:
    """Draw one storey.

    `site` says whether the lot goes on this sheet. A real set separates
    them: the SITE PLAN carries the boundary, the setbacks, the driveway and
    the pool, and the FLOOR PLAN carries only the house. That is not a
    stylistic choice -- the lot is three times the size of the house, and
    drawing it alongside forces the whole sheet down a scale step. The floor
    plans here came out at 1:200 for exactly that reason, where a builder's
    set draws them at 1:100.
    """
    plot = building.plot
    if not ghost and site:
        canvas.rect(plot.rect, "plot", dx)
        canvas.rect(plot.buildable, "setback", dx)
        if storey.index == 0:
            _north_point(canvas, plot, dx)
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

        pool = building.pool
        if site and pool is not None and storey.index == 0:
            canvas.rect(pool.barrier.inset(-pool.non_climbable_zone_mm),
                        "pool-ncz", dx)
            canvas.rect(pool.barrier, "pool-barrier", dx)
            canvas.rect(pool.rect, "pool", dx)
            centre = pool.rect.centre
            canvas.text(centre.x + dx, centre.y, "POOL", "pool-text", dy=-90)
            canvas.text(centre.x + dx, centre.y,
                        f"{pool.rect.w} x {pool.rect.h}", "area", dy=260)

    # The cut marker used to go here and now goes on LAST, in
    # `_draw_section_marker`, because where its letter can stand depends on
    # what else is already on the sheet.

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

    # Fill every wall solid first, then punch the openings back out, then
    # draw the linework over the top. That is the order CAD uses and the
    # order that makes a doorway read as a hole rather than as a wall with
    # lines across it.
    if not ghost:
        for wall, drawn in storey_walls(storey):
            if drawn.band is None:
                continue
            b = drawn.band
            canvas.box(b.x + dx, b.y, b.w, b.h,
                       "wall-fill" if wall.is_exterior else "wall-fill-int")
        for wall, drawn in storey_walls(storey):
            for g in drawn.gaps:
                canvas.box(g.x + dx, g.y, g.w, g.h, "wall-gap")

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

    # Schedule marks, on the exterior openings. This is the join between the
    # sheet and the window schedule: without it the schedule is a list of
    # sizes with no way to tell which hole is which.
    #
    # The MARK goes on the plan, not the supplier's size code, even though
    # the code is what a WA plan usually carries. Two different sizes can
    # share a code -- W05 and W06 are both 1209 on a four-bedroom plan --
    # so the code alone cannot find a row, and a tag a builder trusts and
    # that points at the wrong window is worse than no tag. The code is in
    # the schedule beside the mark, where it is unambiguous.
    #
    # Exterior only. Every internal door tagged as well is thirty labels on
    # a plan that has to stay readable, and the internal doors are all one
    # of four sizes that the schedule already lists room by room.
    if not ghost and not site and marks:
        centre = _bounds(storey).centre
        for wall, drawn in storey_walls(storey):
            if not wall.is_exterior:
                continue
            for gap, opening_id in zip(drawn.gaps, drawn.gap_ids):
                mark = marks.get(opening_id)
                if mark is None:
                    continue
                gx, gy = gap.x + gap.w // 2, gap.y + gap.h // 2
                # Outside the building, which is away from its middle. On a
                # vertical wall that is left or right; on a horizontal one,
                # up or down.
                if gap.h > gap.w:
                    ox = MARK_OFFSET if gx > centre.x else -MARK_OFFSET
                    oy = 0
                else:
                    ox, oy = 0, (MARK_OFFSET if gy > centre.y else -MARK_OFFSET)
                canvas.text(gx + ox + dx, gy + oy, mark, "tag",
                            dy=-70, rotate=-90 if gap.h > gap.w else 0)

    # Fittings and joinery LAST, so a room reads as somewhere you could stand
    # rather than as a rectangle with a caption. Last is not a preference:
    # the room fills are opaque, so a bath drawn before them is a bath that
    # is not on the drawing. Not on the site plan either -- at 1:200 a WC pan
    # is under a millimetre of paper and reads as dirt.
    if not ghost and not site:
        from .fixtures import for_storey

        fittings, benches, fixture_notes = for_storey(storey)
        canvas.notes.extend(fixture_notes)
        for bench in benches:
            canvas.box(bench.x0 + dx, bench.y0, bench.w, bench.h, "bench")
        for item, _space in fittings:
            geometry = symbol(item.kind, item.x + dx, item.y, item.rotation)
            for line in geometry.lines:
                canvas.line(line.x0, line.y0, line.x1, line.y1, "fixture")
            for circle in geometry.circles:
                canvas.circle(circle.cx, circle.cy, circle.r, "fixture")
            for arc in geometry.arcs:
                canvas.arc(arc.cx, arc.cy, arc.r, arc.a0, arc.a1, "fixture")


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


# The frame sightline drawn inside a structural opening.
#
# Nominal, and it has to be: the model carries the hole in the wall, not the
# window that goes in it, and which window that is comes from a supplier's
# range. The schedule already says as much about glazing ratios -- "a frame
# typically takes 10 to 20 per cent of the opening" -- so the inner line is
# drawn light, at a figure that is stated here rather than buried, and the
# notes on the sheet say the schedule decides it.
FRAME_SIGHTLINE = 45

# How far a sill runs past the opening each side.
SILL_RUN = 90


def _course_lines(face, panels, spacing: int) -> list[tuple[int, int, int]]:
    """Horizontal courses across one wall face, broken around the openings.

    Returns (y, x0, x1) runs. Broken rather than drawn over and hidden by an
    opaque panel: the panels are NOT opaque on an elevation -- a window is a
    hole you see glass through -- so a course drawn across one would read as
    brickwork in front of the glass.
    """
    runs: list[tuple[int, int, int]] = []
    top = face.y + face.height
    y = face.y + spacing
    while y < top:
        blockers = sorted(
            (max(face.x, p.x), min(face.x + face.width, p.x + p.width))
            for p in panels
            if p.y < y < p.y + p.height
            and p.x < face.x + face.width and p.x + p.width > face.x
        )
        cursor = face.x
        for x0, x1 in blockers:
            if x0 > cursor:
                runs.append((y, cursor, x0))
            cursor = max(cursor, x1)
        if cursor < face.x + face.width:
            runs.append((y, cursor, face.x + face.width))
        y += spacing
    return runs


def _draw_elevation(canvas: _Canvas, view, dx: int, dy: int = 0) -> None:
    """One elevation: walls, roof, openings and the levels up the side.

    `dy` shifts the whole view so several can be stacked in rows on a sheet.
    """
    for line in view.roof:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy, "elev-roof")

    # Brick courses, under everything else and only where the walls are
    # actually masonry. The pitch is the real 86 mm course the whole project
    # measures in, not a texture spacing chosen to look right.
    from .elevation import MASONRY

    if view.wall_material in MASONRY:
        for face in view.faces:
            for y, x0, x1 in _course_lines(face, view.panels, COURSE_MM):
                canvas.line(x0 + dx, y + dy, x1 + dx, y + dy, "elev-course")

    for line in view.outline:
        canvas.line(line.x0 + dx, line.y0 + dy, line.x1 + dx, line.y1 + dy, "elev-wall")

    for panel in view.panels:
        cls = "elev-door" if panel.kind == "door" else "elev-glaz"
        canvas.box(panel.x + dx, panel.y + dy, panel.width, panel.height, cls)

        # The frame within the structural opening, and the sill under it.
        inset = FRAME_SIGHTLINE
        if panel.width > inset * 3 and panel.height > inset * 3:
            canvas.box(panel.x + inset + dx, panel.y + inset + dy,
                       panel.width - inset * 2, panel.height - inset * 2,
                       "elev-frame")
        if panel.kind != "door":
            canvas.line(panel.x - SILL_RUN + dx, panel.y + dy,
                        panel.x + panel.width + SILL_RUN + dx, panel.y + dy,
                        "elev-sill")

        if panel.label:
            # INSIDE the opening, not above its head. Above it, the mark
            # landed on the ceiling level line that runs the width of the
            # sheet -- "W05" and "CL 2434 (28c + PLATE)" drawn over each
            # other, and on a 1290 mm window the head is exactly where that
            # line is. An opening is the one rectangle on an elevation with
            # nothing else in it.
            canvas.text(panel.x + dx + panel.width // 2,
                        panel.y + dy + panel.height // 2, panel.label,
                        "elev-code", dy=60)

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


def _draw_dims(canvas: _Canvas, dims, dx: int) -> None:
    """Render a set of dimension lines. One renderer, so a site plan's chain
    is drawn with the same weights and the same tick as a floor plan's."""
    for dim in dims:
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


def _text_boxes(canvas: _Canvas) -> list[tuple[float, float, float, float]]:
    """Every piece of text already on the canvas, as a box in real mm.

    The transform each label is drawn under is `translate(x,y) scale(1,-1)
    rotate(r)`, applied right to left, so a text offset of (0, dy) lands at
    (x, y - dy) upright and at (x + dy, y) turned. Reading dy as a y shift on
    a turned label counts a stacked room name as sitting on its own area
    figure, which is 151 collisions that are not there.
    """
    out = []
    for op in canvas.ops:
        if op[0] != "text":
            continue
        _kind, cls, x, y, dy, rot, value = op
        size = TEXT_SIZES.get(cls, 250)
        w = len(value) * size * CHAR_WIDTH
        h = float(size)
        if rot:
            cx, cy, w, h = x + dy, y, h, w
        else:
            cx, cy = x, y - dy
        out.append((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2))
    return out


def _clear_of(box, boxes) -> bool:
    for other in boxes:
        if (min(box[2], other[2]) - max(box[0], other[0]) > 0
                and min(box[3], other[3]) - max(box[1], other[1]) > 0):
            return False
    return True


# How far out the cut marker may be pushed looking for room, and in what
# steps. The cap is what an earlier measurement showed a sheet can give away
# before the drawing drops a scale step.
MARKER_STEP = 300
MARKER_REACH = 2100


def _draw_section_marker(canvas: _Canvas, building, dx: int) -> None:
    """The cut line on the plan, with its letter somewhere it can be read.

    Drawn LAST, and its standoff chosen by measuring rather than fixed,
    because the band outside a floor plan is crowded: the dimension chains
    sit at 1200 and 2100 mm, the opening marks sit against the wall, and a
    letter placed at any single one of those offsets lands on something.
    Fixed offsets were tried across the AU-WA sweep -- 600 mm collided with
    the opening marks on 13 sheets, 1200 with a dimension figure on 21, 2400
    cost three sheets a scale step. Only a 75 mm window came out clean, and
    threading a constant into a 75 mm window is a constant fitted to one
    sweep rather than a rule.

    So the line is drawn where a cut line goes and the LETTER steps outward
    until it finds space nothing else has taken. If nothing is clear inside
    the reach, it takes the last position rather than being dropped: a
    marker somebody has to look twice at still says where the section was
    cut, and no marker at all makes the section a picture.
    """
    if building.roof is None:
        return
    from .section import section_marker

    axis, position, run_from, run_to = section_marker(building)
    if run_to <= run_from:
        return
    if axis == "x":
        canvas.line(run_from + dx, position, run_to + dx, position, "mark-line")
    else:
        canvas.line(position + dx, run_from, position + dx, run_to, "mark-line")

    taken = _text_boxes(canvas)
    size = TEXT_SIZES.get("mark-text", 420)
    half_w, half_h = size * CHAR_WIDTH / 2, size / 2
    for end, outward in ((run_from, -1), (run_to, 1)):
        spot = None
        for step in range(0, MARKER_REACH + 1, MARKER_STEP):
            at = end + outward * step
            cx, cy = (at + dx, position) if axis == "x" else (position + dx, at)
            box = (cx - half_w, cy - half_h, cx + half_w, cy + half_h)
            spot = (cx, cy)
            if _clear_of(box, taken):
                break
        canvas.text(spot[0], spot[1], "A", "mark-text", dy=-half_h // 2)


def _draw_dimensions(canvas: _Canvas, storey, footprint, dx: int,
                     system: str) -> None:
    _draw_dims(canvas, dimension_storey(storey, footprint, system), dx)


def _draw_site_dimensions(canvas: _Canvas, plot, footprint, dx: int,
                          system: str) -> None:
    _draw_dims(canvas, dimension_site(plot, footprint, system), dx)


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
                 scale_note: str, sheet_notes: list[str] | None = None) -> str:
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
    text(x + 4, cursor - 0.8,
         "NTS" if sheet_name in NOT_TO_SCALE else f"1:{frame.scale}",
         "tb-scale")
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

    # Areas, under the revisions, which is where a builder's sheet carries
    # them. Here they cost the drawing nothing; beside the plan they cost
    # 10.6 m of width, which took a five-bedroom house from 1:100 to 1:200.
    if block.areas:
        cursor += 6
        text(x + 4, cursor, "AREAS", "tb-label")
        cursor += 1.5
        line(x, cursor, x + w, cursor, "tb-hair")
        for index, (label, value) in enumerate(block.areas):
            cursor += 5
            strong = index >= len(block.areas) - 2
            text(x + 4, cursor - 1.4, label, "tb-value" if strong else "tb-small")
            text(x + w - 5, cursor - 1.4, value,
                 "tb-fig-strong" if strong else "tb-fig")
            line(x, cursor, x + w, cursor, "tb-hair")
        if block.area_note:
            wrapped = _wrap(block.area_note, 46)
            if len(wrapped) > 3:
                # The box holds three lines. Saying the rest is missing beats
                # letting a truncated note read as the whole of it.
                wrapped = wrapped[:3] + ["..."]
            for i, chunk in enumerate(wrapped):
                text(x + 4, cursor + 4.0 + i * 3.0, chunk, "tb-small")
            # Advance past what was just printed. Leaving this out in one
            # renderer and not the other is how the areas note came out
            # printed through the NOTES heading below it in the PDF and
            # cleanly in the SVG -- the same block, two arithmetics.
            cursor += 4.0 + 3.0 * len(wrapped)

    # This sheet's own notes, under the areas. Same argument as the areas:
    # here they cost the drawing nothing, and under the drawing they cost it
    # a scale step.
    if sheet_notes:
        cursor += 6
        text(x + 4, cursor, "NOTES", "tb-label")
        cursor += 1.5
        line(x, cursor, x + w, cursor, "tb-hair")
        cursor += 2.6
        for note in sheet_notes:
            for chunk in _wrap(note, 44):
                text(x + 4, cursor, chunk, "tb-small")
                cursor += 3.0
            cursor += 1.2

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


def _floor_obstacles(storey) -> dict[int, list[Rect]]:
    """What is already standing on each room's floor, by room.

    The same call `_draw_architecture` makes, so the label sees exactly what
    is drawn -- it is pure, and asking twice is cheaper than threading the
    answer through three sheet types that do not want it.
    """
    from .fixtures import for_storey

    fittings, benches, _ = for_storey(storey)
    out: dict[int, list[Rect]] = {}
    for item, space in fittings:
        geometry = symbol(item.kind, item.x, item.y, item.rotation)
        xs = [c for line in geometry.lines for c in (line.x0, line.x1)]
        ys = [c for line in geometry.lines for c in (line.y0, line.y1)]
        for circle in geometry.circles + geometry.arcs:
            xs += [circle.cx - circle.r, circle.cx + circle.r]
            ys += [circle.cy - circle.r, circle.cy + circle.r]
        if not xs:
            continue
        box = Rect(int(min(xs)), int(min(ys)),
                   int(max(xs) - min(xs)), int(max(ys) - min(ys)))
        out.setdefault(id(space), []).append(box)
    for bench in benches:
        owner = None
        for space in storey.spaces:
            r = space.rect
            if (r.x0 <= bench.x0 and bench.x1 <= r.x1
                    and r.y0 <= bench.y0 and bench.y1 <= r.y1):
                owner = space
                break
        if owner is not None:
            out.setdefault(id(owner), []).append(bench)
    return out


# Roughly how wide a string prints, as a multiple of its size. This is a
# drawing estimate, not a font metric: it is used only to decide what a room
# is too small to CARRY, and erring wide means a line is left off rather than
# printed through a wall.
CHAR_WIDTH = 0.58

# Text size per class, read out of STYLE rather than written down again.
# Anything that measures a label -- the cut marker looking for room, a test
# checking nothing overlaps -- needs these, and a second copy would be a
# second thing to keep in step with the stylesheet.
TEXT_SIZES = {
    name: int(size)
    for name, size in re.findall(
        r"\.([a-z-]+)\s*\{[^}]*?font:[^;}]*?(\d+)px", STYLE
    )
}

# Clear of the walls, at either end of a label and above and below the block.
LABEL_MARGIN = 120

# The name, in the sizes a draughtsman would try in order. A small room takes
# a smaller name; it does not go unlabelled while there is a size that fits.
NAME_SIZES = (("name", 300), ("name-sm", 210), ("name-xs", 150))

# What the second and third lines are drawn at. These do not step down --
# a room too tight for its area at 260 simply does not carry its area.
AREA_SIZE = 260
DIM_SIZE = 240

# Line pitch as a multiple of the text size.
LEADING = 1.2


def _text_width(value: str, size: int) -> int:
    return int(len(value) * size * CHAR_WIDTH)


def _clear_run(rect, obstacles, y0: int, y1: int) -> tuple[int, int]:
    """The widest run inside `rect` between y0 and y1 that nothing crosses.

    Returns (width, centre). Obstacles are the fittings and joinery already
    on the floor: a label printed over a bath is not a label, it is a smudge.
    """
    blocked = sorted(
        (max(rect.x0, o.x0), min(rect.x1, o.x1))
        for o in obstacles if o.y0 < y1 and y0 < o.y1 and o.x0 < rect.x1
        and o.x1 > rect.x0
    )
    best_w, best_c, cursor = 0, rect.centre.x, rect.x0
    for x0, x1 in blocked + [(rect.x1, rect.x1)]:
        if x0 - cursor > best_w:
            best_w, best_c = x0 - cursor, (cursor + x0) // 2
        cursor = max(cursor, x1)
    return best_w, best_c


def _label_spot(rect, obstacles, height: int) -> tuple[int, int, int]:
    """Where a label block `height` tall fits best: (width, cx, cy).

    Scanned rather than solved. A dozen candidate bands is plenty for a room
    and keeps this something you can read.
    """
    if height >= rect.h:
        # Too tall for the room at all. Reported as no clear width rather
        # than squeezed in, so the caller drops a line and asks again.
        return 0, rect.centre.x, rect.centre.y
    best = None
    steps = 12
    for i in range(steps + 1):
        y0 = rect.y0 + (rect.h - height) * i // steps
        width, cx = _clear_run(rect, obstacles, y0, y0 + height)
        cy = y0 + height // 2
        # Ties go to the band nearest the middle of the room, which is where
        # a draughtsman puts a label when nothing is in the way.
        key = (width, -abs(cy - rect.centre.y))
        if best is None or key > best[0]:
            best = (key, width, cx, cy)
    return best[1], best[2], best[3]


def _flip(r):
    return Rect(r.y0, r.x0, r.h, r.w)


def _room_label(canvas, space, dx: int, system: str, obstacles) -> str | None:
    """The name, the area and the size, put somewhere they can be read.

    Four things decide this. A label goes where the floor is CLEAR, because
    printing it over the bath hides both. A line wider than the room is left
    off rather than run out through the walls into the neighbours. A room
    much taller than it is wide -- a passage, a robe -- takes its name turned
    on its side, which is what makes a 1 m corridor legible at all. And a
    small room takes a smaller name before it takes no name.

    Returns a note when a room could not be labelled at all. That is not a
    drafting problem to be swallowed: it means the layout has produced
    something too small to be a room -- a linen cupboard 91 mm deep -- and
    an unlabelled rectangle on the drawing is how that reaches a customer.
    """
    rect = space.rect
    turned = rect.h > rect.w * 1.6 and rect.w < 2000
    run, across = (rect.h, rect.w) if turned else (rect.w, rect.h)
    usable = run - LABEL_MARGIN * 2

    sizes = [(cls, size) for cls, size in NAME_SIZES
             if _text_width(space.name, size) <= usable]
    if not sizes:
        return _too_small(space)
    lines = [(space.name, *sizes[0])]

    if _text_width(fmt_area(space.area), AREA_SIZE) <= usable:
        lines.append((fmt_area(space.area), "area", AREA_SIZE))
    if space.area >= 5_000_000 and not turned:
        text = room_dimension_text(space, system)
        if _text_width(text, DIM_SIZE) <= usable:
            lines.append((text, "roomdim", DIM_SIZE))

    # Drop lines, then step the name down a size, until the block finds
    # somewhere clear to stand.
    #
    # BOTH, in that order, and the second half is not optional. A 1892 x 2442
    # bathroom takes "Bathroom" at 300 against the room's width and then
    # cannot place it, because a bath, a basin and a pan leave 1142 mm of
    # clear floor and the word is 1392 wide. Choosing the size once, up
    # front, meant the only remaining move was to drop the name -- so the
    # drawing left a bathroom unlabelled and called it a room too small for
    # its name, when 210 would have gone in with room to spare.
    step = 0
    while True:
        pitch = [int(size * LEADING) for _v, _c, size in lines]
        # The block is a line pitch each PLUS the height of the glyphs on the
        # top line, which sit above their baseline. Without that the scan is
        # happy to park a label with its ascenders in the wall above.
        height = sum(pitch) + lines[0][2]
        if height + LABEL_MARGIN * 2 <= across:
            if turned:
                width, cy, cx = _label_spot(
                    _flip(rect), [_flip(o) for o in obstacles], height)
            else:
                width, cx, cy = _label_spot(rect, obstacles, height)
            if width >= max(_text_width(v, size) for v, _c, size in lines):
                break
        if len(lines) > 1:
            lines.pop()
            continue
        step += 1
        if step >= len(sizes):
            return _too_small(space)
        lines = [(space.name, *sizes[step])]

    # The canvas is y-up and text is placed by a dy that grows DOWNWARD, so
    # the first line takes the most negative offset. Backwards, this prints a
    # room as "3719 x 2526 / 9.4 m2 / Bed": legible, and upside down.
    offset = -sum(pitch) // 2 + pitch[0] // 2
    for (value, cls, _size), step in zip(lines, pitch):
        if turned:
            canvas.text(cx + dx, cy, value, cls, dy=offset, rotate=-90)
        else:
            canvas.text(cx + dx, cy, value, cls, dy=offset)
        offset += step
    return None


def _too_small(space) -> str:
    rect = space.rect
    return (
        f"{space.name} is {rect.w} x {rect.h} mm, which is too small to carry "
        f"its own name on the drawing. It is drawn and dimensioned but not "
        f"labelled, because a caption printed across its neighbours would "
        f"read as theirs. A room this shape is a layout problem, not a "
        f"drafting one."
    )


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

    # An elevation sheet has no storey, so the index selects which SHEET of
    # elevations is wanted. Two views to a sheet; `elevation_sheets` says how
    # many that comes to for a given building.
    if sheet == "elevations":
        return _elevation_canvas(building, storey_index or 0)

    storeys = (
        [s for s in building.storeys if s.index == storey_index]
        if storey_index is not None
        else building.storeys
    )
    if not storeys:
        raise ValueError(f"the building has no storey {storey_index}")

    if sheet == "sections":
        return _section_canvas(building)

    if sheet == "schedules":
        return _schedule_canvas(building)

    # Breathing room around the drawing, in real millimetres. It is deducted
    # from the paper before a scale is chosen, so it is not free: 3000 here
    # cost 60mm of an A3's 277mm of height, which was the difference between
    # a floor plan at 1:100 and one at 1:200.
    margin = 1500
    ghost = sheet not in ("architectural", "site")
    if sheet == "site":
        # One sheet, the ground storey, the whole lot.
        storeys = storeys[:1]
    # An architectural sheet shows the plot and its setbacks, so the storeys
    # are spaced by the plot. A services sheet does not, so spacing by the
    # plot would leave two thirds of the page empty.
    reference = building.plot.rect if sheet == "site" else (
        footprint or _bounds(storeys[0])
    )
    step = reference.w + (7000 if not ghost else 5000)

    canvas = _Canvas()

    # Fix the title line once. Computing it inside the loop puts each
    # storey's title below the previous one's, marching down the sheet.
    plan_bottom = min(
        (footprint or _bounds(storey)).y0 for storey in storeys
    )
    title_y = plan_bottom - 2600
    titles: list[tuple[int, str]] = []

    for column, storey in enumerate(storeys):
        dx = column * step
        _draw_architecture(canvas, building, storey, dx, ghost,
                           site=(sheet == "site"),
                           marks=opening_marks(building)
                           if sheet == "architectural" else None)
        bounds = footprint or _bounds(storey)

        if sheet == "site":
            # Boundary to building face on all four sides. These are the
            # figures a certifier measures off a site plan, and without them
            # the sheet shows that a house was drawn on a lot and says
            # nothing about whether it may be.
            _draw_site_dimensions(canvas, building.plot, bounds, dx, system)
            for space in storey.spaces:
                c = space.rect.centre
                canvas.text(c.x + dx, c.y, space.name, "ghost-name",
                            dy=int(-space.rect.h * 0.35))
        elif sheet == "architectural":
            _draw_dimensions(canvas, storey, bounds, dx, system)
            obstacles = _floor_obstacles(storey)
            for space in storey.spaces:
                note = _room_label(canvas, space, dx, system,
                                   obstacles.get(id(space), ()))
                if note:
                    canvas.notes.append(note)
            # Last, so its letter can be placed clear of the dimensions and
            # the opening marks it would otherwise be printed over.
            _draw_section_marker(canvas, building, dx)
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

    # One storey to a sheet: the caption goes in the TITLE BLOCK, where the
    # identity of a sheet belongs, and the drawing keeps the height.
    #
    # It is the same call the section sheet's notes just went through, and it
    # buys the same thing. The caption sits 1400 mm clear below everything
    # else drawn, and that space is deducted from the paper before a scale is
    # chosen: on a 10.5 x 32 m block -- a narrow deep survey-strata lot, and
    # an ordinary one in Perth -- the box came out 28825 mm tall against the
    # 27700 an A3 holds at 1:100, over by 1125 mm, while using half the
    # sheet's width. All fifteen floor plan sheets in the AU-WA lot sweep
    # that missed 1:100 were that lot.
    #
    # It also says more than it did. Both floors of a two storey set were
    # headed "Architectural plan"; now the sheet itself says which floor.
    # By how many drawings are on the sheet, not by how it was asked for.
    # The site sheet takes the ground storey whether or not an index was
    # passed, and keying on the index gave it a caption one way and not the
    # other.
    single = len(storeys) == 1
    if single:
        titles = []

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
    # A sheet with one drawing on it is named by that drawing. Short, because
    # the title block holds about 84 mm of capitals at this size and
    # "GROUND FLOOR - ARCHITECTURAL PLAN" wants 110: it ran off the edge of
    # the block and the sheet read "GROUND FLOOR - ARCHITECTUR".
    #
    # The site plan keeps its own name. It shows the ground storey because
    # that is what sits on the lot, but it is not a floor plan and calling it
    # one would be the drawing telling a lie about what it is.
    name = f"{sheet.title()} plan"
    if single and sheet != "site":
        name = (f"{storeys[0].name} plan" if sheet == "architectural"
                else f"{storeys[0].name} {sheet}")
    return (
        canvas,
        (int(-canvas.minx) + margin, int(canvas.maxy) + margin),
        content_w, content_h, name,
    )


def drawing_notes(building, footprint=None, system: str = "metric") -> list[str]:
    """Everything the DRAWING discovered, as opposed to the layout.

    A fitting with nowhere to go in a room that is otherwise fine; a room
    that cannot carry its own name. Neither is visible to the solver, and
    both are findings about the plan rather than about the drafting -- the
    reason a room cannot be labelled is always that it is not a room.

    They are collected by building the sheet, because the sheet is what
    decides them. The CLI used to ask `fixtures.for_storey` directly, which
    got the fittings and quietly missed the labels: the drawing dropped the
    word "Bathroom" off a bathroom and the report never mentioned it.
    """
    seen: list[str] = []
    for storey in building.storeys:
        canvas, *_ = build_sheet(building, storey_index=storey.index,
                                 footprint=footprint, system=system)
        for note in canvas.notes:
            if note not in seen:
                seen.append(note)
    return seen


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
    notes: list[str] | None = None,
) -> Path:
    """Write one sheet as SVG. `services` maps a storey index to its plan.

    `notes` are statements about the design that belong on the sheet rather
    than only in the report -- a room drawn smaller than it was asked to be
    is the case this was added for. A drawing gets separated from its report;
    a limitation only the report states is a limitation the person holding
    the drawing does not know about.
    """
    canvas, origin, content_w, content_h, name = build_sheet(
        building, storey_index, sheet, services, footprint, system
    )
    for note in notes or ():
        if note not in canvas.sheet_notes:
            canvas.sheet_notes.append(note)
    return _write_sheet(
        Path(path), "\n".join(canvas.parts), content_w, content_h,
        origin=origin,
        title=title or TitleBlock(project=building.name or ""),
        sheet_name=name, sheet_notes=canvas.sheet_notes,
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
    sheet_notes: list[str] | None = None,
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
        f"{_title_block(frame, title, sheet_name, sheet_no, sheet_of, scale_note, sheet_notes or [])}"
        f"</svg>"
    )
    path.write_text(svg, encoding="utf-8")
    return path


# How many elevations go on one sheet.
#
# Two, in a column. Four abreast makes the drawing 106 m wide against 26 m
# tall and the sheet scales to the width: 1:500. Two by two is 50 x 29 m,
# which is 1:200 -- better, and still not what a permit set does, because the
# width is what binds and a 2 x 2 block cannot get under the 30.8 m an A3
# holds at 1:100. Two in a COLUMN is 22 x 20 m, which fits, so the elevations
# are drawn at the same scale as the floor plan they belong to. That costs a
# second sheet, and a second sheet is what a builder's set uses.
PER_ELEVATION_SHEET = 2


def elevation_sheets(building: Building) -> int:
    """How many sheets the elevations take, at two to a sheet."""
    views = len(build_elevations(building))
    return max(1, -(-views // PER_ELEVATION_SHEET))


def _elevation_canvas(building: Building, page: int = 0):
    """One sheet of elevations, at the scale every elevation sheet shares.

    Shares, deliberately. The scale is chosen from the content box, and the
    first sheet carries the notes while the others do not -- so left alone,
    a two storey house comes out with elevations 1-2 at 1:200 and 3-4 at
    1:100. A set whose elevations are at two different scales is a set
    somebody measures the wrong one off. So every sheet reports the LARGEST
    box any of them needs, and they all land on the same ratio.
    """
    pages = elevation_sheets(building)
    boxes = [_elevation_page(building, p) for p in range(pages)]
    if not 0 <= page < pages:
        raise ValueError(f"the building has no elevation sheet {page}")
    canvas, origin, _w, _h, name = boxes[page]
    return (canvas, origin,
            max(b[2] for b in boxes), max(b[3] for b in boxes), name)


def _elevation_page(building: Building, page: int = 0):
    """One sheet of elevations, numbered from the street."""
    every = build_elevations(building)
    first = page * PER_ELEVATION_SHEET
    views = every[first:first + PER_ELEVATION_SHEET]
    if not views:
        raise ValueError(f"the building has no elevation sheet {page}")
    canvas = _Canvas()
    # Every millimetre here is deducted from the paper before a scale is
    # chosen. A 3500 margin and a 9000 gap between views is 16 m of white on
    # a 23 m drawing, and 16 m of white is what kept the elevations at 1:200.
    margin = 1500
    gap = 4500

    spans = [
        (min((l.x0 for l in v.roof + v.outline), default=0),
         max((l.x1 for l in v.roof + v.outline), default=0))
        for v in views
    ]
    # Measured over EVERY view, not just this sheet's, so the two sheets space
    # their elevations identically and read as one set.
    row_h = max(
        (max((l.y1 for l in v.roof + v.outline), default=0) for v in every),
        default=0,
    ) + gap

    for index, (view, (left, right)) in enumerate(zip(views, spans)):
        dx = -left
        dy = -index * row_h
        _draw_elevation(canvas, view, dx, dy)
        canvas.text((left + right) // 2 + dx, dy - 2400, view.title, "title")

    # The notes go in the TITLE BLOCK, not under the drawing.
    #
    # Under the drawing they are deducted from the paper before a scale is
    # chosen, and they are not free: six lines of note took these sheets
    # from 1:100 straight back to 1:200. That is paying for the caption with
    # the drawing it captions. The title block has the room, costs the
    # drawing nothing, and is where a builder's set carries general notes
    # anyway. On the first sheet only -- two copies of a note is how a set
    # ends up with two that disagree.
    if page == 0:
        canvas.sheet_notes.extend(every[0].notes)

    name = "Elevations"
    if len(every) > PER_ELEVATION_SHEET:
        name = (f"Elevations {first + 1}"
                f"-{first + len(views)}" if len(views) > 1
                else f"Elevation {first + 1}")

    content_w = int(canvas.maxx - canvas.minx) + margin * 2
    content_h = int(canvas.maxy - canvas.miny) + margin * 2
    return (
        canvas,
        (int(-canvas.minx) + margin, int(canvas.maxy) + margin),
        content_w, content_h, name,
    )




def _bounds(storey):
    """The footprint of a storey, when the caller did not pass one."""
    from ..geom import Rect

    xs = [s.rect.x0 for s in storey.spaces] + [s.rect.x1 for s in storey.spaces]
    ys = [s.rect.y0 for s in storey.spaces] + [s.rect.y1 for s in storey.spaces]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
