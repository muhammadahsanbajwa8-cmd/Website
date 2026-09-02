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
from dataclasses import dataclass, field, replace
from functools import lru_cache

from ..geom import Point, Rect
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
    # Rooms the brief asked for that are not on the drawing at all, because
    # the floor could not hold them. Kept as names rather than read back out
    # of the warning text: what the sheet says about a missing room should
    # not depend on the wording of a sentence written for the report.
    omitted: list[str] = field(default_factory=list)

    def for_storey(self, index: int) -> list[Cell]:
        return [c for c in self.cells if c.storey == index]

    def shortfall_notes(self) -> list[str]:
        """What to print on the DRAWING about rooms that came up short.

        `unsatisfied` is the schedule of it, room by room, and it belongs in
        the report: twenty lines is a table, not a drawing note. But a sheet
        gets separated from its report, and a plan that says nothing about a
        9.6 m2 master suite lets the drawing read as the design somebody
        intended. So the sheet carries the statement and the report carries
        the list.
        """
        short: list[tuple[int, Cell, int, int]] = []
        for cell in self.cells:
            req = cell.requirement
            if req is None or not req.min_area:
                continue
            clear = max(0, cell.area
                        - _WALL_ALLOWANCE * (cell.rect.w + cell.rect.h))
            if clear >= req.min_area:
                continue
            short.append((req.min_area - clear, cell, clear, req.min_area))
        notes: list[str] = []
        if self.omitted:
            # A room that is not drawn at all is worse to leave unsaid than
            # one drawn small: somebody comparing the sheet against the brief
            # they gave finds it missing and has nothing on the page telling
            # them it was a decision rather than an oversight.
            names = ", ".join(sorted(set(self.omitted)))
            was = "was" if len(set(self.omitted)) == 1 else "were"
            notes.append(
                f"{names} {was} left out. The floor could not hold the whole "
                "brief, and dropping what a project home treats as an extra "
                "beats taking the width out of every bedroom. The compliance "
                "report says by how much."
            )
        if short:
            by, cell, clear, asked = max(short, key=lambda item: item[0])
            rooms = "room is" if len(short) == 1 else "rooms are"
            notes.append(
                f"{len(short)} {rooms} smaller than the brief asked for. The "
                f"largest shortfall is {cell.name}, {clear / 1e6:.1f} m² clear "
                f"against {asked / 1e6:.1f} m² asked, {by / 1e6:.1f} m² short. "
                "Every one of them is listed in the compliance report."
            )
        return notes


# Rooms this narrow are unusable whatever a code says; the solver refuses to
# emit one rather than draw a corridor and call it a bedroom.
_ABSOLUTE_MIN_DIM = 900

# Tiles meet on wall centrelines, so a room loses half a wall on each side.
# A program asks for CLEAR space, so every minimum is inflated by this before
# it is used to size a tile. Without it, a corridor asked to be 1000 mm wide
# is built 885 mm wide and fails a rule the design never intended to break.
#
# It is the WORST case, not the average: an exterior wall (230) against an
# interior one (115) takes 172 mm off the tile. At 115 -- half an interior
# wall each side -- a linen press asking for 600 mm was given a 715 mm tile
# and drawn at 543, which is under what it asked for, and nothing reported it
# because the tile looked right.
_WALL_ALLOWANCE = 172

# Below this CLEAR dimension there is no room at all: a 720 mm door leaf will
# not fit in the opening, so nothing can get in. This is the line at which the
# solver refuses outright rather than drawing what it has got.
#
# It is deliberately well under _ABSOLUTE_MIN_DIM. Between the two -- 600 to
# 900 mm -- the plan is drawn and every room in that range is named, both in
# `unsatisfied` and by the label placer, which cannot fit a caption in one.
# That band is a bad plan somebody can look at and argue with. Under 600 there
# is nothing to argue with: a 139 mm linen cupboard and a WC with a dimension
# of zero are not a smaller version of a good plan.
_UNBUILDABLE = 600

# The tile that leaves it. A tile gives up half a wall on each side, and the
# fattest case is an exterior wall (230) against an interior one (115): 172 mm
# off the tile. Using the average allowance instead let a 715 mm tile through
# and drew it at 543 -- so the WORST case is the one that belongs here, or the
# check is not the check it claims to be.
_MIN_TILE = _UNBUILDABLE + 172

# Rooms that must touch BOTH the outside and the circulation, and so cannot
# be one half of a pair. Circulation is here for the same reason -- a passage
# tucked behind another room is not a passage.
_NEVER_PAIRED = frozenset({
    Function.ENTRY, Function.LOBBY, Function.CORRIDOR, Function.STAIR,
    Function.GARAGE,
})

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
            # The top floor gets one too: a stair is needed on the floors it
            # leaves from, and the floor it arrives at still has the flight
            # coming up through it taking that floor area.
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


# Packing: what has been tried against it, and what the measurements said.
#
# Thirteen attempts to improve the packer have been made. Ten were reverted;
# 7 and the tenth attempt inside 9 now stand and say so where they are
# recorded. They are kept here because each cost a session to re-derive and
# each failed, or came good, for a reason that is not obvious from the code.
#
# 1. Protecting habitable rows in `_apportion` -- giving bedrooms and living
#    rooms their floor before anything else got a share. Undersized rooms
#    went UP, 346 to 363: the protection took the shortfall out of the
#    circulation and the wet rooms, which then breached their own minimums
#    and dragged the whole band into the shared-shortfall branch.
#
# 2. Pairing more aggressively -- pairing wherever `_can_pair` allowed it.
#    No effect. Pairing halves each room's depth, so two rooms in a slice
#    need twice the length to hold their areas; for two UNEQUAL rooms that is
#    more span than two separate rows, not less.
#
# 3. Pairing only where it PAYS -- the converse of 2, and the one that looks
#    most obviously right. The test is sound and discriminates correctly: on
#    a 5374 mm band a master with a WC needs 6478 mm of length against 4644
#    for the two apart, while a bathroom with a linen needs 2557 against
#    2744, so the first is refused and the second kept. Applied to the two
#    fallback paths below it still made the sweep worse -- 63 plans drawn
#    fell to 52 and refusals rose from 17 to 28.
#
#    The reason is the thing the length comparison does not count. An unpaired
#    small room takes a whole ROW, and rows are what a band runs out of; the
#    room also spans the full depth, so a WC keeping its own row comes out
#    5374 x 1015. Pairing wastes length and saves rows, and on a tight band
#    saving rows is worth more. Any fifth attempt has to count both.
#
# 4. Bringing a room forward onto the street frontage. The garage sets the
#    front strip's depth -- a car needs about 6 m -- and the whole frontage
#    is held to it, so on a small brief the strip carries a large surplus
#    while the bands behind are over-subscribed. On a 15 x 30 m lot that was
#    20.6 m2 of spare floor around a 4.7 m2 store, with Bed 2 drawn 1975 mm
#    wide. Moving the bedroom onto the frontage fixed exactly that: 4420 x
#    4007 against 5284 x 1975, and the browser sweep's packing losses went
#    from 2 to 0 with nothing else moving.
#
#    It was still reverted, because the room-shape sweeps were measuring the
#    wrong thing. Re-packing the bands behind the promoted room left the
#    bathroom and the laundry doored into each other and into nothing else:
#    two rooms with no route to an exit, which `baseline.route.exists` calls
#    the finding that makes every other finding on the page irrelevant. A
#    wider bedroom is not worth a room nobody can walk into.
#
#    A guard was written -- lay the floor out both ways, follow the rule
#    `walls` hangs doors by, and keep the promotion only if it stranded
#    nothing. It works, and with it in place the promotion never fires on any
#    brief that reaches it, so the code was dead. Any attempt to reuse this
#    idea has to move the CIRCULATION with the room, not just the room.
#
#    What the attempt did leave behind is worth more than it was: the sweep
#    it prompted found nine cases already being drawn with a room that has no
#    route out. See web/route.mjs.

# 5. Pairing across the daylight line first -- in `_group_rows`, preferring a
#    partner whose need for a window differs from the room's, so the robe
#    pairs with the bedroom rather than with the ensuite. Measured over the
#    sweep: no change at all, in any figure.
#
#    The reason is worth keeping, because it is what sent the next attempt
#    somewhere better. On the band it was aimed at -- 12.5 x 28 m, four beds
#    -- the bedrooms are not `_thin` and never enter the pairing branch: at
#    4623 mm of depth a 13.2 m2 bedroom wants 2859 mm of length, an aspect of
#    1.62, which is a good room. They came out 1321 mm across anyway. The
#    band was not mis-shaping them; it was over-subscribed, holding 90.9 m2
#    of rooms in 49.3 m2 of band, and `_apportion` shared the shortfall. No
#    grouping rule can pack a floor into two thirds of itself.
#
# 6. Refusing to shed a room on the street frontage (see `_shed_extras`).
#    The reasoning was that the front strip is as deep as the garage needs
#    whatever stands beside it, so width given up there goes to the portico
#    rather than to the bedrooms behind -- which does happen: dropping the
#    theatre leaves a 21.6 m2 covered porch on a floor whose bedrooms are
#    1.7 m across. Measured, it is still worse: awkward 67 to 69, thin rooms
#    327 to 347, refusals 13 to 14. The frontage rooms do cost the bands
#    something, and the ugly portico is cheaper than the alternative.
#
# 7. Shedding the frontage rooms LAST rather than not at all. Better on one
#    axis -- thin rooms 327 to 321 -- and it refused a lot the tests require
#    drawn, because stopping the shed at a different point left a WC at
#    730 mm. Any eighth attempt here should fix where the frontage surplus
#    goes, not which rooms are allowed to leave.
#
#    THIS ONE NOW STANDS, and is in `_shed_extras` above. Re-measured after
#    the WC was widened to hold a pan -- a room can no longer land at 730 mm
#    without its own declared minimum catching it -- the same rank costs
#    nothing: 65 plans drawn and 15 refused either way, thin rooms 296 to
#    290, code findings unchanged at 132 with one violation, and every test
#    passing. What changed is not the rank; it is that the failure mode the
#    rank used to expose has its own guard now.

