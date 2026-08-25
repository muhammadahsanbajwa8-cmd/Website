"""A flight has to arrive in the same place it leaves from.

Each storey is packed on its own, and the stair is packed with it, so
nothing has been holding the flight on one floor over the flight on the
next. They came out in different places and at different sizes -- on a
10.5 x 32 m lot, 3562 x 3121 in the middle of the ground floor and
3605 x 6989 against the street on the floor above. Someone climbing that
stair arrives under a bedroom floor.

The cause is that the two storeys are not packing the same shape. The
ground floor gives up a strip across the frontage to the garage, the
entry and the portico; the floor above has no garage and packs the whole
footprint. Different envelopes, different bands, and the stair lands
wherever each floor happened to have room.

The test below is written as the invariant rather than as the current
state: a stair either lines up, or the layout says it does not. It passes
today because every misalignment is declared, and it will still pass once
the stair is held still between floors -- at which point the first branch
is the one doing the work. What it will not do is pass while a plan is
quietly issued with a stair that cannot be built.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, Plot
from codraft.program import template

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000), (18000, 30000)]


def _plans():
    for width, depth in LOTS:
        for beds in (3, 4, 5):
            for storeys in (2, 3):
                program = template("au-house", bedrooms=beds, bathrooms=2,
                                   storeys=storeys)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=1000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue
                yield f"{width}x{depth} {beds}bd {storeys}s", program, plot, layout


class AStairConnectsTheFloorsItPassesThrough(unittest.TestCase):
    def test_a_stair_either_lines_up_or_the_plan_says_it_does_not(self):
        undeclared = []
        checked = 0
        for label, _, _, layout in _plans():
            flights: dict[int, list] = {}
            for cell in layout.cells:
                if cell.function is Function.STAIR:
                    flights.setdefault(cell.storey, []).append(cell)
            floors = sorted(flights)
            if len(floors) < 2:
                continue
            checked += 1
            aligned = all(
                any(a.rect == b.rect for a in flights[up])
                for low, up in zip(floors, floors[1:])
                for b in flights[low]
            )
            said = any("stair does not line up" in u for u in layout.warnings)
            if not aligned and not said:
                undeclared.append(label)
        self.assertGreater(checked, 8, "the sweep found no multi-storey plans")
        self.assertEqual(
            [], undeclared,
            "these plans were drawn with a stair that does not connect the "
            "floors, and said nothing about it:\n" + "\n".join(undeclared),
        )

    def test_the_top_floor_still_carries_the_flight(self):
        """The stair takes floor area on the floor it arrives at, too.

        It is tempting to put a stair only on the floors it leaves from.
        The floor it arrives at still has the flight coming up through it,
        and that opening is floor area that cannot hold a bed. Dropping it
        there would give the top floor room it does not have.
        """
        for label, _, _, layout in _plans():
            floors = {c.storey for c in layout.cells}
            with_stair = {c.storey for c in layout.cells
                          if c.function is Function.STAIR}
            self.assertEqual(
                floors, with_stair,
                f"{label}: storeys {sorted(floors - with_stair)} have no stair, "
                "so the flight arrives in a room that is fully floored.",
            )


if __name__ == "__main__":
    unittest.main()
