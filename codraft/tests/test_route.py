"""Every room has to be reachable from the front door.

`baseline.route.exists` is the one finding that makes the rest of the report
irrelevant: a bedroom nobody can walk into is not a bedroom with a problem,
it is not a bedroom. So the cases that produced one are pinned here.

They all came from the same mistake in `walls`. A room with no wall onto the
passage opens into a neighbour, and the neighbour it chose was the widest --
which is a room picked for being big, not for leading anywhere. Five bedrooms
down one side of a passage, each touching the next along its long wall and
the passage along none of it, each opened into the bedroom beside it, and the
whole sleeping wing had no way out. Doors are now hung outwards from
circulation instead, so each one points towards the way out.

The sweep below is deliberately wider than the briefs that failed. The bug
was not in any one plan, and a test that only re-ran the two known-bad lots
would pass again the moment the packer moved a wall.
"""

import unittest

from codraft.codes import check
from codraft.codes.jurisdiction import resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.layout.walls import DOOR_MIN_STRUCTURAL
from codraft.model import OpeningKind, Plot, Roof
from codraft.program import template

# The two lots that produced the failures, plus their neighbours either side.
LOTS = [(12500, 28000), (15000, 30000), (16000, 24000),
        (18000, 30000), (18000, 35000), (20000, 35000), (20000, 40000)]
PROGRAMS = [(3, 2), (4, 2), (5, 2), (5, 3)]


def _plans():
    for width, depth in LOTS:
        for beds, baths in PROGRAMS:
            for rear in (1000, 6000):
                program = template("au-house", bedrooms=beds,
                                   bathrooms=baths, storeys=1)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=rear,
                            setback_left=1000, setback_right=1000)
                label = f"{width}x{depth} {beds}b{baths}ba rear{rear}"
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue          # refused, and refusing is not a defect
                building = build_building(program, plot, layout)
                building.roof = Roof(pitch_degrees=25.0, overhang_mm=600,
                                     kind="hip")
                yield label, building, layout


class EveryRoomCanBeWalkedTo(unittest.TestCase):
    def test_no_plan_is_drawn_with_an_unreachable_room(self):
        stranded = []
        drawn = 0
        for label, building, layout in _plans():
            drawn += 1
            report = check(building, resolve("Perth"), layout.warnings)
            rooms = [f.subject for f in report.failures
                     if f.rule_id == "baseline.route.exists"]
            if rooms:
                stranded.append(f"{label}: {', '.join(rooms)}")
        self.assertGreater(drawn, 20, "the sweep stopped producing plans")
        self.assertEqual([], stranded, "\n".join(stranded))

    def test_a_room_entered_through_another_still_says_so(self):
        """The fix must not have silenced the warning, only redirected it.

        A room opening into another room is an ordinary plan for an ensuite
        and a questionable one for a bedroom, and either way the report has
        to keep saying which rooms are entered that way. Hanging the door
        towards circulation changes WHERE it opens, not whether that is
        worth mentioning.
        """
        seen = False
        for _, _, layout in _plans():
            if any("no wall onto circulation" in w for w in layout.warnings):
                seen = True
                break
        self.assertTrue(
            seen,
            "no plan in the sweep reports a room entered through another "
            "room. Either the packer stopped producing them -- which would "
            "be a large improvement worth checking -- or the warning was "
            "lost when the door target changed.",
        )

if __name__ == "__main__":
    unittest.main()


class TestTheDoorGraphIsNotAFiction(unittest.TestCase):
    """A doorway of no width is the absence of a door, not a narrow one.

    Two rooms that clip a corner share a wall of 150 or 191 mm. A door hung
    there came out 0 mm wide and was drawn anyway -- and because the route
    check walks the door graph, the room it "served" looked connected. Six
    plans in the lot sweep passed `baseline.route.exists` on that fiction,
    and one of them was a master suite reached only through a 150 mm clip of
    the portico.
    """

    def test_no_opening_is_drawn_with_no_width(self):
        for label, building, _layout in _plans():
            with self.subTest(label):
                for storey in building.storeys:
                    for opening in storey.openings:
                        self.assertGreater(
                            opening.width, 0,
                            f"{label}: {opening.id} is an opening of no width",
                        )

    def test_every_door_sits_on_a_wall_that_can_carry_one(self):
        # 300 mm of jamb either side of the leaf is what the builder allows
        # for; a wall shorter than that plus a leaf is not a way through.
        for label, building, _layout in _plans():
            with self.subTest(label):
                for storey in building.storeys:
                    for opening in storey.openings:
                        if opening.kind is not OpeningKind.DOOR:
                            continue
                        wall = storey.wall(opening.wall)
                        if wall is None or wall.is_exterior:
                            continue
                        self.assertGreaterEqual(
                            wall.length - 300, DOOR_MIN_STRUCTURAL,
                            f"{label}: a door on a {wall.length} mm wall",
                        )
