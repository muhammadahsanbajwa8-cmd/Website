"""Projecting the model into elevations.

An elevation is the model seen orthographically from one compass point:
the walls that face you, the openings in them, the roof behind them, and
the levels called up the side. Everything here is derived from the plan --
no elevation carries a dimension the plan does not already contain, which
is the only way the two can be guaranteed to agree.

Heights are called up in brick courses as well as millimetres, because
that is how a Western Australian set reads: "CL 2435 (28c + PLATE)".
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..courses import COURSE_MM, courses_for
from ..model import Building, OpeningKind, Roof, Storey, Wall

DIRECTIONS = ("south", "east", "north", "west")

# Which way is "out" for each viewing direction, in plan.
_OUTWARD = {
    "south": (0.0, -1.0), "north": (0.0, 1.0),
    "west": (-1.0, 0.0), "east": (1.0, 0.0),
}


@dataclass(slots=True)
class Line:
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass(slots=True)
class Panel:
    """An opening as it appears on the elevation."""

    x: int
    y: int
    width: int
    height: int
    kind: str
    label: str = ""
    # Head height in courses, which is how a Western Australian sheet calls
    # one up. Kept beside the label rather than inside it: when the mark is
    # known the mark is what the elevation should say, and the courses are
    # the schedule's job -- but on a building with no schedule to point at,
    # the courses are better than nothing.
    courses: str = ""


@dataclass(slots=True)
class Face:
    """One storey's wall face, as a rectangle on the elevation.

    The outline already carries these as four lines each. A rectangle as
    well, because a texture has to be drawn INSIDE something and four
    unordered segments are not an inside.
    """

    x: int
    y: int
    width: int
    height: int


# Construction systems whose external face is masonry, and so has a course
# to draw. A framed wall is clad in something the model does not know --
# weatherboard, sheet, render on foam -- so it gets no texture and a note
# saying the cladding is unstated rather than a texture that implies brick.
MASONRY = frozenset({"solid_masonry", "double_brick", "brick_veneer"})


@dataclass(slots=True)
class Level:
    """A height called up the side of the drawing."""

    y: int
    label: str


@dataclass(slots=True)
class ElevationView:
    direction: str
    number: int
    outline: list[Line] = field(default_factory=list)
    roof: list[Line] = field(default_factory=list)
    panels: list[Panel] = field(default_factory=list)
    faces: list[Face] = field(default_factory=list)
    levels: list[Level] = field(default_factory=list)
    wall_material: str = ""
    ground: Line | None = None
    width_mm: int = 0
    height_mm: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def title(self) -> str:
        return f"{self.number} Elevation"


def _wall_faces(wall: Wall, storey: Storey, direction: str) -> bool:
    """Whether this exterior wall is the one you are looking at."""
    if not wall.is_exterior or not wall.separates:
        return False
    space = storey.space(wall.separates[0])
    if space is None:
        return False
    mid_x = (wall.start.x + wall.end.x) / 2
    mid_y = (wall.start.y + wall.end.y) / 2
    centre = space.rect.centre
    dx, dy = mid_x - centre.x, mid_y - centre.y
    length = math.hypot(dx, dy) or 1.0
    ox, oy = _OUTWARD[direction]
    return (dx / length) * ox + (dy / length) * oy > 0.6


def _across(direction: str, x: int, y: int) -> int:
    """Position along the elevation's horizontal axis."""
    return x if direction in ("south", "north") else y


def _footprint_extent(storey: Storey, direction: str) -> tuple[int, int]:
    values: list[int] = []
    for space in storey.spaces:
        rect = space.rect
        if direction in ("south", "north"):
            values += [rect.x0, rect.x1]
        else:
            values += [rect.y0, rect.y1]
    return (min(values), max(values)) if values else (0, 0)


def _storey_rect(storey: Storey) -> tuple[int, int, int, int] | None:
    """The storey's footprint as (x0, y0, x1, y1), or None if it has none."""
    if not storey.spaces:
        return None
    xs = [s.rect.x0 for s in storey.spaces] + [s.rect.x1 for s in storey.spaces]
    ys = [s.rect.y0 for s in storey.spaces] + [s.rect.y1 for s in storey.spaces]
    return min(xs), min(ys), max(xs), max(ys)


def _outside(
    outer: tuple[int, int, int, int], inner: tuple[int, int, int, int] | None
) -> list[tuple[int, int, int, int]]:
    """The parts of `outer` that `inner` does not cover.

    Up to four rectangles, the usual way one rectangle is subtracted from
    another: the strip below, the strip above, and what is left either side
    between them. `inner` is expected to sit within `outer` -- an upper floor
    stacks on the one below it -- and anything of `inner` that pokes out is
    simply not subtracted, which leaves the piece drawn rather than dropped.
    """
    if inner is None:
        return [outer]
    ox0, oy0, ox1, oy1 = outer
    ix0, iy0, ix1, iy1 = (max(inner[0], ox0), max(inner[1], oy0),
                          min(inner[2], ox1), min(inner[3], oy1))
    if ix0 >= ix1 or iy0 >= iy1:
        return [outer]
    pieces = []
    if iy0 > oy0:
        pieces.append((ox0, oy0, ox1, iy0))
    if iy1 < oy1:
        pieces.append((ox0, iy1, ox1, oy1))
    if ix0 > ox0:
        pieces.append((ox0, iy0, ix0, iy1))
    if ix1 < ox1:
        pieces.append((ix1, iy0, ox1, iy1))
    return [p for p in pieces if p[2] - p[0] > 0 and p[3] - p[1] > 0]


