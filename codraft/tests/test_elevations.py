"""Brick courses and elevations, checked against a real permit set.

The reference is Redink Homes' "The Trio" (Lot 302 Lalor Road, Kenwick WA,
job 2508047M): 28c ceilings called up as CL 2435, 31c as CL 2692, a 25
degree roof over an 11,690 span, and an overall height of 5134 mm. If the
vertical arithmetic here is right, those numbers come back out.
"""

import math
import unittest

from codraft.courses import (
    COURSE_MM,
    ceiling_height,
    courses_for,
    describe,
    snap_to_course,
    storey_height_for,
)
from codraft.export.elevation import elevation, elevations
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.walls import CONSTRUCTION
from codraft.model import Plot, Roof
from codraft.program import template


class TestCourses(unittest.TestCase):
    def test_reproduces_the_reference_ceiling_levels(self):
        # The sheet states CL 2435 at 28c and CL 2692 at 31c.
        self.assertAlmostEqual(ceiling_height(28), 2435, delta=1)
        self.assertAlmostEqual(ceiling_height(31), 2692, delta=1)

    def test_a_required_height_rounds_up_to_a_whole_course(self):
        # The NCC wants 2400. Rounding down builds 27 courses and finishes
        # at 2348 -- a code failure created by arithmetic, not by design.
        self.assertEqual(courses_for(2400), 28)
        self.assertGreaterEqual(snap_to_course(2400), 2400)
        self.assertGreaterEqual(ceiling_height(courses_for(2400)), 2400)

    def test_never_rounds_a_requirement_down(self):
        for wanted in range(2000, 3000, 7):
            self.assertGreaterEqual(snap_to_course(wanted), wanted, wanted)

    def test_describes_itself_the_way_a_sheet_does(self):
        self.assertIn("28c", describe(2400))

    def test_storey_height_carries_the_floor_build_up(self):
        self.assertEqual(storey_height_for(28), ceiling_height(28) + 200)


class TestConstructionFromTheSheet(unittest.TestCase):
    def test_double_brick_is_230_over_a_90_leaf(self):
        # Verbatim from the set: "external walls consists of 230mm wide
        # cavity brick const... external leaf & 90mm internal leaf".
        self.assertEqual(CONSTRUCTION["double_brick"]["exterior"], 230)
        self.assertEqual(CONSTRUCTION["double_brick"]["interior"], 90)


def _building(width=15000, depth=28000, bedrooms=3, pitch=25.0):
    program = template("au-house", bedrooms=bedrooms, bathrooms=2)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=1000, setback_left=1000, setback_right=1000)
    layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
    building = build_building(program, plot, layout)
    building.roof = Roof(pitch_degrees=pitch, overhang_mm=600, kind="hip")
    return building


class TestElevations(unittest.TestCase):
    def test_overall_height_matches_the_reference(self):
        # 28 courses of brickwork is 2408; a 25 degree roof over an 11,690
        # span rises 2726; the sheet states 5134.
        rise = round(11690 / 2 * math.tan(math.radians(25)))
        self.assertEqual(28 * COURSE_MM + rise, 5134)

    def test_the_plate_is_the_ceiling_not_the_floor_to_floor(self):
        # Getting this wrong puts the plate a course and a bit too high,
        # and the elevation then disagrees with the plan it came from.
        building = _building()
        storey = building.storeys[0]
        self.assertLess(storey.ceiling_height, storey.height)
        view = elevation(building, "south")
        labels = " ".join(l.label for l in view.levels)
        self.assertIn("28c", labels)
        self.assertIn("FL 0", labels)

    def test_four_elevations_numbered_from_the_street(self):
        views = elevations(_building())
        self.assertEqual([v.number for v in views], [1, 2, 3, 4])
        self.assertEqual(len({v.direction for v in views}), 4)
        self.assertEqual(views[0].direction, "south")   # the road side

    def test_every_elevation_draws_a_roof_and_a_wall(self):
        for view in elevations(_building()):
            self.assertTrue(view.roof, f"{view.title} has no roof")
            self.assertTrue(view.outline, f"{view.title} has no walls")
            self.assertGreater(view.height_mm, view.width_mm * 0.05)

    def test_openings_appear_on_the_face_they_belong_to(self):
        building = _building()
        views = {v.direction: v for v in elevations(building)}
        total = sum(len(v.panels) for v in views.values())
        self.assertGreater(total, 0, "no openings projected onto any elevation")
        # No opening may float above the ceiling or below the floor.
        for view in views.values():
            for panel in view.panels:
                self.assertGreaterEqual(panel.y, 0)
                self.assertLessEqual(
                    panel.y + panel.height,
                    building.storeys[-1].elevation
                    + building.storeys[-1].ceiling_height + 1,
                    f"an opening on {view.direction} pokes through the ceiling",
                )

    def test_a_steeper_roof_is_a_taller_building(self):
        low = _building(pitch=22.0).overall_height
        high = _building(pitch=30.0).overall_height
        self.assertGreater(high, low)

    def test_an_unknown_direction_is_refused(self):
        with self.assertRaises(ValueError):
            elevation(_building(), "up")


