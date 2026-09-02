"""A section: the building cut through and looked at.

A permit set needs one. An elevation says what the outside looks like; a
section says how the thing is put together vertically -- floor to floor, floor
to ceiling, where the roof meets the wall, and how far the whole thing stands
above the ground. It is the drawing a surveyor reads ceiling heights off, and
codraft already holds every number it needs: storey levels, ceilings set out
in courses, wall positions, the roof pitch.

WHAT A SECTION HAS TO DISTINGUISH, and the reason this is not just another
elevation: a section shows two different things at once. Anything the cutting
plane passes THROUGH is drawn heavy -- that is structure, sliced. Anything
BEYOND the plane is drawn light -- that is the far side of the room, seen. Draw
both the same weight and the drawing stops meaning anything, because a reader
can no longer tell what is solid from what is air.

WHAT IT DELIBERATELY DOES NOT SHOW. No footing sizes, no slab thickness, no
lintel depths, no reinforcement, no wall ties. All of that is a section's usual
job and all of it is engineering: it depends on soil classification, wind
category and the loads over each opening, none of which this model carries.
The ground line and the floor levels are drawn because they are geometry; what
happens below the ground line is left to the engineer and the drawing says so
rather than inventing a footing that looks convincing.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..courses import COURSE_MM, courses_for
from ..model import Building, Function, OpeningKind, Roof, Storey
from .elevation import Line, Level, _roof_lines

# How far past the building the ground line runs, so the section sits on
# something rather than floating.
GROUND_RUN = 2000


@dataclass(slots=True)
class Slice:
    """A room the cutting plane passes through, and what it is called."""

    x0: int
    x1: int
    floor: int
    ceiling: int
    name: str


@dataclass(slots=True)
class SectionView:
    """One vertical cut through the building."""

    mark: str                       # 'A', 'B'
    axis: str                       # 'x' when the cut runs east-west
    position: int                   # where the plane sits on the other axis
    cut: list[Line] = field(default_factory=list)      # sliced: heavy
    beyond: list[Line] = field(default_factory=list)   # seen: light
    roof: list[Line] = field(default_factory=list)
    slices: list[Slice] = field(default_factory=list)
    levels: list[Level] = field(default_factory=list)
    ground: Line | None = None
    width_mm: int = 0
    height_mm: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def title(self) -> str:
        return f"Section {self.mark}-{self.mark}"


def _spans(storey: Storey, axis: str, position: int) -> list[tuple[int, int, str, Function]]:
    """The rooms the plane passes through, left to right along the cut."""
    hits = []
    for space in storey.spaces:
        rect = space.rect
        if axis == "x":
            if rect.y0 <= position <= rect.y1:
                hits.append((rect.x0, rect.x1, space.name, space.function))
        else:
            if rect.x0 <= position <= rect.x1:
                hits.append((rect.y0, rect.y1, space.name, space.function))
    return sorted(hits)


def _best_cut(building: Building) -> tuple[str, int]:
    """Where to cut, and which way.

    A section is cut where it shows the most: through the stair if there is
    one, because a stair is the thing a section explains best and the thing a
    plan explains worst. Failing that, through the middle of the building, the
    long way -- a cut across the short dimension shows fewer rooms.
    """
    ground = building.storeys[0]
    for space in ground.spaces:
        if space.function is Function.STAIR:
            centre = space.rect.centre
            # Cut ALONG the stair's run, so the flight is seen from the side
            # rather than sliced across its width into a single step.
            if space.rect.h >= space.rect.w:
                return "y", centre.x
            return "x", centre.y

    bounds = _bounds(ground)
    if bounds is None:
        return "x", 0
    x0, y0, x1, y1 = bounds
    if (x1 - x0) >= (y1 - y0):
        return "x", (y0 + y1) // 2
    return "y", (x0 + x1) // 2


def _bounds(storey: Storey) -> tuple[int, int, int, int] | None:
    rects = [s.rect for s in storey.spaces]
    if not rects:
        return None
    return (min(r.x0 for r in rects), min(r.y0 for r in rects),
            max(r.x1 for r in rects), max(r.y1 for r in rects))


def section(building: Building, mark: str = "A") -> SectionView:
    """Cut the building and project what the cut reveals."""
    if not building.storeys:
        raise ValueError("nothing to cut: the building has no storeys")

    axis, position = _best_cut(building)
    view = SectionView(mark=mark, axis=axis, position=position)

    bounds = _bounds(building.storeys[0])
    if bounds is None:
        raise ValueError("nothing to cut: the ground storey has no rooms")
    x0, y0, x1, y1 = bounds
    lo, hi = (x0, x1) if axis == "x" else (y0, y1)

    plate = 0
    for storey in building.storeys:
        base = storey.elevation
        top = base + storey.ceiling_height
        plate = max(plate, top)
        spans = _spans(storey, axis, position)

        # The floor and the ceiling are cut by the plane along their whole
        # length, so they are structure, drawn heavy.
        view.cut.append(Line(lo, base, hi, base))
        view.cut.append(Line(lo, top, hi, top))

        for left, right, name, function in spans:
            view.slices.append(Slice(left, right, base, top, name))
            # Each room's side walls are cut where the plane crosses them.
            for edge in (left, right):
                view.cut.append(Line(edge, base, edge, top))
            # What is behind the room -- the far wall -- is seen, not cut.
            if not function.is_outdoor:
                view.beyond.append(Line(left, top, right, top))

        view.levels.append(
            Level(base, f"FL {base} ({courses_for(base)}c)" if base else "FL 0")
        )
        view.levels.append(
            Level(top, f"CL {top} ({courses_for(top - base)}c + PLATE)")
        )

    roof = building.roof or Roof()
    direction = "south" if axis == "x" else "west"
    # Only the masses the plane actually passes through. A house whose
    # garage is single storey has a second, lower roof, and it belongs on
    # the elevations -- from outside you see it -- but not on a section cut
    # 20 m behind it.
    view.roof, ridge = _roof_lines(building, roof, direction, plate,
                                   through=position)
    view.levels.append(Level(ridge, f"RIDGE {ridge}"))

    view.ground = Line(lo - GROUND_RUN, 0, hi + GROUND_RUN, 0)
    view.width_mm = hi - lo
    view.height_mm = ridge
    view.notes = [
        f"Cut {'east-west' if axis == 'x' else 'north-south'} at "
        f"{position} mm; see the marker on the floor plan.",
        f"Ceilings set out in brick courses: one course is {COURSE_MM} mm.",
        "Heavy lines are cut by the section; light lines are seen beyond it.",
        "NO FOOTINGS, SLAB THICKNESS, LINTELS OR REINFORCEMENT ARE SHOWN. "
        "Those depend on soil classification, wind category and the loads "
        "over each opening, none of which this model carries. An engineer "
        "designs them.",
    ]
    # The roof is drawn where the PLANE cuts it, which on a cut taken along
    # the ridge is lower than the ridge itself. Without saying so, the RIDGE
    # level called up the side stands two metres clear of the roof under it
    # and reads as a drafting error rather than as the two different heights
    # they are.
    top = max((max(line.y0, line.y1) for line in view.roof), default=ridge)
    if ridge - top > COURSE_MM:
        view.notes.insert(
            2,
            f"The roof is drawn where this plane cuts it, {top} mm. RIDGE "
            f"{ridge} is the building's overall height, reached at the ridge "
            "itself and shown on the elevations.",
        )
    return view


def section_marker(building: Building, mark: str = "A") -> tuple[str, int, int, int]:
    """Where to draw the cut line on the plan: (axis, position, from, to).

    A section without a marker showing where it was cut is not a section, it
    is a picture. The line runs past the building at both ends, which is how
    a sheet draws it.

    It runs past by the distance the plan already stands its first dimension
    chain off, and not the 2500 mm it used to. That is not a nicer-looking
    number: the marker is an annotation, and an annotation that changes the
    SCALE of the drawing it annotates has cost more than it is worth. At
    2500 mm the line pushed a four bedroom plan's content box from 26165 to
    28370 mm against the 27700 an A3 holds at 1:100, and ten of the hundred
    floor plan sheets in the AU-WA lot sweep dropped to 1:200 for it.
    Measured over the same hundred, every overrun up to 2000 mm is free.

    `FIRST_OFFSET` is inside that with room to spare, and it is the figure
    this drawing already uses for "clear of the building", so the cut line
    lands level with the chain a reader is already looking at.
    """
    from ..annotate import FIRST_OFFSET

    axis, position = _best_cut(building)
    bounds = _bounds(building.storeys[0])
    if bounds is None:
        return axis, position, 0, 0
    x0, y0, x1, y1 = bounds
    if axis == "x":
        return axis, position, x0 - FIRST_OFFSET, x1 + FIRST_OFFSET
    return axis, position, y0 - FIRST_OFFSET, y1 + FIRST_OFFSET