def _mass_roof(
    mass: tuple[int, int, int, int], plate: int, roof: Roof, direction: str
) -> tuple[list[Line], int]:
    """The roof over one rectangular mass, seen from one side.

    The roof springs from the top of the brickwork rather than from the
    plate above it. That is a 26 mm distinction and it is the difference
    between reproducing a real sheet's overall height exactly and being
    a plate out: the reference set gives 5134 for a 11,690 span at 25
    degrees off a 28 course wall, and 28 x 86 + 2726 is 5134.
    """
    x0, y0, x1, y1 = mass
    width, depth = x1 - x0, y1 - y0
    if width <= 0 or depth <= 0:
        return [], plate

    # The ridge runs along the longer axis; the roof climbs over the shorter.
    span = min(width, depth)
    ridge_along_x = width >= depth
    rise = roof.rise_over(span)
    brickwork = courses_for(plate) * COURSE_MM
    ridge = brickwork + rise

    lo, hi = (x0, x1) if direction in ("south", "north") else (y0, y1)
    left = lo - roof.overhang_mm
    right = hi + roof.overhang_mm

    looking_along_ridge = (direction in ("south", "north")) == ridge_along_x

    lines: list[Line] = []
    if looking_along_ridge:
        # A face parallel to the ridge: eaves below, ridge above, hips
        # sloping in at each end -- a trapezoid.
        inset = span // 2 if roof.kind == "hip" else 0
        lines += [
            Line(left, plate, right, plate),                      # eaves
            Line(left + inset, ridge, right - inset, ridge),      # ridge
            Line(left, plate, left + inset, ridge),               # hip / verge
            Line(right, plate, right - inset, ridge),
        ]
    else:
        # An end face: a triangle, whether it is hipped or gabled.
        middle = (left + right) // 2
        lines += [
            Line(left, plate, right, plate),
            Line(left, plate, middle, ridge),
            Line(right, plate, middle, ridge),
        ]
    return lines, ridge


def _roof_lines(
    building: Building, roof: Roof, direction: str, plate: int
) -> tuple[list[Line], int]:
    """The roof over a building whose upper floors do not cover the ground.

    One roof at the top plate across the whole ground floor is right only
    when the house is the same shape all the way up. A two storey plan with
    a single storey garage across the front is not: the upper floor starts
    5.5 m back from the street, and the roof was drawn at the upper plate
    over the whole footprint anyway -- a roof plane 2.6 m above the garage
    ceiling with nothing between the two. Thirty-six of the hundred and
    forty elevations in the AU-WA lot sweep drew one, over as much as
    6.67 m of ground.

    So the roof follows the shape: each storey's own footprint less the
    footprint of the storey above it is a mass, and each mass is roofed at
    its own plate with the SAME roof -- the pitch, the kind and the overhang
    the model carries. Nothing is chosen here that the plan does not already
    say. What form a builder actually uses where a lower roof abuts a two
    storey wall -- run the main roof down over it, hip it separately, break
    it with a box gutter -- is a roof design, and the note below says so.
    """
    masses: list[tuple[tuple[int, int, int, int], int]] = []
    highest = plate
    for index, storey in enumerate(building.storeys):
        rect = _storey_rect(storey)
        if rect is None:
            continue
        above = (_storey_rect(building.storeys[index + 1])
                 if index + 1 < len(building.storeys) else None)
        top = storey.elevation + storey.ceiling_height
        for piece in _outside(rect, above):
            masses.append((piece, top))
        if above is None:
            highest = top

    lines: list[Line] = []
    ridge = plate
    for mass, top in masses:
        drawn, apex = _mass_roof(mass, top, roof, direction)
        lines += drawn
        if top == highest:
            ridge = max(ridge, apex)
    return lines, ridge


