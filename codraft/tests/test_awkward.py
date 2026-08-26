"""The measure that picks a plan form has to measure the room, not the tile.

`_awkward` is what decides whether a floor is badly enough shaped to try a
service core instead of a single spine. Its own docstring says it measures
the thing being optimised rather than a proxy for it -- and it was measuring
the TILE, which is not the thing. A tile carries half a wall on every side;
the person standing in the room gets what is left, and gets it
disproportionately, because the same allowance comes off a 2.4 m width and a
6 m length alike.

Across a sweep of thirty-three plans, six came out shaped differently
depending on which you measured. On a 20 x 32 m lot it decided whether the
floor was judged awkward enough to try a core at all: one room by the tile,
three by the rooms the customer walks into. Measured on the rooms, 36 of 264
habitable rooms across that sweep were shaped like a passage; now 32.
"""

import unittest

from codraft.layout.solver import _MAX_ASPECT, _WALL_ALLOWANCE, _awkward, Cell
from codraft.geom import Rect
from codraft.model import Function
from codraft.program.schema import SpaceRequirement


def _bedroom(w: int, h: int) -> Cell:
    return Cell("bed", "Bed", Function.BEDROOM, Rect(0, 0, w, h), 0,
                SpaceRequirement(key="bed", name="Bed", function=Function.BEDROOM))


class ItMeasuresTheRoomSomebodyStandsIn(unittest.TestCase):
    def test_a_tile_inside_the_limit_whose_room_is_not_still_counts(self):
        """The case that was being missed, taken from a real plan.

        A 5125 x 2358 tile is 2.17 by its own edges, inside the 2.2 limit.
        Take the wall allowance off and the room is 4953 x 2186 -- 2.27, a
        bedroom two metres across and five long, which is the thing the
        limit exists to catch.
        """
        tile = _bedroom(5125, 2358)
        self.assertLess(
            max(tile.rect.w, tile.rect.h) / min(tile.rect.w, tile.rect.h),
            _MAX_ASPECT, "the fixture is meant to be inside the limit as a tile")
        inner_w = tile.rect.w - _WALL_ALLOWANCE
        inner_h = tile.rect.h - _WALL_ALLOWANCE
        self.assertGreater(max(inner_w, inner_h) / min(inner_w, inner_h),
                           _MAX_ASPECT,
                           "the fixture is meant to be outside it as a room")
        self.assertEqual(1, _awkward([tile])[0],
                         "a room the customer would call a corridor was not "
                         "counted, because the tile around it looked square "
                         "enough")

    def test_a_room_well_inside_the_limit_is_left_alone(self):
        """The correction must not simply count everything.

        Taking the allowance off makes every room thinner, so a test that
        only checks the case above would pass just as well if the measure
        had been made uselessly strict.
        """
        self.assertEqual(0, _awkward([_bedroom(4878, 2476)])[0])
        self.assertEqual(0, _awkward([_bedroom(3600, 3400)])[0])

    def test_rooms_that_need_no_window_are_still_not_counted(self):
        """A robe is allowed to be a slot, and counting those would let a
        layout win by making the bathrooms rounder."""
        robe = Cell("wir", "WIR", Function.STORAGE, Rect(0, 0, 5125, 2358), 0,
                    SpaceRequirement(key="wir", name="WIR",
                                     function=Function.STORAGE))
        self.assertEqual(0, _awkward([robe])[0])


if __name__ == "__main__":
    unittest.main()
