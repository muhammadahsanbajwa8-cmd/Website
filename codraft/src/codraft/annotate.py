"""Dimensions.

A plan without dimensions is a picture. The builder needs numbers, and the
numbers have to chain: each run of dimensions across a face must add up to
the overall, or the drawing contradicts itself on site.

Everything here is derived from the wall centrelines the solver produced, so
the dimensions cannot drift from the geometry -- they are the geometry, read
along an axis. Chains are checked to close before they are returned.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .geom import Rect
from .model import Storey

# How far off the building the first chain sits, and the gap between chains.
FIRST_OFFSET = 1200
CHAIN_GAP = 900
TICK = 160          # length of the 45-degree architectural slash
WITNESS_GAP = 120   # the witness line stops short of the thing it measures
WITNESS_OVERRUN = 180


@dataclass(slots=True)
class Segment:
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass(slots=True)
class DimLine:
    """One dimension: its line, witnesses, ticks and the number."""

    line: Segment
    witness: list[Segment] = field(default_factory=list)
    ticks: list[Segment] = field(default_factory=list)
    text: str = ""
    text_x: int = 0
    text_y: int = 0
    vertical: bool = False
    is_overall: bool = False


def format_mm(value: int, system: str = "metric") -> str:
    """A dimension as it is written on a drawing.

    Metric construction drawings carry whole millimetres with no unit
    suffix -- 3435, not 3.435 m -- because the unit is stated once in the
    title block and a decimal point is the easiest thing to misread on a
    dusty print.
    """
    if system == "imperial":
        total_inches = value / 25.4
        feet = int(total_inches // 12)
        inches = total_inches - feet * 12
        return f"{feet}'-{inches:.0f}\""
    return str(int(round(value)))


def _ticks_at(x: int, y: int, vertical: bool) -> Segment:
    """The 45-degree slash that marks where a dimension starts or stops."""
    half = TICK // 2
    if vertical:
        return Segment(x - half, y - half, x + half, y + half)
    return Segment(x - half, y - half, x + half, y + half)


def _chain(
    positions: list[int],
    fixed: int,
    direction: int,
    offset: int,
    span_from: int,
    vertical: bool,
    system: str,
    is_overall: bool = False,
) -> list[DimLine]:
    """Build one run of dimensions along an axis.

    `positions` are the ordinates being dimensioned, `fixed` is the face
    they are measured off, and `direction` is -1 or +1 for which side the
    dimension line sits on.
    """
    out: list[DimLine] = []
    line_at = fixed + direction * offset

    for start, end in zip(positions, positions[1:]):
        if end - start <= 0:
            continue
        if vertical:
            line = Segment(line_at, start, line_at, end)
            witness = [
                Segment(span_from + direction * WITNESS_GAP, p,
                        line_at + direction * WITNESS_OVERRUN, p)
                for p in (start, end)
            ]
            text_x, text_y = line_at, (start + end) // 2
        else:
            line = Segment(start, line_at, end, line_at)
            witness = [
                Segment(p, span_from + direction * WITNESS_GAP,
                        p, line_at + direction * WITNESS_OVERRUN)
                for p in (start, end)
            ]
            text_x, text_y = (start + end) // 2, line_at

        out.append(
            DimLine(
                line=line,
                witness=witness,
                ticks=[
                    _ticks_at(line_at if vertical else start,
                              start if vertical else line_at, vertical),
                    _ticks_at(line_at if vertical else end,
                              end if vertical else line_at, vertical),
                ],
                text=format_mm(end - start, system),
                text_x=text_x,
                text_y=text_y,
                vertical=vertical,
                is_overall=is_overall,
            )
        )
    return out


def _ordinates(storey: Storey, footprint: Rect, vertical_walls: bool) -> list[int]:
    """The wall positions worth dimensioning along one axis.

    Only walls that actually divide the plan across that axis are taken --
    a stub of wall that does not run the depth of the building would put a
    dimension on the drawing that no one can measure to on site.
    """
    lo, hi = (
        (footprint.x0, footprint.x1) if vertical_walls else (footprint.y0, footprint.y1)
    )
    positions = {lo, hi}
    for wall in storey.walls:
        if wall.vertical != vertical_walls:
            continue
        position = wall.start.x if vertical_walls else wall.start.y
        if lo < position < hi:
            positions.add(position)
    return sorted(positions)


def dimension_storey(
    storey: Storey, footprint: Rect, system: str = "metric"
) -> list[DimLine]:
    """Every dimension for one floor: a chain each way, and the overalls.

    The chains sit below and to the left of the plan, which is where a
    reader looks for them, and the overall sits outside its chain so the
    two can be compared at a glance.
    """
    dims: list[DimLine] = []

    # Along the bottom: the vertical walls, then the overall width.
    xs = _ordinates(storey, footprint, vertical_walls=True)
    dims += _chain(xs, footprint.y0, -1, FIRST_OFFSET, footprint.y0, False, system)
    dims += _chain(
        [footprint.x0, footprint.x1], footprint.y0, -1, FIRST_OFFSET + CHAIN_GAP,
        footprint.y0, False, system, is_overall=True,
    )

    # Up the left-hand side: the horizontal walls, then the overall depth.
    ys = _ordinates(storey, footprint, vertical_walls=False)
    dims += _chain(ys, footprint.x0, -1, FIRST_OFFSET, footprint.x0, True, system)
    dims += _chain(
        [footprint.y0, footprint.y1], footprint.x0, -1, FIRST_OFFSET + CHAIN_GAP,
        footprint.x0, True, system, is_overall=True,
    )
    return dims


def chains_close(dims: list[DimLine], footprint: Rect) -> list[str]:
    """Check every chain adds up to its overall.

    This is the one arithmetic error a set of drawings must never contain,
    because it is discovered by a builder with a tape measure rather than by
    anyone in the office.
    """
    problems: list[str] = []
    for vertical, overall in ((False, footprint.w), (True, footprint.h)):
        run = [d for d in dims if d.vertical is vertical and not d.is_overall]
        total = sum(
            abs(d.line.y1 - d.line.y0) if vertical else abs(d.line.x1 - d.line.x0)
            for d in run
        )
        if run and total != overall:
            axis = "depth" if vertical else "width"
            problems.append(
                f"The {axis} dimensions add up to {total} mm but the building "
                f"is {overall} mm. The chain does not close."
            )
    return problems


def room_dimension_text(space, system: str = "metric") -> str:
    """The `3435 x 4009` a room carries under its name."""
    return (
        f"{format_mm(space.rect.w, system)} x {format_mm(space.rect.h, system)}"
    )