def elevation(building: Building, direction: str, number: int = 1,
              marks: dict[str, str] | None = None) -> ElevationView:
    """Project the building as seen from one compass point.

    `marks` maps opening id to schedule mark. Passing it is what makes the
    elevation and the schedule one drawing rather than two: the reader sees
    W02 on the face and finds W02 in the schedule with its size, its head
    height and whether it needs a lintel. Without it every opening was
    labelled with its head in courses, which on a house where every head is
    at 2150 mm means five openings all captioned "25c" -- true, and the same
    for all of them, so it distinguishes nothing.

    `elevations` below passes it. It is optional here because an elevation
    can be asked for on its own, and a mark that does not come from the same
    grouping the schedule uses would be worse than no mark at all.
    """
    if direction not in DIRECTIONS:
        raise ValueError(f"direction must be one of {', '.join(DIRECTIONS)}")
    if not building.storeys:
        raise ValueError("nothing to draw: the building has no storeys")

    view = ElevationView(direction=direction, number=number)
    ground = building.storeys[0]
    lo, hi = _footprint_extent(ground, direction)

    plate = 0
    for storey in building.storeys:
        base = storey.elevation
        top = base + storey.ceiling_height
        plate = max(plate, top)
        s_lo, s_hi = _footprint_extent(storey, direction)
        view.faces.append(Face(s_lo, base, s_hi - s_lo, top - base))
        view.outline += [
            Line(s_lo, base, s_hi, base),
            Line(s_lo, base, s_lo, top),
            Line(s_hi, base, s_hi, top),
            Line(s_lo, top, s_hi, top),
        ]

        # Openings in the walls that face this way.
        for wall in storey.walls:
            if not _wall_faces(wall, storey, direction):
                continue
            start = _across(direction, wall.start.x, wall.start.y)
            end = _across(direction, wall.end.x, wall.end.y)
            step = 1 if end >= start else -1
            for opening in storey.openings_on(wall.id):
                # An unframed opening between two rooms is not visible from
                # outside. One in an EXTERIOR wall is: the garage's vehicle
                # opening is drawn as an opening rather than a door, because
                # a panel-lift door does not swing, and skipping it by kind
                # left the street elevation showing a 1000 mm front door and
                # a blank five-metre wall with the driveway running up to it.
                if opening.kind is OpeningKind.OPENING and not wall.is_exterior:
                    continue
                x0 = start + step * opening.offset
                x1 = x0 + step * opening.width
                sill = base + opening.sill
                courses = f"{courses_for(opening.sill + opening.height)}c"
                view.panels.append(
                    Panel(
                        x=min(x0, x1), y=sill,
                        width=abs(x1 - x0), height=opening.height,
                        kind=opening.kind.value,
                        label=(marks or {}).get(opening.id) or courses,
                        courses=courses,
                    )
                )

        view.levels.append(
            Level(base, f"FL {base} ({courses_for(base)}c)" if base else "FL 0 (0c)")
        )
        view.levels.append(
            Level(top, f"CL {top} ({courses_for(top - base)}c + PLATE)")
        )

    roof = building.roof or Roof()
    view.roof, ridge = _roof_lines(building, roof, direction, plate)
    view.levels.append(Level(ridge, f"RIDGE {ridge}"))
    stepped = len({
        s.elevation + s.ceiling_height for s in building.storeys
    }) > 1 and any(
        _storey_rect(s) != _storey_rect(building.storeys[0])
        for s in building.storeys
    )

    view.ground = Line(lo - 1500, 0, hi + 1500, 0)
    view.width_mm = hi - lo
    view.height_mm = ridge
    view.wall_material = building.metadata.get("construction", "")
    view.notes = [
        f"{roof.pitch_degrees:.0f} degree pitch {roof.material} roof",
        f"Overall height {ridge} mm above floor level",
    ]
    if view.wall_material in MASONRY:
        view.notes.append(
            f"External walls {view.wall_material.replace('_', ' ')}; the "
            f"course lines are drawn at {COURSE_MM} mm"
        )
    elif view.wall_material:
        view.notes.append(
            f"External walls {view.wall_material.replace('_', ' ')}. The "
            "cladding is not stated, so no texture is drawn"
        )
    # What is deliberately absent. A reference set has all of it and none of
    # it follows from the model, so naming it beats drawing it somewhere
    # plausible and letting the position read as a decision somebody made.
    view.notes += [
        "Openings are shown at the STRUCTURAL size and marked with their "
        "schedule reference; sizes, head heights and lintels are in the "
        "door and window schedule",
        "Downpipes not shown: how many and where is the roof drainage "
        "design, not a consequence of this plan",
        "Meter box, gutter and roof sheet profiles not shown: supplier and "
        "utility requirements",
    ]
    if stepped:
        view.notes.append(
            "Part of this house is single storey, so it carries its own roof "
            "at its own plate. How the lower roof meets the two storey wall "
            "-- run the main roof down over it, hip it separately, break it "
            "with a box gutter -- is a roof design and is not decided here"
        )
    return view


def elevations(building: Building) -> list[ElevationView]:
    """All four, numbered from the street the way a sheet numbers them."""
    order = {
        "south": ("south", "east", "north", "west"),
        "north": ("north", "west", "south", "east"),
        "west": ("west", "south", "east", "north"),
        "east": ("east", "north", "west", "south"),
    }[building.plot.road_side]
    # Worked out ONCE and shared by all four, so the same window cannot come
    # out W02 on the street and W03 down the side.
    from ..schedule import marks as opening_marks

    found = opening_marks(building)
    return [elevation(building, d, i + 1, found) for i, d in enumerate(order)]
