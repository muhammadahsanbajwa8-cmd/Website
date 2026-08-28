"""A lot turned ninety degrees gets the same plan, turned ninety degrees.

Everything downstream of the footprint is written for a street running
east-west: the front zone lays its strip across x, the spine runs the depth,
the front door is set out along x. Half of that consults `road_side` and half
does not, so a lot fronting east came out with its garage strip against a
side boundary and its passage across the frontage -- 169 code findings on a
sweep where the same lot facing south gets 64.

`solve` now turns an east- or west-facing lot, solves it, and turns the
answer back. These tests are what says the two are really the same plan.
"""

import unittest

from codraft.codes import check, design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Function, Plot
from codraft.program import template

WA = resolve("AU-WA")
DESIGN = design_parameters(WA)
LOTS = ((15000, 30000), (12500, 28000), (18000, 30000))


def _plan(side, width, depth, beds=4):
    # The lot turns with the street: a block fronting east is the same block
    # turned, not one with a 15 m depth and two 6 m setbacks to fit in it.
    if side in ("east", "west"):
        width, depth = depth, width
    plot = Plot(rect=Rect(0, 0, width, depth), road_side=side,
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=1)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    return plot, program, layout


class TestEveryOrientationGetsTheSamePlan(unittest.TestCase):
    def test_the_footprint_is_the_same_rectangle_turned(self):
        for width, depth in LOTS:
            _p, _g, straight = _plan("south", width, depth)
            for side in ("north", "east", "west"):
                _p, _g, turned = _plan(side, width, depth)
                with self.subTest(lot=(width, depth), side=side):
                    want = ({straight.envelope.w, straight.envelope.h})
                    self.assertEqual(
                        {turned.envelope.w, turned.envelope.h}, want,
                        "a turned lot got a differently shaped house",
                    )

    def test_the_front_zone_sits_against_the_street(self):
        for width, depth in LOTS:
            for side in ("south", "north", "east", "west"):
                _plot, _program, layout = _plan(side, width, depth)
                env = layout.envelope
                front = [c for c in layout.cells
                         if c.requirement is not None
                         and c.requirement.zone == "front"]
                self.assertTrue(front, "no front zone to check")

                def gap(cell):
                    return {
                        "south": cell.rect.y0 - env.y0,
                        "north": env.y1 - cell.rect.y1,
                        "west": cell.rect.x0 - env.x0,
                        "east": env.x1 - cell.rect.x1,
                    }[side]

                # The ZONE is against the street, not every room in it: on a
                # wider frontage the strip is deep enough to stand the store
                # behind the garage, and that one is 4.3 m back by design.
                with self.subTest(lot=(width, depth), side=side):
                    self.assertEqual(
                        min(gap(c) for c in front), 0,
                        "the front zone is not against the street",
                    )
                    self.assertTrue(
                        all(gap(c) >= 0 for c in front),
                        "a front room is outside the footprint",
                    )

    def test_a_turned_floor_still_tiles_exactly(self):
        for width, depth in LOTS:
            for side in ("east", "west"):
                _plot, _program, layout = _plan(side, width, depth)
                covered = sum(c.rect.area for c in layout.cells
                              if c.storey == 0)
                with self.subTest(lot=(width, depth), side=side):
                    self.assertEqual(covered, layout.envelope.area)

    def test_turning_the_lot_does_not_cost_code_findings(self):
        for width, depth in LOTS:
            counts = {}
            for side in ("south", "north", "east", "west"):
                plot, program, layout = _plan(side, width, depth)
                building = build_building(program, plot, layout, design=DESIGN)
                counts[side] = sum(
                    1 for f in check(building, WA, layout.warnings).findings
                    if f.status == "fail"
                )
            with self.subTest(lot=(width, depth)):
                # A transpose maps east onto north and west onto south.
                self.assertEqual(counts["east"], counts["north"])
                self.assertEqual(counts["west"], counts["south"])

    def test_the_garage_is_still_a_garage(self):
        for width, depth in LOTS:
            for side in ("east", "west"):
                _plot, _program, layout = _plan(side, width, depth)
                garage = next(c for c in layout.cells
                              if c.function is Function.GARAGE)
                with self.subTest(lot=(width, depth), side=side):
                    self.assertGreater(garage.rect.short_side, 3000)


if __name__ == "__main__":
    unittest.main()