# 8. The L: one band brought forward to the street beside the garage, so the
#    front strip spans only the frontage the garage and the front door need
#    instead of the whole of it. This is the plan type the warning further
#    down asks for by name, and it was built -- both ways round, scored on
#    the whole floor, front rooms included, and kept only where it beat the
#    straight spine. It never did, and the measurement says why.
#
#    The front strip really is over-provisioned: across sixty-seven plans it
#    holds 1041 m2 more than the rooms in it asked for, about 15.5 m2 a plan,
#    at the same time as the bands behind are over-subscribed. But that
#    surplus is in DEPTH, not in width. The strip is as deep as a car needs --
#    about 6 m -- across its whole width, and the theatre, the store and the
#    portico beside the garage need barely two of those metres. Every one of
#    them still needs its own slice of the FRONTAGE.
#
#    So the width left over at one end, which is the only thing a wing
#    brought forward can occupy, is tiny: 13 mm on a 12.5 m lot, 952 and 1063
#    on an 18 m one, 3307 where the theatre had already been evicted. The
#    bands it would join are 3.5 to 7.5 m thick. Squeezed into the surplus
#    anyway it drew a 1063 mm wing and scored seventeen bad rooms against the
#    straight spine's five.
#
#    A ninth attempt has to reach the DEPTH surplus, which means a strip that
#    is deep only over the garage and shallow beside it. That makes the band
#    behind L-shaped rather than the floor, and every check here rests on
#    bands being rectangles that tile exactly -- `_stack`, the hole sweep, and
#    the wall builder all assume it. It is a bigger change than it looks.

# 9. Making the three plan forms peers. The single spine, the service core
#    and the garage column are tried in that ORDER and the first that beats
#    the spine returns, so on a 16 to 20 m frontage -- where the core fires --
#    the column is never even built. That is a preference by position, not by
#    measurement, and it looked plainly wrong.
#
#    Built as peers -- all three scored on the whole floor, front rooms
#    included, best kept -- the column wins one more plan and the sweep goes
#    awkward 51 to 49, thin 320 to 319, and code failures 463 to 469. The
#    extra failures are all on that one plan: on a 20 x 35 m block the column
#    scores two better and draws four bedrooms 1853 mm across where the core
#    draws them wider, which is four habitable-width findings, an area one and
#    a doorway. `_shape_score` counts ROOMS, and the count can be won on the
#    wrong ones -- a rounder bathroom paying for a narrower bed.
#
#    Four ways to stop that trade were tried and each cost more than it saved:
#      - score every room against its own declared minimum width instead of a
#        flat 1500 mm: failures 463 to 498, four tests broken. On an
#        over-subscribed floor nearly every room is under its minimum, so the
#        count saturates and stops telling two layouts apart at all.
#      - count thinness only among the rooms that need daylight, so a narrow
#        bathroom stops paying for a narrow bedroom: awkward 51 to 53,
#        failures to 472. The obvious refinement, and it loses.
#      - refuse a column that draws any lit room narrower than the form it
#        replaces: awkward to 61, failures to 462. It blocks nearly every
#        column, including the ones that were paying.
#      - refuse a column that puts MORE lit rooms under their declared width:
#        awkward 62, failures 472. Worse again.
#
#    So the ordering stays, and it stays for a reason worth writing down:
#    nothing here yet measures a layout the way the code checks do, and every
#    cheap proxy tried for it is worse than the flat count. A tenth attempt
#    wants a score built from what the rule engine actually reports, not
#    another guard in front of this one.
#
#    That tenth attempt was made and it worked; see `_shape_score`. Reading
#    the baseline pack's own habitable-room targets, rather than any figure
#    chosen here, took code warnings from 424 to 413 over the sweep and the
#    browser's packing losses from 1 to 0.

# 10. Giving the chooser eyes for the surplus, which answers the question
#    left open at the end of 9. `_try_the_garage_in_a_column` is built and
#    scored 231 times over the AU-WA lot sweep and kept 6. Nothing in
#    `_shape_score` can see why it should be kept more often: it counts the
#    rooms somebody lives in, and the fault the column exists to fix is floor
#    handed to a porch or a hall. On the plans the column loses, the strip it
#    loses to has given an entry hall 28 m2 against the 6 it asked for.
#
#    So a waste term was added -- the surplus over `_target` on the rooms
#    with no preferred area to grow into, the porch and the hall and the
#    store, ranked LAST so it can only break a tie between forms that treat
#    the habitable rooms equally. It fires: the column is kept 24 times
#    instead of 6, the garages' total shortfall falls 444 to 398 m2 and the
#    porches' surplus 345 to 312.
#
#    And it is worse. Thin rooms 290 to 304 and two new
#    `baseline.door.clear_width` failures, because the service rooms have no
#    measure either and the column narrows them. Adding one -- each room
#    against its OWN declared width, which `build_to` now sets from the
#    fittings catalogue -- ahead of the waste term cancels it EXACTLY: the
#    column goes back to 6, every graded number returns to where it started,
#    and on a second lot set of sixty-seven plans nothing moves at all
#    except 22 m2 less porch.
#
#    That cancellation is the finding, and it is worth more than the code
#    was. The column is not being refused out of blindness. On every plan
#    where it wastes less floor it draws a bathroom or a WC under the width
#    its own fittings need, and the exchange is a fair one to decline. Both
#    terms were reverted: measurably neutral code is still code.
#
#    A room brought forward to fill the surplus is attempt 4, and it is not
#    open either -- it strands rooms, and the guard that stops it stranding
#    them makes it dead.

# 11. Letting the front strip keep the depth a car needs. `_front_zone` sizes
#    the strip to 6000 + a wall and then caps it at a THIRD of the floor's
#    depth, and the cap wins: on fifty-five of the sixty-five plans in the
#    AU-WA lot sweep the strip comes out under 6172, and thirty-nine of the
#    garages are under 6000 mm deep as a direct result. The correlation is
#    exact -- every shallow garage is a capped strip.
#
#    Raising the floor back over the cap does fix the garages: shallow ones
#    39 -> 16. It costs far more than it buys. The strip takes its depth from
#    the bands behind, and they were already the tight part: thin rooms
#    290 -> 336, awkward 47 -> 66, code findings 132 -> 187 and violations
#    1 -> 11. Three more plans draw, at that price.
#
#    So the cap stays and the garage is genuinely constrained by how deep the
#    block is. What came out of the attempt is that the plan was blaming the
#    wrong thing: twenty-nine of the sixty-five garages are wide enough for
#    two cars and short only front to back, and every one of them was told
#    there was not enough street frontage. The warning now names the
#    dimension that is actually short. See `walls.check_the_garage_holds_its_cars`.

# 12. Keeping the garage COLUMN where the strip cannot give the garage its
#    depth. Attempt 11 established that the strip cannot be let through its
#    cap. The column is the other way to the same place -- the garage takes
#    the run a car needs and the rest of its column stacks behind it, so the
#    depth comes out of one column rather than out of the whole frontage --
#    and it was already built and scored on every plan, and turned down
#    whenever it did not score better.
#
#    So it is kept where it is the ONLY way: the strip's garage is under
#    6000 mm deep and the column's is not. That is a fallback for one thing
#    the strip cannot do, not a preference for the column, and it is measured
#    per plan rather than in aggregate.
#
#    Over the AU-WA sweep 22 plans change, 22 gain a garage that holds two
#    cars, and none loses one. On those 22 the findings go up by 9 in total:
#    eleven gain one apiece, one loses one, ten are unchanged. Thin rooms go
#    up 40. The findings it costs are habitable rooms under the baseline
#    pack's TARGET width, which the report already describes as a figure to
#    aim at; what it buys is a room the plan itself was reporting as unusable
#    on 54 of 65 plans.
#
#    The browser sweep is where it shows: garages that hold two cars 42 of
#    317 -> 174, too narrow 144 -> 103, too shallow 187 -> 59. Undersized
#    habitable rooms 13 -> 31, every one named, and `feasible.mjs` puts all
#    31 on floors GENUINELY short of area rather than floors the packing
#    lost. Packing losses stay 0 and no room loses its route.

# 13. The L-shaped band, which notes 4 and 8 both point at as the only route
#    left. SPIKED BEFORE BUILDING, and the spike says do not build it.
#
#    Note 8 was written when the strip across the frontage was the normal
#    form. Attempt 12 changed that: the garage column is now kept wherever it
#    is the only way to give the garage its depth, and 53 of the 65 plans in
#    the AU-WA sweep no longer have a strip to shorten at all. The L's
#    premise has largely been overtaken by the thing it was competing with.
#
#    Of the 12 plans that still lay a true strip, every one has depth going
#    spare -- 1884 mm on average, 2557 at worst -- and the band that would be
#    recovered is never a sliver. So the L is buildable. It just does not buy
#    a garage: 5 of the 12 have a garage too NARROW, which no amount of depth
#    fixes, and the other 7 are on floors where the service core wins and the
#    column is never even built.
#
#    That last group looked like a cheap win, so it was tried: reach the same
#    rescue into the core branch. Garages holding two cars 33 -> 40 and too
#    shallow 12 -> 5, at code findings 141 -> 174, VIOLATIONS 1 -> 5,
#    habitable width findings 34 -> 63, and two new daylight and ventilation
#    failures. Reverted. The core form is chosen because it treats the rooms
#    well on a wide frontage, and replacing it with a column undoes exactly
#    that -- which is note 9's ordering earning its place rather than
#    contradicting it.
#
#    So the column rescue is worth it against the strip and not against the
#    core, and the L is worth building for neither. What is left for the
#    garage is width on a narrow frontage, and that is a fact about the
#    block: the front door has to meet the passage behind it.

