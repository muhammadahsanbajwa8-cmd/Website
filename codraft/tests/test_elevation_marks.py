"""The elevation and the schedule are one drawing, not two."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.elevation import elevations
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.schedule import schedule


def _building(width=15000, depth=30000, bedrooms=4, storeys=2):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                       storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design)


class ElevationsCarryTheScheduleMark(unittest.TestCase):
    def setUp(self):
        self.building = _building()
        self.views = elevations(self.building)
        self.rows, _ = schedule(self.building)

    def test_every_opening_drawn_points_at_a_row_in_the_schedule(self):
        known = {row.mark for row in self.rows}
        seen = {p.label for v in self.views for p in v.panels}
        self.assertTrue(seen, "no openings were drawn at all")
        self.assertLessEqual(seen, known)

    def test_the_mark_is_the_row_with_that_opening_s_size(self):
        by_mark = {row.mark: row for row in self.rows}
        for view in self.views:
            for panel in view.panels:
                with self.subTest(view=view.title, mark=panel.label):
                    row = by_mark[panel.label]
                    self.assertEqual(panel.width, row.width)
                    self.assertEqual(panel.height, row.height)

    def test_one_opening_type_gets_one_mark_across_all_four_views(self):
        # The same window seen on two elevations must not come out W02 on
        # the street and W03 down the side. `elevations` works the marks out
        # once and shares them, which is what makes this hold.
        by_size = {}
        for view in self.views:
            for panel in view.panels:
                by_size.setdefault((panel.kind, panel.width, panel.height),
                                   set()).add(panel.label)
        for size, labels in by_size.items():
            with self.subTest(size=size):
                self.assertEqual(len(labels), 1, f"{size} drawn as {labels}")

    def test_the_head_in_courses_is_still_carried(self):
        # It was the label before the mark took that place. A sheet calls a
        # head up in courses and it should not have been lost.
        for view in self.views:
            for panel in view.panels:
                self.assertTrue(panel.courses.endswith("c"))

    def test_an_elevation_asked_for_alone_falls_back_to_the_courses(self):
        # A mark that did not come from the schedule's own grouping would be
        # worse than no mark, so on its own an elevation labels the head.
        from codraft.export.elevation import elevation
        lone = elevation(self.building, "south")
        for panel in lone.panels:
            self.assertEqual(panel.label, panel.courses)


if __name__ == "__main__":
    unittest.main()
