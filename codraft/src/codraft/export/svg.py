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
from ..model import Building, Function
from ..symbols import NAMES, footprint, symbol
from ..units import fmt_area
from ._plan import storey_walls

SHEETS = ("architectural", "electrical", "plumbing", "elevations")

STYLE = """
  .sheet { fill: #fbfaf7; }
  .plot { fill: none; stroke: #9aa0a6; stroke-width: 20; stroke-dasharray: 400 200; }
  .pool { fill: #d6ecf7; stroke: #1565c0; stroke-width: 26; }
  .pool-barrier { fill: none; stroke: #b8860b; stroke-width: 30; stroke-dasharray: 240 120; }
  .pool-ncz { fill: none; stroke: #b03030; stroke-width: 12; stroke-dasharray: 90 110; }
  .pool-text { font: 600 260px system-ui, sans-serif; fill: #1565c0; text-anchor: middle; }
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
"""


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
        self.minx = self.miny = 10**9
        self.maxx = self.maxy = -(10**9)

    def add(self, markup: str) -> None:
        self.parts.append(markup)

    def saw(self, x: float, y: float, pad: float = 0) -> None:
        """Record a point so the sheet can be sized to fit its contents.

        Sizing the page from the plot rectangle leaves a services sheet
        mostly empty, because the building covers a third of the plot and
        the plot is not drawn on that sheet at all.
        """
        self.minx = min(self.minx, x - pad)
        self.maxx = max(self.maxx, x + pad)
        self.miny = min(self.miny, y - pad)
        self.maxy = max(self.maxy, y + pad)

    @property
    def has_content(self) -> bool:
        return self.maxx > self.minx

    def rect(self, r, cls: str, dx: int = 0) -> None:
        self.add(f'<rect class="{cls}" x="{r.x + dx}" y="{r.y}" '
                 f'width="{r.w}" height="{r.h}"/>')
        self.saw(r.x + dx, r.y)
        self.saw(r.x + dx + r.w, r.y + r.h)

    def line(self, x0, y0, x1, y1, cls: str) -> None:
        self.add(f'<line class="{cls}" x1="{x0:.0f}" y1="{y0:.0f}" '
                 f'x2="{x1:.0f}" y2="{y1:.0f}"/>')
        self.saw(x0, y0)
        self.saw(x1, y1)

    def circle(self, cx, cy, r, cls: str) -> None:
        self.add(f'<circle class="{cls}" cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}"/>')
        self.saw(cx, cy, r)

    def arc(self, cx, cy, r, a0, a1, cls: str) -> None:
        x0 = cx + r * math.cos(math.radians(a0))
        y0 = cy + r * math.sin(math.radians(a0))
        x1 = cx + r * math.cos(math.radians(a1))
        y1 = cy + r * math.sin(math.radians(a1))
        large = 1 if (a1 - a0) % 360 > 180 else 0
        self.add(f'<path class="{cls}" d="M {x0:.0f} {y0:.0f} '
                 f'A {r:.0f} {r:.0f} 0 {large} 1 {x1:.0f} {y1:.0f}"/>')
        self.saw(cx, cy, r)

    def polyline(self, points, cls: str, dx: int = 0) -> None:
        if len(points) < 2:
            return
        d = " ".join(f"{x + dx:.0f},{y:.0f}" for x, y in points)
        self.add(f'<polyline class="{cls}" points="{d}"/>')
        for x, y in points:
            self.saw(x + dx, y)

    def text(self, x, y, value: str, cls: str, dy: int = 0) -> None:
        """Text is flipped back upright, one label at a time."""
        self.add(
            f'<g transform="translate({x:.0f},{y:.0f}) scale(1,-1)">'
            f'<text class="{cls}" y="{dy}">{html.escape(value)}</text></g>'
        )
        # Text is centred, so allow for roughly half its run either side.
        self.saw(x, y - dy, max(600, len(value) * 90))


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


def _draw_elevation(canvas: _Canvas, view, dx: int) -> None:
    """One elevation: walls, roof, openings and the levels up the side."""
    for line in view.roof:
        canvas.line(line.x0 + dx, line.y0, line.x1 + dx, line.y1, "elev-roof")
    for line in view.outline:
        canvas.line(line.x0 + dx, line.y0, line.x1 + dx, line.y1, "elev-wall")

    for panel in view.panels:
        cls = "elev-door" if panel.kind == "door" else "elev-glaz"
        canvas.add(
            f'<rect class="{cls}" x="{panel.x + dx}" y="{panel.y}" '
            f'width="{panel.width}" height="{panel.height}"/>'
        )
        canvas.saw(panel.x + dx, panel.y)
        canvas.saw(panel.x + dx + panel.width, panel.y + panel.height)
        if panel.label:
            canvas.text(panel.x + dx + panel.width // 2,
                        panel.y + panel.height + 250, panel.label, "elev-code")

    if view.ground:
        g = view.ground
        canvas.line(g.x0 + dx, g.y0, g.x1 + dx, g.y1, "elev-ground")

    # Levels run off to the left of the drawing, as a sheet sets them out.
    left = min((l.x0 for l in view.outline), default=0) + dx
    right = max((l.x1 for l in view.outline), default=0) + dx
    seen: set[int] = set()
    for level in sorted(view.levels, key=lambda l: l.y):
        if level.y in seen:
            continue
        seen.add(level.y)
        canvas.line(left - 2600, level.y, right + 400, level.y, "elev-level")
        canvas.add(
            f'<g transform="translate({left - 2500},{level.y}) scale(1,-1)">'
            f'<text class="elev-level-text" y="-120">'
            f'{html.escape(level.label)}</text></g>'
        )
        canvas.saw(left - 2600, level.y, 400)


