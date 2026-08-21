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


def _roof_lines(
    building: Building, roof: Roof, direction: str, plate: int
) -> tuple[list[Line], int]:
    """The roof as it appears from one side, and the ridge height.

    The roof springs from the top of the brickwork rather than from the
    plate above it. That is a 26 mm distinction and it is the difference
    between reproducing a real sheet's overall height exactly and being
    a plate out: the reference set gives 5134 for a 11,690 span at 25
    degrees off a 28 course wall, and 28 x 86 + 2726 is 5134.
    """
    ground = building.storeys[0]
    xs = [s.rect.x0 for s in ground.spaces] + [s.rect.x1 for s in ground.spaces]
    ys = [s.rect.y0 for s in ground.spaces] + [s.rect.y1 for s in ground.spaces]
    if not xs:
        return [], plate
    width, depth = max(xs) - min(xs), max(ys) - min(ys)

    # The ridge runs along the longer axis; the roof climbs over the shorter.
    span = min(width, depth)
    ridge_along_x = width >= depth
    rise = roof.rise_over(span)
    brickwork = courses_for(plate) * COURSE_MM
    ridge = brickwork + rise

    lo, hi = _footprint_extent(ground, direction)
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


def elevation(building: Building, direction: str, number: int = 1) -> ElevationView:
    """Project the building as seen from one compass point."""
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
                if opening.kind is OpeningKind.OPENING:
                    continue
                x0 = start + step * opening.offset
                x1 = x0 + step * opening.width
                sill = base + opening.sill
                view.panels.append(
                    Panel(
                        x=min(x0, x1), y=sill,
                        width=abs(x1 - x0), height=opening.height,
                        kind=opening.kind.value,
                        # Height in courses, the way the sheet calls it up.
                        label=f"{courses_for(opening.sill + opening.height)}c",
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
        "Openings are shown at the STRUCTURAL size; the frame within it is "
        "the window schedule's",
        "Downpipes not shown: how many and where is the roof drainage "
        "design, not a consequence of this plan",
        "Meter box, gutter and roof sheet profiles not shown: supplier and "
        "utility requirements",
    ]
    return view


def elevations(building: Building) -> list[ElevationView]:
    """All four, numbered from the street the way a sheet numbers them."""
    order = {
        "south": ("south", "east", "north", "west"),
        "north": ("north", "west", "south", "east"),
        "west": ("west", "south", "east", "north"),
        "east": ("east", "north", "west", "south"),
    }[building.plot.road_side]
    return [elevation(building, d, i + 1) for i, d in enumerate(order)]
