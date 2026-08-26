"""A room called a Double Garage has to hold two cars, or say that it doesn't.

The template's comment has always carried the right figures -- "two cars need
5.4 by 6.0 m and no less" -- while the minimum width declared beside it is
3.2 m, which is one bay. Nothing was stopping a Double Garage coming out
3724 mm across. Fifteen plans in a sweep of thirty-three drew one narrower
than two cars need, every one of them in silence.

Raising the declared minimum was tried and is not the fix: it made no garage
wider and cost about seventy findings elsewhere. The frontage is set out
around the front door, which has to line up with the passage behind it, and
the garage takes whatever is left -- so its width is decided by where the
passage landed. On a 12 m lot with 10 m to build on, a double garage and a
front door and a portico do not all fit across the frontage, and no packer
will make them. That is a fact about the block, and the plan should say it.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, Plot
from codraft.program import template


def _plan(width: int, depth: int, beds: int = 4):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=1)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=1000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return layout, build_building(program, plot, layout)


def _said(layout) -> bool:
    return any("Two cars side by side" in w for w in layout.warnings)


class ADoubleGarageHoldsTwoCarsOrSaysSo(unittest.TestCase):
    def test_a_narrow_block_is_told_the_garage_only_holds_one(self):
        layout, building = _plan(12000, 32000, beds=3)
        garage = next(s for s in building.all_spaces()
                      if s.function is Function.GARAGE)
        self.assertLess(garage.rect.short_side, 5400,
                        "this block is meant to be too narrow for two bays")
        self.assertTrue(_said(layout),
                        "a Double Garage 3.7 m across was drawn without a word")

    def test_a_block_that_can_take_two_bays_is_not_nagged(self):
        """The warning has to mean something, so it must not fire everywhere."""
        quiet = 0
        for width, depth in ((18000, 30000), (20000, 32000), (24000, 30000)):
            layout, building = _plan(width, depth)
            garage = next(s for s in building.all_spaces()
                          if s.function is Function.GARAGE)
            if garage.rect.short_side >= 5400 and garage.rect.long_side >= 6000:
                quiet += 1
                self.assertFalse(
                    _said(layout),
                    f"{width}x{depth}: the garage is "
                    f"{garage.rect.short_side} x {garage.rect.long_side} and "
                    "the plan complained about it anyway")
        self.assertGreater(quiet, 0, "no block in the sweep fits two bays, so "
                                     "this test proved nothing")

    def test_every_plan_that_falls_short_says_so(self):
        undeclared = []
        for width in (12000, 14000, 15000, 16000, 18000, 20000, 24000):
            for beds in (3, 4, 5):
                try:
                    layout, building = _plan(width, 30000, beds)
                except LayoutError:
                    continue
                garage = next((s for s in building.all_spaces()
                               if s.function is Function.GARAGE), None)
                if garage is None:
                    continue
                short = (garage.rect.short_side < 5400
                         or garage.rect.long_side < 6000)
                if short and not _said(layout):
                    undeclared.append(
                        f"{width/1000}x30 {beds}bd: {garage.rect.short_side} x "
                        f"{garage.rect.long_side} and nothing said")
        self.assertEqual([], undeclared, "\n".join(undeclared))


if __name__ == "__main__":
    unittest.main()
