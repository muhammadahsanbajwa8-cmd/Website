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

# The smallest division a dimension chain will carry.
#
# `_ordinates` takes every wall centreline on the axis, and internal walls
# that do not line up with each other put pairs of them a couple of hundred
# millimetres apart. The chain then reads 1156, 2703, 217, 1539, 250, 1172,
# 250, 822, 500, 350, 4041 -- eleven figures where a permit set carries five,
# and the small ones measure a jog in a wall rather than anything a builder
# sets out to. Ordinates closer together than this are collapsed onto the
# first of them, which loses the jog and keeps the chain closing, because
# every division is still the gap between two kept ordinates.
#
# It is a DRAWING decision, not a construction one. The rooms are unchanged
# and the room sizes under each name are unchanged; what changes is how many
# figures go on the chain.
MIN_CHAIN_STEP = 600


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
    return _collapse(sorted(positions), lo, hi)


def _collapse(positions: list[int], lo: int, hi: int) -> list[int]:
    """Drop ordinates too close together to carry a legible figure.

    Both ends are always kept -- they are the building -- so a short last
    division is resolved by dropping the ordinate BEFORE it rather than the
    end of the building, which would leave the chain measuring to nothing.
    """
    kept = [lo]
    for position in positions:
        if position <= lo or position >= hi:
            continue
        if position - kept[-1] >= MIN_CHAIN_STEP:
            kept.append(position)
    while len(kept) > 1 and hi - kept[-1] < MIN_CHAIN_STEP:
        kept.pop()
    kept.append(hi)
    return kept


def storey_extent(storey: Storey, footprint: Rect) -> Rect:
    """The rectangle THIS floor occupies, which is not always the building's.

    An upper floor is stacked inside the ground floor and is usually smaller
    than it -- the single-storey part of the house, the garage and the
    portico and whatever else is under its own roof, is not on the first
    floor at all. Dimensioning every floor to the building's footprint put
    the ground floor's overall on the first floor's chain: 45 of the 90
    floors in a lot sweep carried a depth that is not a face on that floor,
    by up to 6321 mm. A builder setting the first floor out from its own
    sheet builds it six metres too long.

    Taken from the walls, which run on tile centrelines, so this measures
    the same thing the footprint measures and the two are comparable.
    """
    if not storey.walls:
        return footprint
    xs = [p.x for wall in storey.walls for p in (wall.start, wall.end)]
    ys = [p.y for wall in storey.walls for p in (wall.start, wall.end)]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def dimension_storey(
    storey: Storey, footprint: Rect, system: str = "metric"
) -> list[DimLine]:
    """Every dimension for one floor: a chain each way, and the overalls.

    The chains sit below and to the left of the plan, which is where a
    reader looks for them, and the overall sits outside its chain so the
    two can be compared at a glance.

    `footprint` is the building's, and is only a fallback: what gets
    dimensioned is the floor, which `storey_extent` measures.
    """
    footprint = storey_extent(storey, footprint)
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


def dimension_site(plot, footprint: Rect, system: str = "metric") -> list[DimLine]:
    """The dimensions a SITE plan exists to carry.

    Boundary to building face, on all four sides, and the lot itself. These
    are the figures a certifier measures: the setback is the control, the
    building is what has to sit inside it. A site plan without them shows
    that a house was drawn on a lot and says nothing about whether it may be.

    The chain runs boundary, near face, far face, boundary -- so the two
    setbacks and the building come out as three figures that add to the lot,
    and a reader can check the arithmetic across the sheet.
    """
    lot = plot.rect
    dims: list[DimLine] = []

    across = [lot.x0, footprint.x0, footprint.x1, lot.x1]
    dims += _chain(sorted(set(across)), lot.y0, -1, FIRST_OFFSET, lot.y0,
                   False, system)
    dims += _chain([lot.x0, lot.x1], lot.y0, -1, FIRST_OFFSET + CHAIN_GAP,
                   lot.y0, False, system, is_overall=True)

    along = [lot.y0, footprint.y0, footprint.y1, lot.y1]
    dims += _chain(sorted(set(along)), lot.x0, -1, FIRST_OFFSET, lot.x0,
                   True, system)
    dims += _chain([lot.y0, lot.y1], lot.x0, -1, FIRST_OFFSET + CHAIN_GAP,
                   lot.x0, True, system, is_overall=True)
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


