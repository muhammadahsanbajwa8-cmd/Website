"""The person handed the drawing has to see which rooms came up short.

The solver has always known, room by room, what the brief asked for and what
it got: `layout.unsatisfied`. It was printed to the terminal and nowhere
else, so it reached whoever ran the command and not whoever was handed the
report -- and a squeezed room somebody is told about is a stated limitation
where the same room in silence is a lie. `web/coverage.mjs` asserts exactly
that property for the browser and nothing asserted it here.
"""

import re
import unittest

from codraft.codes import check, design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template

WA = resolve("AU-WA")
DESIGN = design_parameters(WA)

# 10.5 x 16 m of buildable ground for a brief that asks for 261 m2.
TIGHT = Plot(rect=Rect(0, 0, 12500, 28000), road_side="south",
             setback_front=6000, setback_rear=6000,
             setback_left=1000, setback_right=1000)
ROOMY = Plot(rect=Rect(0, 0, 20000, 40000), road_side="south",
             setback_front=6000, setback_rear=6000,
             setback_left=1000, setback_right=1000)


def _report(plot, beds=4):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=1)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    building = build_building(program, plot, layout, design=DESIGN)
    return layout, check(building, WA, layout.warnings,
                         unsatisfied=layout.unsatisfied)


class TestTheReportCarriesTheShortfalls(unittest.TestCase):
    def test_a_squeezed_plan_names_its_squeezed_rooms(self):
        layout, report = _report(TIGHT)
        self.assertTrue(layout.unsatisfied, "this plot is meant to squeeze")
        text = report.to_text()
        self.assertIn("ASKED FOR BUT NOT ACHIEVED", text)
        for item in layout.unsatisfied:
            self.assertIn(item, text)

    def test_it_reaches_the_json_too(self):
        layout, report = _report(TIGHT)
        self.assertEqual(report.to_dict()["unsatisfied"], layout.unsatisfied)

    def test_a_plan_that_fits_says_nothing(self):
        layout, report = _report(ROOMY, beds=3)
        text = report.to_text()
        if "ASKED FOR BUT NOT ACHIEVED" in text:
            # Allowed only if there really is something to report.
            self.assertTrue(layout.unsatisfied)

    def test_no_line_claims_a_shortfall_between_two_equal_numbers(self):
        # "36.0 m2 clear; 36.0 m2 was asked for" reads as a room missing a
        # target it visibly meets. Where the difference rounds away, the line
        # has to say so.
        pattern = re.compile(r"about ([\d.]+) m² clear; ([\d.]+) m² was asked for")
        for plot in (TIGHT, ROOMY):
            layout, _ = _report(plot)
            for item in layout.unsatisfied:
                found = pattern.search(item)
                if found and found.group(1) == found.group(2):
                    self.assertIn("less than 0.1", item, item)


if __name__ == "__main__":
    unittest.main()
