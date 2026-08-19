"""A schematic electrical layout.

Lights, fans, switches, sockets and extract fans, set out room by room,
with the circuits drawn back to a distribution board by the circulation
route. The quantities come from ordinary domestic and small-commercial
practice, which is a defensible starting point and nothing more: an
electrical engineer sizes the cables, rates the breakers, and decides the
earthing arrangement, and none of those can be read off a floor plan.
"""

from __future__ import annotations

from ..model import Building, Function
from .model import Fixture, Run, ServicesPlan
from .placement import (
    beside_door,
    corridor_axis,
    grid_points,
    longest_free_side,
    route,
    wall_points,
)

# Roughly one ceiling point per this much floor, which is what gives an
# even wash of light at ordinary ceiling heights.
AREA_PER_LIGHT_M2 = 12

# Socket outlets by room, from common domestic practice. A designer will
# move these; the point is that the count is deliberate rather than absent.
SOCKETS = {
    Function.LIVING: 4,
    Function.BEDROOM: 3,
    Function.DINING: 2,
    Function.KITCHEN: 4,
    Function.OFFICE: 6,
    Function.MEETING: 2,
    Function.CLASSROOM: 4,
    Function.RETAIL: 4,
    Function.CORRIDOR: 1,
    Function.LOBBY: 2,
    Function.ENTRY: 1,
    Function.STORAGE: 1,
    Function.UTILITY: 2,
    Function.GARAGE: 2,
}

# Rooms that get a fan rather than only a light, in a warm climate.
FAN_ROOMS = {Function.BEDROOM, Function.LIVING, Function.DINING, Function.OFFICE}

MOUNTING = {
    "socket": 450,
    "socket_protected": 1200,
    "socket_appliance": 1000,
    "switch": 1200,
    "switch_2": 1200,
    "distribution_board": 1500,
}


def design_electrical(
    building: Building, storey_index: int, warm_climate: bool = True
) -> ServicesPlan:
    """Lay out the electrical services for one floor."""
    storey = building.storey(storey_index)
    if storey is None:
        raise ValueError(f"the building has no storey {storey_index}")

    plan = ServicesPlan(discipline="electrical", storey=storey_index)
    counter = [0]

    def new_id(prefix: str) -> str:
        counter[0] += 1
        return f"E{storey_index}-{prefix}-{counter[0]:03d}"

    # -- the board -------------------------------------------------------
    board_space = next(
        (s for s in storey.spaces if s.function is Function.ENTRY),
        next((s for s in storey.spaces if s.function.is_circulation), None),
    )
    board_point = None
    if board_space is not None:
        side = longest_free_side(storey, board_space)
        placed = wall_points(board_space.rect, side, 1, inset=200)
        if placed:
            x, y, rotation = placed[0]
            board_point = (x, y)
            plan.fixtures.append(
                Fixture(
                    id=new_id("DB"), kind="distribution_board", x=x, y=y,
                    space=board_space.id, rotation=rotation,
                    label="DB" if storey_index == 0 else f"SB-{storey_index}",
                    height_mm=MOUNTING["distribution_board"],
                    note="Consumer unit position is indicative. The final "
                         "position, way count and protective devices are the "
                         "electrical engineer's.",
                )
            )
    else:
        plan.warnings.append(
            "No entry or circulation space was found, so no board position "
            "could be set out."
        )

    lighting_points: list[tuple[int, int]] = []

    for space in storey.spaces:
        rect = space.rect
        area_m2 = space.area / 1_000_000

        # -- lights ------------------------------------------------------
        count = max(1, min(6, round(area_m2 / AREA_PER_LIGHT_M2) or 1))
        if space.function is Function.CORRIDOR:
            count = max(1, int(rect.long_side // 3000))
        points = grid_points(rect, count)

        wants_fan = (
            warm_climate
            and space.function in FAN_ROOMS
            and building.use == "residential"
        )
        for index, (x, y) in enumerate(points):
            kind = "fan_ceiling" if (wants_fan and index == 0) else "light_ceiling"
            plan.fixtures.append(
                Fixture(
                    id=new_id("L"), kind=kind, x=x, y=y, space=space.id,
                    circuit=f"L{storey_index + 1}",
                    label="" if kind == "light_ceiling" else "FAN",
                )
            )
            lighting_points.append((x, y))

        # -- the switch, and the leg to what it controls ------------------
        sx, sy, rotation = beside_door(storey, space)
        switch_kind = "switch_2" if (wants_fan and len(points) >= 1) else "switch"
        plan.fixtures.append(
            Fixture(
                id=new_id("S"), kind=switch_kind, x=sx, y=sy, space=space.id,
                rotation=rotation, circuit=f"L{storey_index + 1}",
                height_mm=MOUNTING["switch"],
            )
        )
        for x, y in points:
            plan.runs.append(
                Run(kind="switch_leg", points=[(sx, sy), (x, y)],
                    label=f"{space.name} lighting")
            )

        # -- sockets ------------------------------------------------------
        socket_count = SOCKETS.get(space.function, 1)
        if space.function.is_wet:
            # A wet room gets one protected outlet, not a ring of them.
            socket_count = 1
        side = longest_free_side(storey, space)
        for x, y, rot in wall_points(rect, side, socket_count, inset=200):
            kind = "socket_protected" if space.function.is_wet else "socket"
            if space.function is Function.KITCHEN:
                kind = "socket_protected"
            plan.fixtures.append(
                Fixture(
                    id=new_id("P"), kind=kind, x=x, y=y, space=space.id,
                    rotation=rot, circuit=f"P{storey_index + 1}",
                    height_mm=MOUNTING.get(kind, 450),
                )
            )

        # -- extract, where there is no window to open --------------------
        if space.function.is_wet:
            windows = [
                o for o in storey.openings_of(space.id)
                if o.kind.value == "window"
            ]
            ex, ey = rect.centre.x, rect.centre.y
            plan.fixtures.append(
                Fixture(
                    id=new_id("EF"), kind="exhaust_fan", x=ex, y=ey + 400,
                    space=space.id, circuit=f"L{storey_index + 1}",
                    note="" if windows else
                         "This room has no window, so mechanical extract is "
                         "not optional here.",
                )
            )

        # -- the circuit back to the board --------------------------------
        if board_point is not None:
            plan.runs.append(
                Run(
                    kind="circuit_light",
                    points=route(storey, board_point, (sx, sy)),
                    label=f"L{storey_index + 1} to {space.name}",
                )
            )

    if corridor_axis(storey) is None:
        plan.warnings.append(
            "This floor has no corridor, so circuit routes were drawn as "
            "direct runs. They will need setting out against the structure."
        )

    plan.notes = [
        "Schematic layout only. Circuit design, cable sizing, protective "
        "device ratings, earthing and bonding are the electrical engineer's "
        "and are not shown.",
        "Socket and light quantities follow ordinary practice for the room "
        "type. They are a starting point for the designer, not a code "
        "requirement.",
        "Mounting heights are given in the schedule and are indicative.",
        "All outlets in kitchens, bathrooms and outdoors are shown as "
        "RCD/GFCI protected. Confirm the requirement locally -- most codes "
        "require it, and the ones that do not are the exception.",
    ]
    return plan
