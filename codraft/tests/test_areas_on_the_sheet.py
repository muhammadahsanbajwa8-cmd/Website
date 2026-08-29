"""The area box on the sheet is the one somebody prices from.

FOOTPRINT is the ground the building covers, over the external walls. The
note under the box says so and points at that row. It was neither: it was
the tiling rectangle -- which runs to the wall CENTRELINES, so 7 m2 short on
a 15 x 30 m lot -- multiplied by the number of storeys. A two-storey house
printed 432.6 m2 under the word FOOTPRINT for a building standing on 223.2,
and that was not its floor area either (373.0), because an upper storey is
not the same size as the ground.
"""

import unittest

from codraft.annotate import area_schedule
from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.units import fmt_area

DESIGN = design_parameters(resolve("AU-WA"))
LOTS = ((12500, 28000), (15000, 30000), (18000, 30000))


def _built(width, depth, storeys=1):
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=DESIGN), layout


class TestTheAreaBoxAgreesWithTheModel(unittest.TestCase):
    def test_footprint_is_the_buildings_footprint(self):
        for width, depth in LOTS:
            for storeys in (1, 2):
                building, layout = _built(width, depth, storeys)
                rows = dict(area_schedule(building, layout.envelope)[0])
                with self.subTest(lot=(width, depth), storeys=storeys):
                    self.assertEqual(rows["FOOTPRINT"],
                                     fmt_area(building.footprint))

    def test_footprint_is_one_storey_not_all_of_them(self):
        building, layout = _built(15000, 30000, storeys=2)
        rows = dict(area_schedule(building, layout.envelope)[0])
        self.assertNotEqual(rows["FOOTPRINT"], rows["GROSS FLOOR AREA"])
        self.assertEqual(rows["GROSS FLOOR AREA"],
                         fmt_area(building.gross_floor_area))

    def test_it_counts_the_walls(self):
        # The note promises "over the external walls", so the number has to
        # be bigger than the tiling rectangle, which stops at the centrelines.
        for width, depth in LOTS:
            building, layout = _built(width, depth)
            with self.subTest(lot=(width, depth)):
                self.assertGreater(building.footprint, layout.envelope.area)
                self.assertEqual(dict(area_schedule(building, layout.envelope)[0])
                                 ["FOOTPRINT"], fmt_area(building.footprint))

    def test_a_single_storey_house_has_no_separate_gross_row(self):
        building, layout = _built(15000, 30000)
        rows = dict(area_schedule(building, layout.envelope)[0])
        self.assertNotIn("GROSS FLOOR AREA", rows)

    def test_the_note_still_points_at_footprint(self):
        building, layout = _built(15000, 30000)
        _rows, note = area_schedule(building, layout.envelope)
        self.assertIn("FOOTPRINT", note)
        self.assertIn("external walls", note)


if __name__ == "__main__":
    unittest.main()
