"""From tiles to walls, doors and windows.

The solver leaves an exact tiling of the envelope. This module reads the
adjacencies in that tiling and gives them substance: where two tiles meet
there is an interior wall, where a tile meets open air there is an exterior
wall, and where a room meets circulation there is a doorway.

Sizes here -- a 900 mm door leaf, a window at 15% of floor area -- are
ordinary practice chosen to clear most codes comfortably. They are starting
points, not permissions. The rule engine checks them afterwards against the
jurisdiction that actually applies, and will say so when a default is not
enough.
"""

from __future__ import annotations

import itertools
import math

from ..courses import (
    WET_SILL_COURSES,
    WINDOW_HEAD_COURSES,
    WINDOW_SILL_COURSES,
    course_level,
    snap_to_course,
)
from ..geom import EPS, Point, Rect
from ..model import (
    Building,
    Function,
    Opening,
    OpeningKind,
    Plot,
    Roof,
    Space,
    Stair,
    Storey,
    Wall,
    WallKind,
)
from ..program import SpaceProgram
from .site import place_driveway
from .solver import Cell, Layout

EXTERIOR_THICKNESS = 230   # one brick, rendered both faces
INTERIOR_THICKNESS = 115   # half brick
PARTY_THICKNESS = 230

# Construction systems, because a wall's thickness is regional practice and
# it changes every room dimension in the plan. Perth builds double brick;
# the eastern states build brick veneer over a frame. Taking one for the
# other puts every room out by 30 to 40 mm, which is enough to fail a
# minimum that the design would otherwise have met.
# The double-brick figures are read off a Redink permit set, which states
# it outright: "external walls consists of 230mm wide cavity brick const...
# external leaf & 90mm internal leaf". Internal walls are the 90 mm leaf,
# dry lined -- the lining adds about 20 mm and is not drawn, which is why a
# survey of those drawings recovers 90 mm.
CONSTRUCTION = {
    "solid_masonry":  {"exterior": 230, "interior": 115},
    "double_brick":   {"exterior": 230, "interior": 90},
    "brick_veneer":   {"exterior": 240, "interior": 90},
    "timber_frame":   {"exterior": 200, "interior": 90},
    "steel_frame":    {"exterior": 200, "interior": 90},
}

# Structural door widths. The clear width a code measures is narrower by the
# leaf thickness -- see Opening.clear_width.
DOOR_WIDTHS = {
    Function.BATHROOM: 810,
    Function.WC: 810,
    Function.STORAGE: 760,
    Function.UTILITY: 760,
}
DEFAULT_DOOR_WIDTH = 915
ENTRY_DOOR_WIDTH = 1000
# A 2040 leaf in a frame wants about 2100 to the head -- but 2100 is not a
# whole course, so the head is snapped UP to 25c. Up, never down: a head laid
# a course low is a door that does not fit.
DOOR_HEIGHT = snap_to_course(2100, plate=0)   # 25c = 2150

# Below this an opening is not a door anyone can use, whatever a wall's
# length says. It is not a code figure -- the NCC sets no minimum width for
# an ordinary door in a house -- it is the point at which the solver stops
# pretending and says the room needs re-planning.
DOOR_MIN_STRUCTURAL = 720

# In anything but a house, every door is on somebody's way out, and egress
# rules apply to all of them rather than to the front door alone. A store
# cupboard sized like a house's fails IBC 1010.1.1 the moment it is drawn in
# an office, so non-residential work starts from a wider leaf.
NON_RESIDENTIAL_MIN_DOOR = 965

# Openings are set out in brick courses, not round millimetres. A bricklayer
# builds to courses, so a head called up at 2100 gets laid at 24c and finishes
# at 2064, or at 25c and finishes at 2150 -- and which one it is decides where
# the lintel bears. Giving the course is giving the answer; giving 2100 hands
# the trade a decision it should not have to make.
WINDOW_HEAD = course_level(WINDOW_HEAD_COURSES)      # 25c = 2150
WINDOW_SILL = course_level(WINDOW_SILL_COURSES)      # 10c = 860
WET_WINDOW_WIDTH = 600
WET_WINDOW_SILL = course_level(WET_SILL_COURSES)     # 18c = 1548
WET_WINDOW_HEIGHT = WINDOW_HEAD - WET_WINDOW_SILL    #  7c =  602

# The widest single window unit worth drawing. Past this a window is made and
# delivered as two units with a mullion or a masonry pier between them, and
# drawing one 5 m opening instead hides both the pier and the lintel span it
# creates. Practical manufacture, not a code figure.
MAX_WINDOW_UNIT = 2400

