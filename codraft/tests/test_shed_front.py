"""Shedding a room off the street frontage frees no floor, so it goes last."""

import unittest

from codraft.geom import Rect
from codraft.layout import solve
from codraft.model import Plot
from codraft.program import template


def _plan(width, depth, bedrooms=4, bathrooms=2, storeys=1):
    program = template("au-house", bedrooms=bedrooms, bathrooms=bathrooms,
                       storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    return solve(program, plot)


class ShedFrontLast(unittest.TestCase):
    def test_the_theatre_is_kept_where_the_porch_would_have_taken_its_place(self):
        # 4.5 m2 over the footprint. Dropping the theatre saved that much on
        # paper and cost nothing on the ground: the front strip is as deep as
        # the garage whatever is in it, and the space the theatre gave up was
        # handed to the portico, which asked for 4 m2 and was drawn at 31.7.
        layout = _plan(15000, 30000)
        names = [c.name for c in layout.cells]
        self.assertIn("Theatre", names)
        portico = next(c for c in layout.cells if c.name == "Portico")
        self.assertLess(portico.area, 20_000_000)

    def test_a_room_behind_the_frontage_is_still_shed_first(self):
        layout = _plan(15000, 30000)
        # The extras behind the strip go before it: shedding those does free
        # floor. This is a rank, not an exemption.
        self.assertIn("Linen", layout.omitted)
        self.assertNotIn("Theatre", layout.omitted)

    def test_a_front_room_is_still_shed_when_nothing_else_is_left(self):
        # A narrow lot: the extras behind the frontage go, and the floor is
        # still over-subscribed, so the front ones follow.
        layout = _plan(10500, 32000, bedrooms=5, bathrooms=3)
        self.assertTrue(layout.omitted)
        self.assertIn("Theatre", layout.omitted)


if __name__ == "__main__":
    unittest.main()
