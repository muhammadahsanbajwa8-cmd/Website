"""Door and window schedules, and the specification that goes with an opening.

An opening is the most worked-over part of a house. It is where the weather
gets in, where the wall stops carrying load and something else has to carry
it, where the insulation is interrupted, and where a neighbour can see in.
A plan that draws a rectangle in a wall and says nothing else about it has
described almost none of that.

What this module can do honestly is bounded, and the boundary matters:

  * SIZES AND SETTING OUT are geometry, and are derived. Every head and sill
    is on a whole brick course, because that is how the wall is built.
  * LINTELS are identified but NOT sized. Which openings need one falls out
    of the geometry -- any opening in a loadbearing wall does. What size it
    is depends on the span, the load above it and the wind classification,
    which is engineering, and no amount of care with a plan substitutes for
    an engineer.
  * FLASHING, INSULATION AND SEALING are specification, not geometry. They
    are listed against the standard that governs them so the items are on the
    drawing and get priced and built, and they are labelled as specification
    rather than reported as checks that passed. Nothing here has been
    verified, because none of it can be verified from a plan.

The size code follows the convention Australian window suppliers use --
height then width, in units of 100 mm, so a 1200 high by 1800 wide window is
1218. Manufacturers are not perfectly consistent about the order, which is
why every row carries the millimetre dimensions as well and the header says
which way round the code reads. A schedule that can be misread by a supplier
is worse than no schedule.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .courses import COURSE_MM, courses_for
from .model import Building, Function, Opening, OpeningKind, WallKind


@dataclass(slots=True)
class ScheduleRow:
    """One type of opening, and everywhere it occurs."""

    mark: str                 # W01, D03
    width: int
    height: int
    sill: int
    kind: OpeningKind
    rooms: list[str] = field(default_factory=list)
    storeys: set[int] = field(default_factory=set)
    exterior: bool = True
    egress: bool = False
    needs_lintel: bool = False

    @property
    def count(self) -> int:
        return len(self.rooms)

    @property
    def head(self) -> int:
        return self.sill + self.height

    @property
    def code(self) -> str:
        """The supplier's size code: height then width, in 100 mm units."""
        return f"{self.height // 100:02d}{self.width // 100:02d}"

    @property
    def head_courses(self) -> int:
        return courses_for(self.head, plate=0)

    @property
    def sill_courses(self) -> int:
        return courses_for(self.sill, plate=0) if self.sill else 0

    def set_out(self) -> str:
        """How the drawing calls the height up: courses first, mm after."""
        if self.kind is OpeningKind.DOOR:
            return f"head {self.head_courses}c ({self.head} mm)"
        return (
            f"head {self.head_courses}c ({self.head} mm), "
            f"sill {self.sill_courses}c ({self.sill} mm)"
        )


def _on_a_course(value: int) -> bool:
    return value % COURSE_MM == 0


def schedule(building: Building) -> tuple[list[ScheduleRow], list[str]]:
    """Group the building's openings into types, and report what is off.

    Returns the rows and any warnings -- a head that does not land on a
    course being the one worth shouting about, since it means somebody will
    have to cut bricks or move the lintel.
    """
    rows: dict[tuple, ScheduleRow] = {}
    warnings: list[str] = []
    counters = {OpeningKind.WINDOW: 0, OpeningKind.DOOR: 0, OpeningKind.OPENING: 0}
    prefix = {OpeningKind.WINDOW: "W", OpeningKind.DOOR: "D", OpeningKind.OPENING: "O"}

    for storey in building.storeys:
        for opening in sorted(
            storey.openings, key=lambda o: (o.kind.value, -o.width, -o.height, o.id)
        ):
            wall = next((w for w in storey.walls if w.id == opening.wall), None)
            exterior = wall.kind is WallKind.EXTERIOR if wall else False
            key = (opening.kind, opening.width, opening.height, opening.sill, exterior)
            row = rows.get(key)
            if row is None:
                counters[opening.kind] += 1
                row = ScheduleRow(
                    mark=f"{prefix[opening.kind]}{counters[opening.kind]:02d}",
                    width=opening.width,
                    height=opening.height,
                    sill=opening.sill,
                    kind=opening.kind,
                    exterior=exterior,
                    # Every opening in an exterior wall of a masonry house is
                    # in a loadbearing wall. Which ones need a lintel is
                    # geometry; what size it is, is not.
                    needs_lintel=exterior,
                )
                rows[key] = row
            row.storeys.add(storey.index)
            row.egress = row.egress or opening.is_egress
            room = _room_for(building, storey, opening)
            row.rooms.append(room)

            if exterior and not _on_a_course(opening.sill + opening.height):
                warnings.append(
                    f"{row.mark} has its head at {opening.sill + opening.height} mm, "
                    f"which is not a whole course of {COURSE_MM} mm. The "
                    "bricklayer will either cut a course or move the lintel."
                )

    ordered = sorted(rows.values(), key=lambda r: (r.kind.value, r.mark))
    return ordered, sorted(set(warnings))