# Masonry between two openings in the same wall. Kept so the units read as
# units on the elevation and so there is something for the lintels to bear
# on. The engineer sets what a pier must actually be.
WINDOW_PIER = 450

# Glazing as a share of floor area. Most codes land between 8% and 12% for
# daylight; 15% leaves headroom and is what a designer would draw anyway.
GLAZING_RATIO = 0.15

# Codes measure the LIGHT-TRANSMITTING area; the model carries the structural
# opening, and a frame eats into it. Sizing openings with this allowance gives
# the glass a chance of meeting the requirement the frame is measured against.
FRAME_ALLOWANCE = 0.85

# Stair defaults, kept comfortable. The riser actually used is derived from
# the storey height, and the going from the space available, so both are
# facts about the design rather than assumptions -- and both get checked.
TARGET_RISER = 175
MIN_GOING = 250
LANDING_DEPTH = 900
# Codes put a floor under the landing, not at 900. When a stair is a little
# short of the run its going needs, taking the landing down towards that
# floor is what a designer does before redrawing the plan.
MIN_LANDING = 750


def _interval_overlap(a0: int, a1: int, b0: int, b1: int) -> tuple[int, int] | None:
    lo, hi = max(a0, b0), min(a1, b1)
    return (lo, hi) if hi - lo > EPS else None