def _draw_dimensions(canvas: _Canvas, storey, footprint, dx: int, system: str) -> None:
    for dim in dimension_storey(storey, footprint, system):
        canvas.line(dim.line.x0 + dx, dim.line.y0, dim.line.x1 + dx, dim.line.y1, "dim")
        for w in dim.witness:
            canvas.line(w.x0 + dx, w.y0, w.x1 + dx, w.y1, "dim-wit")
        for t in dim.ticks:
            canvas.line(t.x0 + dx, t.y0, t.x1 + dx, t.y1, "dim-tick")
        cls = "dim-overall" if dim.is_overall else "dim-text"
        if dim.vertical:
            canvas.add(
                f'<g transform="translate({dim.text_x + dx},{dim.text_y}) '
                f'scale(1,-1) rotate(-90)">'
                f'<text class="{cls}" y="-110">{html.escape(dim.text)}</text></g>'
            )
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

    canvas.add(f'<rect class="legend-box" x="{x}" y="{y - height}" '
               f'width="{width}" height="{height}"/>')
    canvas.saw(x, y - height)
    canvas.saw(x + width, y)
    cursor = y - 520
    canvas.text(x + 300, cursor, title, "legend-title")
    cursor -= 420

    for kind, label in entries:
        along, out = footprint(kind)
        scale = min(1.0, legend_size / max(along, out, 1))
        _draw_symbol(canvas, kind, x + 700, cursor + 60, 0, scale=scale)
        canvas.add(
            f'<g transform="translate({x + 1600},{cursor}) scale(1,-1)">'
            f'<text class="legend-item">{html.escape(label)}</text></g>'
        )
        cursor -= line_height

    cursor -= 200
    for note in notes:
        wrapped = _wrap(note, 44)
        for index, piece in enumerate(wrapped):
            cls = "note-strong" if index == 0 and note.startswith("Not ") else "note"
            canvas.add(
                f'<g transform="translate({x + 300},{cursor}) scale(1,-1)">'
                f'<text class="{cls}">{html.escape(piece)}</text></g>'
            )
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


def write_svg(
    building: Building,
    path: str | Path,
    storey_index: int | None = None,
    sheet: str = "architectural",
    services: dict[int, object] | None = None,
    footprint=None,
    system: str = "metric",
) -> Path:
    """Write one sheet. `services` maps a storey index to its ServicesPlan."""
    path = Path(path)
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
        return _write_elevations(building, path)

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

        canvas.text(reference.centre.x + dx, title_y,
                    f"{storey.name} — {sheet.title()}", "title")

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

    width = int(canvas.maxx - canvas.minx) + margin * 2
    height = int(canvas.maxy - canvas.miny) + margin * 2
    offset_x = int(-canvas.minx) + margin
    offset_y = int(canvas.maxy) + margin

    body = "\n".join(canvas.parts)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="100%" style="max-width:100%;height:auto">'
        f"<style>{STYLE}</style>"
        f'<rect class="sheet" x="0" y="0" width="{width}" height="{height}"/>'
        f'<g transform="translate({offset_x},{offset_y}) scale(1,-1)">'
        f"{body}</g></svg>"
    )
    path.write_text(svg, encoding="utf-8")
    return path


def _write_elevations(building: Building, path: Path) -> Path:
    """All four elevations on one sheet, numbered from the street."""
    views = build_elevations(building)
    canvas = _Canvas()
    margin = 3500

    cursor = 0
    for view in views:
        width = max((l.x1 for l in view.roof + view.outline), default=0)
        left = min((l.x0 for l in view.roof + view.outline), default=0)
        dx = cursor - left
        _draw_elevation(canvas, view, dx)
        canvas.text(
            (left + width) // 2 + dx, -2400,
            f"{view.title}  1:100", "title",
        )
        cursor += (width - left) + 9000

    for index, note in enumerate(views[0].notes):
        canvas.add(
            f'<g transform="translate({0},{-4200 - index * 700}) scale(1,-1)">'
            f'<text class="elev-note">{html.escape(note)}</text></g>'
        )
        canvas.saw(0, 4200 + index * 700, 9000)

    width = int(canvas.maxx - canvas.minx) + margin * 2
    height = int(canvas.maxy - canvas.miny) + margin * 2
    body = "\n".join(canvas.parts)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="100%" style="max-width:100%;height:auto">'
        f"<style>{STYLE}</style>"
        f'<rect class="sheet" x="0" y="0" width="{width}" height="{height}"/>'
        f'<g transform="translate({int(-canvas.minx) + margin},'
        f'{int(canvas.maxy) + margin}) scale(1,-1)">{body}</g></svg>'
    )
    path.write_text(svg, encoding="utf-8")
    return path


def _bounds(storey):
    """The footprint of a storey, when the caller did not pass one."""
    from ..geom import Rect

    xs = [s.rect.x0 for s in storey.spaces] + [s.rect.x1 for s in storey.spaces]
    ys = [s.rect.y0 for s in storey.spaces] + [s.rect.y1 for s in storey.spaces]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
