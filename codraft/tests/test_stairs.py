"""A flight has to arrive in the same place it leaves from.

Each storey used to be packed on its own, and the stair packed with it, so
nothing held the flight on one floor over the flight on the next. They came
out in different places and at different sizes -- on a 10.5 x 32 m lot,
3562 x 3121 in the middle of the ground floor and 3605 x 6989 against the
street on the floor above. Someone climbing that stair arrives under a
bedroom floor. Every multi-storey plan had it.

Four things had to agree before it could line up, and only the last is
about the stair: the shape being packed, where the spine sits in it, which
side of the spine the flight is on, and how much of that band's run it
takes. Fixing the first alone was tried and moved nothing, because the band
split is decided by each floor's own room areas and lands somewhere else
regardless. An upper floor is now packed against the ground floor's
envelope and spine, with the flight pinned to the same run.

Holding a floor to the floor below costs it the area over the garage and a
spine chosen for somebody else's rooms, and a few floors cannot carry that
-- their rooms come out too small to take a door, and the plan is refused
outright. A two-storey house nobody can have is worse than one whose stair
is drawn wrong and said to be wrong, so those floors are laid out loose and
the misalignment is reported instead.

Hence two tests where one would look like enough. The first is the
invariant: a stair either lines up or the plan says it does not, which
holds whichever way a floor went. The second pins how often the first
branch is the one doing the work -- otherwise the invariant is satisfied
completely by giving up and declaring, which is where this started.
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

    def test_most_flights_actually_line_up(self):
        """The invariant above is satisfied by declaring every misalignment.

        That was the honest state before the floors were stacked, and it is
        not the state worth keeping: a plan whose stair is drawn wrong is
        still a plan whose stair is drawn wrong. So the count is pinned. An
        upper floor now packs the ground floor's shape with the spine where
        the ground floor put it, and the flight takes the same run of the
        same band, which lines up four flights in five.

        The bar is set below what is measured today on purpose. It is here
        to catch the pinning being lost, not to be re-tuned every time the
        packer moves a wall by a millimetre.
        """
        lined_up = adrift = 0
        for _, _, _, layout in _plans():
            flights: dict[int, list] = {}
            for cell in layout.cells:
                if cell.function is Function.STAIR:
                    flights.setdefault(cell.storey, []).append(cell)
            floors = sorted(flights)
            for low, up in zip(floors, floors[1:]):
                for below in flights[low]:
                    if any(a.rect == below.rect for a in flights[up]):
                        lined_up += 1
                    else:
                        adrift += 1
        self.assertGreater(lined_up + adrift, 20, "the sweep found no flights")
        self.assertGreaterEqual(
            lined_up, 24,
            f"only {lined_up} of {lined_up + adrift} flights line up between "
            "floors. The upper floors are meant to be packed against the "
            "ground floor's envelope and spine, with the flight pinned to the "
            "same run -- check that `_Below` is still reaching them.",
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
