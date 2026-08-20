"""Deriving the quantities that rules ask about.

A rule says "corridors serving 50 or more occupants shall be at least 1118
mm clear". To check it, something has to know how wide the corridor is and
how many people it serves. This module is that something: it reads the
building model and produces plain dictionaries of numbers, one per thing a
rule might be about -- the building, a storey, a room, a door, a stair.

Two of these numbers are approximations, and both say so where they are
computed: clear ceiling height assumes a slab, and travel distance is
measured through the door graph rather than around furniture. Everything
else is read straight off the geometry.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field

from ..geom import Point, manhattan
from ..model import Building, Function, OpeningKind, Space, Storey

# Floor to ceiling is floor to floor less the structure and finishes between.
# A real project takes this from the structural drawing; without one, this is
# the ordinary allowance, and any rule it decides is flagged as depending on it.
ASSUMED_SLAB_AND_FINISH = 200


@dataclass(slots=True)
class FactSet:
    """Everything derived, grouped by what a rule can be scoped to."""

    building: dict = field(default_factory=dict)
    storeys: list[dict] = field(default_factory=list)
    spaces: list[dict] = field(default_factory=list)
    doors: list[dict] = field(default_factory=list)
    windows: list[dict] = field(default_factory=list)
    stairs: list[dict] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)

    # Rule packs read more naturally in the singular -- "scope": "space" --
    # so both forms resolve to the same collection.
    _ALIASES = {
        "storey": "storeys", "space": "spaces", "door": "doors",
        "window": "windows", "stair": "stairs",
    }

    def scope(self, name: str) -> list[dict]:
        if name == "building":
            return [self.building]
        attribute = self._ALIASES.get(name, name)
        if attribute in ("storeys", "spaces", "doors", "windows", "stairs"):
            return getattr(self, attribute)  # type: ignore[no-any-return]
        raise KeyError(
            f"unknown rule scope {name!r}; expected building, storey, "
            "space, door, window or stair"
        )


def _load_factor(function: Function, factors: dict[str, float]) -> float:
    """Square metres of floor per person, from the pack's own table.

    Occupant load factors are a jurisdiction's choice and differ between
    codes, so there is no default here worth having. A function the pack
    does not list contributes no occupants, and the rule that needed it
    reports as unchecked rather than guessing a number.
    """
    return float(factors.get(function.value, 0) or 0)


def _occupants(space: Space, factors: dict[str, float]) -> int:
    factor = _load_factor(space.function, factors)
    if factor <= 0:
        return 0
    # Codes round occupant load up: a fraction of a person is a person.
    return -(-int(space.area / 1_000_000) // int(factor)) if factor >= 1 else int(
        space.area / 1_000_000 / factor
    )


def _egress_distances(storey: Storey) -> dict[str, int]:
    """Shortest walking distance from each room to an exit, through doorways.

    Codes measure travel distance from the most remote point of a room,
    along the path of travel, to an exit. This walks the graph of rooms
    joined by doors, taking room centres as waypoints and the far corner of
    the starting room as the origin. It is an approximation of a path a
    person actually walks -- it ignores furniture and takes rectilinear
    routes -- and it is reported as one.
    """
    spaces = {s.id: s for s in storey.spaces}
    if not spaces:
        return {}

    # Which rooms a door joins, and where the exits are.
    neighbours: dict[str, list[tuple[str, int]]] = {sid: [] for sid in spaces}
    exits: dict[str, int] = {}
    for opening in storey.openings:
        # Unframed openings are part of the route too -- a hall that flows
        # into a corridor is walked through exactly like a doorway.
        if opening.kind is OpeningKind.WINDOW:
            continue
        wall = storey.wall(opening.wall)
        if wall is None:
            continue
        touching = [sid for sid in wall.separates if sid in spaces]
        if opening.is_egress or wall.is_exterior:
            for sid in touching:
                # Cost from the room's centre to the doorway itself.
                door_point = _opening_point(wall.start, wall.end, opening)
                cost = manhattan(spaces[sid].rect.centre, door_point)
                exits[sid] = min(exits.get(sid, cost), cost)
        if len(touching) == 2:
            a, b = touching
            cost = manhattan(spaces[a].rect.centre, spaces[b].rect.centre)
            neighbours[a].append((b, cost))
            neighbours[b].append((a, cost))

    # Above ground level the stair is the exit. Codes measure travel
    # distance on an upper floor to the enclosure, not to a door on the
    # ground floor -- reaching the protected stair is reaching safety.
    if storey.index > 0:
        for space in storey.spaces:
            if space.function is Function.STAIR:
                exits.setdefault(space.id, 0)

    if not exits:
        return {sid: -1 for sid in spaces}

    # Dijkstra outward from every exit at once.
    best: dict[str, int] = {}
    queue: list[tuple[int, str]] = [(cost, sid) for sid, cost in exits.items()]
    heapq.heapify(queue)
    while queue:
        cost, sid = heapq.heappop(queue)
        if sid in best:
            continue
        best[sid] = cost
        for other, step in neighbours[sid]:
            if other not in best:
                heapq.heappush(queue, (cost + step, other))

    out: dict[str, int] = {}
    for sid, space in spaces.items():
        if sid not in best:
            out[sid] = -1  # no route to an exit at all
            continue
        # From the far corner of the room, not from its middle.
        corner = max(
            (manhattan(c, space.rect.centre) for c in space.rect.corners()), default=0
        )
        out[sid] = best[sid] + corner
    return out


def _opening_point(start: Point, end: Point, opening) -> Point:
    """Where along its wall an opening sits, in plan."""
    length = manhattan(start, end) or 1
    t = min(1.0, (opening.offset + opening.width / 2) / length)
    return Point(
        round(start.x + (end.x - start.x) * t),
        round(start.y + (end.y - start.y) * t),
    )


def derive(building: Building, parameters: dict | None = None) -> FactSet:
    """Read the model and produce the facts rules are written against."""
    parameters = parameters or {}
    factors = parameters.get("occupant_load_factors", {}) or {}
    slab = int(parameters.get("slab_and_finish_mm", ASSUMED_SLAB_AND_FINISH))
    openable = float(parameters.get("openable_fraction", 0.5))

    facts = FactSet()
    facts.assumptions.append(
        f"Clear ceiling height is taken as floor-to-floor less {slab} mm for "
        "structure and finishes, there being no structural drawing to read it from."
    )
    facts.assumptions.append(
        "Travel distances are measured through the graph of rooms joined by "
        "doorways, from the far corner of each room, on rectilinear paths."
    )
    facts.assumptions.append(
        "Glazing ratios are measured on the structural window opening, not "
        "the light-transmitting area a code asks for. A frame typically takes "
        "10 to 20 per cent of the opening, so a room close to the limit here "
        "may not meet it once the window is specified. Openings are sized "
        "with an allowance for this, but the window schedule decides it."
    )
    facts.assumptions.append(
        f"Ventilation rules are written against the area that OPENS, not the "
        f"area that is glazed. The model carries window sizes, not opening "
        f"lights, so openable area is taken as {openable:.0%} of the glazed "
        "area -- about what an awning or sliding sash gives. Confirm against "
        "the window schedule; a fixed pane opens none of it."
    )
    if not factors:
        facts.assumptions.append(
            "This rule pack supplies no occupant load factors, so occupant "
            "counts are zero and any rule that depends on them is reported "
            "as unchecked rather than passed."
        )

    total_occupants = 0
    for storey in building.storeys:
        distances = _egress_distances(storey)
        storey_occupants = 0
        exit_count = sum(
            1
            for o in storey.openings
            if o.kind is OpeningKind.DOOR and o.is_egress
        )

        for space in storey.spaces:
            occupants = _occupants(space, factors)
            space.occupants = occupants
            storey_occupants += occupants

            windows = [
                o
                for o in storey.openings_of(space.id)
                if o.kind is OpeningKind.WINDOW
            ]
            window_area = sum(o.width * o.height for o in windows)
            doors = [
                o for o in storey.openings_of(space.id) if o.kind is OpeningKind.DOOR
            ]

            facts.spaces.append(
                {
                    "id": space.id,
                    "name": space.name,
                    "function": space.function.value,
                    "storey": storey.index,
                    "is_habitable": space.function.is_habitable,
                    "is_circulation": space.function.is_circulation,
                    "is_wet": space.function.is_wet,
                    "area_m2": round(space.area / 1_000_000, 3),
                    "area_mm2": space.area,
                    "width_mm": space.width,
                    "length_mm": space.length,
                    "clear_height_mm": storey.height - slab,
                    "window_area_m2": round(window_area / 1_000_000, 3),
                    "glazing_ratio": round(window_area / space.area, 4)
                    if space.area
                    else 0.0,
                    "window_count": len(windows),
                    "openable_area_m2": round(window_area * openable / 1_000_000, 3),
                    "openable_ratio": round(window_area * openable / space.area, 4)
                    if space.area
                    else 0.0,
                    "has_window": bool(windows),
                    "door_count": len(doors),
                    "has_door": bool(doors),
                    "min_door_clear_width_mm": min(
                        (d.clear_width for d in doors), default=0
                    ),
                    "travel_distance_mm": distances.get(space.id, -1),
                    "has_route_to_exit": distances.get(space.id, -1) >= 0,
                    "occupants": occupants,
                }
            )

        for opening in storey.openings:
            wall = storey.wall(opening.wall)
            served = [
                storey.space(sid)
                for sid in (wall.separates if wall else ())
            ]
            served_names = [s.name for s in served if s]
            record = {
                "id": opening.id,
                "storey": storey.index,
                "width_mm": opening.width,
                "clear_width_mm": opening.clear_width,
                "height_mm": opening.height,
                "sill_mm": opening.sill,
                "is_egress": opening.is_egress,
                "on_exterior_wall": bool(wall and wall.is_exterior),
                "serves": served_names,
                "serves_functions": [s.function.value for s in served if s],
            }
            if opening.kind is OpeningKind.DOOR:
                facts.doors.append(record)
            elif opening.kind is OpeningKind.WINDOW:
                record["area_m2"] = round(opening.width * opening.height / 1e6, 3)
                facts.windows.append(record)

        for stair in storey.stairs:
            going = stair.tread_depth or 1
            facts.stairs.append(
                {
                    "id": stair.id,
                    "storey": storey.index,
                    "riser_mm": stair.riser_height,
                    "going_mm": stair.tread_depth,
                    "risers": stair.risers,
                    "flights": stair.flights,
                    # Codes cap the risers in a single flight, not in the
                    # whole stair -- a dog-leg with a landing resets the count.
                    "risers_per_flight": -(-stair.risers // max(1, stair.flights)),
                    "width_mm": stair.width,
                    "headroom_mm": stair.headroom,
                    "rise_total_mm": stair.rise_total,
                    "handrails": stair.handrails,
                    # The two-rise-plus-going check, which most codes carry in
                    # some form as a comfort rule.
                    "two_r_plus_g": 2 * stair.riser_height + going,
                    "pitch_degrees": round(
                        __import__("math").degrees(
                            __import__("math").atan2(stair.riser_height, going)
                        ),
                        1,
                    ),
                }
            )

        facts.storeys.append(
            {
                "index": storey.index,
                "name": storey.name,
                "floor_area_m2": round(storey.floor_area / 1_000_000, 3),
                "height_mm": storey.height,
                "clear_height_mm": storey.height - slab,
                "space_count": len(storey.spaces),
                "exit_count": exit_count,
                "occupants": storey_occupants,
                "is_ground": storey.index == 0,
            }
        )
        total_occupants += storey_occupants

    plot = building.plot
    facts.building = {
        "name": building.name,
        "use": building.use,
        "storeys": building.storey_count,
        "height_mm": building.height,
        "gross_floor_area_m2": round(building.gross_floor_area / 1_000_000, 3),
        "footprint_m2": round(building.footprint / 1_000_000, 3),
        "plot_area_m2": round(plot.area / 1_000_000, 3),
        "coverage_ratio": round(building.coverage_ratio, 4),
        "floor_area_ratio": round(building.floor_area_ratio, 4),
        "setback_front_mm": plot.setback_front,
        "setback_rear_mm": plot.setback_rear,
        "setback_left_mm": plot.setback_left,
        "setback_right_mm": plot.setback_right,
        "parking_spaces": building.parking_spaces,
        "occupants": total_occupants,
        "exit_count": sum(s["exit_count"] for s in facts.storeys),
        "dwelling_units": 1 if building.use == "residential" else 0,
    }
    return facts
