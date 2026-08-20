"""The building model: what was designed, independent of how it is drawn.

Exporters read this and write DXF, IFC or SVG. The rule engine reads this
and derives facts to check. Neither one talks to the other, so adding a
jurisdiction never touches a file format and adding a file format never
touches a code rule.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

from .geom import (
    Point,
    Rect,
    centroid,
    edge_normal,
    is_vertical,
    largest_inscribed_rect,
    polygon_area,
    polygon_bounds,
    segment_length,
)


class Function(str, Enum):
    """What a space is for.

    Deliberately generic. Occupancy classification -- IBC Group R-3, a
    Eurocode fire compartment class, a BCP residential category -- is a
    jurisdiction's opinion about these, and lives in its rule pack, not
    here. That is what lets one plan be checked against several codes.
    """

    BEDROOM = "bedroom"
    LIVING = "living"
    DINING = "dining"
    KITCHEN = "kitchen"
    BATHROOM = "bathroom"
    WC = "wc"
    CORRIDOR = "corridor"
    LOBBY = "lobby"
    STAIR = "stair"
    ENTRY = "entry"
    STORAGE = "storage"
    UTILITY = "utility"
    GARAGE = "garage"
    OFFICE = "office"
    MEETING = "meeting"
    CLASSROOM = "classroom"
    RETAIL = "retail"
    ASSEMBLY = "assembly"
    BALCONY = "balcony"
    COURTYARD = "courtyard"
    ALFRESCO = "alfresco"      # roofed outdoor living, under the main roof

    @property
    def is_circulation(self) -> bool:
        return self in (Function.CORRIDOR, Function.LOBBY, Function.STAIR, Function.ENTRY)

    @property
    def is_outdoor(self) -> bool:
        """Roofed but not enclosed. Owed no daylight, and it counts as open
        space rather than as floor area in most planning codes."""
        return self in (Function.ALFRESCO, Function.BALCONY, Function.COURTYARD)

    @property
    def is_habitable(self) -> bool:
        """Habitable rooms are the ones daylight and ventilation rules bite on.

        Almost every code draws this line, and draws it in roughly the same
        place: rooms for living, sleeping, eating or working, but not
        bathrooms, corridors, stores or garages.
        """
        return self in (
            Function.BEDROOM,
            Function.LIVING,
            Function.DINING,
            Function.KITCHEN,
            Function.OFFICE,
            Function.MEETING,
            Function.CLASSROOM,
            Function.RETAIL,
            Function.ASSEMBLY,
        )

    @property
    def is_wet(self) -> bool:
        return self in (Function.BATHROOM, Function.WC, Function.KITCHEN, Function.UTILITY)


class WallKind(str, Enum):
    EXTERIOR = "exterior"
    INTERIOR = "interior"
    PARTY = "party"


class OpeningKind(str, Enum):
    DOOR = "door"
    WINDOW = "window"
    OPENING = "opening"  # an unframed gap, e.g. living into dining


@dataclass(slots=True)
class Space:
    """A room, as an axis-aligned rectangle on one storey."""

    id: str
    name: str
    function: Function
    rect: Rect
    storey: int
    occupants: int | None = None  # set by the rule engine, not by the layout

    @property
    def area(self) -> int:
        return self.rect.area

    @property
    def width(self) -> int:
        return self.rect.short_side

    @property
    def length(self) -> int:
        return self.rect.long_side


@dataclass(slots=True)
class Wall:
    """A wall centreline, with a thickness either side of it."""

    id: str
    start: Point
    end: Point
    thickness: int
    kind: WallKind
    storey: int
    height: int
    fire_rating_minutes: int = 0
    # The spaces this wall separates. One id means it faces outside.
    separates: tuple[str, ...] = ()

    @property
    def length(self) -> int:
        return segment_length(self.start, self.end)

    @property
    def vertical(self) -> bool:
        return is_vertical(self.start, self.end)

    @property
    def is_exterior(self) -> bool:
        return self.kind is WallKind.EXTERIOR


@dataclass(slots=True)
class Opening:
    """A door or window, positioned along its wall's centreline."""

    id: str
    wall: str
    kind: OpeningKind
    offset: int  # from the wall's start point, to the opening's near edge
    width: int
    height: int
    sill: int = 0
    is_egress: bool = False
    leaf_thickness: int = 45  # a door leaf eats into its own clear width

    @property
    def clear_width(self) -> int:
        """What a person actually fits through.

        Codes measure a doorway's clear width with the door open at 90
        degrees, so the leaf and its stops come off the structural opening.
        Windows have no leaf in the way of anyone walking.
        """
        if self.kind is OpeningKind.DOOR:
            return max(0, self.width - self.leaf_thickness)
        return self.width


@dataclass(slots=True)
class Stair:
    """A flight, described by the numbers every code has an opinion about."""

    id: str
    storey: int
    rect: Rect
    riser_height: int
    tread_depth: int
    risers: int
    width: int
    headroom: int = 2100
    handrails: int = 1
    flights: int = 1  # 2 means a half-turn stair, doubling back on a landing

    @property
    def rise_total(self) -> int:
        return self.riser_height * self.risers


