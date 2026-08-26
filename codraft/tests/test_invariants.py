"""The things a drawing has to be true about before anything else is worth
checking.

Every finding in this project so far that mattered came from asking a
question nothing was asking. The room-shape sweeps measure how big rooms
came out, and they are silent on whether a room can be entered, whether the
stair connects the floors, or whether a window opens into another room. Two
real defects were found that way and are fixed; these are the rest of the
questions, asked once so they stay asked.

They all pass today. That is the point: they are here to fail later. A
packer change that puts a window in an internal wall or opens a hole in the
outline is not a change that shows up as a worse number in a sweep, it is a
drawing that is wrong, and nothing else in the suite would notice.

One warning about writing these, learned by getting it wrong. `Space.rect`
is the CLEAR rectangle -- inset half a wall on every side -- while
`Cell.rect` is the tile, and tiles meet exactly. Measuring the outline from
spaces makes the perimeter short by four wall thicknesses on every plan,
which reads as a hole in the building on every case in the sweep. Compare
tiles with tiles.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import OpeningKind, Plot
from codraft.program import template

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000),
        (18000, 30000), (20000, 40000)]
SETBACKS = dict(setback_front=6000, setback_rear=1000,
                setback_left=1000, setback_right=1000)


def _plans():
    for width, depth in LOTS:
        for beds in (3, 4, 5):
            for storeys in (1, 2):
                program = template("au-house", bedrooms=beds, bathrooms=2,
                                   storeys=storeys)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            **SETBACKS)
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue
                yield (f"{width}x{depth} {beds}bd {storeys}s",
                       build_building(program, plot, layout), layout, plot)


class ADrawingHasToBeGeometricallyTrue(unittest.TestCase):
    def setUp(self):
        self.plans = list(_plans())
        self.assertGreater(len(self.plans), 20, "the sweep produced no plans")

    def test_no_two_rooms_occupy_the_same_floor(self):
        clashes = []
        for label, building, _, _ in self.plans:
            for storey in building.storeys:
                spaces = list(storey.spaces)
                for i, a in enumerate(spaces):
                    for b in spaces[i + 1:]:
                        if (a.rect.x < b.rect.x1 and b.rect.x < a.rect.x1
                                and a.rect.y < b.rect.y1 and b.rect.y < a.rect.y1):
                            clashes.append(f"{label}: {a.name} overlaps {b.name}")
        self.assertEqual([], clashes, "\n".join(clashes[:10]))

    def test_an_upper_floor_sits_on_the_one_below_it(self):
        """A room hanging past the floor below has nothing holding it up."""
        floating = []
        for label, building, _, _ in self.plans:
            for i in range(1, len(building.storeys)):
                below = building.storeys[i - 1].spaces
                if not below:
                    continue
                x0 = min(s.rect.x for s in below)
                x1 = max(s.rect.x1 for s in below)
                y0 = min(s.rect.y for s in below)
                y1 = max(s.rect.y1 for s in below)
                for space in building.storeys[i].spaces:
                    r = space.rect
                    if r.x < x0 or r.y < y0 or r.x1 > x1 or r.y1 > y1:
                        floating.append(
                            f"{label}: {space.name} on floor {i} reaches past "
                            "the floor below it")
        self.assertEqual([], floating, "\n".join(floating[:10]))

    def test_a_window_is_never_in_an_internal_wall(self):
        """A window in an internal wall is a hole into the next room."""
        inside = []
        for label, building, _, _ in self.plans:
            for storey in building.storeys:
                walls = {w.id: w for w in storey.walls}
                for opening in storey.openings:
                    if opening.kind is not OpeningKind.WINDOW:
                        continue
                    wall = walls.get(opening.wall)
                    if wall is not None and not wall.is_exterior:
                        inside.append(
                            f"{label}: window {opening.id} is in a "
                            f"{wall.kind.value} wall between {wall.separates}")
        self.assertEqual([], inside, "\n".join(inside[:10]))

    def test_every_opening_lies_on_the_wall_it_names(self):
        """An opening running off the end of its wall is drawn in mid-air."""
        adrift = []
        for label, building, _, _ in self.plans:
            for storey in building.storeys:
                walls = {w.id: w for w in storey.walls}
                for opening in storey.openings:
                    wall = walls.get(opening.wall)
                    if wall is None:
                        adrift.append(f"{label}: opening {opening.id} names "
                                      f"wall {opening.wall}, not on this floor")
                    elif opening.offset < 0 or opening.offset + opening.width > wall.length:
                        adrift.append(
                            f"{label}: opening {opening.id} runs "
                            f"{opening.offset}..{opening.offset + opening.width} "
                            f"along a wall {wall.length} long")
        self.assertEqual([], adrift, "\n".join(adrift[:10]))

    def test_nothing_is_built_over_a_setback(self):
        over = []
        for label, building, _, plot in self.plans:
            spaces = [s for storey in building.storeys for s in storey.spaces]
            if not spaces:
                continue
            if (min(s.rect.x for s in spaces) < plot.setback_left
                    or min(s.rect.y for s in spaces) < plot.setback_front
                    or max(s.rect.x1 for s in spaces) > plot.rect.x1 - plot.setback_right
                    or max(s.rect.y1 for s in spaces) > plot.rect.y1 - plot.setback_rear):
                over.append(f"{label}: the building crosses a setback")
        self.assertEqual([], over, "\n".join(over[:10]))

    def test_the_exterior_walls_close_the_building(self):
        """A missing length of exterior wall is a gap in the outside of the house.

        Measured against the TILE outline. Spaces are inset half a wall each
        side, so measuring against those makes every plan look 4 x 230 mm
        short of closing.
        """
        gaps = []
        for label, building, layout, _ in self.plans:
            for storey in building.storeys:
                cells = [c for c in layout.cells if c.storey == storey.index]
                if not cells:
                    continue
                around = 2 * ((max(c.rect.x1 for c in cells) - min(c.rect.x for c in cells))
                              + (max(c.rect.y1 for c in cells) - min(c.rect.y for c in cells)))
                exterior = sum(w.length for w in storey.walls if w.is_exterior)
                if abs(exterior - around) > 2:
                    gaps.append(
                        f"{label} floor {storey.index}: {exterior} mm of exterior "
                        f"wall around an outline of {around} mm")
        self.assertEqual([], gaps, "\n".join(gaps[:10]))


if __name__ == "__main__":
    unittest.main()
