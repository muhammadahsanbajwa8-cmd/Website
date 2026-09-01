"""A roof plane needs a storey under it."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.elevation import _footprint_extent, elevations
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _building(width, depth, storeys, bedrooms=4):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                       storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design)


class RoofFollowsTheShape(unittest.TestCase):
    def setUp(self):
        self.building = _building(15000, 30000, 2)
        self.views = elevations(self.building)

    def test_the_upper_floor_really_does_stop_short_of_the_ground_one(self):
        # The case the roof has to cope with: a single storey garage across
        # the street frontage with two storeys behind it. If this stops being
        # true the test below proves nothing.
        ground, top = self.building.storeys[0], self.building.storeys[-1]
        lo0, hi0 = _footprint_extent(ground, "east")
        lo1, hi1 = _footprint_extent(top, "east")
        self.assertGreater((lo1 - lo0) + (hi0 - hi1), 3000)

    def test_no_eaves_runs_past_the_storey_that_carries_it(self):
        # The fault: one roof at the top plate across the whole ground floor
        # put a roof plane 2.6 m above the garage ceiling with nothing
        # between the two, on 36 of the 140 two-storey elevations in the lot
        # sweep.
        for view in self.views:
            tops = {}
            for storey in self.building.storeys:
                lo, hi = _footprint_extent(storey, view.direction)
                top = storey.elevation + storey.ceiling_height
                tops.setdefault(top, []).append((lo, hi))
            overhang = (self.building.roof.overhang_mm
                        if self.building.roof else 600)
            for line in view.roof:
                if line.y0 != line.y1 or line.y0 not in tops:
                    continue          # a ridge, not an eaves
                x0, x1 = sorted((line.x0, line.x1))
                with self.subTest(view=view.title, y=line.y0):
                    self.assertTrue(
                        any(lo - overhang <= x0 and x1 <= hi + overhang
                            for lo, hi in tops[line.y0]),
                        f"eaves {x0}-{x1} at {line.y0} has nothing under it",
                    )

    @staticmethod
    def _eaves(building, view):
        """The heights a roof springs from -- storey plates, not ridges.

        A hip roof seen along its ridge draws two horizontals, the eaves and
        the ridge, so counting every horizontal line counts the ridge as a
        second eaves and a plain single storey house looks stepped.
        """
        plates = {s.elevation + s.ceiling_height for s in building.storeys}
        return {line.y0 for line in view.roof
                if line.y0 == line.y1 and line.y0 in plates}

    def test_the_single_storey_part_gets_its_own_lower_roof(self):
        side = next(v for v in self.views if v.direction in ("east", "west"))
        self.assertGreater(
            len(self._eaves(self.building, side)), 1,
            "the whole roof springs from one plate on a stepped plan")

    def test_a_house_of_one_shape_all_the_way_up_gets_one_roof(self):
        # Nothing about a single storey plan changed, and it should not have.
        single = _building(15000, 30000, 1)
        for view in elevations(single):
            with self.subTest(view=view.title):
                self.assertEqual(len(self._eaves(single, view)), 1,
                                 "a flat-shaped house got a step")

    def test_the_overall_height_is_the_tallest_mass_s_ridge(self):
        top = self.building.storeys[-1]
        plate = top.elevation + top.ceiling_height
        for view in self.views:
            self.assertGreater(view.height_mm, plate)
            self.assertEqual(view.height_mm, self.views[0].height_mm)


if __name__ == "__main__":
    unittest.main()