@dataclass(slots=True)
class Pool:
    """A swimming pool and the barrier that has to go round it.

    The barrier is not an accessory to the pool: in every Australian state
    it is the regulated part. A pool that is not enclosed by a compliant
    barrier is an offence, and the barrier is what gets inspected -- in
    Western Australia every four years for the life of the pool.

    The figures carried here are the ones a barrier is judged on, so they
    can be checked rather than assumed: AS 1926.1 sets 1200 mm minimum
    height above finished ground level with a 900 mm non-climbable zone
    outside it, and gates that close and latch themselves and swing away
    from the water.
    """

    rect: Rect
    water_depth_mm: int = 1500
    barrier_height_mm: int = 1200
    non_climbable_zone_mm: int = 900
    barrier_gap_below_mm: int = 100
    gates: int = 1
    gate_self_closing: bool = True
    gate_self_latching: bool = True
    gate_swings_outward: bool = True
    barrier_offset_mm: int = 1000   # barrier set back from the water's edge

    @property
    def area(self) -> int:
        return self.rect.area

    @property
    def barrier(self) -> Rect:
        """The line the barrier runs on."""
        offset = self.barrier_offset_mm
        return Rect(
            self.rect.x - offset, self.rect.y - offset,
            self.rect.w + offset * 2, self.rect.h + offset * 2,
        )

    @property
    def needs_barrier(self) -> bool:
        """Barriers are required above 300 mm of water, spas included."""
        return self.water_depth_mm > 300


@dataclass(slots=True)
class Roof:
    """The roof, to the level of detail an elevation needs.

    Project homes in Perth are hipped metal at 22 to 27 degrees, with the
    ridge along the long axis and eaves oversailing the brickwork. That is
    enough to draw four elevations and to state an overall height, which is
    the number a planning scheme cares about. It is not enough to build
    from: trusses, battens, valleys and the flashing are the roof plumber's
    and the truss supplier's.
    """

    pitch_degrees: float = 25.0
    overhang_mm: int = 600
    kind: str = "hip"          # 'hip' or 'gable'
    material: str = "metal"

    def rise_over(self, span_mm: int) -> int:
        """How high the roof climbs over half a span."""
        return int(round(span_mm / 2 * math.tan(math.radians(self.pitch_degrees))))


@dataclass(slots=True)
class Storey:
    index: int
    name: str
    elevation: int          # of the finished floor, above site datum
    height: int             # floor to floor
    ceiling: int = 0        # floor to ceiling; falls back to height - 200
    spaces: list[Space] = field(default_factory=list)
    walls: list[Wall] = field(default_factory=list)
    openings: list[Opening] = field(default_factory=list)
    stairs: list[Stair] = field(default_factory=list)

    @property
    def ceiling_height(self) -> int:
        """Floor to ceiling. The plate sits here, not at floor-to-floor."""
        return self.ceiling or max(0, self.height - 200)

    @property
    def floor_area(self) -> int:
        """Gross area of everything enclosed on this storey."""
        return sum(s.area for s in self.spaces)

    def space(self, space_id: str) -> Space | None:
        return next((s for s in self.spaces if s.id == space_id), None)

    def wall(self, wall_id: str) -> Wall | None:
        return next((w for w in self.walls if w.id == wall_id), None)

    def openings_on(self, wall_id: str) -> list[Opening]:
        return [o for o in self.openings if o.wall == wall_id]

    def openings_of(self, space_id: str) -> list[Opening]:
        """Every opening in a wall that bounds this space."""
        wall_ids = {w.id for w in self.walls if space_id in w.separates}
        return [o for o in self.openings if o.wall in wall_ids]


