"""The front door is set out over the passage, not over the link behind it."""

import unittest

from codraft.geom import Rect
from codraft.layout import solve
from codraft.model import Function, Plot
from codraft.program import template


def _plan(width, depth, bedrooms=3, bathrooms=1, storeys=1):
    program = template("au-house", bedrooms=bedrooms, bathrooms=bathrooms,
                       storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    return solve(program, plot)


class EntryMeetsThePassage(unittest.TestCase):
    """A 20 x 35 m lot is wide enough to take the three-band service core."""

    def setUp(self):
        self.layout = _plan(20000, 35000)
        self.ground = self.layout.for_storey(0)
        self.entry = next(c for c in self.ground if c.name == "Entry")
        self.passages = [c for c in self.ground
                         if c.function is Function.CORRIDOR]

    def test_the_floor_really_does_take_the_core_form(self):
        # Three corridor cells: one down each side of the core and a link
        # across the back. If this stops being true the test below is
        # measuring a different plan and should be re-pointed.
        self.assertEqual(len(self.passages), 3)

    def test_the_entry_sits_over_a_passage_that_runs_back_from_the_front(self):
        deep = max(c.rect.h for c in self.passages)
        running_back = [c for c in self.passages if c.rect.h == deep]
        overlap = max(
            min(self.entry.rect.x1, c.rect.x1) - max(self.entry.rect.x0, c.rect.x0)
            for c in running_back
        )
        # Along a wall, not at a corner: a shared edge of zero length is not
        # a way through, and the route check walks doors.
        self.assertGreater(overlap, 0, "the entry meets no passage")

    def test_the_entry_is_not_sized_to_the_link_across_the_back(self):
        # The link is 4965 mm wide and sits at the far end of the plan. Sized
        # to it, the entry hall came out 28.0 m2 against the 6.0 it asks for.
        self.assertLess(self.entry.area, 15_000_000)


if __name__ == "__main__":
    unittest.main()
