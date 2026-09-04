"""An alfresco is roofed outdoor space, and has to be drawn as one.

The model has always said so -- `Function.is_outdoor` is "roofed but not
enclosed", the area box lists ALFRESCO apart from TOTAL INTERNAL, and the
outdoor-living measurement declines to count it because it is under a roof.
The drawing said something else. Ten of the fourteen alfrescos in the lot
sweep were laid in the middle of the plan with no external wall at all, and
all fourteen had exactly one opening: a door from the house. So the plan
showed a sealed room labelled "Alfresco 21.7 m2" and the elevation showed
unbroken brickwork across the back of the house, while the area box on the
same sheet called it outdoor space.

Two causes, in two places. The solver did not know an outdoor room needs an
external wall, because that flag was defaulted on for HABITABLE rooms and an
alfresco is not habitable -- it needs one for a more basic reason than
daylight. And the wall builder skipped outdoor rooms when placing openings,
with a comment saying they are "open on at least one side" and nothing
anywhere making it so.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, OpeningKind, Plot
from codraft.program import template

LOTS = [(12500, 28000), (15000, 30000), (18000, 30000), (20000, 35000)]


def _sets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for bedrooms in (3, 4, 5):
            for storeys in (1, 2):
                program = template("au-house", bedrooms=bedrooms,
                                   bathrooms=2, storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=1000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot,
                                   max_footprint=int(plot.area * 0.5))
                except LayoutError:
                    continue
                yield (f"{width}x{depth} {bedrooms}bed {storeys}s",
                       build_building(program, plot, layout, design=design))


class AnAlfrescoIsOnTheOutsideOfTheHouse(unittest.TestCase):
    def test_it_has_an_external_wall(self):
        found = 0
        for label, building in _sets():
            for storey in building.storeys:
                for space in storey.spaces:
                    if not space.function.is_outdoor:
                        continue
                    found += 1
                    outside = [w for w in storey.walls
                               if space.id in w.separates and w.is_exterior]
                    with self.subTest(case=label, room=space.name):
                        self.assertTrue(
                            outside,
                            f"{space.name} is outdoor space with no external "
                            "wall: it is in the middle of the house",
                        )
        self.assertGreater(found, 8, "the sweep produced almost no alfrescos")

    def test_it_is_open_on_one_side(self):
        found = 0
        for label, building in _sets():
            for storey in building.storeys:
                walls = {w.id: w for w in storey.walls}
                for space in storey.spaces:
                    if not space.function.is_outdoor:
                        continue
                    found += 1
                    outward = [
                        o for o in storey.openings
                        if space.id in walls[o.wall].separates
                        and walls[o.wall].is_exterior
                    ]
                    with self.subTest(case=label, room=space.name):
                        self.assertTrue(
                            outward,
                            f"{space.name} is drawn enclosed: every one of "
                            "its external walls is solid",
                        )
                        self.assertTrue(
                            any(o.kind is OpeningKind.OPENING
                                for o in outward),
                            f"{space.name} opens to the yard through a "
                            "window or a door rather than being open",
                        )
        self.assertGreater(found, 8)

    def test_the_open_side_is_the_widest_wall_it_has(self):
        # An alfresco under the main roof faces the yard, which is its long
        # side. Opening a return instead would be a slot, not an alfresco.
        for label, building in _sets():
            for storey in building.storeys:
                walls = {w.id: w for w in storey.walls}
                for space in storey.spaces:
                    if not space.function.is_outdoor:
                        continue
                    outside = [w for w in storey.walls
                               if space.id in w.separates and w.is_exterior]
                    if not outside:
                        continue
                    widest = max(w.length for w in outside)
                    opened = [walls[o.wall] for o in storey.openings
                              if space.id in walls[o.wall].separates
                              and walls[o.wall].is_exterior
                              and o.kind is OpeningKind.OPENING]
                    with self.subTest(case=label, room=space.name):
                        self.assertTrue(opened)
                        self.assertEqual(max(w.length for w in opened), widest)


class TheBriefKnowsItBelongsOnTheWall(unittest.TestCase):
    def test_an_outdoor_room_is_flagged_like_a_habitable_one(self):
        # Where the solver reads it from. A fix that only reached the wall
        # builder would open a side of a room still buried in the plan.
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        alfresco = next(s for s in program.spaces
                        if s.function is Function.ALFRESCO)
        self.assertTrue(alfresco.needs_exterior_wall)


if __name__ == "__main__":
    unittest.main()
