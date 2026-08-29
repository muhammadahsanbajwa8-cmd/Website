"""A site plan has a north point.

North is +y and always has been: `road_side` names the compass edge the road
is on, and the drawing is set out with north up whichever edge that is. So
the arrow is not a decoration or a guess -- it is the one fact the plot
already asserts, drawn. Every permit site plan carries one, and this one did
not.
"""

import re
import tempfile
import unittest
from pathlib import Path

from codraft.codes import design_parameters, resolve
from codraft.export.pdf import fit_scale
from codraft.export.svg import build_sheet, write_svg
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.site import place_driveway, place_pool
from codraft.model import Function, Plot
from codraft.program import template

DESIGN = design_parameters(resolve("AU-WA"))
FACING = (("south", 15000, 30000), ("north", 15000, 30000),
          ("east", 30000, 15000), ("west", 30000, 15000))

ARROW = re.compile(
    r'<line class="north" x1="([-\d.]+)" y1="([-\d.]+)" '
    r'x2="([-\d.]+)" y2="([-\d.]+)"'
)


def _drawn(side, width, depth, sheet="site", pool=False):
    plot = Plot(rect=Rect(0, 0, width, depth), road_side=side,
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    building = build_building(program, plot, layout, design=DESIGN)
    garage = next(c for c in layout.cells if c.function is Function.GARAGE)
    building.driveway = place_driveway(plot, layout.envelope, garage.rect)[0]
    if pool:
        building.pool = place_pool(plot, layout.envelope, 8000, 4000)[0]
    with tempfile.TemporaryDirectory() as tmp:
        text = write_svg(
            building, Path(tmp) / "s.svg", storey_index=0, sheet=sheet,
            footprint=layout.envelope,
        ).read_text(encoding="utf-8")
    return plot, layout, building, text


def _extent(text):
    found = ARROW.findall(text)
    xs = [float(v) for m in found for v in (m[0], m[2])]
    ys = [float(v) for m in found for v in (m[1], m[3])]
    return found, xs, ys


class TestTheSitePlanIsOriented(unittest.TestCase):
    def test_there_is_one_on_every_orientation(self):
        for side, width, depth in FACING:
            _plot, _layout, _b, text = _drawn(side, width, depth)
            found, _xs, _ys = _extent(text)
            with self.subTest(side=side):
                self.assertTrue(found, "no north arrow")
                self.assertIn('class="north-text"', text)
                self.assertIn(">N<", text)

    def test_it_points_up_the_page(self):
        # North is +y. An arrow that points anywhere else is worse than none.
        for side, width, depth in FACING:
            _plot, _layout, _b, text = _drawn(side, width, depth)
            found, _xs, ys = _extent(text)
            shaft = found[0]
            with self.subTest(side=side):
                self.assertEqual(float(shaft[0]), float(shaft[2]),
                                 "the shaft is not vertical")
                self.assertGreater(float(shaft[3]), float(shaft[1]))

    def test_it_stays_inside_the_lot_and_off_the_house(self):
        for side, width, depth in FACING:
            plot, layout, _b, text = _drawn(side, width, depth)
            _found, xs, ys = _extent(text)
            foot = layout.envelope
            with self.subTest(side=side):
                self.assertGreaterEqual(min(xs), plot.rect.x0)
                self.assertLessEqual(max(xs), plot.rect.x1)
                self.assertGreaterEqual(min(ys), plot.rect.y0)
                self.assertLessEqual(max(ys), plot.rect.y1)
                self.assertFalse(
                    foot.x0 < max(xs) and min(xs) < foot.x1
                    and foot.y0 < max(ys) and min(ys) < foot.y1,
                    "the arrow is drawn over the house",
                )

    def test_it_does_not_cost_the_sheet_a_scale_step(self):
        # Outside the lot it would widen the sheet by a quarter, which is
        # more than a north arrow is worth.
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        program.build_to(DESIGN)
        layout = solve(program, plot)
        building = build_building(program, plot, layout, design=DESIGN)
        _c, _o, width, height, _n = build_sheet(
            building, 0, "site", None, layout.envelope, "metric")
        frame = fit_scale(width, height, size="A3")
        self.assertLessEqual(frame.scale, 200)

    def test_it_keeps_clear_of_a_pool(self):
        plot, layout, building, text = _drawn("south", 20000, 40000, pool=True)
        self.assertIsNotNone(building.pool, "this lot is meant to hold a pool")
        _found, xs, ys = _extent(text)
        zone = building.pool.barrier.inset(-building.pool.non_climbable_zone_mm)
        self.assertFalse(
            zone.x0 < max(xs) and min(xs) < zone.x1
            and zone.y0 < max(ys) and min(ys) < zone.y1,
            "the arrow is drawn in the pool's non-climbable zone",
        )

    def test_the_floor_plan_does_not_get_one(self):
        # It carries no lot, so there is nothing for it to orient.
        _plot, _layout, _b, text = _drawn("south", 15000, 30000,
                                          sheet="architectural")
        self.assertNotIn('class="north"', text)


if __name__ == "__main__":
    unittest.main()
