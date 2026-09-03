"""A two-storey house needs a toilet on the floor the front door is on.

That is what a powder room is for, and it is not a preference: a visitor,
or anyone in the kitchen, should not have to climb a flight of stairs. The
template left the WC's storey to the solver, and the solver balances floor
areas -- so it put the WC upstairs with the bathrooms, where the area was
needed. Two hundred and forty of the two hundred and forty multi-storey
plans in the state sweep had no toilet anywhere on the ground floor, and
nothing said so on the drawing or in the report.

The fix is a pin in the template rather than a rule in the solver: which
floor a powder room goes on is a fact about the brief, not about packing.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, solve
from codraft.model import Function, Plot
from codraft.program import template

WET = {Function.WC, Function.BATHROOM}


def _laid_out(width, depth, storeys, bedrooms=4, bathrooms=2):
    program = template("au-house", bedrooms=bedrooms, bathrooms=bathrooms,
                       storeys=storeys)
    program.build_to(design_parameters(resolve("Perth, WA"), program.use))
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=1000,
                setback_left=1000, setback_right=1000)
    return solve(program, plot, max_footprint=int(plot.area * 0.5))


class TheGroundFloorHasSomewhereToGo(unittest.TestCase):
    def test_every_multi_storey_plan_puts_a_toilet_on_the_ground_floor(self):
        drawn = 0
        for width, depth in ((12000, 32000), (15000, 30000), (18000, 35000)):
            for storeys in (2, 3):
                with self.subTest(lot=f"{width}x{depth}", storeys=storeys):
                    try:
                        layout = _laid_out(width, depth, storeys)
                    except LayoutError:
                        continue          # refusing is a separate question
                    drawn += 1
                    ground = [c for c in layout.for_storey(0)
                              if c.function in WET]
                    self.assertTrue(
                        ground,
                        "no toilet on the ground floor of a "
                        f"{storeys}-storey house on {width}x{depth}",
                    )
        self.assertGreaterEqual(drawn, 4, "the sweep drew almost nothing")

    def test_the_template_says_so_rather_than_leaving_it_to_the_packer(self):
        # Where the pin lives matters: a solver that happens to land the WC
        # downstairs today is not the same as a brief that says it must.
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        wc = next(s for s in program.spaces if s.function is Function.WC)
        self.assertEqual(wc.storey, 0)


if __name__ == "__main__":
    unittest.main()
