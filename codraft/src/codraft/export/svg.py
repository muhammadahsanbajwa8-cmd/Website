"""An SVG plan, for looking at without opening CAD.

Same geometry as the DXF, drawn for a screen. SVG's y axis points down and
a plan's points up, so everything is mirrored once, at the top, rather than
by negating coordinates all over the file.
"""

from __future__ import annotations

import html
import math
from pathlib import Path

from ..model import Building, Function
from ..units import fmt_area
from ._plan import storey_walls

STYLE = """
  .sheet { fill: #fbfaf7; }
  .plot { fill: none; stroke: #9aa0a6; stroke-width: 20; stroke-dasharray: 400 200; }
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
  .title { font: 700 460px system-ui, sans-serif; fill: #14110d; text-anchor: middle; }
"""


def _fill(function: Function) -> str:
    if function.is_circulation:
        return "room-circ"
    if function.is_wet:
        return "room-wet"
    return "room"


def write_svg(building: Building, path: str | Path, storey_index: int | None = None) -> Path:
    """Write one storey, or all of them side by side, as an SVG plan."""
    path = Path(path)
    storeys = (
        [s for s in building.storeys if s.index == storey_index]
        if storey_index is not None
        else building.storeys
    )
    if not storeys:
        raise ValueError(f"the building has no storey {storey_index}")

    plot = building.plot
    margin = 2500
    step = plot.rect.w + 6000
    width = step * len(storeys) - 6000 + margin * 2
    height = plot.rect.h + margin * 2 + 3000

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="100%" style="max-width:100%;height:auto">',
        f"<style>{STYLE}</style>",
        f'<rect class="sheet" x="0" y="0" width="{width}" height="{height}"/>',
        # One flip, so every coordinate below is ordinary plan geometry.
        f'<g transform="translate({margin},{height - margin}) scale(1,-1)">',
    ]

    def rect(r, cls: str, dx: int) -> str:
        return (f'<rect class="{cls}" x="{r.x + dx}" y="{r.y}" '
                f'width="{r.w}" height="{r.h}"/>')

    def seg(s, cls: str, dx: int) -> str:
        return (f'<line class="{cls}" x1="{s.x0 + dx}" y1="{s.y0}" '
                f'x2="{s.x1 + dx}" y2="{s.y1}"/>')

    for column, storey in enumerate(storeys):
        dx = column * step
        parts.append(rect(plot.rect, "plot", dx))
        parts.append(rect(plot.buildable, "setback", dx))

        for space in storey.spaces:
            parts.append(rect(space.rect, _fill(space.function), dx))

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
                    parts.append(
                        f'<line class="tread" x1="{r.x0 + dx}" y1="{r.y0 + offset}" '
                        f'x2="{r.x1 + dx}" y2="{r.y0 + offset}"/>'
                    )
                else:
                    parts.append(
                        f'<line class="tread" x1="{r.x0 + offset + dx}" y1="{r.y0}" '
                        f'x2="{r.x0 + offset + dx}" y2="{r.y1}"/>'
                    )

        for wall, drawn in storey_walls(storey):
            cls = "wall-ext" if wall.is_exterior else "wall-int"
            for s in drawn.faces:
                parts.append(seg(s, cls, dx))
            for s in drawn.jambs:
                parts.append(seg(s, "jamb", dx))
            for s in drawn.door_leaves:
                parts.append(seg(s, "door", dx))
            for a in drawn.door_swings:
                parts.append(_arc_path(a, dx))
            for s in drawn.window_lines:
                parts.append(seg(s, "glaz", dx))

        # Text is flipped back the right way up, one label at a time.
        for space in storey.spaces:
            c = space.rect.centre
            parts.append(
                f'<g transform="translate({c.x + dx},{c.y}) scale(1,-1)">'
                f'<text class="name" y="-60">{html.escape(space.name)}</text>'
                f'<text class="area" y="280">{html.escape(fmt_area(space.area))}</text>'
                f"</g>"
            )
        cx = plot.rect.centre.x + dx
        parts.append(
            f'<g transform="translate({cx},-1200) scale(1,-1)">'
            f'<text class="title">{html.escape(storey.name)}</text></g>'
        )

    parts.append("</g></svg>")
    path.write_text("\n".join(parts), encoding="utf-8")
    return path


def _arc_path(arc, dx: int) -> str:
    """A door swing, as an SVG arc segment."""
    x0 = arc.cx + dx + arc.radius * math.cos(math.radians(arc.start_deg))
    y0 = arc.cy + arc.radius * math.sin(math.radians(arc.start_deg))
    x1 = arc.cx + dx + arc.radius * math.cos(math.radians(arc.end_deg))
    y1 = arc.cy + arc.radius * math.sin(math.radians(arc.end_deg))
    sweep = 1 if (arc.end_deg - arc.start_deg) % 360 <= 180 else 0
    return (
        f'<path class="door" d="M {x0:.0f} {y0:.0f} '
        f'A {arc.radius} {arc.radius} 0 0 {sweep} {x1:.0f} {y1:.0f}"/>'
    )