def marks(building: Building) -> dict[str, str]:
    """Which schedule mark belongs to each opening, by opening id.

    Built by re-running the same grouping `schedule` does, so a mark on the
    plan and a mark in the schedule cannot come out different. Duplicating
    the keying instead would work until the day somebody changes what makes
    two openings the same type, and then the plan would point at the wrong
    row -- which is worse than no mark, because a builder would trust it.
    """
    rows, _ = schedule(building)
    by_key = {
        (row.kind, row.width, row.height, row.sill, row.exterior): row.mark
        for row in rows
    }
    out: dict[str, str] = {}
    for storey in building.storeys:
        for opening in storey.openings:
            wall = next((w for w in storey.walls if w.id == opening.wall), None)
            exterior = wall.kind is WallKind.EXTERIOR if wall else False
            mark = by_key.get(
                (opening.kind, opening.width, opening.height, opening.sill,
                 exterior)
            )
            if mark:
                out[opening.id] = mark
    return out


def _room_for(building: Building, storey, opening: Opening) -> str:
    """Which room this opening serves, for the 'location' column."""
    wall = next((w for w in storey.walls if w.id == opening.wall), None)
    if wall is None:
        return "?"
    names = []
    for space_id in wall.separates:
        space = next((s for s in storey.spaces if s.id == space_id), None)
        if space is not None:
            names.append(space.name)
    return " / ".join(names) if names else "external"


# --------------------------------------------------------------------------
# The specification that belongs with an opening.
#
# Every line names the standard that governs it. None of it is checked, and
# the block says so -- these are items to be drawn, priced and built, not
# findings. Listing them is how they stop being forgotten; calling them
# "passed" would be a lie about what a plan can tell you.
# --------------------------------------------------------------------------

_OPENING_SPEC = [
    (
        "Head and sill flashing",
        "NCC Housing Provisions Part 7.3 / AS 3700",
        "Flashings at every external opening, lapped over the frame at the "
        "head and turned up at the jambs, with stop ends. In a cavity wall "
        "the head flashing has to cross the cavity and weep to the outer "
        "leaf, or it drains into the cavity it was meant to drain out of.",
    ),
    (
        "Damp-proof course",
        "NCC Housing Provisions Part 7.3 / AS 3700",
        "DPC continuous under every sill and at the base of the wall, lapped "
        "to the flashings so there is no break in the path water takes out.",
    ),
    (
        "Window selection and installation",
        "AS 2047, with wind classification to AS 4055",
        "Windows and external glazed doors are selected against the site's "
        "wind classification. The classification comes from a site "
        "assessment -- terrain, shielding and topography -- which is not "
        "modelled here, so no N or C rating is stated.",
    ),
    (
        "Glazing",
        "AS 1288",
        "Grade of glass and whether it must be safety glass depend on the "
        "pane size and its height above the floor. Doors, sidelights and "
        "anything close to floor level are the usual cases.",
    ),
    (
        "Insulation continuity at the reveal",
        "NCC Volume Two Part 13 (energy efficiency)",
        "The reveal is where a wall's insulation is interrupted. Required "
        "R-values are set by climate zone and are not stated here, because "
        "they change with the zone and with the NCC edition the state has "
        "adopted -- confirm both. The detail to draw is the insulation "
        "carried up to the frame and sealed, not stopped short of it.",
    ),
    (
        "Sealing against air leakage",
        "NCC Volume Two Part 13",
        "The gap between frame and structure sealed on the inside face. An "
        "unsealed reveal loses more than the glass does.",
    ),
    (
        "Lintels over openings",
        "AS 3700, sized by an engineer",
        "Every opening in a loadbearing wall needs a lintel. The span, the "
        "load over it and the wind classification decide the section, and "
        "all three are engineering. The schedule marks which openings need "
        "one; it does not size them, and nothing here should be built from.",
    ),
    (
        "Termite management at penetrations",
        "AS 3660.1",
        "Required in most of Australia, and the perimeter and any "
        "penetration through the slab are where it is detailed.",
    ),
]


def opening_specification() -> list[tuple[str, str, str]]:
    """The specification items that belong against every external opening."""
    return list(_OPENING_SPEC)


def format_schedule(rows: list[ScheduleRow], title: str) -> list[str]:
    """The schedule as drawing-block text."""
    if not rows:
        return []
    out = [title, "-" * 72]
    out.append(
        f"  {'MARK':5} {'CODE':6} {'SIZE (W x H)':16} {'SET OUT':34} "
        f"{'NO':3} {'LINTEL':7} LOCATION"
    )
    for r in rows:
        size = f"{r.width} x {r.height}"
        location = ", ".join(sorted(set(r.rooms)))
        if len(location) > 40:
            location = location[:37] + "..."
        out.append(
            f"  {r.mark:5} {r.code:6} {size:16} {r.set_out():34} "
            f"{r.count:<3} {'YES' if r.needs_lintel else '-':7} {location}"
        )
    out.append("")
    if any(r.needs_lintel for r in rows):
        # The specification item for lintels says "the schedule marks which
        # openings need one". It did not: `needs_lintel` was worked out for
        # every row and printed nowhere, so the document made a claim about
        # itself that was not true. The garage opening is what made it matter
        # -- 5.2 m of loadbearing external wall over a hole, and no column
        # anywhere saying so.
        out.append(
            "  LINTEL YES means the opening is in a loadbearing wall and needs "
            "one. The span and the load decide the section, and both are an "
            "engineer's; this marks them, it does not size them."
        )
    out.append(
        "  Size codes read HEIGHT then WIDTH in units of 100 mm, which is the "
        "commoner Australian convention -- but suppliers differ, so order "
        "against the millimetre sizes, not the code."
    )
    out.append(
        "  Heads and sills are given in brick courses first because that is "
        f"how the wall is built: one course is {COURSE_MM} mm."
    )
    return out