# WHERE THE NARROW HABITABLE ROOMS ARE, measured rather than assumed, because
# `baseline.habitable.width` is the largest remaining group of findings and it
# would be easy to go looking for a packing fault that is not there.
#
# By plan form over the AU-WA sweep:
#
#      form    plans   width fails   per plan   over-subscribed floors
#      spine      30            17       0.57                       15
#      core        7             0       0.00                        0
#      column     28            22       0.79                        6
#
# The core draws none at all. The spine's are mostly floors that are
# over-subscribed and say so. And every one of the column's 22 is on a plan
# the garage RESCUE kept -- attempt 12 -- which is the trade that attempt
# measured and accepted: 22 plans gained a garage that holds two cars for
# nine findings net.
#
# So none of them is the "area was there and the packing lost it" kind. The
# browser's `feasible.mjs` says the same thing from the other side: 0 packing
# losses, and all 31 undersized habitable rooms on floors genuinely short of
# area. Anyone hunting this group should start by re-running that split
# rather than by changing the packer.

def _group_rows(rooms: list[tuple[str, SpaceRequirement]], depth: int) -> list[_Row]:
    """Decide which rooms share a slice of the band with a neighbour.

    A room's slice is proportional to its AREA, so a small room in a deep
    band gets a short slice: a 4.8 m2 WC on a 5.5 m band is 880 mm long and
    5.5 m deep, which is a corridor. Pairing two such rooms across the depth
    is what fixes that, and it is what a real plan does -- the WC and the
    linen press sit back to back.

    The partner is searched FORWARD along the band, not taken from the next
    position. Ordering has already been decided by zoning and by which rooms
    need daylight, so the room next in line is very often solo or lit and
    cannot pair; refusing to look past it left the small rooms unpaired and
    strung out down the band, which is where most of the slivers came from.
    Order is otherwise preserved: a partner is lifted forward to its
    neighbour rather than the band being re-sorted.
    """
    def _thin(req: SpaceRequirement) -> bool:
        span = (_target(req) or 1) // max(1, depth)
        return span > 0 and depth / span > _MAX_ASPECT

    def _can_pair(a: SpaceRequirement, b: SpaceRequirement) -> bool:
        if a.solo or b.solo:
            return False
        # A pair puts one room behind the other, so the inner one reaches
        # the corridor and the outer one reaches the outside -- never both.
        # A room that has to do both cannot be in a pair at all. The entry
        # is exactly that room: it is the front door AND the way onto the
        # passage. Pairing it with a store put the store on the passage and
        # left the entry opening only into the store, which cut the route
        # out of the house and left four bedrooms with no way out.
        if a.function in _NEVER_PAIRED or b.function in _NEVER_PAIRED:
            return False
        if _tile_width(a) + _tile_width(b) > depth:
            return False
        if depth < 2 * (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE):
            return False
        # Only one room in a pair touches the outside wall; the other is
        # against the corridor. So two rooms that both need daylight can
        # never share a slice -- one of them would come out windowless,
        # which is how a bedroom ended up in the middle of the plan.
        return not (a.needs_exterior_wall and b.needs_exterior_wall)

    remaining = list(rooms)
    rows: list[_Row] = []
    while remaining:
        key, req = remaining.pop(0)
        target = _target(req) or 1
        if not _thin(req) or req.solo:
            rows.append(_Row([(key, req)], target, depth))
            continue

        partner = next(
            (i for i, (_k, other) in enumerate(remaining)
             if _thin(other) and _can_pair(req, other)),
            None,
        )
        if partner is None:
            # No thin partner left. An odd number of small rooms strands the
            # last one, and stranded is the worst place to be: a WC alone on
            # a 5.9 m band is 5879 x 623. Pair it with a room that is NOT
            # thin instead -- the big room gives up the depth the small one
            # needs and keeps the rest, which is what a plan does when it
            # tucks a WC in behind a bedroom.
            partner = next(
                (i for i, (_k, other) in enumerate(remaining)
                 if _can_pair(req, other)
                 and depth - (_tile_width(req) or _ABSOLUTE_MIN_DIM)
                 >= max(_tile_width(other),
                        _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)),
                None,
            )
        if partner is None:
            rows.append(_Row([(key, req)], target, depth))
            continue

        next_key, next_req = remaining.pop(partner)
        rows.append(
            _Row([(key, req), (next_key, next_req)],
                 target + (_target(next_req) or 1), depth)
        )

    # A forward search cannot help the LAST room: an odd number of small
    # rooms strands whichever one sorts last, and the WC sorts last on every
    # sleep wing this solver builds. So sweep back over the rows and merge
    # any single thin room into an earlier single row that can carry it.
    for i in range(len(rows) - 1, -1, -1):
        row = rows[i]
        if len(row.rooms) != 1:
            continue
        key, req = row.rooms[0]
        if req.solo or not _thin(req):
            continue
        # The SMALLEST host that can carry it, not the first one found.
        # A pair shares the row's length and splits its depth, so a WC merged
        # into the living room's row gets the living room's length: 1072 x
        # 8218 mm, which is not a WC but a corridor with a toilet at the end
        # of it. Forty-five of the sixty-seven plans in the lot sweep drew a
        # room with no wall left to stand its own fittings against, and the
        # WC was one on every single one of them.
        #
        # This is a better choice among the same candidates rather than a new
        # rule about which are allowed: nothing that could be paired before
        # cannot be paired now.
        able = [
            j for j in range(len(rows))
            if j != i and len(rows[j].rooms) == 1
            and _can_pair(req, rows[j].rooms[0][1])
            and depth - (_tile_width(req) or _ABSOLUTE_MIN_DIM)
            >= max(_tile_width(rows[j].rooms[0][1]),
                   _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE)
        ]
        host = min(able, key=lambda j: rows[j].target) if able else None
        if host is None:
            continue
        rows[host].rooms.append((key, req))
        rows[host].target += _target(req) or 1
        rows.pop(i)
    return rows


