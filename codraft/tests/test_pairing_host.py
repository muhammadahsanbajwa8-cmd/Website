"""A small room is tucked behind the smallest room that can carry it.

A pair shares the row's length and splits its depth. So the partner decides
how LONG the small room comes out, and taking the first partner that could
carry it put the WC behind the living room: 1072 x 8218 mm, which is not a
WC but a corridor with a toilet at the end of it. Forty-five of the
sixty-seven plans in the lot sweep drew a room with no wall left to stand
its own fittings against, and the WC was one on every single one of them.

The change is a better choice among the same candidates, not a new rule
about which are allowed: nothing that could be paired before cannot be
paired now.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.solver import _group_rows
from codraft.model import Function, Plot
from codraft.program import template
from codraft.program.schema import SpaceRequirement
from codraft.units import area_mm2, mm

DESIGN = design_parameters(resolve("AU-WA"))


def _room(key, function, area, width, lit=False):
    return SpaceRequirement(
        key=key, name=key.title(), function=function, count=1,
        min_area=area_mm2(area), min_width=mm(width),
    )


class TestTheSmallestHostTakesIt(unittest.TestCase):
    def test_it_goes_behind_the_smaller_of_two_hosts(self):
        wc = _room("wc", Function.WC, "1.8m2", "0.9m")
        big = _room("living", Function.LIVING, "24m2", "3.6m")
        small = _room("laundry", Function.UTILITY, "7m2", "1.8m")
        rows = _group_rows(
            [("living", big), ("laundry", small), ("wc", wc)], 5200)
        with_wc = [r for r in rows if any(k == "wc" for k, _ in r.rooms)]
        self.assertEqual(len(with_wc), 1)
        partners = [k for k, _ in with_wc[0].rooms if k != "wc"]
        self.assertEqual(partners, ["laundry"],
                         "the WC was tucked behind the biggest room, not the "
                         "smallest that could carry it")

    def test_nothing_that_could_pair_before_is_refused_now(self):
        # Only one host to choose from: it still pairs.
        wc = _room("wc", Function.WC, "1.8m2", "0.9m")
        big = _room("living", Function.LIVING, "24m2", "3.6m")
        rows = _group_rows([("living", big), ("wc", wc)], 5200)
        self.assertEqual(len(rows), 1, "the only available pair was refused")

    def test_the_wc_stops_being_a_corridor(self):
        # The plan this was found on. 8218 mm was what it drew.
        program = template("au-house", bedrooms=5, bathrooms=3, storeys=1)
        program.build_to(DESIGN)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        wc = next(c for c in layout.cells if c.function is Function.WC)
        self.assertLess(max(wc.rect.w, wc.rect.h), 8000)

    def test_no_room_is_longer_than_the_floor_it_sits_on(self):
        # A sanity net rather than a threshold: whatever the packer does, a
        # room may not run further than the footprint it is drawn inside.
        for width, depth in ((12500, 28000), (15000, 30000), (18000, 30000)):
            program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
            program.build_to(DESIGN)
            plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                        setback_front=6000, setback_rear=6000,
                        setback_left=1000, setback_right=1000)
            layout = solve(program, plot)
            build_building(program, plot, layout, design=DESIGN)
            for cell in layout.cells:
                with self.subTest(lot=(width, depth), room=cell.name):
                    self.assertLessEqual(cell.rect.w, layout.envelope.w)
                    self.assertLessEqual(cell.rect.h, layout.envelope.h)


if __name__ == "__main__":
    unittest.main()