@dataclass(slots=True)
class Plot:
    """The piece of land, and what the local authority says about its edges.

    A lot may be given as a rectangle or as a surveyed boundary. Real ones
    are rarely rectangles: a Perth subdivision is full of splayed corners,
    battle-axe legs and frontages surveyed as chords, and treating those as
    their bounding box overstates the land by ten or twenty percent. Site
    cover is a percentage OF the lot, so that error lands straight in the
    number the council checks.
    """

    rect: Rect                                    # the bounding box
    boundary: list[Point] | None = None           # the surveyed shape, if known
    # Setbacks in millimetres, per side, as the jurisdiction requires them.
    setback_front: int = 0
    setback_rear: int = 0
    setback_left: int = 0
    setback_right: int = 0
    # Which side the road is on -- 'south' means the plot fronts southwards.
    road_side: str = "south"
    _buildable: Rect | None = None                # cached; the search is not free

    @classmethod
    def from_boundary(cls, points: list[Point], **kwargs) -> "Plot":
        """Build a lot from its surveyed corners."""
        if len(points) < 3:
            raise ValueError("a lot boundary needs at least three corners")
        return cls(rect=polygon_bounds(points), boundary=list(points), **kwargs)

    @property
    def is_irregular(self) -> bool:
        return self.boundary is not None and len(self.boundary) != 4

    @property
    def area(self) -> int:
        """The real area of the land, not of the box it fits in."""
        if self.boundary:
            return polygon_area(self.boundary)
        return self.rect.area

    def _road_axis(self) -> tuple[float, float]:
        """A unit vector pointing from the road into the lot."""
        return {
            "south": (0.0, 1.0), "north": (0.0, -1.0),
            "west": (1.0, 0.0), "east": (-1.0, 0.0),
        }[self.road_side]

    def edge_setbacks(self) -> list[int]:
        """The setback that applies to each boundary edge, in edge order.

        Which edge is the frontage is decided by geometry rather than by
        asking: the edge whose outward normal points at the road is the
        front, the one opposite is the rear, and the rest are sides.
        """
        if not self.boundary:
            return []
        inward = self._road_axis()
        middle = centroid(self.boundary)
        left_axis = (-inward[1], inward[0])

        setbacks: list[int] = []
        edges = list(zip(self.boundary, self.boundary[1:] + self.boundary[:1]))
        for a, b in edges:
            nx, ny = edge_normal(a, b, middle)
            facing = -(nx * inward[0] + ny * inward[1])
            if facing > 0.6:
                setbacks.append(self.setback_front)
            elif facing < -0.6:
                setbacks.append(self.setback_rear)
            elif nx * left_axis[0] + ny * left_axis[1] > 0:
                setbacks.append(self.setback_left)
            else:
                setbacks.append(self.setback_right)
        return setbacks

    @property
    def buildable(self) -> Rect:
        """The envelope left after setbacks, measured from the road side.

        On a surveyed boundary this is the largest axis-aligned rectangle
        that clears every edge by its own setback -- which is the question a
        builder is actually asking about an odd-shaped block.
        """
        if self._buildable is not None:
            return self._buildable

        if self.boundary:
            found = largest_inscribed_rect(self.boundary, self.edge_setbacks())
            self._buildable = found or Rect(self.rect.x, self.rect.y, 0, 0)
            return self._buildable

        front, rear = self.setback_front, self.setback_rear
        left, right = self.setback_left, self.setback_right
        if self.road_side == "south":
            result = self.rect.inset_sides(left, front, right, rear)
        elif self.road_side == "north":
            result = self.rect.inset_sides(left, rear, right, front)
        elif self.road_side == "west":
            result = self.rect.inset_sides(front, left, rear, right)
        elif self.road_side == "east":
            result = self.rect.inset_sides(rear, left, front, right)
        else:
            raise ValueError(
                f"road_side must be a compass point, got {self.road_side!r}"
            )
        self._buildable = result
        return result


@dataclass(slots=True)
class Building:
    """A complete design, ready to draw or to check."""

    name: str
    plot: Plot
    storeys: list[Storey] = field(default_factory=list)
    jurisdiction: str = ""        # e.g. 'PK-PB-lahore', resolved by codes.registry
    use: str = "residential"      # the brief's word for it; codes map it themselves
    roof: Roof | None = None
    pool: Pool | None = None
    parking_spaces: int = 0
    metadata: dict[str, str] = field(default_factory=dict)

    # -- aggregate quantities every code asks for in some form -----------
    @property
    def gross_floor_area(self) -> int:
        return sum(s.floor_area for s in self.storeys)

    @property
    def footprint(self) -> int:
        """Ground-storey area -- what site coverage is measured against."""
        return self.storeys[0].floor_area if self.storeys else 0

    @property
    def coverage_ratio(self) -> float:
        return self.footprint / self.plot.area if self.plot.area else 0.0

    @property
    def floor_area_ratio(self) -> float:
        return self.gross_floor_area / self.plot.area if self.plot.area else 0.0

    @property
    def height(self) -> int:
        return sum(s.height for s in self.storeys)

    @property
    def storey_count(self) -> int:
        return len(self.storeys)

    @property
    def overall_height(self) -> int:
        """Floor level to ridge -- the number a planning scheme asks for."""
        top = self.height
        if self.roof is None or not self.storeys:
            return top
        footprint = self.storeys[0]
        if not footprint.spaces:
            return top
        xs = [s.rect.x0 for s in footprint.spaces] + [s.rect.x1 for s in footprint.spaces]
        ys = [s.rect.y0 for s in footprint.spaces] + [s.rect.y1 for s in footprint.spaces]
        span = min(max(xs) - min(xs), max(ys) - min(ys))
        return top + self.roof.rise_over(span)

    def all_spaces(self) -> Iterable[Space]:
        for storey in self.storeys:
            yield from storey.spaces

    def spaces_by_function(self, function: Function) -> list[Space]:
        return [s for s in self.all_spaces() if s.function is function]

    def storey(self, index: int) -> Storey | None:
        return next((s for s in self.storeys if s.index == index), None)
