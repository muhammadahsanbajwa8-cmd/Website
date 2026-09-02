"""A sheet name has to fit the block it is printed in."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet, elevation_sheets
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.sheet import TITLE_BLOCK_WIDTH

# The name is set in `tb-big`, 5.4 px bold sans, and printed 4 mm in from the
# left of the block. A capital in that face runs about 0.62 em, which is the
# same order of estimate the content box uses for its own text; it is a
# measure, not a promise, so the budget below leaves the inset at both ends.
CAP_MM = 5.4 * 0.62
BUDGET = TITLE_BLOCK_WIDTH - 8


def _pages():
    design = design_parameters(resolve("AU-WA"))
    for storeys in (1, 2):
        program = template("au-house", bedrooms=4, bathrooms=2,
                           storeys=storeys)
        program.build_to(design)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout, design=design)
        sheets = [("site", None)]
        sheets += [("architectural", s.index) for s in building.storeys]
        sheets += [("elevations", p) for p in range(elevation_sheets(building))]
        sheets += [("sections", None), ("schedules", None)]
        for sheet, index in sheets:
            name = build_sheet(building, index, sheet, None, layout.envelope,
                               "metric")[4]
            yield storeys, sheet, name


class SheetNamesFitTheirBlock(unittest.TestCase):
    def test_every_name_in_a_set(self):
        # "GROUND FLOOR - ARCHITECTURAL PLAN" wants about 110 mm of the 84
        # the block holds, and ran off its right edge: the sheet read
        # "GROUND FLOOR - ARCHITECTUR".
        seen = 0
        for storeys, sheet, name in _pages():
            seen += 1
            with self.subTest(storeys=storeys, sheet=sheet, name=name):
                self.assertLessEqual(len(name) * CAP_MM, BUDGET)
        self.assertGreater(seen, 10)

    def test_a_floor_plan_says_which_floor(self):
        names = [n for st, sh, n in _pages() if sh == "architectural" and st == 2]
        self.assertIn("Ground floor plan", names)
        self.assertIn("Floor 1 plan", names)

    def test_the_site_plan_is_not_called_a_floor(self):
        # It shows the ground storey because that is what sits on the lot.
        for _storeys, sheet, name in _pages():
            if sheet == "site":
                self.assertEqual(name, "Site plan")


if __name__ == "__main__":
    unittest.main()
