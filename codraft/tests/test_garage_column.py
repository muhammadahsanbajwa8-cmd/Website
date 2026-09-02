"""The garage stood on its own, so the frontage stops being six metres deep.

A strip across the front has to be as deep as a car. It is one rectangle, so
everything beside the garage -- the front door, the portico, the store -- is
given that depth too, for rooms that need about two metres of it. Measured
across sixty-seven plans that was 1041 m2 of floor nothing in it asked for,
while the bands behind were over-subscribed.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import LayoutError, solve
from codraft.layout.solver import _DOUBLE_GARAGE_DEPTH, _DOUBLE_GARAGE_WIDTH, _MIN_TILE
from codraft.model import Function, Plot
from codraft.program import template

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000),
        (16000, 24000), (18000, 30000), (20000, 35000)]
BRIEFS = [(3, 1), (4, 2), (5, 2), (5, 3)]


def _plot(width, depth):
    return Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)


def _plans():
    for width, depth in LOTS:
        for beds, baths in BRIEFS:
            for storeys in (1, 2):
                program = template("au-house", bedrooms=beds,
                                   bathrooms=baths, storeys=storeys)
                try:
                    layout = solve(program, _plot(width, depth))
                except LayoutError:
                    continue
                yield f"{width}x{depth} {beds}b{baths}ba {storeys}s", layout


def _columns():
    for label, layout in _plans():
        if any("column of its own" in w for w in layout.warnings):
            yield label, layout


class TestTheGarageColumn(unittest.TestCase):
    def test_it_is_chosen_somewhere(self):
        self.assertTrue(list(_columns()), "the column never wins on any brief")

    def test_the_garage_holds_two_cars_whenever_it_is_used(self):
        for label, layout in _columns():
            with self.subTest(label):
                garage = next(c for c in layout.cells
                              if c.function is Function.GARAGE)
                clear_w = garage.rect.short_side - 172
                clear_d = max(garage.rect.w, garage.rect.h) - 172
                self.assertGreaterEqual(clear_w, _DOUBLE_GARAGE_WIDTH)
                self.assertGreaterEqual(clear_d, _DOUBLE_GARAGE_DEPTH)

    def test_the_floor_still_tiles_exactly(self):
        # Every piece of the column form is a rectangle, and the whole point
        # of that is the floor still closing. Nothing may overlap and the
        # tiles must add up to the footprint.
        for label, layout in _columns():
            with self.subTest(label):
                for index in range(layout.storeys):
                    cells = layout.for_storey(index)
                    if not cells:
                        continue
                    for i, a in enumerate(cells):
                        for b in cells[i + 1:]:
                            over_x = min(a.rect.x1, b.rect.x1) - max(a.rect.x0, b.rect.x0)
                            over_y = min(a.rect.y1, b.rect.y1) - max(a.rect.y0, b.rect.y0)
                            self.assertFalse(
                                over_x > 0 and over_y > 0,
                                f"{a.name} overlaps {b.name}",
                            )
                    # Against the floor's OWN rectangle, not the ground
                    # footprint. An upper storey stops where the storey below
                    # it stops carrying two floors -- over a deep garage
                    # column that is well short of the footprint -- and
                    # measuring it against the footprint calls eleven honest
                    # floors a hole.
                    x0 = min(c.rect.x0 for c in cells)
                    x1 = max(c.rect.x1 for c in cells)
                    y0 = min(c.rect.y0 for c in cells)
                    y1 = max(c.rect.y1 for c in cells)
                    self.assertEqual(
                        sum(c.rect.area for c in cells),
                        (x1 - x0) * (y1 - y0),
                        "the floor does not tile the rectangle it occupies",
                    )

    def test_it_never_leaves_a_sliver(self):
        # The column takes 5.6 m of the frontage and what is left has to hold
        # the front door and the portico. Where that cannot be done, the
        # strip across the front draws the plan instead.
        for label, layout in _columns():
            with self.subTest(label):
                worst = min(c.rect.short_side for c in layout.cells)
                self.assertGreaterEqual(worst, _MIN_TILE)


if __name__ == "__main__":
    unittest.main()


class TheColumnRescuesAGarageTheStripCannotHold(unittest.TestCase):
    """`_front_zone` sizes the strip to what a car needs and then caps it at
    a third of the floor's depth, and the cap wins on 55 of the 65 plans in
    the AU-WA lot sweep. Letting the strip through the cap takes the rooms
    behind under their own minimums (packing attempt 11). The column is the
    other way to the same place, so it is kept where it is the only way --
    even when it does not score better."""

    def test_a_lot_the_strip_cannot_serve_gets_the_column(self):
        from codraft.geom import Rect
        from codraft.layout import build_building, solve
        from codraft.model import Function, Plot
        from codraft.program import template

        program = template("au-house", bedrooms=3, bathrooms=2, storeys=2)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout)
        garage = next(s for s in building.all_spaces()
                      if s.function is Function.GARAGE)
        self.assertGreaterEqual(garage.rect.w, 5400)
        self.assertGreaterEqual(garage.rect.h, 6000)
        self.assertTrue(
            any("column of its own" in w for w in layout.warnings),
            "the garage holds two cars but the sheet does not say how",
        )

    def test_the_sheet_says_the_column_is_what_made_it_fit(self):
        from codraft.geom import Rect
        from codraft.layout import solve
        from codraft.model import Plot
        from codraft.program import template

        program = template("au-house", bedrooms=3, bathrooms=2, storeys=2)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        said = next(w for w in layout.warnings if "column of its own" in w)
        self.assertIn("hold two cars", said)
