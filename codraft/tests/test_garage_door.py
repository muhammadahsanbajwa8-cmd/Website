"""A garage you can drive into.

Sixty-five of the sixty-seven plans in the lot sweep drew a garage with no
opening to the outside. The elevation facing the street showed a 1000 mm
front door and a blank wall five and a half metres wide, with the driveway
drawn running up to it. Rooms are doored onto circulation, and a garage's
opening is not that -- it is a hole in the front of the house for a car, and
nothing was placing it.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.elevation import elevations
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, OpeningKind, Plot, Roof, WallKind
from codraft.program import template

DESIGN = design_parameters(resolve("AU-WA"))
LOTS = ((12500, 28000), (15000, 30000), (18000, 30000), (20000, 35000))


def _built(width, depth, beds=4, side="south"):
    if side in ("east", "west"):
        width, depth = depth, width
    plot = Plot(rect=Rect(0, 0, width, depth), road_side=side,
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=1)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    building = build_building(program, plot, layout, design=DESIGN)
    building.roof = Roof(pitch_degrees=25.0, overhang_mm=600, kind="hip")
    return plot, layout, building


class TestTheGarageOpens(unittest.TestCase):
    def test_every_garage_has_a_way_in(self):
        for width, depth in LOTS:
            for beds in (3, 4, 5):
                for side in ("south", "east"):
                    try:
                        _plot, _layout, building = _built(width, depth, beds, side)
                    except LayoutError:
                        continue
                    storey = building.storeys[0]
                    garage = next((s for s in storey.spaces
                                   if s.function is Function.GARAGE), None)
                    if garage is None:
                        continue
                    walls = [w for w in storey.walls
                             if w.kind is WallKind.EXTERIOR
                             and garage.id in w.separates]
                    holes = [o for w in walls for o in storey.openings_on(w.id)
                             if o.kind is not OpeningKind.WINDOW]
                    with self.subTest(lot=(width, depth), beds=beds, side=side):
                        self.assertTrue(holes, "no way to drive in")
                        self.assertGreater(max(o.width for o in holes), 2000)

    def test_it_is_not_drawn_as_a_swinging_leaf(self):
        # A door is drawn in plan with its leaf and a quarter-circle swing,
        # and a 5.2 m swing arc is 5.2 m of drawing that is not there: it
        # took the architectural sheet from 1:100 to 1:200.
        _plot, _layout, building = _built(15000, 30000)
        storey = building.storeys[0]
        garage = next(s for s in storey.spaces if s.function is Function.GARAGE)
        walls = [w for w in storey.walls
                 if w.kind is WallKind.EXTERIOR and garage.id in w.separates]
        for wall in walls:
            for opening in storey.openings_on(wall.id):
                if opening.width > 2000:
                    self.assertIs(opening.kind, OpeningKind.OPENING)

    def test_the_street_elevation_shows_it(self):
        for side in ("south", "east", "north", "west"):
            _plot, _layout, building = _built(15000, 30000, side=side)
            street = elevations(building)[0]
            wide = [p for p in street.panels if p.width > 2000]
            with self.subTest(side=side):
                self.assertTrue(
                    wide, "the street elevation shows no garage opening")

    def test_nothing_overlaps_it_on_the_same_wall(self):
        for width, depth in LOTS:
            _plot, _layout, building = _built(width, depth)
            for storey in building.storeys:
                by_wall: dict[str, list] = {}
                for opening in storey.openings:
                    by_wall.setdefault(opening.wall, []).append(opening)
                for wall_id, group in by_wall.items():
                    group.sort(key=lambda o: o.offset)
                    for a, b in zip(group, group[1:]):
                        with self.subTest(lot=(width, depth), wall=wall_id):
                            self.assertLessEqual(a.offset + a.width, b.offset)


if __name__ == "__main__":
    unittest.main()