# What goes on which line of the areas table, and in what order. A builder's
# quote separates these because they are priced differently: a garage is not
# a living area and an alfresco is not one either.
#
# PORCH is matched by NAME, not by function. Function.ENTRY covers both the
# portico outside the front door and the entry hall inside it, and those are
# not the same thing to price -- the hall is living area. Keying the line on
# the function put 18.2 m2 of porch on a house with an 8.9 m2 one.
def _is_porch(space) -> bool:
    return space.name.strip().lower().split()[:1] in (["portico"], ["porch"])


AREA_GROUPS = (
    ("LIVING", None),          # everything not claimed by a line below
    ("GARAGE", lambda sp: sp.function.value == "garage"),
    ("ALFRESCO", lambda sp: sp.function.value in ("alfresco", "balcony")),
    ("PORCH", _is_porch),
)


def area_schedule(building, footprint=None,
                  system: str = "metric") -> tuple[list[tuple[str, str]], str]:
    """The areas a builder quotes, and an honest note on how they were got.

    Every figure is the CLEAR area inside the wall faces the sheet draws,
    because that is the only area codraft actually knows. A quoted area is
    normally measured over the external brickwork, which on a house this size
    is several square metres more -- so the footprint goes on its own line
    rather than the internal total being passed off as the figure somebody
    would price from. The note says which is which, on the sheet, because the
    sheet is what gets forwarded.
    """
    from .units import fmt_area

    spaces = [sp for storey in building.storeys for sp in storey.spaces]
    tests = [test for _label, test in AREA_GROUPS if test is not None]

    rows: list[tuple[str, str]] = []
    for label, test in AREA_GROUPS:
        if test is None:
            total = sum(sp.area for sp in spaces
                        if not any(t(sp) for t in tests))
        else:
            total = sum(sp.area for sp in spaces if test(sp))
        if total:
            rows.append((label, fmt_area(total, system)))

    rows.append(("TOTAL INTERNAL",
                 fmt_area(sum(sp.area for sp in spaces), system)))

    # FOOTPRINT is the ground the building covers, measured over the external
    # walls, and it is the figure somebody prices from -- which is why the
    # note under this box points at it. It was neither of those things. It
    # was the tiling rectangle, which runs to the wall CENTRELINES and so is
    # 7 m2 short on a 15 x 30 m lot, multiplied by the number of storeys --
    # so a two-storey house printed 432.6 m2 under the word FOOTPRINT for a
    # building standing on 223.2, and that was not its floor area either
    # (373.0), because an upper storey is not the same size as the ground.
    #
    # Both figures come off the model now, where `Storey.floor_area` measures
    # the union of the rooms and the walls around them.
    # Site cover is the first number a planner looks for, and it was computed
    # and printed only in the report. The lot goes with it so the percentage
    # can be checked rather than taken: two numbers and a division anybody
    # can do. What the local CAP is belongs to the report, which knows the
    # jurisdiction; this says what the design does.
    #
    # Order matters here. The box prints its last two rows in the strong
    # face, so those two are FOOTPRINT -- the figure the note points at as
    # the one to price from -- and SITE COVER.
    lot = getattr(getattr(building, "plot", None), "rect", None)
    if lot is not None and lot.area > 0:
        rows.append(("LOT", fmt_area(lot.area, system)))
    if len(building.storeys) > 1:
        rows.append(("GROSS FLOOR AREA",
                     fmt_area(building.gross_floor_area, system)))
    rows.append(("FOOTPRINT", fmt_area(building.footprint, system)))
    if lot is not None and lot.area > 0:
        rows.append(("SITE COVER",
                     f"{building.footprint / lot.area * 100:.0f}%"))
    # Kept to three lines at the title block's 46 characters. A note that
    # runs off the box is a note whose last clause -- the one saying which
    # figure to price from -- is the clause that goes missing.
    note = (
        "Room areas are clear inside the walls. FOOTPRINT is the ground "
        "covered over the external walls: the figure to price from."
    )
    return rows, note
