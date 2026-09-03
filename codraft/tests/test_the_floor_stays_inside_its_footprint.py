"""No room is laid outside the footprint the plan was sized to.

The footprint is not a hint. It is the rectangle the site-cover cap was
trimmed against and the rectangle that sits inside the side setbacks, so a
room over its edge is a room over the boundary and a plan over its cap --
and both of those are a refused permit rather than an untidy drawing.

Eighteen plans in the state sweep put the entry 316 mm outside it, and one
of them reported 51.8% site cover against its own 50% cap and called it
compliant. The cause was a clamp with two bounds and no rule about which
one gives: on a narrow strip the room reserved for the entry's neighbour on
the left was wider than what was left on the right, and the lower bound
won. A neighbour with nowhere to go is a packing problem to report; a room
over the boundary is not a trade the plan may make.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, solve
from codraft.model import Plot
from codraft.program import template

# Lots wide enough and narrow enough to reach both plan forms. The 10 x 28 m
# block is the one that failed: its footprint fills the envelope exactly, so
# any overrun at all is over the setback.
LOTS = [(10000, 28000), (12000, 32000), (15000, 30000), (18000, 35000)]


class EveryRoomIsInsideTheFootprint(unittest.TestCase):
    def test_no_cell_crosses_the_footprint_on_any_storey(self):
        drawn = 0
        for width, depth in LOTS:
            for storeys in (1, 2, 3):
                for bedrooms in (2, 4, 5):
                    label = f"{width}x{depth} {storeys}st {bedrooms}bd"
                    program = template("au-house", bedrooms=bedrooms,
                                       bathrooms=2, storeys=storeys)
                    program.build_to(
                        design_parameters(resolve("Perth, WA"), program.use))
                    plot = Plot(rect=Rect(0, 0, width, depth),
                                road_side="south", setback_front=6000,
                                setback_rear=1000, setback_left=1000,
                                setback_right=1000)
                    try:
                        layout = solve(
                            program, plot,
                            max_footprint=int(plot.area * 0.5))
                    except LayoutError:
                        continue
                    drawn += 1
                    foot = layout.envelope
                    for cell in layout.cells:
                        with self.subTest(lot=label, room=cell.name):
                            self.assertGreaterEqual(cell.rect.x, foot.x)
                            self.assertGreaterEqual(cell.rect.y, foot.y)
                            self.assertLessEqual(cell.rect.x1, foot.x1)
                            self.assertLessEqual(cell.rect.y1, foot.y1)
        self.assertGreaterEqual(drawn, 20, "the sweep drew almost nothing")

    def test_a_plan_never_reports_cover_above_its_own_cap(self):
        # What the overrun cost in the number the customer is shown.
        from codraft.layout import build_building

        checked = 0
        for width, depth in LOTS:
            for bedrooms in (2, 4):
                program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                                   storeys=2)
                design = design_parameters(resolve("Perth, WA"), program.use)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=1000,
                            setback_left=1000, setback_right=1000)
                cap = int(plot.area * 0.5)
                try:
                    layout = solve(program, plot, max_footprint=cap)
                except LayoutError:
                    continue
                building = build_building(program, plot, layout, design=design)
                checked += 1
                covered = building.storeys[0].floor_area
                with self.subTest(lot=f"{width}x{depth}", beds=bedrooms):
                    self.assertLessEqual(
                        covered, cap,
                        f"the ground floor covers {covered / 1e6:.1f} m2 "
                        f"against a {cap / 1e6:.0f} m2 cap",
                    )
        self.assertGreaterEqual(checked, 4)


if __name__ == "__main__":
    unittest.main()