def _subtract(span: tuple[int, int], covered: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """What is left of a span once the covered parts are removed."""
    remaining = [span]
    for c0, c1 in sorted(covered):
        next_remaining: list[tuple[int, int]] = []
        for r0, r1 in remaining:
            if c1 <= r0 or c0 >= r1:
                next_remaining.append((r0, r1))
                continue
            if c0 > r0:
                next_remaining.append((r0, c0))
            if c1 < r1:
                next_remaining.append((c1, r1))
        remaining = next_remaining
    return [(a, b) for a, b in remaining if b - a > EPS]


def _walls_for_storey(
    cells: list[Cell],
    storey_index: int,
    height: int,
    exterior_mm: int = EXTERIOR_THICKNESS,
    interior_mm: int = INTERIOR_THICKNESS,
) -> tuple[list[Wall], dict[tuple[str, str], str]]:
    """Every wall on one floor, and an index of which rooms each separates."""
    walls: list[Wall] = []
    between: dict[tuple[str, str], str] = {}
    counter = itertools.count(1)

    def wall_id() -> str:
        return f"W{storey_index}-{next(counter):03d}"

    # Interior walls: one per pair of tiles that share a face.
    for a, b in itertools.combinations(cells, 2):
        edge = a.rect.shared_edge(b.rect)
        if edge is None:
            continue
        kind = WallKind.INTERIOR
        wall = Wall(
            id=wall_id(),
            start=edge[0],
            end=edge[1],
            thickness=interior_mm,
            kind=kind,
            storey=storey_index,
            height=height,
            separates=(a.key, b.key),
        )
        walls.append(wall)
        between[(a.key, b.key)] = wall.id
        between[(b.key, a.key)] = wall.id

    # Exterior walls: the parts of a tile's edge that no neighbour covers.
    for cell in cells:
        rect = cell.rect
        faces = (
            ("left", rect.x0, (rect.y0, rect.y1), True),
            ("right", rect.x1, (rect.y0, rect.y1), True),
            ("bottom", rect.y0, (rect.x0, rect.x1), False),
            ("top", rect.y1, (rect.x0, rect.x1), False),
        )
        for _, position, span, vertical in faces:
            covered: list[tuple[int, int]] = []
            for other in cells:
                if other is cell:
                    continue
                o = other.rect
                if vertical:
                    if abs(o.x1 - position) > EPS and abs(o.x0 - position) > EPS:
                        continue
                    overlap = _interval_overlap(span[0], span[1], o.y0, o.y1)
                else:
                    if abs(o.y1 - position) > EPS and abs(o.y0 - position) > EPS:
                        continue
                    overlap = _interval_overlap(span[0], span[1], o.x0, o.x1)
                if overlap:
                    covered.append(overlap)
            for lo, hi in _subtract(span, covered):
                start = Point(position, lo) if vertical else Point(lo, position)
                end = Point(position, hi) if vertical else Point(hi, position)
                walls.append(
                    Wall(
                        id=wall_id(),
                        start=start,
                        end=end,
                        thickness=exterior_mm,
                        kind=WallKind.EXTERIOR,
                        storey=storey_index,
                        height=height,
                        separates=(cell.key,),
                    )
                )

    return walls, between


def _clear_rect(cell: Cell, walls: list[Wall]) -> Rect:
    """The room inside its walls -- what a code measures when it says 'area'.

    Tiles meet on wall centrelines, so each room gives up half the thickness
    of every wall around it. Reporting the tile area instead would overstate
    every room in the building by a few percent, which is exactly the kind
    of error that clears a minimum on paper and fails it on site.
    """
    rect = cell.rect
    sides = {"left": 0, "right": 0, "bottom": 0, "top": 0}
    for wall in walls:
        if cell.key not in wall.separates:
            continue
        half = wall.thickness // 2
        if wall.vertical:
            if abs(wall.start.x - rect.x0) <= EPS:
                sides["left"] = max(sides["left"], half)
            elif abs(wall.start.x - rect.x1) <= EPS:
                sides["right"] = max(sides["right"], half)
        else:
            if abs(wall.start.y - rect.y0) <= EPS:
                sides["bottom"] = max(sides["bottom"], half)
            elif abs(wall.start.y - rect.y1) <= EPS:
                sides["top"] = max(sides["top"], half)
    return rect.inset_sides(sides["left"], sides["bottom"], sides["right"], sides["top"])


def _centre_opening(wall: Wall, width: int) -> int:
    """Offset that centres an opening on its wall, keeping a sane reveal."""
    usable = wall.length - 300  # 150 mm of wall either side, minimum
    if usable <= 0:
        return 0
    width = min(width, usable)
    return max(0, (wall.length - width) // 2)


def _openings_for_storey(
    cells: list[Cell],
    walls: list[Wall],
    between: dict[tuple[str, str], str],
    storey_index: int,
    plot: Plot,
    clear: dict[str, Rect],
    warnings: list[str],
    use: str = "residential",
    design: dict | None = None,
) -> list[Opening]:
    """Doors onto circulation, a front door, and windows where light is due."""
    design = design or {}
    # A code states the CLEAR width; the leaf and its stop come off the
    # structural opening, so the opening has to be wider by that much.
    required_clear = int(design.get("door_clear_width_mm", 0) or 0)
    glazing = float(design.get("glazing_ratio", GLAZING_RATIO))
    ventilation = float(design.get("ventilation_ratio", 0) or 0)
    openable = float(design.get("openable_fraction", 0.5))
    openings: list[Opening] = []
    counter = itertools.count(1)
    by_key = {c.key: c for c in cells}
    wall_by_id = {w.id: w for w in walls}

    def opening_id() -> str:
        return f"O{storey_index}-{next(counter):03d}"

    circulation = {c.key for c in cells if c.function.is_circulation}

    # Where a room with no wall onto circulation should open instead.
    #
    # The obvious answer, and the one this used, is the widest neighbour: it
    # gives the door somewhere to swing. But the widest neighbour is chosen
    # for being big, not for leading anywhere, and a room is not reachable
    # because it adjoins a large one. Five bedrooms down one side of a
    # passage, each touching the next along its long wall and the passage
    # along none of it, each opened into the bedroom beside it -- and the
    # whole sleeping wing had no route to an exit, which is the one finding
    # that makes every other finding in the report irrelevant.
    #
    # So work OUTWARDS from circulation instead. A room may only open into a
    # room that already has a route, and among those it takes the widest
    # wall. Each pass reaches one room further from the passage, so the door
    # is always hung towards the way out. What is left when a pass adds
    # nothing is genuinely unreachable, and still says so below.
    # One LAYER at a time, not one room at a time. Adding each room to
    # `reached` the moment it is settled makes the result depend on the order
    # the cells happen to be in: a bedroom whose neighbours are a bathroom
    # reached earlier in the same pass and a robe reached later in it saw only
    # the bathroom, and hung its door on the 191 mm of wall where the two
    # rooms clip a corner -- rather than on the 2802 mm it shares with the
    # robe that opens onto the passage. Both rooms are the same distance from
    # circulation, so both belong to the same layer and the widest wall
    # between them should decide.
    # A wall shorter than the jamb a frame needs is not a way through. Two
    # rooms clipping a corner share a wall of 150 mm, and a door hung there
    # is a doorway of no width -- which is not a narrow door, it is the
    # absence of one. Rooms are joined only along walls that can carry a
    # leaf, so neither the route out nor the door graph is built on one.
    def _passable(wall_id: str) -> bool:
        return wall_by_id[wall_id].length - 300 >= DOOR_MIN_STRUCTURAL

    routed: dict[str, tuple[str, str]] = {}
    reached = set(circulation)
    while True:
        layer: dict[str, tuple[str, str]] = {}
        for cell in cells:
            if cell.key in reached:
                continue
            towards = [
                (other.key, between[(cell.key, other.key)])
                for other in cells
                if other.key in reached and (cell.key, other.key) in between
                and _passable(between[(cell.key, other.key)])
            ]
            if not towards:
                continue
            towards.sort(key=lambda kw: -wall_by_id[kw[1]].length)
            layer[cell.key] = towards[0]
        if not layer:
            break
        routed.update(layer)
        reached.update(layer)

    # -- internal doors --------------------------------------------------
    for cell in cells:
        if cell.function.is_circulation:
            continue
        targets = [
            (key, between[(cell.key, key)])
            for key in circulation
            if (cell.key, key) in between
            and _passable(between[(cell.key, key)])
        ]
        if not targets:
            # Nothing to open onto directly. Fall back to the largest
            # neighbour so the room is at least reachable, and say so --
            # a room entered through another room fails egress rules in
            # most codes for anything but a suite.
            neighbours = [
                (other.key, between[(cell.key, other.key)])
                for other in cells
                if other.key != cell.key and (cell.key, other.key) in between
                and _passable(between[(cell.key, other.key)])
            ]
            if not neighbours:
                warnings.append(
                    f"{cell.name} does not touch any other room; it has no door."
                )
                continue
            if cell.key in routed:
                targets = [routed[cell.key]]
            else:
                # No circulation on this storey to work outwards from -- an
                # upper floor of two rooms off a stair below, say. The widest
                # neighbour is as good an answer as there is, and the warning
                # below still says the room is entered through another one.
                neighbours.sort(key=lambda kw: -wall_by_id[kw[1]].length)
                targets = neighbours[:1]
            warnings.append(
                f"{cell.name} has no wall onto circulation, so its door opens "
                f"into {by_key[targets[0][0]].name}. Check this against the "
                "local rule on rooms entered through other rooms."
            )

        # Open onto the longest available wall, which keeps the door clear
        # of corners and gives the room a usable swing.
        targets.sort(key=lambda kw: -wall_by_id[kw[1]].length)
        wall = wall_by_id[targets[0][1]]
        width = DOOR_WIDTHS.get(cell.function, DEFAULT_DOOR_WIDTH)
        if use != "residential":
            width = max(width, NON_RESIDENTIAL_MIN_DOOR)
        if required_clear:
            width = max(width, required_clear + Opening("", "", OpeningKind.DOOR,
                                                        0, 0, 0).leaf_thickness)
        available = max(0, wall.length - 300)
        if width > available:
            # The wall cannot take the door the room is owed. Say which, and
            # by how much -- a 390 mm opening drawn without comment reads as
            # a design decision rather than as the failure it is.
            if available < DOOR_MIN_STRUCTURAL:
                warnings.append(
                    f"{cell.name} opens off a wall only {wall.length} mm long, "
                    f"which leaves {available} mm of doorway against the "
                    f"{DOOR_MIN_STRUCTURAL} mm a usable leaf needs. That is a "
                    "planning problem, not a dimension to be adjusted."
                )
            else:
                warnings.append(
                    f"{cell.name}'s door is narrowed to {available} mm to fit "
                    f"its {wall.length} mm wall, from the {width} mm the room "
                    "would otherwise get."
                )
            width = available
        if width <= 0:
            # A doorway of no width is not a narrow door, it is the absence
            # of one, and drawing it is worse than leaving it out: the route
            # check walks the door graph, so a phantom opening makes a room
            # nothing can enter look connected, and `has_route_to_exit`
            # passes on a fiction. The two rooms touch along a wall shorter
            # than the 300 mm of jamb a frame needs -- they meet at a corner,
            # not along a side. The warning above already says so.
            continue
        openings.append(
            Opening(
                id=opening_id(),
                wall=wall.id,
                kind=OpeningKind.DOOR,
                offset=_centre_opening(wall, width),
                width=width,
                height=DOOR_HEIGHT,
            )
        )

    # -- circulation joins up ---------------------------------------------
    # An entry hall opens into the corridor, and the corridor into the stair.
    # These are usually unframed openings rather than doors, but they carry
    # the whole egress route: without them the plan is a set of rooms with no
    # way out, and every travel distance is uncomputable.
    circulation_cells = [c for c in cells if c.function.is_circulation]
    for a, b in itertools.combinations(circulation_cells, 2):
        wall_id = between.get((a.key, b.key))
        if wall_id is None:
            continue
        wall = wall_by_id[wall_id]
        width = min(1200, max(0, wall.length - 300))
        if width <= 0:
            continue
        openings.append(
            Opening(
                id=opening_id(),
                wall=wall.id,
                kind=OpeningKind.OPENING,
                offset=_centre_opening(wall, width),
                width=width,
                height=DOOR_HEIGHT,
            )
        )

    # -- the front door --------------------------------------------------
    road_edge = {
        "south": lambda w: not w.vertical and w.start.y == min(c.rect.y0 for c in cells),
        "north": lambda w: not w.vertical and w.start.y == max(c.rect.y1 for c in cells),
        "west": lambda w: w.vertical and w.start.x == min(c.rect.x0 for c in cells),
        "east": lambda w: w.vertical and w.start.x == max(c.rect.x1 for c in cells),
    }[plot.road_side]

    entry_keys = [c.key for c in cells if c.function in (Function.ENTRY, Function.LOBBY)]
    if not entry_keys:
        entry_keys = [c.key for c in cells if c.function.is_circulation]

    front_candidates = [
        w
        for w in walls
        if w.is_exterior and road_edge(w) and set(w.separates) & set(entry_keys)
    ]
    if not front_candidates:
        # Any road-facing wall will do, except the garage's: the front door
        # and the vehicle door landed on the same 5.5 m wall and overlapped.
        garage_keys = {c.key for c in cells if c.function is Function.GARAGE}
        front_candidates = [
            w for w in walls
            if w.is_exterior and road_edge(w)
            and not (set(w.separates) & garage_keys)
        ]
    if front_candidates and storey_index == 0:
        wall = max(front_candidates, key=lambda w: w.length)
        entry_width = max(ENTRY_DOOR_WIDTH, required_clear + 45)
        openings.append(
            Opening(
                id=opening_id(),
                wall=wall.id,
                kind=OpeningKind.DOOR,
                offset=_centre_opening(wall, entry_width),
                width=min(entry_width, max(0, wall.length - 300)),
                height=DOOR_HEIGHT,
                is_egress=True,
            )
        )
    elif storey_index == 0:
        warnings.append(
            "No exterior wall faces the road, so no front door was placed."
        )

    # -- the garage door --------------------------------------------------
    # A garage with no way to drive into it. Sixty-five of sixty-seven plans
    # in the lot sweep had one: the elevation facing the street showed a
    # single 1000 mm front door and a blank wall five and a half metres wide,
    # with the driveway drawn running up to it. Rooms are doored onto
    # circulation, and a garage's opening is not that -- it is a hole in the
    # front of the house for a car, and nothing was placing it.
    #
    # The width is the wall's, less the jamb the rest of this module allows:
    # the same reasoning `place_driveway` uses when it takes its own width
    # from the garage rather than from a table. What kind of door hangs in it
    # -- panel lift, roller, tilt -- and the leaf inside the structural
    # opening are the supplier's, which is what the elevation notes already
    # say about every other opening on the sheet.
    if storey_index == 0:
        for cell in cells:
            if cell.function is not Function.GARAGE:
                continue
            facing = [
                w for w in walls
                if w.is_exterior and road_edge(w) and cell.key in w.separates
            ]
            if not facing:
                facing = [w for w in walls
                          if w.is_exterior and cell.key in w.separates]
                if facing:
                    warnings.append(
                        f"{cell.name} has no wall onto the street, so its door "
                        "is drawn on the exterior wall it does have. Check it "
                        "against where the crossover can go."
                    )
            if not facing:
                warnings.append(
                    f"{cell.name} has no exterior wall at all, so no vehicle "
                    "door could be placed. A car cannot reach it."
                )
                continue
            wall = max(facing, key=lambda w: w.length)
            width = max(0, wall.length - 300)
            if width < DOOR_MIN_STRUCTURAL:
                warnings.append(
                    f"{cell.name} fronts {wall.length} mm of wall, which "
                    f"leaves {width} mm for a vehicle door. That is a planning "
                    "problem, not a dimension to be adjusted."
                )
                continue
            # An OPENING, not a DOOR, and the distinction is not pedantry:
            # a door is drawn in plan with its leaf and a quarter-circle
            # swing, and a 5.2 m swing arc is 5.2 m of drawing that is not
            # there. It took the architectural sheet from 1:100 to 1:200 --
            # the whole plan a scale step smaller to make room for the swing
            # of a door that does not swing. A panel-lift or roller door
            # lifts into the space above, so what the plan has to show is the
            # hole, which is what an opening is.
            openings.append(
                Opening(
                    id=opening_id(),
                    wall=wall.id,
                    kind=OpeningKind.OPENING,
                    offset=_centre_opening(wall, width),
                    width=width,
                    height=DOOR_HEIGHT,
                )
            )

    # -- a second way out -------------------------------------------------
    # Above about fifty occupants every code wants two exits, remote from
    # each other. A house rarely reaches that; anything else reaches it at
    # the first floor of any size, so non-residential plans get a second
    # door at the far end of the circulation from the first.
    if use != "residential" and storey_index == 0:
        placed_walls = {o.wall for o in openings if o.is_egress}
        candidates = [
            w
            for w in walls
            if w.is_exterior
            and w.id not in placed_walls
            and set(w.separates) & set(entry_keys)
        ]
        if candidates and placed_walls:
            first = next(w for w in walls if w.id in placed_walls)
            # Remote means remote: take the exterior wall furthest from the
            # door already placed, not merely a different one.
            far = max(
                candidates,
                key=lambda w: abs(w.start.x - first.start.x)
                + abs(w.start.y - first.start.y),
            )
            width = min(ENTRY_DOOR_WIDTH, max(0, far.length - 300))
            if width > 0:
                openings.append(
                    Opening(
                        id=opening_id(),
                        wall=far.id,
                        kind=OpeningKind.DOOR,
                        offset=_centre_opening(far, width),
                        width=width,
                        height=DOOR_HEIGHT,
                        is_egress=True,
                    )
                )
        elif not candidates:
            warnings.append(
                "Only one exit could be placed: the circulation touches the "
                "outside in one place only. Above roughly fifty occupants a "
                "second, remote exit is required almost everywhere."
            )

    # -- windows ---------------------------------------------------------
    for cell in cells:
        exterior = [w for w in walls if w.is_exterior and cell.key in w.separates]
        if not exterior:
            if cell.function.is_habitable:
                warnings.append(
                    f"{cell.name} has no exterior wall, so it has no window. "
                    "Habitable rooms need daylight almost everywhere."
                )
            continue
        if cell.function.is_circulation and cell.function is not Function.STAIR:
            continue
        if cell.function.is_outdoor:
            continue   # roofed but open on at least one side

        wall = max(exterior, key=lambda w: w.length)
        # Order matters: a kitchen is both wet and habitable, and it is the
        # habitable half that decides how much daylight it is owed.
        if cell.function.is_habitable:
            floor_area = clear[cell.key].area
            required = math.ceil(floor_area * glazing / FRAME_ALLOWANCE)
            if ventilation:
                # Ventilation is required on the area that OPENS, so a window
                # sized only for daylight can still fall short.
                required = max(required, math.ceil(floor_area * ventilation / openable))
            height, sill = WINDOW_HEAD - WINDOW_SILL, WINDOW_SILL
        elif cell.function.is_wet:
            height, sill = WET_WINDOW_HEIGHT, WET_WINDOW_SILL
            required = WET_WINDOW_WIDTH * height
            if ventilation:
                required = max(
                    required, math.ceil(clear[cell.key].area * ventilation / openable)
                )
        else:
            height, sill = WINDOW_HEAD - WINDOW_SILL, WINDOW_SILL
            required = 900 * height

        # Spend the requirement across as many walls as it takes. One window
        # on the longest wall is the usual answer, but a room with short
        # exterior walls cannot reach 10% of its floor area that way, and
        # widening a window past its wall is not an option.
        remaining = required
        for candidate in sorted(exterior, key=lambda w: -w.length):
            if remaining <= 0:
                break
            # Only the wall nothing is already standing in. A window was
            # centred on the wall whatever else was on it, which put a 900 mm
            # garage window through the middle of the 5.4 m vehicle opening.
            # Nothing caught it until the garage got its door, because until
            # then the only openings on an exterior wall were the front door
            # and the windows themselves, and those are placed one to a wall.
            free_start, free_length = _widest_free_run(candidate, openings)
            available = max(0, free_length - 600)
            if available < 600:
                continue
            # Round the width up. Truncating lands a room at 9.99% of the
            # 10% it needs, which is a failure caused by integer division
            # rather than by the design.
            wanted = min(max(600, -(-remaining // height)), available)

            # Split the glazing into units that can be made, with a pier
            # between them. A single 5 m opening is not a window -- it is two
            # or three, and the pier between them is what the lintels bear on.
            # The cap is absolute: where the wall cannot carry enough units to
            # reach the glazing the room wants, the room gets less glazing and
            # is told so, rather than one unit nobody can manufacture.
            def _to_ten(value: int) -> int:
                return -(-value // 10) * 10

            def _unit(count: int) -> int:
                return min(MAX_WINDOW_UNIT, max(600, _to_ten(-(-wanted // count))))

            fits = max(1, (available + WINDOW_PIER) // (600 + WINDOW_PIER))
            units = min(fits, max(1, -(-wanted // MAX_WINDOW_UNIT)))
            unit_width = _unit(units)
            while units > 1 and units * unit_width + (units - 1) * WINDOW_PIER > available:
                units -= 1
                unit_width = _unit(units)
            span = units * unit_width + (units - 1) * WINDOW_PIER
            if span > available:
                units = 1
                unit_width = min(MAX_WINDOW_UNIT, available)
                span = unit_width

            start = free_start + max(0, (free_length - span) // 2)
            for unit in range(units):
                openings.append(
                    Opening(
                        id=opening_id(),
                        wall=candidate.id,
                        kind=OpeningKind.WINDOW,
                        offset=start + unit * (unit_width + WINDOW_PIER),
                        width=unit_width,
                        height=height,
                        sill=sill,
                    )
                )
            remaining -= units * unit_width * height

        if remaining > 0 and cell.function.is_habitable:
            warnings.append(
                f"{cell.name} has {(required - remaining) / 1e6:.2f} m² of glazing "
                f"against the {required / 1e6:.2f} m² its floor area calls for. "
                "Its exterior walls are too short to carry the rest -- the room "
                "needs a wider frontage, a rooflight, or a taller window."
            )

    return openings


def _widest_free_run(
    wall: Wall, openings: list[Opening]
) -> tuple[int, int]:
    """The longest stretch of a wall with nothing already in it.

    Returns (offset, length) along the wall. Openings are placed one module
    at a time and nothing was checking what a wall already carried, which is
    fine while every exterior wall gets at most one thing -- and stops being
    fine the moment a garage has both a vehicle opening and a wall long
    enough to look like it wants a window.
    """
    taken = sorted(
        (o.offset, o.offset + o.width)
        for o in openings if o.wall == wall.id
    )
    best_start, best_length = 0, wall.length
    cursor = 0
    runs: list[tuple[int, int]] = []
    for start, end in taken:
        if start > cursor:
            runs.append((cursor, start - cursor))
        cursor = max(cursor, end)
    if cursor < wall.length:
        runs.append((cursor, wall.length - cursor))
    if runs:
        best_start, best_length = max(runs, key=lambda run: run[1])
    elif taken:
        best_start, best_length = 0, 0
    return best_start, best_length


def _stairs_for_storey(
    cells: list[Cell],
    storey_index: int,
    storey_height: int,
    clear: dict[str, Rect],
    warnings: list[str],
    design: dict | None = None,
) -> list[Stair]:
    """Work the flight out from the height it has to climb and the run it has.

    Nothing here is assumed. The number of risers is whatever it takes to
    reach the next floor at a comfortable rise; the going is whatever the
    space allows once a landing is taken out. If that produces a steep
    stair, the geometry says so honestly and the rule engine fails it --
    which is the point.
    """
    stairs: list[Stair] = []
    for cell in cells:
        if cell.function is not Function.STAIR:
            continue
        design = design or {}
        riser_max = int(design.get("stair_riser_max_mm", 0) or 0)
        going_min = int(design.get("stair_going_min_mm", MIN_GOING) or MIN_GOING)
        going_max = int(design.get("stair_going_max_mm", 0) or 0)

        rect = clear[cell.key]
        target_riser = min(TARGET_RISER, riser_max) if riser_max else TARGET_RISER
        risers = max(2, -(-storey_height // target_riser))
        riser = storey_height // risers
        goings = max(1, risers - 1)
        # One straight flight if the run is there. If it is not, the stair
        # turns back on itself -- which is what anyone would draw, and the
        # only way an eighteen-riser flight fits a three-metre room without
        # becoming a ladder.
        flights = 1
        width = rect.short_side
        per_flight = goings
        if rect.long_side - LANDING_DEPTH < goings * going_min and rect.short_side >= 2 * 900:
            flights = 2
            per_flight = -(-goings // 2)
            width = rect.short_side // 2

        # Tighten the landing towards its own minimum before letting the
        # going drop below what the code allows. A designer does this before
        # redrawing the plan, and it is the difference between a 235 mm
        # going that fails and a 240 mm one that does not.
        landing = LANDING_DEPTH
        going = 0
        for candidate in range(LANDING_DEPTH, MIN_LANDING - 1, -25):
            landing = candidate
            going = max(0, rect.long_side - candidate) // max(1, per_flight)
            if going >= going_min:
                break
        if going_max:
            # A going longer than the code allows is not generosity, it is a
            # violation. The spare run becomes a deeper landing instead.
            going = min(going, going_max)
        run_available = max(0, rect.long_side - landing)

        if going < going_min:
            warnings.append(
                f"{cell.name} is too small for the {risers} risers it has to "
                f"climb: even with the landing cut to {landing} mm the going "
                f"works out at {going} mm, against the {going_min} mm minimum. "
                "Give it more room."
            )

        stairs.append(
            Stair(
                id=f"S{storey_index}-{cell.key}",
                storey=storey_index,
                rect=rect,
                riser_height=riser,
                tread_depth=going,
                risers=risers,
                width=width,
                flights=flights,
            )
        )
    return stairs


def build_building(
    program: SpaceProgram,
    plot: Plot,
    layout: Layout,
    name: str = "",
    jurisdiction: str = "",
    design: dict | None = None,
) -> Building:
    """Assemble the full model: spaces, walls, openings and stairs.

    `design` carries the targets the jurisdiction's rule packs ask for --
    door clear widths, glazing and ventilation ratios, stair limits. Passing
    them means the plan is drawn trying to satisfy the local code rather
    than drawn to a default and failed against it afterwards.
    """
    design = design or {}
    system = str(design.get("construction", "") or "")
    thicknesses = CONSTRUCTION.get(system, {})
    exterior_mm = int(design.get("wall_exterior_mm")
                      or thicknesses.get("exterior", EXTERIOR_THICKNESS))
    interior_mm = int(design.get("wall_interior_mm")
                      or thicknesses.get("interior", INTERIOR_THICKNESS))
    building = Building(
        name=name or program.name,
        plot=plot,
        jurisdiction=jurisdiction,
        use=program.use,
        # Recorded, not inferred. An elevation that wants to draw brickwork
        # has to know the walls ARE brick, and guessing it back from a
        # 230 mm thickness is a guess: 230 is also a rendered blockwork wall
        # and 200 is a framed one with thick cladding.
        metadata={"construction": system} if system else {},
        # Set HERE, from the design the caller already handed over, because
        # a set with no roof is a set with no elevations and no section: the
        # PDF writer's page list is guarded on `building.roof is not None`,
        # and so is the cut marker on the floor plan. Until now only `cli.py`
        # remembered to attach one, so a plan produced through the library --
        # which is how the tests, the sweeps and every other caller build one
        # -- came out as a site plan, floor plans and schedules, and nothing
        # else, without saying anything was missing.
        #
        # This is the same fault `SpaceProgram.build_to` was written to end,
        # and its docstring says why: a correction only some callers remember
        # is how the ceiling height came to be wrong for Lahore. The design
        # dict carrying the pitch is already a parameter of this function.
        roof=Roof(
            pitch_degrees=float(design.get("roof_pitch_degrees", 25.0)),
            overhang_mm=int(design.get("roof_overhang_mm", 600)),
            kind=str(design.get("roof_kind", "hip")),
        ),
    )
    warnings = layout.warnings

    for index in range(layout.storeys):
        cells = layout.for_storey(index)
        if not cells:
            continue
        height = layout.storey_height
        walls, between = _walls_for_storey(
            cells, index, height, exterior_mm, interior_mm
        )
        clear = {cell.key: _clear_rect(cell, walls) for cell in cells}
        openings = _openings_for_storey(
            cells, walls, between, index, plot, clear, warnings, program.use, design
        )
        stairs = _stairs_for_storey(cells, index, height, clear, warnings, design)

        storey = Storey(
            index=index,
            name="Ground floor" if index == 0 else f"Floor {index}",
            elevation=index * height,
            height=height,
            # Snapped to a whole brick course, because that is what gets
            # built and a ceiling asked for at 2400 is laid at 2434.
            ceiling=snap_to_course(height - 200),
            spaces=[
                Space(
                    id=cell.key,
                    name=cell.name,
                    function=cell.function,
                    rect=clear[cell.key],
                    storey=index,
                )
                for cell in cells
            ],
            walls=walls,
            openings=openings,
            stairs=stairs,
        )
        building.storeys.append(storey)

    # The driveway, for the same reason the roof is set above: a garage with
    # no driveway is an oversight, not a design decision, and only `cli.py`
    # remembered to place one. A site plan built through the library showed a
    # double garage on a lot with no way to drive to it.
    #
    # Everything it needs is already here -- the plot, the footprint and the
    # garage's own rectangle, which is where its width comes from. A crossover
    # is a separate ask (it is the council's part of the verge, not the
    # owner's) and stays with the caller that knows whether one was requested.
    garage_rect = next(
        (space.rect for storey in building.storeys for space in storey.spaces
         if space.function is Function.GARAGE),
        None,
    )
    if garage_rect is not None:
        drive, drive_notes = place_driveway(plot, layout.envelope, garage_rect)
        building.driveway = drive
        warnings.extend(n for n in drive_notes if n not in warnings)

    return building
