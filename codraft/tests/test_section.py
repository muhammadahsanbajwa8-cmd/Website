"""A section, and the two things that make it one.

An elevation says what the outside looks like. A section says how the thing
is put together vertically, and a permit set needs one. Two properties make
it readable rather than decorative, and both are asserted here:

  * CUT AND SEEN ARE DIFFERENT WEIGHTS. What the plane passes through is
    structure and is heavy; what is behind it is air and is light. Draw both
    the same and a reader cannot tell solid from air -- the drawing stops
    meaning anything.

  * THE PLAN CARRIES THE MARKER. A section without a line on the plan saying
    where it was cut is a picture of a building, not a drawing of this one.

And the thing it must not do: invent structure. No footings, slab thickness,
lintels or reinforcement, because all of that depends on soil classification,
wind category and loads this model does not carry.
"""

import unittest

from codraft.courses import courses_for
from codraft.export.section import section, section_marker
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Function, Plot, Roof
from codraft.program import template


def _building(storeys=2, width=15000, depth=30000, roof=True):
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    building = build_building(program, plot, solve(program, plot))
    if roof:
        building.roof = Roof(pitch_degrees=25.0, overhang_mm=600, kind="hip")
    return building


class TestTheCutIsTakenWhereItShows(unittest.TestCase):
    def test_it_cuts_through_the_stair_when_there_is_one(self):
        # A stair is the thing a section explains best and a plan explains
        # worst, so that is where the cut goes.
        building = _building(storeys=2)
        axis, position = section_marker(building)[:2]
        stair = next(s for s in building.storeys[0].spaces
                     if s.function is Function.STAIR)
        span = ((stair.rect.y0, stair.rect.y1) if axis == "x"
                else (stair.rect.x0, stair.rect.x1))
        self.assertGreaterEqual(position, span[0])
        self.assertLessEqual(position, span[1])

    def test_a_single_storey_still_produces_a_section(self):
        view = section(_building(storeys=1))
        self.assertTrue(view.cut)
        self.assertTrue(view.slices)

    def test_it_passes_through_rooms_and_names_them(self):
        view = section(_building())
        self.assertTrue(view.slices)
        for piece in view.slices:
            self.assertTrue(piece.name)
            self.assertGreater(piece.x1, piece.x0)
            self.assertGreater(piece.ceiling, piece.floor)


class TestCutAndSeenAreTold(unittest.TestCase):
    def test_both_kinds_of_line_are_produced(self):
        view = section(_building())
        self.assertTrue(view.cut, "nothing was cut")
        self.assertTrue(view.beyond, "nothing was seen beyond the cut")

    def test_they_are_drawn_at_different_weights(self):
        from codraft.export.pdf import parse_style
        from codraft.export.svg import STYLE

        styles = parse_style(STYLE)
        cut = float(styles["sect-cut"]["stroke-width"])
        beyond = float(styles["sect-beyond"]["stroke-width"])
        self.assertGreater(
            cut, beyond * 2,
            "cut and seen are too close in weight to tell apart",
        )

    def test_both_reach_the_drawing(self):
        canvas, *_ = build_sheet(_building(), sheet="sections")
        classes = {op[1] for op in canvas.ops}
        self.assertIn("sect-cut", classes)
        self.assertIn("sect-beyond", classes)


class TestThePlanSaysWhereItWasCut(unittest.TestCase):
    def test_the_marker_is_on_the_plan(self):
        canvas, *_ = build_sheet(_building(), storey_index=0)
        ops = [op for op in canvas.ops if op[1] in ("mark-line", "mark-text")]
        self.assertTrue(ops, "the plan carries no section marker")
        self.assertEqual(
            sum(1 for op in ops if op[1] == "mark-text"), 2,
            "a section marker needs a tag at each end",
        )

    def test_the_marker_runs_past_the_building(self):
        building = _building()
        axis, position, run_from, run_to = section_marker(building)
        rects = [s.rect for s in building.storeys[0].spaces]
        if axis == "x":
            self.assertLess(run_from, min(r.x0 for r in rects))
            self.assertGreater(run_to, max(r.x1 for r in rects))
        else:
            self.assertLess(run_from, min(r.y0 for r in rects))
            self.assertGreater(run_to, max(r.y1 for r in rects))

    def test_the_marker_and_the_section_agree(self):
        building = _building()
        view = section(building)
        axis, position = section_marker(building)[:2]
        self.assertEqual((view.axis, view.position), (axis, position))


class TestItDoesNotInventStructure(unittest.TestCase):
    def test_the_notes_disclaim_the_engineering(self):
        joined = " ".join(section(_building()).notes)
        for word in ("FOOTINGS", "LINTELS", "REINFORCEMENT"):
            self.assertIn(word, joined)
        self.assertIn("engineer", joined.lower())

    def test_nothing_is_drawn_below_the_ground_line(self):
        # Whatever is under the ground line is the engineer's, so there is
        # nothing there to be mistaken for a footing.
        view = section(_building())
        for line in view.cut + view.beyond:
            self.assertGreaterEqual(min(line.y0, line.y1), 0)


class TestLevelsAreReadable(unittest.TestCase):
    def test_levels_are_called_up_in_courses(self):
        labels = " ".join(l.label for l in section(_building()).levels)
        self.assertIn("c", labels)
        self.assertIn("RIDGE", labels)
        self.assertIn("FL 0", labels)

    def test_two_levels_close_together_get_separated_labels(self):
        # A ceiling and the floor above it are 200 mm apart, which is 2 mm at
        # 1:100 -- the labels print over each other unless they are nudged.
        from codraft.export.svg import _level_labels
        from codraft.export.elevation import Level

        placed = _level_labels([Level(0, "FL 0"), Level(2434, "CL"),
                                Level(2634, "FL")])
        label_ys = [label_y for _, label_y, _ in placed]
        for a, b in zip(label_ys, label_ys[1:]):
            self.assertGreaterEqual(b - a, 500)
        # The lines themselves stay at their true heights.
        self.assertEqual([true_y for true_y, _, _ in placed], [0, 2434, 2634])


if __name__ == "__main__":
    unittest.main()