if __name__ == "__main__":
    unittest.main()


class TestTheElevationSheetsAgree(unittest.TestCase):
    """Two views to a sheet, and every sheet at the same scale as the plan.

    Four abreast makes the drawing 106 m wide against 26 m tall and the sheet
    scales to the width: 1:500. Two by two is 1:200 -- better, and still not
    what a permit set does, because a 2 x 2 block cannot get under the 30.8 m
    an A3 holds at 1:100. Two in a column can, so it is two in a column and a
    second sheet, which is what a builder's set uses.

    The sheets must also agree with each other. The scale comes from the
    content box and only the first sheet carries the notes, so left alone a
    two storey house came out with elevations 1-2 at 1:200 and 3-4 at 1:100 --
    and a set at two scales is a set somebody measures the wrong one off.
    """

    def _scales(self, storeys):
        from codraft.export.svg import build_sheet, elevation_sheets
        from codraft.sheet import fit_scale

        building = _building(bedrooms=4)
        if storeys == 2:
            building = _building(bedrooms=4, depth=30000)
        out = []
        for page in range(elevation_sheets(building)):
            _, _, w, h, name = build_sheet(building, storey_index=page,
                                           sheet="elevations")
            out.append((name, fit_scale(w, h, "A3").scale))
        return out

    def test_the_elevations_are_split_across_sheets(self):
        from codraft.export.svg import elevation_sheets

        self.assertEqual(elevation_sheets(_building()), 2)

    def test_every_elevation_sheet_is_at_the_same_scale(self):
        for storeys in (1, 2):
            scales = {scale for _name, scale in self._scales(storeys)}
            with self.subTest(storeys=storeys):
                self.assertEqual(len(scales), 1, f"sheets disagree: {scales}")

    def test_they_are_at_the_scale_a_builder_reads(self):
        for _name, scale in self._scales(1):
            self.assertEqual(scale, 100)

    def test_each_sheet_names_which_elevations_it_carries(self):
        names = [name for name, _ in self._scales(1)]
        self.assertEqual(names, ["Elevations 1-2", "Elevations 3-4"])

    def test_no_view_is_dropped_and_none_is_repeated(self):
        from codraft.export.svg import build_sheet, elevation_sheets
        from codraft.export.elevation import elevations as views_of

        building = _building()
        titles = [v.title for v in views_of(building)]
        drawn: list[str] = []
        for page in range(elevation_sheets(building)):
            canvas, *_ = build_sheet(building, storey_index=page,
                                     sheet="elevations")
            drawn += [op[6] for op in canvas.ops
                      if op[0] == "text" and op[1] == "title"]
        self.assertEqual(sorted(drawn), sorted(titles))

    def test_the_notes_are_on_one_sheet_only(self):
        # Two copies of a note is how a set ends up with two that disagree.
        from codraft.export.svg import build_sheet, elevation_sheets

        building = _building()
        seen: list[str] = []
        for page in range(elevation_sheets(building)):
            canvas, *_ = build_sheet(building, storey_index=page,
                                     sheet="elevations")
            seen += [op[6] for op in canvas.ops
                     if op[0] == "text" and op[1] == "elev-note"]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertTrue(seen, "the elevations carry no notes at all")
