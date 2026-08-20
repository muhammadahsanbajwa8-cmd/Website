"""The layout solver: a corridor spine, with rooms either side of it.

Small buildings are not planned by cutting a rectangle into ever smaller
rectangles; they are planned around a circulation spine with rooms hung off
it. Doing the same here is not an aesthetic preference -- it is what makes
the result checkable. A room on a double-loaded corridor touches
circulation on one side, so it has a door onto an egress route, and touches
the perimeter on the other, so it has a window. Those two facts are what
half the world's residential code is about.

The solver is deterministic: the same program and plot give the same plan,
down to the millimetre, on every run.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..geom import Rect
from ..model import Function, Plot
from ..program import SpaceProgram, SpaceRequirement


class LayoutError(ValueError):
    """The program cannot be laid out on this plot."""


@dataclass(slots=True)
class Cell:
    """One room's tile, before walls are given any thickness.

    Tiles meet exactly, edge to edge. Wall centrelines are laid on those
    shared edges afterwards, which is why the tiling has to be exact rather
    than approximately right.
    """

    key: str          # unique on the storey, e.g. 'bedroom_2'
    name: str
    function: Function
    rect: Rect
    storey: int
    requirement: SpaceRequirement | None = None

    @property
    def area(self) -> int:
        return self.rect.area


@dataclass(slots=True)
class Layout:
    """The result, including everything that went wrong."""

    cells: list[Cell] = field(default_factory=list)
    envelope: Rect | None = None
    storeys: int = 1
    storey_height: int = 3000
    warnings: list[str] = field(default_factory=list)
    unsatisfied: list[str] = field(default_factory=list)

    def for_storey(self, index: int) -> list[Cell]:
        return [c for c in self.cells if c.storey == index]


# Rooms this narrow are unusable whatever a code says; the solver refuses to
# emit one rather than draw a corridor and call it a bedroom.
_ABSOLUTE_MIN_DIM = 900

# Tiles meet on wall centrelines, so a room loses half a wall on each side --
# about this much across each dimension. A program asks for clear space, so
# every minimum is inflated by this before it is used to size a tile.
# Without it, a corridor asked to be 1000 mm wide is built 885 mm wide and
# fails a rule the design never intended to break.
_WALL_ALLOWANCE = 115

# A room longer than this many times its width reads as a passage, not a
# room. Rooms that would come out this thin are paired across the band
# instead, two abreast.
_MAX_ASPECT = 2.2

# The widest frontage a two-band corridor plan can actually use.
#
# Band depth is (frontage - corridor) / 2, and that depth becomes the width of
# every room hanging off the passage. A bedroom wants to be roughly square, so
# a band much past 6.5 m deep gives rooms that are wide and shallow -- 12 m2
# arriving as 2.0 x 6.0, which is a corridor with a bed in it. Two 6.5 m bands
# and a passage is about 14 m, and measuring bears it out: capping here
# recovers 27 undersized rooms across the sweep, and capping tighter recovers
# none, because below this the shortfall is depth rather than shape.
#
# It is a limit of the CORRIDOR MODEL, not of houses. A genuinely wide house
# is planned as an L or a U around a courtyard, which this solver does not do;
# on a wide lot it builds narrower and deeper instead, which is what a project
# home does anyway.
MAX_FRONTAGE = 14000

# Rear yard kept clear of the building before the frontage cap gives way.
# Not a code figure -- the outdoor living requirement is a rule pack's job
# and varies by state. This is the point at which making the house narrower
# and deeper stops being worth what it costs the garden.
MIN_REAR_YARD = 7000


def _tile_width(req: SpaceRequirement) -> int:
    """The tile dimension that leaves `min_width` clear inside the walls."""
    return req.min_width + _WALL_ALLOWANCE if req.min_width else 0


def _tile_area(area: int) -> int:
    """The tile area that leaves `area` clear inside the walls."""
    if area <= 0:
        return 0
    side = math.isqrt(area)
    return (side + _WALL_ALLOWANCE) ** 2


def _target(req: SpaceRequirement) -> int:
    """The tile area to aim for: what was preferred, else what was required."""
    return _tile_area(max(req.min_area, req.preferred_area))

_GROUND_PREFERRED = {
    Function.ENTRY, Function.LIVING, Function.DINING, Function.KITCHEN,
    Function.GARAGE, Function.LOBBY, Function.RETAIL, Function.ASSEMBLY,
}
_UPPER_PREFERRED = {Function.BEDROOM}


def _instances(program: SpaceProgram) -> list[tuple[str, SpaceRequirement]]:
    """Expand `count` into individually placeable rooms."""
    out: list[tuple[str, SpaceRequirement]] = []
    for req in program.spaces:
        if req.count == 1:
            out.append((req.key, req))
        else:
            for i in range(1, req.count + 1):
                out.append((f"{req.key}_{i}", req))
    return out


def _assign_storeys(
    program: SpaceProgram, instances: list[tuple[str, SpaceRequirement]]
) -> dict[str, int]:
    """Decide which floor each room lands on.

    An explicit `storey` in the program wins outright. Otherwise rooms go
    where that kind of room usually goes -- living spaces down, bedrooms up
    -- and the remainder is balanced by area so no floor is left almost
    empty while another is overfull.
    """
    storeys = program.storeys
    assignment: dict[str, int] = {}
    if storeys == 1:
        return {key: 0 for key, _ in instances}

    loads = [0] * storeys
    flexible: list[tuple[str, SpaceRequirement]] = []

    for key, req in instances:
        if req.storey is not None:
            assignment[key] = req.storey
            loads[req.storey] += max(req.min_area, req.preferred_area)
        elif req.function in _GROUND_PREFERRED:
            assignment[key] = 0
            loads[0] += max(req.min_area, req.preferred_area)
        else:
            flexible.append((key, req))

    # Circulation is not distributed -- every floor needs its own.
    upper_first = sorted(
        flexible,
        key=lambda kr: (kr[1].function not in _UPPER_PREFERRED,
                        -max(kr[1].min_area, kr[1].preferred_area)),
    )
    for key, req in upper_first:
        if req.function.is_circulation:
            assignment[key] = 0
            continue
        candidates = range(1, storeys) if req.function in _UPPER_PREFERRED else range(storeys)
        floor = min(candidates, key=lambda i: loads[i])
        assignment[key] = floor
        loads[floor] += max(req.min_area, req.preferred_area)

    return assignment


def _replicate_circulation(
    program: SpaceProgram,
    instances: list[tuple[str, SpaceRequirement]],
    assignment: dict[str, int],
) -> list[tuple[str, SpaceRequirement, int]]:
    """Give every storey its own corridor and stair.

    A corridor on the ground floor does not serve the first floor, and a
    stair has to exist on both floors it connects. The program describes
    one of each; the solver puts one on each storey that needs it.
    """
    placed: list[tuple[str, SpaceRequirement, int]] = []
    circulation: list[tuple[str, SpaceRequirement]] = []

    for key, req in instances:
        if req.function.is_circulation and req.function is not Function.ENTRY:
            circulation.append((key, req))
        else:
            placed.append((key, req, assignment[key]))

    for key, req in circulation:
        for storey in range(program.storeys):
            # A stair is only needed on floors it leaves from.
            if req.function is Function.STAIR and storey == program.storeys - 1:
                if program.storeys > 1:
                    # The top floor still needs the stair's footprint arriving.
                    pass
            suffix = "" if program.storeys == 1 else f"_l{storey}"
            placed.append((f"{key}{suffix}", req, storey))

    return placed


# Which wing of the house a room belongs to. An Australian project home is
# not planned by area -- it is planned in zones: the garage and entry across
# the street frontage, the living zone through the middle to the alfresco,
# and the bedrooms down one side off the passage. Splitting the corridor's
# two bands by area instead mixes them, and a bedroom ends up behind a
# kitchen with no external wall.
_SLEEP_WING = {Function.BEDROOM}
_LIVE_WING = {
    Function.LIVING, Function.DINING, Function.KITCHEN,
    Function.ALFRESCO, Function.OFFICE,
}


def _wing(req: SpaceRequirement) -> str:
    """'sleep', 'live', or 'either' for the service rooms that follow."""
    if req.function in _SLEEP_WING:
        return "sleep"
    if req.function in _LIVE_WING:
        return "live"
    return "either"


def _band_split(
    rooms: list[tuple[str, SpaceRequirement]],
) -> tuple[list[tuple[str, SpaceRequirement]], list[tuple[str, SpaceRequirement]]]:
    """Hang rooms off both sides of the corridor, by zone where there is one.

    Bedrooms take one band and the living rooms the other, which is how these
    houses are actually planned. The service rooms -- bathroom, ensuite, WIR,
    laundry, WC, linen -- have no wing of their own, so they go wherever the
    balance needs them, and the ensuite and WIR follow the bedrooms because
    they open off one.

    Where a floor has only one wing on it (an upper floor of bedrooms, say),
    there is nothing to zone, so it falls back to longest-processing-time
    first: take the biggest room still unplaced and give it to whichever side
    has less. Greedy, but for the handful of rooms on one floor it lands
    within a few percent of a perfect split, instantly.
    """
    sleep = [(k, r) for k, r in rooms if _wing(r) == "sleep"]
    live = [(k, r) for k, r in rooms if _wing(r) == "live"]
    spare = [(k, r) for k, r in rooms if _wing(r) == "either"]

    if not sleep or not live:
        # Nothing to zone -- balance by area across everything.
        left: list[tuple[str, SpaceRequirement]] = []
        right: list[tuple[str, SpaceRequirement]] = []
        left_area = right_area = 0
        for key, req in sorted(rooms, key=lambda kr: -_target(kr[1])):
            target = _target(req) or 1
            if left_area <= right_area:
                left.append((key, req))
                left_area += target
            else:
                right.append((key, req))
                right_area += target
        return left, right

    left, right = sleep, live
    left_area = sum(_target(r) or 1 for _, r in left)
    right_area = sum(_target(r) or 1 for _, r in right)

    # An ensuite or a walk-in robe opens off a bedroom, not off the living
    # room. They belong to the sleep wing wherever it exists.
    bedside = {"ensuite", "wir", "bath", "bathroom", "linen"}
    follows = [kr for kr in spare if kr[0].split("_")[0] in bedside]
    spare = [kr for kr in spare if kr not in follows]
    for key, req in follows:
        left.append((key, req))
        left_area += _target(req) or 1

    for key, req in sorted(spare, key=lambda kr: -_target(kr[1])):
        target = _target(req) or 1
        if left_area <= right_area:
            left.append((key, req))
            left_area += target
        else:
            right.append((key, req))
            right_area += target
    return left, right


@dataclass(slots=True)
class _Row:
    """One slice across a band, holding one room or two side by side.

    Pairing is what keeps a small room from becoming a passage. A 4 m²
    bathroom in a 5.5 m deep band would be 5.5 m long and 730 mm wide if it
    took the full depth; put two of them abreast and both are close to
    square.
    """

    rooms: list[tuple[str, SpaceRequirement]]
    target: int
    depth: int = 0

    def min_span(self) -> int:
        """How long the row must be, whatever else happens.

        Both the narrowest dimension a room needs AND the length its area
        needs at this band depth. Flooring only on width is how a double
        garage that asked for 36 m² comes out at 21 -- wide enough on paper,
        and too short to put two cars in.
        """
        needed = _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE
        for _, req in self.rooms:
            needed = max(needed, _tile_width(req))
        if self.depth > 0:
            # Rooms sharing a row split the depth, so each needs its area
            # over its own share; one room to a row gets the lot.
            share = self.depth // max(1, len(self.rooms))
            for _, req in self.rooms:
                if req.min_area:
                    needed = max(needed, -(-_tile_area(req.min_area) // max(1, share)))
        return needed


def _group_rows(rooms: list[tuple[str, SpaceRequirement]], depth: int) -> list[_Row]:
    """Decide which rooms share a slice of the band with a neighbour."""
    rows: list[_Row] = []
    index = 0
    while index < len(rooms):
        key, req = rooms[index]
        target = _target(req) or 1
        span = target // max(1, depth)
        thin = span > 0 and depth / span > _MAX_ASPECT

        if thin and not req.solo and index + 1 < len(rooms):
            next_key, next_req = rooms[index + 1]
            if next_req.solo:
                rows.append(_Row([(key, req)], target, depth))
                index += 1
                continue
            next_target = _target(next_req) or 1
            next_span = next_target // max(1, depth)
            next_thin = next_span > 0 and depth / next_span > _MAX_ASPECT
            pair_depth_ok = (
                _tile_width(req) + _tile_width(next_req) <= depth
                and depth >= 2 * (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)
            )
            # Only one room in a pair touches the outside wall; the other is
            # against the corridor. So two rooms that both need daylight can
            # never share a slice -- one of them would come out windowless,
            # which is how a bedroom ended up in the middle of the plan.
            both_need_light = req.needs_exterior_wall and next_req.needs_exterior_wall
            if next_thin and pair_depth_ok and not both_need_light:
                rows.append(
                    _Row([(key, req), (next_key, next_req)],
                         target + next_target, depth)
                )
                index += 2
                continue

        rows.append(_Row([(key, req)], target, depth))
        index += 1
    return rows


def _apportion(spans: list[int], floors: list[int], total: int, warnings: list[str]) -> list[int]:
    """Fit a set of sizes into a fixed total without going under any floor.

    Anything below its floor is raised to it, and the shortfall is taken
    from whichever rows have slack, in proportion to how much they have.
    When there is not enough to go round the caller is told, because a plan
    that quietly ignores a minimum is worse than one that admits it cannot
    meet it.
    """
    sizes = list(spans)
    for _ in range(len(sizes) * 2 + 2):
        deficit = sum(max(0, f - s) for f, s in zip(floors, sizes))
        if deficit <= 0:
            break
        donors = [i for i, (s, f) in enumerate(zip(sizes, floors)) if s > f]
        slack = sum(sizes[i] - floors[i] for i in donors)
        if not donors or slack <= 0:
            break
        for i in donors:
            sizes[i] -= min(sizes[i] - floors[i], (sizes[i] - floors[i]) * deficit // slack)
        for i, (s, f) in enumerate(zip(sizes, floors)):
            sizes[i] = max(s, f)

    overrun = sum(sizes) - total
    if overrun > 0:
        # Under a centimetre is integer rounding closing the tiling, not a
        # squeeze anyone needs told about.
        if overrun > 10:
            warnings.append(
                f"A band is about {overrun / 1000:.1f} m short of what the rooms "
                "on it need. They were trimmed to fit and will not meet the "
                "sizes asked for."
            )
        # Take the excess from whatever sits above its own floor, most slack
        # first. Cutting to the absolute minimum instead would spare the rows
        # that happen to sort early and annihilate the ones that sort late.
        for i in sorted(range(len(sizes)), key=lambda i: -(sizes[i] - floors[i])):
            if overrun <= 0:
                break
            give = min(overrun, max(0, sizes[i] - floors[i]))
            sizes[i] -= give
            overrun -= give
        if overrun > 0:
            # The band is genuinely over-subscribed: no allocation gives every
            # row its floor. Shrink them all by the same proportion so the
            # shortfall is shared rather than landing on one room.
            gross = sum(sizes)
            scale = max(0, gross - overrun) / max(1, gross)
            sizes = [max(_ABSOLUTE_MIN_DIM, int(s * scale)) for s in sizes]
            slack_left = sum(sizes) - total
            for i in range(len(sizes)):
                if slack_left <= 0:
                    break
                give = min(slack_left, max(0, sizes[i] - _ABSOLUTE_MIN_DIM))
                sizes[i] -= give
                slack_left -= give
    elif overrun < 0 and sizes:
        # Spend the remainder on the largest row so the tiling closes exactly
        # on the band edge rather than leaving an unassigned sliver.
        sizes[max(range(len(sizes)), key=lambda i: sizes[i])] += -overrun
    return sizes


def _stack(
    rooms: list[tuple[str, SpaceRequirement]],
    band: Rect,
    along_y: bool,
    warnings: list[str],
    outer_low: bool = True,
) -> list[tuple[str, SpaceRequirement, Rect]]:
    """Lay rooms along a band, sized by area and floored by their minimums.

    `outer_low` says which edge of the band is the outside wall: True when it
    is the low edge (band.x for a vertical band, band.y for a horizontal
    one), False when the corridor is on that side instead. Only rows holding
    two rooms care, and they care a great deal -- the room on the corridor
    side has no external wall, so the one that needs a window has to take the
    outer half.
    """
    if not rooms:
        return []

    span_total = band.h if along_y else band.w
    depth = band.w if along_y else band.h
    if depth < _ABSOLUTE_MIN_DIM:
        warnings.append(
            f"A band is only {depth} mm deep, which cannot hold a usable room."
        )

    rows = _group_rows(rooms, depth)
    totals = sum(row.target for row in rows) or 1
    spans = [max(1, span_total * row.target // totals) for row in rows]
    floors = [row.min_span() for row in rows]
    spans = _apportion(spans, floors, span_total, warnings)

    placed: list[tuple[str, SpaceRequirement, Rect]] = []
    cursor = band.y if along_y else band.x
    for row, span in zip(rows, spans):
        if len(row.rooms) == 1:
            key, req = row.rooms[0]
            rect = (
                Rect(band.x, cursor, band.w, span)
                if along_y
                else Rect(cursor, band.y, span, band.h)
            )
            placed.append((key, req, rect))
        else:
            # Two abreast: split the band's depth between them by area.
            (key_a, req_a), (key_b, req_b) = row.rooms
            # The outer slot is the one with an external wall. Give it to
            # whichever of the two needs daylight; if neither does it makes no
            # difference, and _group_rows has already refused to pair two that
            # both do.
            if req_b.needs_exterior_wall and not req_a.needs_exterior_wall:
                (key_a, req_a), (key_b, req_b) = (key_b, req_b), (key_a, req_a)
            if not outer_low:
                # The low edge is the corridor here, so the outer room is the
                # second one placed. Swap so it still lands against the wall.
                (key_a, req_a), (key_b, req_b) = (key_b, req_b), (key_a, req_a)
            target_a = _target(req_a) or 1
            target_b = _target(req_b) or 1
            depth_a = depth * target_a // (target_a + target_b)
            depth_a = max(
                _tile_width(req_a) or _ABSOLUTE_MIN_DIM,
                min(depth - (_tile_width(req_b) or _ABSOLUTE_MIN_DIM), depth_a),
            )
            depth_b = depth - depth_a
            if along_y:
                placed.append((key_a, req_a, Rect(band.x, cursor, depth_a, span)))
                placed.append((key_b, req_b, Rect(band.x + depth_a, cursor, depth_b, span)))
            else:
                placed.append((key_a, req_a, Rect(cursor, band.y, span, depth_a)))
                placed.append((key_b, req_b, Rect(cursor, band.y + depth_a, span, depth_b)))
        cursor += span
    return placed


def _order_for_road(
    rooms: list[tuple[str, SpaceRequirement]], road_first: bool
) -> list[tuple[str, SpaceRequirement]]:
    """Put the entrance -- and the stair beside it -- at the road end."""
    def rank(item: tuple[str, SpaceRequirement]) -> int:
        function = item[1].function
        if function is Function.ENTRY:
            return 0
        if function is Function.STAIR:
            return 1
        if function is Function.LIVING:
            return 2
        return 5

    ordered = sorted(rooms, key=rank)
    # The entry, the stair and the living room are placed at the road end for
    # a reason -- the stair has to reach the entry, or the floor above it has
    # no route out. Only the ordinary rooms after them get reordered.
    head = [kr for kr in ordered if rank(kr) < 5]
    tail = _interleave_for_pairing([kr for kr in ordered if rank(kr) >= 5])
    ordered = head + tail
    return ordered if road_first else list(reversed(ordered))


def _interleave_for_pairing(
    rooms: list[tuple[str, SpaceRequirement]],
) -> list[tuple[str, SpaceRequirement]]:
    """Sit each room that needs a window next to one that does not.

    Rooms are paired across the band with their NEIGHBOUR in this list, and
    two rooms that both need daylight may not pair -- the inner one would have
    no external wall. Left in program order the bedrooms sit together and none
    of them can pair, so every bedroom takes a full slice of the band's length
    and a floor with four of them runs out of house. Interleaving them with
    the robes, ensuites and linen means each bedroom pairs with the service
    room that opens off it: bedroom against the outside wall, robe inboard,
    which is how these plans are drawn anyway.

    Only the ordinary rooms are passed here. The entry, stair and living room
    are placed at the road end by rank and must stay there: move the stair
    away from the entry and the floor above it has no route out.
    """
    lit = [kr for kr in rooms if kr[1].needs_exterior_wall]
    unlit = [kr for kr in rooms if not kr[1].needs_exterior_wall]
    if not lit or not unlit:
        return rooms

    out: list[tuple[str, SpaceRequirement]] = []
    while lit or unlit:
        if lit:
            out.append(lit.pop(0))
        if unlit:
            out.append(unlit.pop(0))
    return out


# Which rooms live across the street frontage. The template says so
# explicitly rather than being inferred from function, because a theatre
# and a living room are the same function and only one of them goes there.
def _is_front(req: SpaceRequirement) -> bool:
    return req.zone == "front"


def _front_zone(
    rooms: list[tuple[str, SpaceRequirement]],
    envelope: Rect,
    plot: Plot,
    warnings: list[str],
) -> tuple[
    list[tuple[str, SpaceRequirement]], Rect | None, Rect,
    list[tuple[str, SpaceRequirement]],
]:
    """Size the strip the garage, portico and entry take across the front.

    Returns the rooms bound for it, the strip, what is left behind it, and
    the rooms bound for that. Sizing only -- the rooms are placed later, by
    `_place_front`, because where the entry goes depends on where the passage
    behind it lands, and that is not known yet.

    A project home does not hang its garage off the same passage as the
    bedrooms -- the garage, the portico and the entry sit across the street
    frontage, and the living and sleeping zones are behind them. Modelling
    that is what lets a double garage be 5.4 by 6.0 m instead of whatever
    depth a side band happened to have left over.
    """
    front = [(k, r) for k, r in rooms if _is_front(r)]
    garage = next((r for _, r in front if r.function is Function.GARAGE), None)
    if garage is None or len(front) < 2:
        return [], None, envelope, rooms

    # The frontage carries these rooms side by side, so it can only take as
    # many as its width allows at a usable size. The template says a theatre
    # belongs across the front, and on a 16 m frontage it does; on a 10 m one,
    # behind the garage and the front door, there is nothing left for it and
    # it comes out 1.5 m wide. Send it back to the passage instead -- a
    # theatre off the hallway is an ordinary plan, a 1.5 m one is not.
    evicted: list[tuple[str, SpaceRequirement]] = []
    _KEEP = (Function.GARAGE, Function.ENTRY)
    while len(front) > 2:
        needed = sum(_tile_width(r) or _ABSOLUTE_MIN_DIM for _, r in front)
        if needed <= envelope.w:
            break
        movable = [kr for kr in front if kr[1].function not in _KEEP]
        if not movable:
            break
        # Give up the least insistent room first, largest of those, since it
        # is the one costing the frontage most.
        loose = max(movable, key=lambda kr: (kr[1].priority, _target(kr[1]) or 0))
        front.remove(loose)
        evicted.append(loose)
        warnings.append(
            f"{loose[1].name} was moved off the street frontage: at "
            f"{envelope.w} mm wide it cannot carry the garage, the entry and "
            f"{loose[1].name} at a usable size. It opens off the passage instead."
        )

    # The strip has to be deep enough for the garage, which is the room
    # with a dimension that cannot be negotiated.
    # Deep enough for the garage, which is the one room whose dimensions
    # cannot be negotiated, and no deeper -- every extra millimetre here is
    # taken from the living and sleeping zones behind.
    needed = _target(garage)
    width_share = max(_tile_width(garage), 5600)
    depth = max(6000 + _WALL_ALLOWANCE, -(-needed // max(1, width_share)))
    depth = min(depth, envelope.h // 3)

    # If the front rooms cannot fill the strip, it is wasted floor area and
    # the house is better off without one.
    front_area = sum(_target(r) or 0 for _, r in front)
    if front_area < envelope.w * depth * 0.75:
        depth = max(
            6000 + _WALL_ALLOWANCE, -(-front_area // max(1, envelope.w))
        )
        depth = min(depth, envelope.h // 3)
    if depth < 5000 or envelope.h - depth < _ABSOLUTE_MIN_DIM * 3:
        return [], None, envelope, rooms

    road_first = plot.road_side in ("south", "west")
    strip = (
        Rect(envelope.x, envelope.y, envelope.w, depth)
        if road_first
        else Rect(envelope.x, envelope.y1 - depth, envelope.w, depth)
    )
    remainder = (
        Rect(envelope.x, envelope.y + depth, envelope.w, envelope.h - depth)
        if road_first
        else Rect(envelope.x, envelope.y, envelope.w, envelope.h - depth)
    )

    rest = [(k, r) for k, r in rooms if not _is_front(r)] + evicted
    return front, strip, remainder, rest


def _place_front(
    front: list[tuple[str, SpaceRequirement]],
    strip: Rect,
    over: tuple[int, int] | None,
    warnings: list[str],
) -> list[Cell]:
    """Lay the front rooms across the strip, entry first if it must line up.

    `over` is the x range the passage behind occupies, when there is one. The
    entry is the only thing joining the street frontage to the rest of the
    house, so it has to sit over that range -- otherwise the passage runs
    into the back of the garage and the whole plan behind the front door has
    no route to an exit. Getting this wrong is not a cosmetic fault: every
    room on the floor then fails the rule that it can be walked out of.

    Where there is no passage to meet, the rooms simply stack across the
    frontage with the garage at one end.
    """
    entry = next(
        (kr for kr in front
         if kr[1].function is Function.ENTRY and kr[0].split("_")[0] == "entry"),
        next((kr for kr in front if kr[1].function is Function.ENTRY), None),
    )
    if over is None or entry is None:
        ordered = sorted(front, key=lambda kr: 0 if kr[1].function is Function.GARAGE else 1)
        return [
            Cell(key, req.name, req.function, rect, 0, req)
            for key, req, rect in _stack(ordered, strip, along_y=False, warnings=warnings)
        ]

    # The entry's slot: wide enough for itself, and never narrower than the
    # passage it has to hand onto.
    lo, hi = over
    others = [kr for kr in front if kr is not entry]
    slot_w = max(_tile_width(entry[1]) or 0, hi - lo, _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)
    if entry[1].min_area:
        slot_w = max(slot_w, -(-_tile_area(entry[1].min_area) // max(1, strip.h)))

    # Centre it on the passage, then slide it back inside the strip. Both
    # neighbours need room to exist, so the slot cannot sit flush to an end
    # unless there is nothing to put there.
    slot_x = (lo + hi) // 2 - slot_w // 2
    left_min = _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE if others else 0
    slot_x = max(strip.x + left_min, min(strip.x1 - slot_w, slot_x))
    if slot_x < strip.x:
        slot_x, slot_w = strip.x, min(slot_w, strip.w)

    left_w = slot_x - strip.x
    right_w = strip.x1 - (slot_x + slot_w)

    # The portico is the roofed bit in front of the door. It belongs against
    # the entry, not wherever there happened to be frontage going spare --
    # put it at the far end and the front door has no covered approach, and
    # nothing that comes through it can reach an exit.
    portico = next(
        (kr for kr in others
         if kr[1].function is Function.ENTRY and kr is not entry),
        None,
    )
    portico_rect: Rect | None = None
    if portico is not None:
        want = max(_tile_width(portico[1]) or 0, _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)
        if portico[1].min_area:
            want = max(want, -(-_tile_area(portico[1].min_area) // max(1, strip.h)))
        # Take it from the roomier side, and never so much that the side is
        # left unable to hold anything.
        on_left = left_w >= right_w
        available = (left_w if on_left else right_w)
        take = min(want, max(0, available - (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)))
        if take < _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE:
            take = min(want, available)
        if take > 0:
            if on_left:
                portico_rect = Rect(slot_x - take, strip.y, take, strip.h)
                left_w -= take
            else:
                portico_rect = Rect(slot_x + slot_w, strip.y, take, strip.h)
                slot_x_after = slot_x + slot_w + take
                right_w -= take
            others = [kr for kr in others if kr is not portico]
        else:
            portico = None

    # The garage takes whichever side can hold it; the rest follow on the
    # other, which is how these frontages actually read -- garage, front
    # door, then the theatre and the store.
    garage = next((kr for kr in others if kr[1].function is Function.GARAGE), None)
    left: list[tuple[str, SpaceRequirement]] = []
    right: list[tuple[str, SpaceRequirement]] = []
    if garage is not None:
        garage_w = _tile_width(garage[1]) or _ABSOLUTE_MIN_DIM
        if left_w >= garage_w and left_w >= right_w:
            left.append(garage)
        elif right_w >= garage_w:
            right.append(garage)
        elif left_w >= right_w:
            left.append(garage)
        else:
            right.append(garage)
    left_area = sum(_target(r) or 1 for _, r in left)
    right_area = sum(_target(r) or 1 for _, r in right)
    for key, req in sorted(
        (kr for kr in others if kr is not garage), key=lambda kr: -(_target(kr[1]) or 0)
    ):
        # Send each remaining room to the side with more room going spare,
        # measured against how much of that side is already spoken for.
        left_room = left_w * strip.h - left_area
        right_room = right_w * strip.h - right_area
        if (left_room >= right_room and left_w > 0) or right_w <= 0:
            left.append((key, req))
            left_area += _target(req) or 1
        else:
            right.append((key, req))
            right_area += _target(req) or 1

    placed: list[tuple[str, SpaceRequirement, Rect]] = [
        (entry[0], entry[1], Rect(slot_x, strip.y, slot_w, strip.h))
    ]
    if left and left_w > 0:
        placed += _stack(left, Rect(strip.x, strip.y, left_w, strip.h), False, warnings)
    right_x = slot_x + slot_w
    if portico_rect is not None and portico_rect.x >= slot_x + slot_w:
        right_x = portico_rect.x1
    if right and right_w > 0:
        placed += _stack(right, Rect(right_x, strip.y, right_w, strip.h), False, warnings)
    if portico is not None and portico_rect is not None:
        placed.append((portico[0], portico[1], portico_rect))
    for key, req in left if left_w <= 0 else []:
        warnings.append(f"{req.name} could not be fitted across the frontage.")
    return [
        Cell(key, req.name, req.function, rect, 0, req)
        for key, req, rect in placed
    ]


def _layout_storey(
    storey: int,
    rooms: list[tuple[str, SpaceRequirement]],
    envelope: Rect,
    plot: Plot,
    warnings: list[str],
) -> list[Cell]:
    """Place one floor: a front zone if there is a garage, then a corridor
    spine down the long axis with rooms either side of it."""
    if not rooms:
        return []

    front_rooms: list[tuple[str, SpaceRequirement]] = []
    strip: Rect | None = None
    if storey == 0:
        front_rooms, strip, envelope, rooms = _front_zone(
            rooms, envelope, plot, warnings
        )
        if not rooms:
            return _place_front(front_rooms, strip, None, warnings) if strip else []
    spine_x = strip.centre.x if strip is not None else None

    corridor = next((r for r in rooms if r[1].function is Function.CORRIDOR), None)
    others = [r for r in rooms if r is not corridor]

    # With one or two rooms a corridor is wasted floor area; slice instead.
    if corridor is None or len(others) <= 2:
        along_y = envelope.h >= envelope.w
        placed = _stack(rooms, envelope, along_y, warnings)
        front_cells = _place_front(front_rooms, strip, None, warnings) if strip else []
        return front_cells + [
            Cell(key, req.name, req.function, rect, storey, req)
            for key, req, rect in placed
        ]

    # The corridor runs the long way, so it reaches every room with the
    # least floor given over to walking -- unless there is a front zone, in
    # which case it must run back from the entry instead, whatever the
    # remainder's proportions say.
    corridor_vertical = envelope.h >= envelope.w
    if spine_x is not None:
        corridor_vertical = plot.road_side in ("south", "north")
    corridor_width = max(corridor[1].min_width, 1000) + _WALL_ALLOWANCE
    cross = envelope.w if corridor_vertical else envelope.h
    if corridor_width >= cross - 2 * _ABSOLUTE_MIN_DIM:
        corridor_width = max(1000, (cross - 2 * _ABSOLUTE_MIN_DIM) // 3)
        warnings.append(
            "The floor is narrow, so the corridor was reduced to "
            f"{corridor_width} mm to leave room either side. Check it against "
            "the corridor width rule for this jurisdiction."
        )

    left_rooms, right_rooms = _band_split(others)
    left_target = sum(_target(r) or 1 for _, r in left_rooms)
    right_target = sum(_target(r) or 1 for _, r in right_rooms)
    usable = cross - corridor_width
    run = envelope.h if corridor_vertical else envelope.w

    def _band_depth(band: list[tuple[str, SpaceRequirement]]) -> int:
        """How deep this side has to be before its rooms are usable.

        Deep enough to hold their area along the run, and never narrower than
        the widest room's own minimum. Without this the spine can be pulled
        hard against one side and leave a handful of rooms fighting over a
        couple of metres.
        """
        if not band:
            return 0
        area = sum(_target(r) or 0 for _, r in band)
        depth = -(-area // max(1, run))
        for _, r in band:
            depth = max(depth, _tile_width(r) or 0)
        return max(_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE, depth)

    left_target = sum(_target(r) or 1 for _, r in left_rooms)
    right_target = sum(_target(r) or 1 for _, r in right_rooms)
    usable = cross - corridor_width
    run = envelope.h if corridor_vertical else envelope.w

    def _band_depth(band: list[tuple[str, SpaceRequirement]]) -> int:
        """How deep this side has to be before its rooms are usable.

        Deep enough to hold their area along the run, and never narrower than
        the widest room's own minimum. Without this the spine can be pulled
        hard against one side and leave a handful of rooms fighting over a
        couple of metres.
        """
        if not band:
            return 0
        area = sum(_target(r) or 0 for _, r in band)
        depth = -(-area // max(1, run))
        for _, r in band:
            depth = max(depth, _tile_width(r) or 0)
        return max(_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE, depth)

    # Zoning decides which side a room belongs on; the run decides how many
    # a side can actually hold. Every room takes a slice of the band's LENGTH,
    # and rooms that need daylight cannot double up across its depth -- the
    # inner one would have no window. So a wing with more rooms than its run
    # can give a usable slice to has to shed some to the other side, or every
    # room on it comes out a metre and a half long. Minor bedrooms one side
    # and the master the other is how a real plan resolves exactly this.
    def _run_needed(band: list[tuple[str, SpaceRequirement]], depth: int) -> int:
        total = 0
        for _, r in band:
            area_run = -(-(_target(r) or 0) // max(1, depth))
            total += max(_tile_width(r) or _ABSOLUTE_MIN_DIM, area_run)
        return total

    left_target = sum(_target(r) or 1 for _, r in left_rooms)
    right_target = sum(_target(r) or 1 for _, r in right_rooms)
    min_left, min_right = _band_depth(left_rooms), _band_depth(right_rooms)
    balanced = usable * left_target // max(1, left_target + right_target)

    if min_left + min_right <= usable:
        # Both sides can be served. Start from the area-balanced split, then
        # slide the spine towards the entry if that still leaves both bands
        # workable — the entry alignment is a preference, not a licence to
        # starve a side.
        left_depth = balanced
        if spine_x is not None and corridor_vertical:
            left_depth = spine_x - envelope.x - corridor_width // 2
        left_depth = max(min_left, min(usable - min_right, left_depth))
    else:
        # Over-subscribed: no split gives both sides what they need. Divide in
        # proportion to what each needs, so the shortfall is shared instead of
        # the entry position handing one band everything.
        left_depth = round(usable * min_left / max(1, min_left + min_right))
        warnings.append(
            f"This floor needs about {(min_left + min_right) / 1000:.1f} m across "
            f"the corridor and the footprint gives {usable / 1000:.1f} m. Rooms "
            "either side were narrowed to fit."
        )
    left_depth = max(_ABSOLUTE_MIN_DIM, min(usable - _ABSOLUTE_MIN_DIM, left_depth))
    right_depth = usable - left_depth

    # A room that spans the full depth of a band is as deep as the band. Where
    # a band is much deeper than its rooms want to be, they come out the shape
    # of a corridor -- plenty of area, and 1.7 m across. Rooms pair across the
    # depth to avoid that, but two rooms that both need a window cannot pair,
    # so a wing of bedrooms runs out of partners. That is the limit of a
    # single spine: a house much past 14 m wide wants two of them, or an L.
    # Say so rather than draw the result and leave it to be noticed.
    for band, band_depth, side in ((left_rooms, left_depth, "one"),
                                   (right_rooms, right_depth, "the other")):
        lit = [r for _, r in band if r.needs_exterior_wall]
        if not lit or band_depth <= 0:
            continue
        wanted = min(
            (_target(r) // max(1, _tile_width(r) or _ABSOLUTE_MIN_DIM)) for r in lit
        )
        if wanted and band_depth > wanted * 2:
            warnings.append(
                f"The band on {side} side of the passage is {band_depth} mm "
                f"deep and its rooms want about {wanted} mm. They span it "
                "anyway, so they come out long and narrow. This is the limit "
                "of a single spine: a house this wide wants a second passage "
                "or an L-shaped plan."
            )

    road_first = plot.road_side in ("south", "west")
    left_rooms = _order_for_road(left_rooms, road_first)
    right_rooms = _order_for_road(right_rooms, road_first)

    cells: list[Cell] = []
    if corridor_vertical:
        left_band = Rect(envelope.x, envelope.y, left_depth, envelope.h)
        corridor_rect = Rect(envelope.x + left_depth, envelope.y, corridor_width, envelope.h)
        right_band = Rect(corridor_rect.x1, envelope.y, right_depth, envelope.h)
        # The left band's outside wall is its low edge; the right band's is
        # its high edge, because the corridor is on its low side.
        placed = _stack(left_rooms, left_band, True, warnings, outer_low=True)
        placed += _stack(right_rooms, right_band, True, warnings, outer_low=False)
    else:
        left_band = Rect(envelope.x, envelope.y, envelope.w, left_depth)
        corridor_rect = Rect(envelope.x, envelope.y + left_depth, envelope.w, corridor_width)
        right_band = Rect(envelope.x, corridor_rect.y1, envelope.w, right_depth)
        placed = _stack(left_rooms, left_band, False, warnings, outer_low=True)
        placed += _stack(right_rooms, right_band, False, warnings, outer_low=False)

    for key, req, rect in placed:
        cells.append(Cell(key, req.name, req.function, rect, storey, req))
    cells.append(
        Cell(corridor[0], corridor[1].name, Function.CORRIDOR, corridor_rect, storey, corridor[1])
    )

    # Now the passage is fixed, the frontage can be set out around it, with
    # the front door over the passage rather than wherever it happened to
    # land beside the garage.
    front_cells: list[Cell] = []
    if strip is not None:
        meets = (
            (corridor_rect.x, corridor_rect.x1)
            if corridor_vertical
            else None
        )
        front_cells = _place_front(front_rooms, strip, meets, warnings)
    return front_cells + cells


def _footprint(
    envelope: Rect,
    needed: int,
    plot: Plot,
    max_footprint: int | None,
    warnings: list[str],
) -> Rect:
    """Choose how much of the envelope to actually build on.

    Filling the envelope because it happens to be there is how a three-bed
    house ends up with a fifty square metre living room. The building is
    sized to what the program asks for, then placed against the road, so
    the open ground it leaves lands at the rear where a garden or a yard
    belongs -- and so site coverage stays a number the design chose rather
    than a number the plot imposed.
    """
    cap = envelope.area
    if max_footprint is not None and max_footprint < cap:
        cap = max_footprint
        if needed > max_footprint:
            warnings.append(
                f"The program needs about {needed / 1e6:.0f} m² per floor but "
                f"coverage rules here cap the footprint at {max_footprint / 1e6:.0f} m². "
                "The plan was built to the cap; consider another storey."
            )
    area = min(max(needed, 1), cap)
    if area >= envelope.area:
        return envelope

    # Build to the side setbacks and control the depth. Scaling the whole
    # envelope down proportionally makes a house as narrow as the block is
    # deep -- 11 m wide and 22 m long on a block where a real project home
    # is 13.6 m wide and 25 m long. Frontage is the dimension a plan wants,
    # because rooms hang off a spine that runs the depth.
    width = min(envelope.w, MAX_FRONTAGE)
    depth = -(-area // max(1, width))

    # The frontage cap is a preference, and the rear yard outranks it. Going
    # narrower makes the house deeper, and depth comes straight out of the
    # back garden -- which is where the outdoor living the R-Codes require
    # goes, and where a pool goes if there is one. So where the capped width
    # would push the building past the yard the block can spare, widen back
    # towards the envelope until it fits. Rooms that are slightly wide beat a
    # house with no garden behind it.
    if depth > envelope.h - MIN_REAR_YARD and envelope.w > width:
        for candidate in range(width, envelope.w + 1, 250):
            if -(-area // candidate) <= envelope.h - MIN_REAR_YARD:
                width, depth = candidate, -(-area // candidate)
                break
        else:
            width = envelope.w
            depth = -(-area // max(1, width))
    if depth > envelope.h:
        # Too deep for the block: give back some frontage and try again.
        depth = envelope.h
        width = min(envelope.w, -(-area // max(1, depth)))
    width = max(_ABSOLUTE_MIN_DIM * 2, min(envelope.w, width))
    depth = max(_ABSOLUTE_MIN_DIM * 2, min(envelope.h, depth))

    # Push the building up against the road frontage; the slack falls behind.
    if plot.road_side == "south":
        return Rect(envelope.x, envelope.y, width, depth)
    if plot.road_side == "north":
        return Rect(envelope.x, envelope.y1 - depth, width, depth)
    if plot.road_side == "west":
        return Rect(envelope.x, envelope.y, width, depth)
    return Rect(envelope.x1 - width, envelope.y, width, depth)


def solve(
    program: SpaceProgram, plot: Plot, max_footprint: int | None = None
) -> Layout:
    """Lay the program out on the plot's buildable envelope.

    `max_footprint` is how a jurisdiction's site coverage limit reaches the
    solver. Passing it means the plan is built within the limit rather than
    built freely and failed afterwards -- the rule engine still checks it,
    but on a design that was trying to comply.
    """
    envelope = plot.buildable
    if envelope.w <= 0 or envelope.h <= 0:
        raise LayoutError(
            "The setbacks leave nothing to build on: the plot is "
            f"{plot.rect.w}x{plot.rect.h} mm and the setbacks consume all of it."
        )
    if envelope.short_side < _ABSOLUTE_MIN_DIM * 2:
        raise LayoutError(
            f"The buildable envelope is only {envelope.short_side} mm across, "
            "which is too narrow for rooms either side of any circulation."
        )

    layout = Layout(
        envelope=envelope,
        storeys=program.storeys,
        storey_height=program.storey_height,
    )

    instances = _instances(program)
    assignment = _assign_storeys(program, instances)
    placed = _replicate_circulation(program, instances, assignment)

    # The footprint is shared by every storey -- floors stack, so the ground
    # floor cannot be smaller than the one above it.
    needed = max(
        (
            sum(_target(req) or 0 for _, req, s in placed if s == storey)
            for storey in range(program.storeys)
        ),
        default=0,
    )
    # Rooms do not tile a rectangle perfectly. Bands come out a little deeper
    # than the rooms on them strictly need, rows leave slivers, and every
    # tile gives up half a wall on each side. Asking for exactly the sum of
    # the rooms guarantees every one of them is squeezed; this is the
    # allowance that stops a twenty-room program shrinking its living room
    # by a third.
    needed = int(needed * 1.14)
    footprint = _footprint(envelope, needed, plot, max_footprint, layout.warnings)
    layout.envelope = footprint

    for storey in range(program.storeys):
        rooms = [(key, req) for key, req, s in placed if s == storey]
        if not rooms:
            layout.warnings.append(f"Storey {storey} has no rooms assigned to it.")
            continue
        asked = sum(_target(req) or 0 for _, req in rooms)
        # A percent either way is rounding, not a squeeze worth reporting.
        if asked > footprint.area * 101 // 100:
            over = (asked - footprint.area) / 1e6
            layout.warnings.append(
                f"Storey {storey} asks for {asked / 1e6:.1f} m² but the footprint "
                f"gives {footprint.area / 1e6:.1f} m² -- {over:.1f} m² over. "
                "Rooms were scaled down proportionally."
            )
        layout.cells.extend(
            _layout_storey(storey, rooms, footprint, plot, layout.warnings)
        )

    for cell in layout.cells:
        req = cell.requirement
        if req is None:
            continue
        clear_area = max(0, cell.area - _WALL_ALLOWANCE * (cell.rect.w + cell.rect.h))
        if req.min_area and clear_area < req.min_area:
            layout.unsatisfied.append(
                f"{cell.name} is about {clear_area / 1e6:.1f} m² clear; "
                f"{req.min_area / 1e6:.1f} m² was asked for."
            )
        clear_width = cell.rect.short_side - _WALL_ALLOWANCE
        if req.min_width and clear_width < req.min_width:
            layout.unsatisfied.append(
                f"{cell.name} is about {clear_width} mm across; "
                f"{req.min_width} mm was asked for."
            )

    return layout