def _apportion(spans: list[int], floors: list[int], total: int, warnings: list[str]) -> list[int]:
    """Fit a set of sizes into a fixed total without going under any floor.

    Anything below its floor is raised to it, and the shortfall is taken
    from whichever rows have slack, in proportion to how much they have.
    When there is not enough to go round the caller is told, because a plan
    that quietly ignores a minimum is worse than one that admits it cannot
    meet it.
    """
    if sum(floors) > total > 0:
        # No allocation gives every row its floor, so the question is only
        # who pays. Sharing it in proportion to what each row NEEDED is the
        # answer; the code below cannot reach that conclusion, because with
        # every row already under its floor there are no donors to take from
        # and it breaks out having changed nothing -- leaving the
        # area-proportional split standing. That split is brutal to a small
        # room: three bedrooms on a 15 x 28 m lot put the WC at 285 mm and
        # the master bedroom at 2554, when the honest answer is that both are
        # about 61 per cent of what they need.
        wanted = sum(floors)
        sizes = [max(1, f * total // wanted) for f in floors]
        sizes[max(range(len(sizes)), key=lambda i: sizes[i])] += total - sum(sizes)
        warnings.append(
            f"A band is about {(wanted - total) / 1000:.1f} m short of what "
            f"the rooms on it need -- {total / 1000:.1f} m of length for "
            f"{wanted / 1000:.1f} m of rooms. Every room on it was reduced to "
            f"about {total * 100 // wanted} per cent of the length it asked "
            "for, so the shortfall is shared rather than taken out of the "
            "smallest room."
        )
        return sizes

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
    pinned: dict[str, int] | None = None,
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

    # A row whose run was settled on another floor. The stair is the only one:
    # a flight has to take the same length of the same band on every floor it
    # passes through, or it arrives under the floor above. The rest of the
    # band is apportioned again over what is left, so the pin costs the other
    # rooms length rather than pushing the row off the end of the band.
    if pinned:
        for i, row in enumerate(rows):
            want = next((pinned[k] for k, _ in row.rooms if k in pinned), None)
            if want is None or want == spans[i]:
                continue
            free = span_total - want
            rest = [j for j in range(len(rows)) if j != i]
            if want > spans[i] and free < sum(floors[j] for j in rest):
                # Giving the flight MORE would take another row under its
                # own minimum, so this floor cannot honour the run. Taking
                # length away never can: whatever the flight gives up, the
                # rest of the band gets, so a shrinking pin is always
                # allowed -- including on a band already over-subscribed,
                # where every row is under its floor and this test would
                # otherwise refuse a pin that helps them.
                continue
            spans[i] = want
            if rest:
                share = _apportion([spans[j] for j in rest],
                                   [floors[j] for j in rest], free, warnings)
                for j, v in zip(rest, share):
                    spans[j] = v
            break

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
        # The portico takes the NARROWER side, so the wider one is left for
        # the garage. Taking the roomier side put a 4208 mm portico beside a
        # 4120 mm "double" garage on a 12 m frontage -- a covered porch wider
        # than the room meant to hold two cars.
        on_left = left_w <= right_w
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


    # An empty side is a hole in the house. The frontage is a reserved
    # rectangle and what goes in it has to tile it, but the rooms are placed
    # either side of a door positioned for the passage behind it -- so a side
    # with nothing to put in it was simply left as floor that no room covers.
    # The width goes to whatever is already against it.
    if not right and right_w > 0:
        if portico_rect is not None and portico_rect.x >= slot_x + slot_w:
            portico_rect = Rect(portico_rect.x, portico_rect.y,
                                portico_rect.w + right_w, portico_rect.h)
        else:
            slot_w += right_w
        right_w = 0
    elif not left and left_w > 0:
        if portico_rect is not None and portico_rect.x1 <= slot_x:
            portico_rect = Rect(strip.x, portico_rect.y,
                                portico_rect.w + left_w, portico_rect.h)
        else:
            slot_x -= left_w
            slot_w += left_w
        left_w = 0
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


def _garage_column(
    storey: int,
    garage: tuple[str, SpaceRequirement],
    other_front: list[tuple[str, SpaceRequirement]],
    left_rooms: list,
    right_rooms: list,
    corridor: tuple[str, SpaceRequirement],
    full: Rect,
    corridor_width: int,
    road_first: bool,
    warnings: list[str],
    pinned: dict[str, int] | None = None,
) -> tuple[list[Cell], Rect] | None:
    """The garage in a column of its own, so the frontage stops being 6 m deep.

    The front strip is as deep as a car needs -- about 6 m -- and it is that
    deep across the WHOLE frontage, because it is one rectangle. Beside the
    garage sit the entry, the portico, sometimes a store: rooms that need
    about two metres of depth and are given six. Measured across sixty-seven
    plans that is 1041 m2 of floor the rooms in it never asked for, while the
    bands behind them are over-subscribed.

    Taking the garage OUT of the strip is what reaches it. The garage becomes
    a column at one end of the frontage running back from the street, the
    strip beside it shrinks to the depth the front door actually needs, and
    the four metres that frees across the rest of the frontage go to the
    bands. Every piece is still a rectangle, so the floor still tiles exactly.

    This is also how the frontage reads on a project home: the garage door
    and the front door side by side, the garage as deep as the house is at
    that end, and the rest of the elevation the height of one storey rather
    than a six-metre-deep box.

    Returns the cells and the strip the frontage now has, or None where the
    column will not fit.
    """
    _key, greq = garage
    # Wide enough for what the garage is FOR. Its declared minimum width is
    # 3200 mm, which is a single bay; the figure the plan is checked against
    # afterwards is _DOUBLE_GARAGE_WIDTH, so use that here rather than draw a
    # column too narrow and report it later.
    wide = _tile_width(greq) or _ABSOLUTE_MIN_DIM
    if (greq.min_area or 0) >= _DOUBLE_GARAGE_WIDTH * _DOUBLE_GARAGE_DEPTH:
        wide = max(wide, _DOUBLE_GARAGE_WIDTH + _WALL_ALLOWANCE)
    deep = max(_DOUBLE_GARAGE_DEPTH + _WALL_ALLOWANCE,
               -(-(_target(greq) or 0) // max(1, wide)))
    if wide + corridor_width + _MIN_TILE > full.w:
        return None
    if deep >= full.h - _MIN_TILE:
        return None

    # What is left of the frontage, and how deep it has to be for the rooms
    # still on it. The entry has to reach from the street to the passage, so
    # it sets the floor.
    strip_w = full.w - wide
    need = sum(_target(r) or 0 for _, r in other_front)
    strip_h = max(
        _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE,
        -(-need // max(1, strip_w)),
        max((_tile_width(r) or 0) for _, r in other_front) if other_front else 0,
    )
    strip_h = min(strip_h, deep)
    if full.h - strip_h < _MIN_TILE * 2:
        return None

    strip = Rect(full.x + wide, full.y, strip_w, strip_h)
    corridor_rect = Rect(full.x + wide, full.y + strip_h,
                         corridor_width, full.h - strip_h)
    right_band = Rect(corridor_rect.x1, corridor_rect.y,
                      full.x1 - corridor_rect.x1, corridor_rect.h)
    if right_band.w < _MIN_TILE:
        return None

    # The garage takes the street end of its own column and the rooms of the
    # left band fall in behind it. It is laid out FIRST, at the run a car
    # needs, rather than stacked with them: `_stack` shares a shortfall out
    # over every row, and on an over-subscribed band that drew the garage
    # 4703 mm deep. A car does not share the shortfall. What is left of the
    # column is what the rooms behind get, and if that is not enough they say
    # so the way they always have.
    if full.h - deep < _MIN_TILE:
        return None
    column = Rect(full.x, full.y + deep, wide, full.h - deep)
    placed = [(garage[0], garage[1], Rect(full.x, full.y, wide, deep))]
    placed += _stack(_order_for_road(left_rooms, road_first), column, True,
                     warnings, outer_low=True, pinned=pinned)
    placed += _stack(_order_for_road(right_rooms, road_first), right_band, True,
                     warnings, outer_low=False, pinned=pinned)
    cells = [Cell(key, req.name, req.function, rect, storey, req)
             for key, req, rect in placed]
    cells.append(Cell(corridor[0], corridor[1].name, Function.CORRIDOR,
                      corridor_rect, storey, corridor[1]))
    return cells, strip


def _two_bands(
    storey: int,
    left_rooms: list,
    right_rooms: list,
    corridor: tuple[str, SpaceRequirement],
    envelope: Rect,
    vertical: bool,
    corridor_width: int,
    left_depth: int,
    right_depth: int,
    road_first: bool,
    warnings: list[str],
    pinned: dict[str, int] | None = None,
) -> list[Cell]:
    """The single spine: band, passage, band. The default form."""
    left_rooms = _order_for_road(left_rooms, road_first)
    right_rooms = _order_for_road(right_rooms, road_first)

    cells: list[Cell] = []
    if vertical:
        left_band = Rect(envelope.x, envelope.y, left_depth, envelope.h)
        corridor_rect = Rect(envelope.x + left_depth, envelope.y,
                             corridor_width, envelope.h)
        right_band = Rect(corridor_rect.x1, envelope.y, right_depth, envelope.h)
        # The left band's outside wall is its low edge; the right band's is
        # its high edge, because the corridor is on its low side.
        placed = _stack(left_rooms, left_band, True, warnings, outer_low=True,
                        pinned=pinned)
        placed += _stack(right_rooms, right_band, True, warnings,
                         outer_low=False, pinned=pinned)
    else:
        left_band = Rect(envelope.x, envelope.y, envelope.w, left_depth)
        corridor_rect = Rect(envelope.x, envelope.y + left_depth,
                             envelope.w, corridor_width)
        right_band = Rect(envelope.x, corridor_rect.y1, envelope.w, right_depth)
        placed = _stack(left_rooms, left_band, False, warnings, outer_low=True)
        placed += _stack(right_rooms, right_band, False, warnings, outer_low=False)

    for key, req, rect in placed:
        cells.append(Cell(key, req.name, req.function, rect, storey, req))
    cells.append(Cell(corridor[0], corridor[1].name, Function.CORRIDOR,
                      corridor_rect, storey, corridor[1]))
    return cells


@lru_cache(maxsize=1)
def _habitable_targets() -> tuple[int, int]:
    """What a habitable room has to reach, read from the baseline rule pack.

    The solver chooses between plan forms, and a chooser needs to know what
    counts as a bad room. Deciding that here would be inventing a figure. The
    baseline pack already states one -- it is the jurisdiction-independent
    floor every plan is checked against afterwards -- so the design targets
    in that pack are what the choice is made on. A plan is then drawn TRYING
    to meet the same numbers it will be measured by, which is the reason
    `design_parameters` exists at all.

    Falls back to nothing rather than to a guess: if the pack cannot be read,
    the targets come back zero and the score falls back to shape alone.
    """
    try:
        from ..codes.engine import load_pack
        design = load_pack("baseline").design
    except Exception:
        return 0, 0
    width = int(design.get("habitable_min_width_mm", 0) or 0)
    area = float(design.get("habitable_min_area_m2", 0) or 0)
    return width, int(area * 1e6)


def _shape_score(cells: list[Cell]) -> tuple[int, int, int]:
    """How well a layout treats its rooms: shape and thinness together.

    `_awkward` counts the lit rooms drawn like a passage. It is the right
    thing to optimise and it is not, on its own, enough to CHOOSE by: a
    layout can trade two of those for several rooms too small to use and come
    out ahead on the count while being worse to live in.

    Too small is the baseline pack's own figure for a habitable room, read
    from its design block -- so the plan is chosen by the same number it will
    be measured by afterwards, and no figure is decided here. Two cheaper
    proxies were tried and both are worse: a flat 1500 mm line lets four
    bedrooms 1853 mm across through, and each room against its own declared
    minimum saturates on an over-subscribed floor and stops discriminating.
    See the packing notes at the top of this file.
    """
    count, excess = _awkward(cells)
    min_width, min_area = _habitable_targets()
    undersized = sum(
        1 for c in cells
        if c.requirement is not None
        and c.function.is_habitable
        and (c.rect.short_side - _WALL_ALLOWANCE < min_width
             or (c.rect.w - _WALL_ALLOWANCE)
                * (c.rect.h - _WALL_ALLOWANCE) < min_area)
    )
    return count + undersized, count, excess


def _awkward(cells: list[Cell]) -> tuple[int, int]:
    """How badly a layout treats the rooms that need daylight.

    (how many read as a passage, by how much in total). Lower is better, and
    it is the thing being optimised, so it is what gets measured -- not a
    proxy for it. Only lit rooms count: a robe or a linen press is allowed to
    be a slot, and counting those would let a layout win by making the
    bathrooms rounder.
    """
    count = excess = 0
    for cell in cells:
        req = cell.requirement
        if req is None or not req.needs_exterior_wall:
            continue
        # Measured on the room, not on the tile. A tile carries half a wall on
        # every side, and the person standing in the room gets what is left --
        # which is thinner, and disproportionately so, because the same
        # allowance comes off a 2.4 m width and a 6 m length alike. Six cases
        # in a sweep of thirty-three are shaped differently depending on which
        # you measure, and on a 20 x 32 m lot it decides whether the layout is
        # judged awkward enough to try a service core at all: one room by the
        # tile, three by the rooms the customer walks into.
        #
        # The exact loss depends on which of a room's walls are exterior and
        # is not known until `walls` runs. `_WALL_ALLOWANCE` is the figure the
        # solver already sizes every tile by, so it is the one to use here.
        inner_w = max(1, cell.rect.w - _WALL_ALLOWANCE)
        inner_h = max(1, cell.rect.h - _WALL_ALLOWANCE)
        short = max(1, min(inner_w, inner_h))
        ratio = max(inner_w, inner_h) / short
        if ratio > _MAX_ASPECT:
            count += 1
            excess += int((ratio - _MAX_ASPECT) * 1000)
    return count, excess


def _core_split(
    left: list[tuple[str, SpaceRequirement]],
    right: list[tuple[str, SpaceRequirement]],
    usable: int,
    run: int,
) -> tuple[list, list, list] | None:
    """Pull the unlit rooms into a middle band, or decline to.

    A single spine puts every room across one of two bands, so on a wide
    frontage each band is half the frontage deep and every room spans it: a
    bedroom on an 18 m frontage comes out 7161 x 2127. Pairing is the usual
    answer and it cannot help here, because two rooms that both need daylight
    can never share a slice -- and a sleep wing is nothing but rooms that need
    daylight.

    What a wide house actually does is put the rooms that DON'T need a window
    -- bathrooms, robes, the laundry, the pantry -- in the middle, with a
    passage down each side of them. Three shallower bands instead of two deep
    ones, and every lit room still has an external wall.

    Returns (left, core, right) or None when the form does not apply: when the
    bands are not deep enough to be worth splitting, or when there are too few
    unlit rooms to make a middle out of.
    """
    lit = [kr for kr in left + right if kr[1].needs_exterior_wall]
    unlit = [kr for kr in left + right if not kr[1].needs_exterior_wall]
    if not lit or len(unlit) < 3:
        return None

    # Count what a two-band layout would actually do to the lit rooms, rather
    # than compare depths to a target depth.
    #
    # A room of area A spanning a band of depth d is d long by A/d wide, so
    # its proportion is d*d/A, and it reads as a passage past _MAX_ASPECT.
    # Counting the casualties is the honest test because it is the thing
    # being optimised. Two earlier tries measured a DEPTH instead and both
    # were wrong in the same way: whichever room happened to be the largest
    # -- the living room, which is genuinely allowed to be deep -- set the
    # target, and the four bedrooms it was meant to protect never registered.
    two_band_depth = usable // 2
    hurt = [
        kr for kr in lit
        if two_band_depth * two_band_depth
        > _MAX_ASPECT * max(1, _target(kr[1]) or 0)
    ]
    # One awkward room is not worth a second passage; a wing of them is.
    if len(hurt) < 3:
        return None

    core_area = sum(_target(r) or 0 for _k, r in unlit)
    core_depth = -(-core_area // max(1, run))
    if core_depth < _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE:
        return None
    if usable - core_depth < 2 * (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE):
        return None

    lit_left = [kr for kr in left if kr[1].needs_exterior_wall]
    lit_right = [kr for kr in right if kr[1].needs_exterior_wall]
    if not lit_left or not lit_right:
        return None
    return lit_left, unlit, lit_right


def _core_bands(
    storey: int,
    split: tuple[list, list, list],
    corridor: tuple[str, SpaceRequirement],
    envelope: Rect,
    vertical: bool,
    corridor_width: int,
    run: int,
    road_first: bool,
    warnings: list[str],
) -> list[Cell] | None:
    """Lay out band / passage / core / passage / band.

    The two passages have to JOIN. Separated by a core that spans the whole
    run, the far one is reachable only by walking through a bathroom, and
    every room beyond it fails the rule that it can be walked out of -- which
    is the one guarantee this solver will not trade away for a nicer shape.

    So the core band carries a link at one end: the middle strip is laid out
    as [core rooms][link], the link runs the full depth of the middle band,
    and both passages meet it along their ends. That keeps the tiling exact,
    reuses the same stacker as every other band, and costs one room's worth
    of length rather than a special case in the wall builder.
    """
    lit_left, unlit, lit_right = split
    key, req = corridor

    core_area = sum(_target(r) or 0 for _k, r in unlit)
    core_depth = max(_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE,
                     -(-core_area // max(1, run)))
    usable = (envelope.w if vertical else envelope.h) - 2 * corridor_width
    core_depth = min(core_depth, usable - 2 * (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE))
    if core_depth < _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE:
        return None

    spare = usable - core_depth
    left_target = sum(_target(r) or 1 for _k, r in lit_left)
    right_target = sum(_target(r) or 1 for _k, r in lit_right)
    left_depth = max(
        _ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE,
        min(spare - (_ABSOLUTE_MIN_DIM + _WALL_ALLOWANCE),
            spare * left_target // max(1, left_target + right_target)),
    )
    right_depth = spare - left_depth

    # The link, as a room on the core band. It is the corridor requirement
    # again, so it is as wide as a passage has to be and is checked as one.
    link = (f"{key}_link", req)
    core_rooms = _order_for_road(list(unlit), road_first) + [link]

    cells: list[Cell] = []
    if vertical:
        left_band = Rect(envelope.x, envelope.y, left_depth, envelope.h)
        near = Rect(left_band.x1, envelope.y, corridor_width, envelope.h)
        core_band = Rect(near.x1, envelope.y, core_depth, envelope.h)
        far = Rect(core_band.x1, envelope.y, corridor_width, envelope.h)
        right_band = Rect(far.x1, envelope.y, right_depth, envelope.h)
        placed = _stack(_order_for_road(lit_left, road_first), left_band, True,
                        warnings, outer_low=True)
        placed += _stack(core_rooms, core_band, True, warnings)
        placed += _stack(_order_for_road(lit_right, road_first), right_band,
                         True, warnings, outer_low=False)
    else:
        left_band = Rect(envelope.x, envelope.y, envelope.w, left_depth)
        near = Rect(envelope.x, left_band.y1, envelope.w, corridor_width)
        core_band = Rect(envelope.x, near.y1, envelope.w, core_depth)
        far = Rect(envelope.x, core_band.y1, envelope.w, corridor_width)
        right_band = Rect(envelope.x, far.y1, envelope.w, right_depth)
        placed = _stack(_order_for_road(lit_left, road_first), left_band, False,
                        warnings, outer_low=True)
        placed += _stack(core_rooms, core_band, False, warnings)
        placed += _stack(_order_for_road(lit_right, road_first), right_band,
                         False, warnings, outer_low=False)

    for k, r, rect in placed:
        cells.append(Cell(k, r.name, r.function, rect, storey, r))
    cells.append(Cell(key, req.name, Function.CORRIDOR, near, storey, req))
    cells.append(Cell(f"{key}_far", req.name, Function.CORRIDOR, far, storey, req))
    return cells


@dataclass(slots=True)
class _Below:
    """What the ground floor settled, for the floors stacked on top of it.

    A stair has to arrive where it left from, and nothing was holding it:
    each storey is packed on its own, so the flight came out somewhere
    different on every floor. Four things have to agree before it can line
    up, and this carries all four down from the ground floor -- the shape
    being packed, where the spine sits in it, which side of the spine the
    flight is on, and how much of that band's run it takes.

    Matching only the first was tried and moved nothing: the band split is
    decided by each floor's own room areas, so it lands somewhere else
    regardless of the envelope.
    """

    envelope: Rect
    spine_x: int
    stair_left: bool
    stair_span: int


def _layout_storey(
    storey: int,
    rooms: list[tuple[str, SpaceRequirement]],
    envelope: Rect,
    plot: Plot,
    warnings: list[str],
    below: _Below | None = None,
    stair_run: int | None = None,
) -> list[Cell]:
    """Place one floor, stacked on the ground floor where that still works.

    Holding an upper floor to the ground floor's shape and spine is what
    lets the stair line up, and it costs that floor something real: the area
    over the garage, and a spine placed for the rooms downstairs rather than
    its own. Usually the floor can carry it. Where it cannot the rooms come
    out too small to take a door, and the whole plan is then refused -- a
    two-storey house nobody can have, in exchange for a stair that lines up
    on the drawing they no longer get.

    So the floor is laid out both ways and the stacked one is kept only if
    it does not force a room under that limit. Where it is given up the
    stair does not line up, and `_check_stairs_line_up` says so.
    """
    if below is None:
        return _layout_storey_once(storey, rooms, envelope, plot, warnings,
                                   stair_run=stair_run)

    # An attempt that is thrown away must not leave its explanations behind
    # on the report, so each one's notes are kept separate and only the
    # surviving layout's are put back.
    base = len(warnings)
    stacked = _layout_storey_once(storey, rooms, envelope, plot, warnings,
                                  below, stair_run)
    if all(c.rect.short_side >= _MIN_TILE for c in stacked):
        return stacked
    stacked_notes = warnings[base:]

    del warnings[base:]
    loose = _layout_storey_once(storey, rooms, envelope, plot, warnings)
    if min((c.rect.short_side for c in loose), default=0) <= min(
        (c.rect.short_side for c in stacked), default=0
    ):
        del warnings[base:]
        warnings.extend(stacked_notes)
        return stacked
    return loose


def _layout_storey_once(
    storey: int,
    rooms: list[tuple[str, SpaceRequirement]],
    envelope: Rect,
    plot: Plot,
    warnings: list[str],
    below: _Below | None = None,
    stair_run: int | None = None,
) -> list[Cell]:
    """Place one floor: a front zone if there is a garage, then a corridor
    spine down the long axis with rooms either side of it."""
    if not rooms:
        return []

    front_rooms: list[tuple[str, SpaceRequirement]] = []
    strip: Rect | None = None
    # `_front_zone` hands back the remainder BEHIND the strip as `envelope`.
    # A plan form that rearranges the frontage needs the whole floor.
    full_envelope = envelope
    if storey == 0:
        front_rooms, strip, envelope, rooms = _front_zone(
            rooms, envelope, plot, warnings
        )
        if not rooms:
            return _place_front(front_rooms, strip, None, warnings) if strip else []
    spine_x = strip.centre.x if strip is not None else None
    if below is not None:
        # Pack the shape the ground floor packed, with the spine where it put
        # it. An upper floor otherwise packs the whole footprint, including
        # the strip the garage holds below, and splits its bands by its own
        # room areas -- two reasons the stair lands somewhere else.
        envelope = below.envelope
        spine_x = below.spine_x

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
    if below is not None:
        want, other = ((left_rooms, right_rooms) if below.stair_left
                       else (right_rooms, left_rooms))
        moved = [kr for kr in other if kr[1].function is Function.STAIR]
        for kr in moved:
            other.remove(kr)
            want.insert(0, kr)
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

    def _depths(left, right) -> tuple[int, int]:
        """Where the spine sits, given what is on each side of it."""
        left_target = sum(_target(r) or 1 for _, r in left)
        right_target = sum(_target(r) or 1 for _, r in right)
        min_left, min_right = _band_depth(left), _band_depth(right)
        if min_left + min_right <= usable:
            # Both sides can be served. Start from the area-balanced split,
            # then slide the spine towards the entry if that still leaves both
            # bands workable -- the entry alignment is a preference, not a
            # licence to starve a side.
            depth = usable * left_target // max(1, left_target + right_target)
            if spine_x is not None and corridor_vertical:
                depth = spine_x - envelope.x - corridor_width // 2
            depth = max(min_left, min(usable - min_right, depth))
        else:
            # No split gives both sides what they need. Divide in proportion
            # to what each needs, so the shortfall is shared instead of the
            # entry position handing one band everything.
            depth = round(usable * min_left / max(1, min_left + min_right))
        depth = max(_ABSOLUTE_MIN_DIM, min(usable - _ABSOLUTE_MIN_DIM, depth))
        return depth, usable - depth

    left_depth, right_depth = _depths(left_rooms, right_rooms)
    if _band_depth(left_rooms) + _band_depth(right_rooms) > usable:
        warnings.append(
            f"This floor needs about "
            f"{(_band_depth(left_rooms) + _band_depth(right_rooms)) / 1000:.1f} m "
            f"across the corridor and the footprint gives {usable / 1000:.1f} m. "
            "Rooms either side were narrowed to fit."
        )

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

    # Three bands with a service core, where it beats two bands.
    #
    # Beats, measured -- not "where the frontage is wide", which is what the
    # first two versions of this tried. A core is the right answer on a
    # 20 x 32 m lot (five awkward rooms down to none) and the wrong one on a
    # 26 x 28 (none up to five), and no rule of thumb about frontage told
    # those apart. Both layouts are cheap to build, so both get built and the
    # one that treats the lit rooms better wins.
    core = _core_split(left_rooms, right_rooms, usable, run)
    # The run the flight takes, on whichever floor this is. It comes either
    # from the floor below or from the common run `solve` settled across all
    # of them; a stair pinned on the ground floor is how the upper ones get
    # a run they can actually afford.
    run_target = stair_run if stair_run is not None else (
        below.stair_span if below is not None else None)
    pinned = None
    if run_target:
        pinned = {k: run_target
                  for k, r in others if r.function is Function.STAIR}
    plain = _two_bands(storey, left_rooms, right_rooms, corridor, envelope,
                       corridor_vertical, corridor_width, left_depth,
                       right_depth, road_first, [], pinned)
    # Scored on what was BUILT, not on an estimate of it. The estimate said a
    # 15 x 30 m block wanted a core; building it says two of its rooms are
    # awkward, which a second passage is not worth -- and the core it would
    # have chosen there squeezed the double garage to 4897 mm, which is not a
    # double garage. A single spine stays the default and has to be plainly
    # failing before a third band is considered.
    if core is not None and _awkward(plain)[0] >= 3:
        aside: list[str] = []
        core_cells = _core_bands(
            storey, core, corridor, envelope, corridor_vertical,
            corridor_width, run, road_first, aside,
        )
        if core_cells and _shape_score(core_cells) < _shape_score(plain):
            warnings.extend(aside)
            front_cells: list[Cell] = []
            if strip is not None:
                # The passage that RUNS BACK from the frontage, not the
                # first corridor in the list. The service-core form lays a
                # passage down each side of the core and a short link across
                # the back joining the two, and the link is a corridor cell
                # like the others -- so `next` picked it, and the front door
                # was set out over a "passage" 4965 mm wide sitting at the
                # far end of the plan. The entry then landed over the robe
                # and the ensuite, touching neither real passage along
                # anything but a corner.
                #
                # Nothing caught it because the portico beside the entry
                # happened to land over the left-hand passage and carried
                # the whole route out of the house on its own. It is not
                # something to leave to where the porch falls: on the seven
                # plans in the lot sweep that take this form, the entry hall
                # was drawn between 24.6 and 28.0 m2 against the 6.0 it asks
                # for, because it was sized to the width of the wrong thing.
                passage = max(
                    (c for c in core_cells if c.function is Function.CORRIDOR),
                    key=lambda c: c.rect.h if corridor_vertical else c.rect.w,
                    default=None,
                )
                meets = (
                    (passage.rect.x0, passage.rect.x1)
                    if passage is not None and corridor_vertical
                    else None
                )
                front_cells = _place_front(front_rooms, strip, meets, warnings)
            warnings.append(
                "This floor is wide enough that two bands off one passage "
                "would leave rooms spanning half the frontage, so the rooms "
                "that need no window -- the bathrooms, the robes, the "
                "laundry -- were put in a middle band with a passage down "
                "each side of it. Every room that needs daylight still has "
                "an external wall."
            )
            return front_cells + core_cells

    # The garage in a column of its own, where that beats the strip across the
    # frontage. Built and scored the way the service core is: both are cheap
    # to build, so build both and keep the one that treats the rooms better.
    column = _try_the_garage_in_a_column(
        storey, front_rooms, left_rooms, right_rooms, corridor, full_envelope,
        strip, corridor_vertical, corridor_width, road_first, pinned, plain,
        warnings,
    )
    if column is not None:
        return column

    cells = _two_bands(storey, left_rooms, right_rooms, corridor, envelope,
                       corridor_vertical, corridor_width, left_depth,
                       right_depth, road_first, warnings, pinned)
    corridor_rect = next(
        c.rect for c in cells if c.function is Function.CORRIDOR
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


def _try_the_garage_in_a_column(
    storey: int,
    front_rooms: list[tuple[str, SpaceRequirement]],
    left_rooms: list,
    right_rooms: list,
    corridor: tuple[str, SpaceRequirement] | None,
    full: Rect,
    strip: Rect | None,
    corridor_vertical: bool,
    corridor_width: int,
    road_first: bool,
    pinned: dict[str, int] | None,
    plain: list[Cell],
    warnings: list[str],
) -> list[Cell] | None:
    """Build the garage column and keep it only if it measures better.

    Returns the finished floor, or None to leave the strip across the front.
    """
    if strip is None or corridor is None or not corridor_vertical:
        return None
    if not road_first:
        # The geometry below puts the street at the low edge. `road_first`
        # covers south and west, which is most of what a subdivision faces.
        return None
    garage = next(
        (kr for kr in front_rooms if kr[1].function is Function.GARAGE), None
    )
    if garage is None:
        return None
    other_front = [kr for kr in front_rooms if kr is not garage]
    if not other_front:
        return None

    plain_front = _place_front(
        front_rooms, strip,
        next(((c.rect.x0, c.rect.x1) for c in plain
              if c.function is Function.CORRIDOR), None),
        [],
    )
    plain_score = _shape_score(plain + plain_front)

    aside: list[str] = []
    built = _garage_column(
        storey, garage, other_front, left_rooms, right_rooms, corridor, full,
        corridor_width, road_first, aside, pinned,
    )
    if built is None:
        return None
    cells, narrowed = built
    passage = next((c for c in cells if c.function is Function.CORRIDOR), None)
    meets = (passage.rect.x0, passage.rect.x1) if passage else None
    front_cells = _place_front(other_front, narrowed, meets, aside)
    # Keep the column where the strip CANNOT give the garage the depth a car
    # parks along, even when it does not score better.
    #
    # This is not a preference for the column. It is a fallback for one thing
    # the strip cannot do: `_front_zone` sizes the strip to what a car needs
    # and then caps it at a third of the floor's depth, and the cap wins on
    # fifty-five of the sixty-five plans in the AU-WA lot sweep. Letting the
    # strip through the cap was tried and takes the rooms behind under their
    # own minimums -- see packing attempt 11. The column is the other way to
    # the same place: the garage gets the run a car needs and the rest of its
    # column stacks behind it, so the depth comes out of one column rather
    # than out of the whole frontage.
    #
    # Measured over the sweep: 22 plans change, 22 gain a garage that holds
    # two cars, none loses one. On those 22, findings go up by 9 in total --
    # eleven of them gain one apiece, one loses one -- and thin rooms by 40.
    # A double garage that holds one car is a defect the plan itself reports
    # on 54 of 65 plans and a buyer sees at a glance; the findings it costs
    # are habitable rooms under the baseline pack's TARGET width, which the
    # report already describes as a figure to aim at rather than a minimum.
    #
    # `road_first` is guaranteed above, so the street is at the low edge and
    # a garage's depth is always its height.
    def _parks_along(group: list[Cell]) -> int:
        car = next((c for c in group if c.function is Function.GARAGE), None)
        return 0 if car is None else car.rect.h - _WALL_ALLOWANCE

    rescues = (_parks_along(plain + plain_front) < _DOUBLE_GARAGE_DEPTH
               <= _parks_along(cells + front_cells))
    if not rescues and _shape_score(cells + front_cells) >= plain_score:
        return None
    # A form that scores better and forces a sliver is not better. The column
    # takes 5.6 m of a 10.5 m frontage and what is left has to hold the front
    # door, the portico and the store: on one brief that drew a 545 mm
    # portico, and `_refuse_slivers` threw the whole plan out afterwards --
    # a plan the strip across the front draws. This is that same test, asked
    # here where there is still another form to fall back to.
    #
    # It has to be the same test. Asked instead whether the column leaves any
    # room narrower than the strip does, it turned the column down almost
    # everywhere: the shrunken strip always narrows the portico or the store
    # a little, even where the bands behind gain far more than that.
    if any(c.rect.short_side < _MIN_TILE for c in cells + front_cells):
        return None

    warnings.extend(aside)
    warnings.append(
        "The garage runs back from the street in a column of its own rather "
        "than sitting in a strip across the whole frontage. A strip has to be "
        "as deep as a car, and everything beside the garage -- the front "
        "door, the portico -- is then given six metres of depth for rooms "
        "that need two. Standing the garage on its own returns that depth to "
        "the rooms behind."
        + ("" if not rescues else
           " Here it is what lets the garage hold two cars at all: the strip "
           "across the frontage is capped at a share of the floor's depth, "
           "and that cap is below the depth a car parks along.")
    )
    return front_cells + cells


# The template ranks every room it asks for, and the ones it ranks 4 or
# worse are the ones it already treats as extras: the theatre and the
# alfresco sit behind constructor flags, and the portico, the walk-in
# pantry, the garage store and the linen press are what a builder adds when
# the block has room for them. 1 to 3 is the house itself -- the passage,
# the living, the kitchen, the bedrooms, the bathrooms, the laundry. The
# split is the template's, read in the direction the template declares it;
# nothing here decides that a theatre matters less than a bedroom.
_EXTRA_PRIORITY = 4


def _shed_extras(
    placed: list[tuple[str, SpaceRequirement, int]],
    footprint: Rect,
    storeys: int,
    warnings: list[str],
    omitted: list[str] | None = None,
) -> list[tuple[str, SpaceRequirement, int]]:
    """Cut the brief to the block before cutting the rooms to the brief.

    A floor asked to hold 261 m2 of rooms on a 168 m2 footprint does not get
    64 per cent of a house. The shortfall is shared out along the bands, and
    because a band's depth is fixed the whole of it lands on one dimension:
    every bedroom comes out 1321 mm across and the master suite 7.1 m2. The
    warnings said so honestly, and it was still a drawing nobody could
    build.

    What a builder does on a block this size is delete the theatre and the
    alfresco -- not shave a metre and a half off every bedroom. So drop the
    extras, worst-ranked and largest first, until the floor fits, and say
    which ones went. If the floor still does not fit once the extras are
    gone, nothing more is dropped: the house itself is what is left, and the
    existing over-subscription warning is the honest answer.

    A room another surviving room is asked to sit next to is never dropped.
    The portico is exactly that room -- the entry is declared adjacent to it
    -- and the front zone is set out around the pair.
    """
    kept = list(placed)
    for storey in range(storeys):
        while True:
            asked = sum(_target(req) or 0 for _, req, s in kept if s == storey)
            if asked <= footprint.area:
                break
            wanted = {
                name
                for _, req, _ in kept
                for name in req.adjacent_to
            }
            candidates = [
                (i, req)
                for i, (_k, req, s) in enumerate(kept)
                if s == storey
                and req.priority >= _EXTRA_PRIORITY
                and req.key not in wanted
            ]
            if not candidates:
                break
            # A room across the street frontage is shed LAST, because
            # shedding it frees no floor. The front strip is a reserved
            # rectangle as deep as the garage, and whatever the front rooms
            # do not fill is handed to the portico or the entry: on a 15 x 30
            # m lot the theatre was dropped to save 4.5 m2 and the portico
            # was then drawn at 31.7 m2 against the 4.0 it asked for, beside
            # a "double" garage 5553 mm clear that holds one car. The floor
            # was no less over-subscribed for having lost the theatre; the
            # 27.7 m2 simply moved to the porch.
            #
            # Rank, not exemption. Where the extras behind the frontage are
            # gone and the floor still does not fit, a front room is dropped
            # exactly as before.
            i, req = max(
                candidates,
                key=lambda ir: (_is_front(ir[1]) is False,
                                ir[1].priority, _target(ir[1]) or 0),
            )
            kept.pop(i)
            if omitted is not None:
                omitted.append(req.name)
            over = (asked - footprint.area) / 1e6
            warnings.append(
                f"{req.name} was left out of storey {storey}. The rooms asked "
                f"for are {over:.1f} m2 more than the {footprint.area / 1e6:.1f} "
                f"m2 the footprint gives, and {req.name} is an extra rather "
                "than part of the house. Drawing it would have come out of "
                "the width of every bedroom instead."
            )
    return kept


# What a cap on site cover has to leave room for. The tiles the solver lays
# meet on wall CENTRELINES, so the built outline runs half an external wall
# outside them on every side -- the difference between a 234 m2 tiling and
# the 241 m2 of ground it actually covers. A cap read as tile area is a cap
# quietly exceeded.
#
# The figure is the thickest external wall the construction catalogue in
# `layout.walls` carries. Which system a plan is built in is not known here
# and does not have to be: reserving for the thickest makes the house a few
# centimetres smaller than a timber-framed one could be, and reserving for
# the thinnest would let a brick one creep over a limit it is checked
# against. Being under a cap costs frontage; being over it costs the permit.
def _thickest_exterior_wall() -> int:
    from .walls import CONSTRUCTION
    return max(system["exterior"] for system in CONSTRUCTION.values())


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
        # Filling the envelope is only allowed if the envelope itself fits
        # under the cap once its walls are counted. Returning here without
        # asking was how three Karachi plans stayed 0.02 over their
        # floor-area ratio after the trim was added: the trim was never
        # reached on the one path that hands back the whole envelope.
        deep = _depth_within_the_cap(
            envelope.w, envelope.h, max_footprint, warnings
        )
        if deep >= envelope.h:
            return envelope
        if plot.road_side == "north":
            return Rect(envelope.x, envelope.y1 - deep, envelope.w, deep)
        return Rect(envelope.x, envelope.y, envelope.w, deep)

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


    depth = _depth_within_the_cap(width, depth, max_footprint, warnings)

    # Push the building up against the road frontage; the slack falls behind.
    # Done after the trim, so that whichever edge the building is held to, it
    # is still held to it once the depth has come off.
    if plot.road_side == "north":
        return Rect(envelope.x, envelope.y1 - depth, width, depth)
    if plot.road_side == "east":
        return Rect(envelope.x1 - width, envelope.y, width, depth)
    return Rect(envelope.x, envelope.y, width, depth)


def _depth_within_the_cap(
    width: int, depth: int, max_footprint: int | None, warnings: list[str]
) -> int:
    """How deep the footprint may be before the ground it COVERS breaks the cap.

    The tiles meet on wall centrelines, so the built outline runs half an
    external wall outside them on every side: a cap spent on tile area is a
    cap quietly exceeded. Depth goes before frontage, because a plan wants
    its frontage and the depth comes out of the back garden either way.
    """
    if max_footprint is None:
        return depth
    wall = _thickest_exterior_wall()
    while ((width + wall) * (depth + wall) > max_footprint
           and depth > _ABSOLUTE_MIN_DIM * 2):
        depth -= 25
    depth = max(_ABSOLUTE_MIN_DIM * 2, depth)
    if (width + wall) * (depth + wall) > max_footprint:
        warnings.append(
            f"The planning limits here allow {max_footprint / 1e6:.0f} m² a "
            "floor and the smallest footprint this brief can be laid out on "
            "covers more than that once the external walls are counted. The "
            "plan is drawn to the smallest that works; check the cover and "
            "floor-area figures in the report."
        )
    return depth


def _common_stair_run(
    program: SpaceProgram,
    placed: list[tuple[str, SpaceRequirement, int]],
    footprint: Rect,
    plot: Plot,
) -> int | None:
    """The run every floor can give the flight, so they can all take the same.

    Pinning the upper floors to the GROUND floor's run is the wrong way
    round. The ground floor gets its run from its own apportionment and it is
    often the most generous -- 2295 mm where a stair of that width needs
    1734 -- and an upper floor that can only spare 2214 then refuses the pin
    and lands somewhere else, over eighty millimetres of slack that neither
    floor wanted.

    So ask every floor what it would give unpinned, take the smallest, and
    hold it against what a stair of that width actually needs. Everything
    above that floor is negotiable; below it the flight stops being a flight,
    and that floor genuinely cannot stack.

    Costs one extra layout of each storey. That is cheap, and it is the only
    way to know: what a floor can spare is decided by the apportionment,
    which is decided by every other room on it.
    """
    if program.storeys < 2:
        return None

    def _flight(storey: int, below: _Below | None) -> Cell | None:
        rooms = [(k, r) for k, r, s in placed if s == storey]
        if not rooms:
            return None
        try:
            cells = _layout_storey(storey, rooms, footprint, plot, [], below)
        except LayoutError:
            return None
        return next((c for c in cells if c.function is Function.STAIR), None)

    ground = _flight(0, None)
    if ground is None:
        return None
    base = _ground_floor([ground], footprint)
    if base is None:
        # The ground floor's own cells are needed for the envelope and spine,
        # not just the flight; ask for them properly.
        rooms = [(k, r) for k, r, s in placed if s == 0]
        try:
            base = _ground_floor(
                _layout_storey(0, rooms, footprint, plot, []), footprint)
        except LayoutError:
            return None
        if base is None:
            return None

    # Probe each upper floor in the stacked geometry with the run left free,
    # which is what it can actually spare there. Asking an unstacked floor is
    # meaningless: it puts the flight in a different band of a different
    # width, so its run is not a figure the stacked floor could honour.
    loose = _Below(base.envelope, base.spine_x, base.stair_left, 0)
    runs = [ground.rect.h]
    needs = 0
    req = ground.requirement
    if req is not None and req.min_area:
        needs = -(-_tile_area(req.min_area) // max(1, ground.rect.w))
    for storey in range(1, program.storeys):
        flight = _flight(storey, loose)
        if flight is None:
            return None
        runs.append(flight.rect.h)
    if not runs:
        return None
    return max(min(runs), needs) or None


def _ground_floor(cells: list[Cell], footprint: Rect) -> _Below | None:
    """Read back what the ground floor settled, for the floors above it.

    Taken from the cells rather than returned out of the packer because the
    packer decides all of it in different places -- the envelope after the
    front zone is carved, the spine after the bands are balanced, the side
    and the run of the flight after the rows are apportioned. The corridor
    cell carries the first two: it spans the envelope, so its extent IS the
    envelope's along the run, and its centre is the spine.
    """
    corridor = next((c for c in cells if c.function is Function.CORRIDOR), None)
    stair = next((c for c in cells if c.function is Function.STAIR), None)
    if corridor is None or stair is None:
        return None
    if corridor.rect.h < corridor.rect.w:
        return None                       # spine runs across; not handled here
    return _Below(
        envelope=Rect(footprint.x, corridor.rect.y,
                      footprint.w, corridor.rect.h),
        spine_x=corridor.rect.centre.x,
        stair_left=stair.rect.x < corridor.rect.x,
        stair_span=stair.rect.h,
    )


# What two cars need side by side, and the depth to get out of them. The
# template's own comment has always carried these figures; its declared
# minimum WIDTH is 3.2 m, which is one bay, so nothing has been stopping a
# room labelled "Double Garage" coming out 3724 mm across.
_DOUBLE_GARAGE_WIDTH = 5400
_DOUBLE_GARAGE_DEPTH = 6000


# A Double Garage that only holds one car has to say so, and that check now
# lives in `layout.walls.check_the_garage_holds_its_cars`, called from
# `build_building`. It was here, and it could not be right here: at this
# point the walls do not exist, so it measured the tile less a flat
# `_WALL_ALLOWANCE` and printed a garage 130 mm narrower and 106 mm deeper
# than the one the drawing shows. One report gave both figures, four lines
# apart, for the same room.
#
# It also read the tile as short-side-is-the-width, which is only true of a
# garage deeper than it is wide. On the ones that are not -- and a strip
# across a wide frontage makes them -- it tested the width against the depth
# limit and the depth against the width limit.


def _check_stairs_line_up(layout: Layout) -> None:
    """A stair occupies the same rectangle on every floor it passes through.

    Upper floors are stacked on the ground floor so that most of them do --
    same envelope, same spine, same side of it, same run of the band. Some
    still cannot: a band too short to give the flight its run, a floor with
    too few rooms to be worth a corridor at all, which is sliced across the
    whole envelope with no bands to pin into, or a floor that would have had
    a room squeezed under the size that takes a door and was laid out loose
    instead.

    One more thing was tried against the ones that remain and did not work,
    which is worth recording because it looks obviously right. The spine is
    pinned as a preference and then clamped to each floor's own band
    minimums, so it can still shift by tens of millimetres -- enough to miss.
    Holding it hard instead aligned NOTHING extra, in either engine: the two
    cases it changed went from differing in width to differing in run, still
    misaligned, and it cost nine more privacy findings because the bands move
    and bedrooms end up nearer a boundary. Reverted.

    Those are still drawn, because a two-storey house with the rest of it
    right is worth more than a refusal. This says so, in the terms a builder
    would use, so nothing goes out claiming to be buildable when the stair
    does not connect. A drawing that cannot be built should say so rather
    than be quietly issued.

    One approach has been tested against this and does NOT work, which is
    worth knowing before anyone builds it. Making the upper storeys pack the
    SAME envelope as the ground floor -- carving the front strip's depth off
    every floor, not just the one with the garage in it -- changes nothing:
    twelve cases, twelve misalignments, before and after. The floors do not
    merely pack different shapes, they pack different room LISTS, so the
    band split and the row apportionment come out different anyway. The
    stair has to be pinned, not the envelopes matched.

    It goes on `warnings` rather than `unsatisfied` because that is the list
    that reaches the sheet and the code report. `unsatisfied` is printed by
    the CLI and nowhere else, and a defect that only appears in somebody's
    terminal is not declared on the drawing a customer is handed.
    """
    flights: dict[int, list[Cell]] = {}
    for cell in layout.cells:
        if cell.function is Function.STAIR:
            flights.setdefault(cell.storey, []).append(cell)
    floors = sorted(flights)
    for lower, upper in zip(floors, floors[1:]):
        for below in flights[lower]:
            if any(above.rect == below.rect for above in flights[upper]):
                continue
            where = ", ".join(
                f"{c.rect.w}x{c.rect.h} at {c.rect.x},{c.rect.y}"
                for c in flights[upper]
            )
            layout.warnings.append(
                f"The stair does not line up between floor {lower} and floor "
                f"{upper}: it is {below.rect.w}x{below.rect.h} at "
                f"{below.rect.x},{below.rect.y} below and {where} above. A "
                "flight has to arrive in the same place it leaves from, so "
                "this cannot be built as drawn -- each floor is packed on "
                "its own and nothing yet holds the stair still between them."
            )


def _refuse_slivers(layout: Layout, program: SpaceProgram, footprint: Rect) -> None:
    """Refuse a plan whose rooms have been squeezed out of existence.

    The solver already said, at the top of this file, that a room under 900 mm
    across is unusable whatever a code says and that it refuses to emit one.
    It did not refuse. Asked for five bedrooms on a 9 x 22 m lot -- a program
    needing 266 m2 where the footprint gives 70 -- it warned that rooms had
    been "scaled down proportionally" and then drew a linen cupboard 139 mm
    deep and a WC with a dimension of zero.

    A warning is the wrong instrument for that. Somebody reads the drawing,
    not the log, and a plan of slivers is not a small version of a good plan;
    it is a picture of something that cannot be built. So it is refused, and
    the refusal says what would fit instead, because the answer the customer
    needs is a number of storeys or a number of bedrooms, not a rectangle.
    """
    slivers = sorted(
        (c for c in layout.cells if c.rect.short_side < _MIN_TILE),
        key=lambda c: c.rect.short_side,
    )
    if not slivers:
        return

    worst = ", ".join(
        f"{c.name} at {c.rect.w} x {c.rect.h} mm" for c in slivers[:3]
    )
    more = f" and {len(slivers) - 3} more" if len(slivers) > 3 else ""
    asked = max(
        (sum(_target(c.requirement) or 0
             for c in layout.cells
             if c.storey == storey and c.requirement is not None)
         for storey in range(program.storeys)),
        default=0,
    )
    available = footprint.area
    advice = ""
    if available > 0 and asked > available:
        floors = -(-asked // available)
        advice = (
            f" The brief needs about {asked / 1e6:.0f} m2 per floor and this "
            f"footprint gives {available / 1e6:.0f} m2, so it wants about "
            f"{floors} storeys, a bigger lot, or fewer rooms."
        )
    raise LayoutError(
        f"This brief does not fit on this lot. Laying it out forces "
        f"{len(slivers)} room{'s' if len(slivers) != 1 else ''} under "
        f"{_UNBUILDABLE} mm across, which will not take a door: "
        f"{worst}{more}.{advice} Nothing was drawn, because a plan of slivers "
        "is not a smaller version of a good plan."
    )


def solve(
    program: SpaceProgram, plot: Plot, max_footprint: int | None = None,
    max_gross_area: int | None = None,
) -> Layout:
    """Lay the program out on the plot's buildable envelope.

    `max_footprint` is how a jurisdiction's site coverage limit reaches the
    solver. Passing it means the plan is built within the limit rather than
    built freely and failed afterwards -- the rule engine still checks it,
    but on a design that was trying to comply.

    `max_gross_area` is the same idea for a floor-area-ratio cap, and it is
    the tighter of the two the moment a plan goes up. Site cover limits the
    footprint; a ratio limits the footprint TIMES the number of storeys, so a
    three-storey brief inside its cover cap can be half again over its ratio.
    Fifteen of a hundred and six Pakistani plans were, by up to 0.25 -- every
    one of them under its cover cap, none of them told about the other limit.
    Both are gross areas measured over the walls, so they compare directly.
    """
    if plot.road_side in ("east", "west"):
        # Solve it turned, then turn the answer back.
        #
        # Everything downstream of here is written for a street running
        # east-west: `_front_zone` lays its strip across x at the low or high
        # y, the spine runs the depth, `_place_front` sets the door out along
        # x. Half of that reads `road_side` and half of it does not, so a lot
        # fronting east came out with its garage strip on a side boundary and
        # the passage running across the frontage -- 169 findings on a sweep
        # where the same lot facing south gets 64.
        #
        # Rotating the problem is not a shortcut around writing it properly;
        # it IS writing it properly. A plan on a lot turned ninety degrees is
        # the same plan turned ninety degrees, and one implementation that is
        # exercised by every case beats two that agree only where they were
        # both remembered.
        turned = replace(
            plot,
            rect=Rect(plot.rect.y, plot.rect.x, plot.rect.h, plot.rect.w),
            boundary=[Point(pt.y, pt.x) for pt in plot.boundary]
            if plot.boundary else None,
            road_side="north" if plot.road_side == "east" else "south",
            setback_left=plot.setback_right,
            setback_right=plot.setback_left,
            _buildable=None,
        )
        laid = solve(program, turned, max_footprint, max_gross_area)
        flip = lambda r: Rect(r.y, r.x, r.h, r.w)   # noqa: E731
        laid.cells = [replace(c, rect=flip(c.rect)) for c in laid.cells]
        if laid.envelope is not None:
            laid.envelope = flip(laid.envelope)
        return laid

    if max_gross_area is not None and program.storeys > 0:
        per_floor = max_gross_area // program.storeys
        max_footprint = (per_floor if max_footprint is None
                         else min(max_footprint, per_floor))
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

    placed = _shed_extras(placed, footprint, program.storeys,
                          layout.warnings, layout.omitted)

    common_run = _common_stair_run(program, placed, footprint, plot)
    below: _Below | None = None
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
        cells = _layout_storey(storey, rooms, footprint, plot, layout.warnings,
                               below, common_run)
        layout.cells.extend(cells)
        if storey == 0:
            below = _ground_floor(cells, footprint)

    _check_stairs_line_up(layout)
    _refuse_slivers(layout, program, footprint)

    for cell in layout.cells:
        req = cell.requirement
        if req is None:
            continue
        clear_area = max(0, cell.area - _WALL_ALLOWANCE * (cell.rect.w + cell.rect.h))
        if req.min_area and clear_area < req.min_area:
            # Both figures are shown to a tenth of a square metre, and a
            # shortfall smaller than that prints as "36.0 m² clear; 36.0 m²
            # was asked for" -- a sentence that says a room missed a target
            # it visibly meets. This file is the one the customer is handed,
            # so say which it is rather than leave them to work out that the
            # two identical numbers are not identical.
            short = req.min_area - clear_area
            by = (
                "which is short by less than 0.1 m²"
                if round(clear_area / 1e6, 1) == round(req.min_area / 1e6, 1)
                else f"which is {short / 1e6:.1f} m² short"
            )
            layout.unsatisfied.append(
                f"{cell.name} is about {clear_area / 1e6:.1f} m² clear; "
                f"{req.min_area / 1e6:.1f} m² was asked for, {by}."
            )
        clear_width = cell.rect.short_side - _WALL_ALLOWANCE
        if req.min_width and clear_width < req.min_width:
            layout.unsatisfied.append(
                f"{cell.name} is about {clear_width} mm across; "
                f"{req.min_width} mm was asked for."
            )
        elif clear_width < _ABSOLUTE_MIN_DIM:
            # No minimum was asked for, so nothing above catches it -- and a
            # room 700 mm across is unusable whether or not the brief
            # bothered to say so. A linen press with no stated width is still
            # a linen press nobody can open.
            layout.unsatisfied.append(
                f"{cell.name} is about {clear_width} mm across, which is "
                f"under the {_ABSOLUTE_MIN_DIM} mm below which a room is not "
                "usable whatever a code says. No minimum was asked for it, "
                "so nothing above reports it."
            )

    return layout
