"""A section shows the roof where its plane cuts it, not the outline."""

import math
import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.elevation import _storey_rect, elevations
from codraft.export.section import section
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _building(storeys=2, width=15000, depth=30000):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design)


def _top(view):
    return max(max(line.y0, line.y1) for line in view.roof)


class TheSectionDrawsTheRoofAtItsPlane(unittest.TestCase):
    def setUp(self):
        self.building = _building()
        self.view = section(self.building)

    def test_the_cut_runs_along_the_ridge_and_not_across_it(self):
        # The case that matters. Cut ACROSS the ridge, the drawing is already
        # the true cross-section: the roof climbs from the eaves to the apex
        # in the plane of the cut. This test measures nothing unless the cut
        # is the other kind.
        top = _storey_rect(self.building.storeys[-1])
        width, depth = top[2] - top[0], top[3] - top[1]
        ridge_along_x = width >= depth
        self.assertEqual(self.view.axis, "x")
        self.assertTrue(ridge_along_x, "the ridge is across this cut")

    def test_the_roof_stops_where_the_plane_reaches_it(self):
        # The outline put the ridge over the rooms whatever the plane was
        # doing: 7607 mm on a cut where the roof has climbed to 5573.
        self.assertLess(_top(self.view), self.view.height_mm)

    def test_the_height_it_stops_at_is_the_pitch_and_the_distance(self):
        roof = self.building.roof
        top = _storey_rect(self.building.storeys[-1])
        climb = min(self.view.position - top[1], top[3] - self.view.position)
        storey = self.building.storeys[-1]
        plate = storey.elevation + storey.ceiling_height
        want = plate + climb * math.tan(math.radians(roof.pitch_degrees))
        # Within a brick course: the springing is snapped to whole courses.
        self.assertLess(abs(_top(self.view) - want), 120)

    def test_the_ridge_level_is_still_the_building_s_overall_height(self):
        # It is the figure a planning scheme asks for and it does not depend
        # on where somebody chose to cut.
        self.assertEqual(self.view.height_mm,
                         elevations(self.building)[0].height_mm)

    def test_the_drawing_says_the_two_heights_are_different(self):
        # Otherwise the RIDGE level stands two metres clear of the roof under
        # it and reads as a drafting error.
        joined = " ".join(self.view.notes)
        self.assertIn(str(_top(self.view)), joined)
        self.assertIn(str(self.view.height_mm), joined)

    def test_an_elevation_still_shows_the_whole_outline(self):
        # From outside you see the ridge however far behind the face it is.
        for view in elevations(self.building):
            self.assertEqual(
                max(max(line.y0, line.y1) for line in view.roof),
                view.height_mm,
            )


if __name__ == "__main__":
    unittest.main()
