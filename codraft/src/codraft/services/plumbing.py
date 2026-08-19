"""A schematic plumbing layout.

Sanitary fixtures set out against the walls that can take them, a soil and
vent stack serving the wet rooms, and cold, hot and waste runs drawn back
to it orthogonally.

What is deliberately absent: pipe diameters, falls, flow rates, pressures,
vent sizing, trap seals, hot water storage capacity and drainage
connections beyond the building line. Those are the plumbing engineer's,
they depend on things no floor plan carries, and inventing them would be
the most dangerous thing this package could do.
"""

from __future__ import annotations

from ..geom import Point
from ..model import Building, Function
from .model import Fixture, Run, ServicesPlan
from ..symbols import footprint
from .placement import longest_free_side, pack_along_wall, route

# Clear floor a person needs to stand and use a fitting. Codes differ on
# the exact figure and on where it is measured from, but none of them is
# happy with less than this.
MIN_CLEARANCE = 600

# The smallest room that can take a shower as well as a WC and basin.
SHOWER_MIN_AREA_M2 = 3.2
BATH_MIN_AREA_M2 = 5.5


def _wet_rooms(storey) -> list:
    return [s for s in storey.spaces if s.function.is_wet]


def _stack_position(storey, wet) -> tuple[int, int] | None:
    """Put the stack where it serves the most fixtures with the least pipe.

    A single stack in the middle of the wet rooms is what a plumber wants
    and what a structural engineer will tolerate. Spreading fixtures across
    the plan and running them to separate stacks is how a house ends up
    with four holes through a slab.
    """
    if not wet:
        return None
    xs = [s.rect.centre.x for s in wet]
    ys = [s.rect.centre.y for s in wet]
    centroid = (sum(xs) // len(xs), sum(ys) // len(ys))

    # Anchor it to a corner of whichever wet room is nearest that centroid,
    # because a stack stands in a corner, not in the middle of a floor.
    nearest = min(
        wet,
        key=lambda s: abs(s.rect.centre.x - centroid[0])
        + abs(s.rect.centre.y - centroid[1]),
    )
    corner = min(
        nearest.rect.corners(),
        key=lambda c: abs(c.x - centroid[0]) + abs(c.y - centroid[1]),
    )
    # Bring it just inside the room so it is not drawn on the wall line.
    inward_x = 250 if corner.x == nearest.rect.x0 else -250
    inward_y = 250 if corner.y == nearest.rect.y0 else -250
    return (corner.x + inward_x, corner.y + inward_y)


def design_plumbing(building: Building, storey_index: int) -> ServicesPlan:
    """Lay out the sanitary services for one floor."""
    storey = building.storey(storey_index)
    if storey is None:
        raise ValueError(f"the building has no storey {storey_index}")

    plan = ServicesPlan(discipline="plumbing", storey=storey_index)
    counter = [0]

    def new_id(prefix: str) -> str:
        counter[0] += 1
        return f"P{storey_index}-{prefix}-{counter[0]:03d}"

    wet = _wet_rooms(storey)
    if not wet:
        plan.warnings.append(
            f"{storey.name} has no wet rooms, so there is nothing to set out."
        )
        return plan

    stack = _stack_position(storey, wet)
    if stack:
        plan.fixtures.append(
            Fixture(
                id=new_id("SVP"), kind="stack_soil", x=stack[0], y=stack[1],
                label="SVP", note="Soil and vent pipe. Position must be "
                                  "coordinated with the structure before it "
                                  "is fixed.",
            )
        )
        plan.fixtures.append(
            Fixture(
                id=new_id("WR"), kind="stack_water", x=stack[0] + 450,
                y=stack[1], label="WR", note="Cold and hot water risers.",
            )
        )

    heater_placed = False

    for space in wet:
        rect = space.rect
        area_m2 = space.area / 1_000_000
        side = longest_free_side(storey, space)

        if space.function in (Function.BATHROOM, Function.WC):
            wanted = ["wc", "basin"]
            if space.function is Function.BATHROOM:
                if area_m2 >= BATH_MIN_AREA_M2:
                    wanted.append("bath")
                elif area_m2 >= SHOWER_MIN_AREA_M2:
                    wanted.append("shower")
                else:
                    plan.warnings.append(
                        f"{space.name} is {area_m2:.1f} m², too small for a "
                        "shower alongside a WC and basin. Only the WC and "
                        "basin are shown."
                    )
            wanted.append("floor_drain")
        elif space.function is Function.KITCHEN:
            wanted = ["sink"]
        elif space.function is Function.UTILITY:
            wanted = ["washing_machine", "floor_drain"]
        else:
            wanted = []

        # Floor gullies sit in the middle of the room, everything else on a
        # wall -- packed by the width each fixture actually needs.
        on_wall = [k for k in wanted if k != "floor_drain"]
        positions, overrun, side = _place_fittings(rect, side, on_wall)
        if overrun:
            plan.warnings.append(
                f"{space.name} is {area_m2:.1f} m² and cannot take "
                f"{', '.join(on_wall)} with any clear run: the fittings are "
                f"about {overrun} mm longer than the walls allow. They are "
                "drawn packed. The room needs to grow, or lose a fitting."
            )

        clearance = _clearance(rect, on_wall, positions)
        if clearance < MIN_CLEARANCE:
            plan.warnings.append(
                f"{space.name} leaves about {clearance} mm of clear floor "
                f"between the fittings. Codes commonly want {MIN_CLEARANCE} mm "
                "in front of a WC and to use a basin. The fittings fit on the "
                "walls; a person does not fit between them."
            )

        for kind, (x, y, rotation) in zip(on_wall, positions):
            plan.fixtures.append(
                Fixture(
                    id=new_id(kind[:3].upper()), kind=kind, x=x, y=y,
                    space=space.id, rotation=rotation,
                )
            )
            if stack:
                plan.runs.append(
                    Run(kind="waste", points=_pipe(rect, (x, y), stack),
                        label=f"{space.name} waste")
                )
                plan.runs.append(
                    Run(kind="cold", points=_pipe(rect, (x, y), (stack[0] + 450, stack[1])),
                        label=f"{space.name} cold")
                )
                if kind in ("basin", "shower", "bath", "sink"):
                    plan.runs.append(
                        Run(kind="hot",
                            points=_pipe(rect, (x, y), (stack[0] + 450, stack[1])),
                            label=f"{space.name} hot")
                    )

        if "floor_drain" in wanted:
            centre = rect.centre
            plan.fixtures.append(
                Fixture(
                    id=new_id("FG"), kind="floor_drain", x=centre.x, y=centre.y,
                    space=space.id,
                )
            )
            if stack:
                plan.runs.append(
                    Run(kind="waste", points=_pipe(rect, (centre.x, centre.y), stack),
                        label=f"{space.name} gully")
                )

        # One water heater, in the first wet room that can take it.
        if not heater_placed and space.function in (Function.BATHROOM, Function.UTILITY,
                                                    Function.KITCHEN):
            corner = rect.corners()[2]
            plan.fixtures.append(
                Fixture(
                    id=new_id("WH"), kind="water_heater",
                    x=corner.x - 400, y=corner.y - 400, space=space.id,
                    label="WH",
                    note="Storage or instantaneous heater. Capacity, fuel and "
                         "flue are the engineer's, not the plan's.",
                )
            )
            heater_placed = True

    if storey_index > 0:
        plan.notes.append(
            "The stack on this floor must line up with the floors below it. "
            "If it does not, either the plan or the stack has to move."
        )

    plan.notes += [
        "Schematic layout only. Pipe diameters, falls, vent sizing, trap "
        "seals and drainage connections beyond the building line are the "
        "plumbing engineer's and are not shown.",
        "Runs are drawn orthogonally to show what connects to what. They are "
        "not set out against the structure and do not represent a route.",
        "Fixtures are drawn at their real sizes so that clearances can be "
        "checked. Confirm the local requirement for clear space in front of "
        "a WC and to the side of a basin.",
    ]
    return plan


OPPOSITE = {"south": "north", "north": "south", "west": "east", "east": "west"}


def _clearance(rect, kinds: list[str], positions: list) -> int:
    """The narrowest gap left across the room once the fittings are in.

    Fitting on the walls is not the same as fitting in the room. Two
    fittings on opposite walls can both be within their wall runs and still
    leave a slot no one can stand in, which is the thing worth saying.
    """
    if not kinds:
        return max(rect.w, rect.h)

    # How far each fitting projects from the wall it is on, per direction.
    projections = {"south": 0, "north": 0, "west": 0, "east": 0}
    for kind, (x, y, rotation) in zip(kinds, positions):
        depth = footprint(kind)[1]
        side = {0: "south", 180: "north", 270: "west", 90: "east"}.get(rotation, "south")
        projections[side] = max(projections[side], depth)

    across_y = rect.h - projections["south"] - projections["north"]
    across_x = rect.w - projections["west"] - projections["east"]
    return int(min(across_x, across_y))


def _place_fittings(rect, side: str, kinds: list[str]):
    """Fit the fittings onto the walls, using more than one where needed.

    A 3.8 m² bathroom cannot take a WC, a basin and a shower along one
    wall, and nobody would draw it that way. When one wall will not hold
    the run, the fittings are split across opposite walls -- which is what
    the room would actually be laid out as.
    """
    widths = [footprint(k)[0] for k in kinds]
    if not widths:
        return [], 0, side

    best = None
    for candidate in (side, OPPOSITE[side], "west" if side in ("south", "north") else "south"):
        placed, overrun = pack_along_wall(rect, candidate, widths, inset=150)
        if best is None or overrun < best[1]:
            best = (placed, overrun, candidate)
        if overrun == 0:
            return placed, 0, candidate

    # One wall will not do it. Split the run across two opposite walls,
    # keeping the largest fitting on its own so it keeps a clear wall.
    order = sorted(range(len(kinds)), key=lambda i: -widths[i])
    first = {order[0]}
    for index in order[1:]:
        take = sum(widths[i] for i in first)
        if take + widths[index] <= sum(widths) / 2:
            first.add(index)

    side_a, side_b = side, OPPOSITE[side]
    kinds_a = [kinds[i] for i in range(len(kinds)) if i in first]
    kinds_b = [kinds[i] for i in range(len(kinds)) if i not in first]
    placed_a, over_a = pack_along_wall(rect, side_a, [footprint(k)[0] for k in kinds_a], inset=150)
    placed_b, over_b = pack_along_wall(rect, side_b, [footprint(k)[0] for k in kinds_b], inset=150)

    if over_a + over_b < best[1]:
        merged: list = []
        it_a, it_b = iter(placed_a), iter(placed_b)
        for i in range(len(kinds)):
            merged.append(next(it_a) if i in first else next(it_b))
        return merged, over_a + over_b, side_a
    return best


def _pipe(rect, start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    """An orthogonal run from a fixture to the stack.

    Turning inside the room the fixture is in, rather than at the stack,
    keeps the run against a wall for as much of its length as possible.
    """
    corner = (start[0], end[1]) if abs(start[0] - end[0]) < abs(start[1] - end[1]) else (end[0], start[1])
    points = [start, corner, end]
    return [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
