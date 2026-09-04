"""The overall on a floor plan is that floor's overall.

An upper floor is stacked inside the ground floor and is usually smaller
than it: the single-storey part of the house -- the garage, the portico,
whatever is under its own roof -- is not on the first floor at all. Every
floor was dimensioned to the BUILDING's footprint, so the first-floor sheet
printed the ground floor's depth as its own. Forty-five of the ninety
floors in a lot sweep carried an overall that is not a face on that floor,
by up to 6321 mm.

That is not a cosmetic fault. The overall is the figure a builder sets out
from, and a chain that measures to a wall which is not there sets the floor
out six metres too long. The ordinates between the ends were always this
floor's -- they are read off its own walls -- so the chain divided a
distance its own divisions do not add up to.
"""

import unittest

from codraft.annotate import dimension_storey, storey_extent
from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000), (20000, 35000)]


def _sets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for bedrooms in (3, 5):
            for storeys in (2, 3):
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
                       build_building(program, plot, layout, design=design),
                       layout)


class TheOverallIsTheFloorsOwn(unittest.TestCase):
    def test_the_printed_overall_matches_the_floor_it_is_on(self):
        checked = 0
        for label, building, layout in _sets():
            for storey in building.storeys:
                cells = layout.for_storey(storey.index)
                if not cells:
                    continue
                checked += 1
                wide = (max(c.rect.x1 for c in cells)
                        - min(c.rect.x0 for c in cells))
                deep = (max(c.rect.y1 for c in cells)
                        - min(c.rect.y0 for c in cells))
                overalls = {d.vertical: d.text for d
                            in dimension_storey(storey, layout.envelope)
                            if d.is_overall}
                with self.subTest(case=label, floor=storey.index):
                    self.assertEqual(overalls.get(False), str(wide))
                    self.assertEqual(overalls.get(True), str(deep))
        self.assertGreater(checked, 20, "the sweep drew almost nothing")

    def test_an_upper_floor_smaller_than_the_ground_is_the_case(self):
        # If no floor in the sweep were smaller than the one below it, the
        # assertion above would be true of the old code too and would be
        # asserting nothing.
        smaller = 0
        for _label, building, layout in _sets():
            ground = storey_extent(building.storeys[0], layout.envelope)
            for storey in building.storeys[1:]:
                own = storey_extent(storey, layout.envelope)
                if own.w < ground.w or own.h < ground.h:
                    smaller += 1
        self.assertGreater(
            smaller, 0,
            "no upper floor in the sweep is smaller than the ground floor, "
            "so this file proves nothing",
        )

    def test_the_chain_adds_up_to_the_overall_it_divides(self):
        # The ends moved; the divisions between them did not. They have to
        # still meet.
        for label, building, layout in _sets():
            for storey in building.storeys:
                dims = dimension_storey(storey, layout.envelope)
                for vertical in (False, True):
                    chain = [d for d in dims
                             if d.vertical is vertical and not d.is_overall]
                    overall = next((d for d in dims if d.vertical is vertical
                                    and d.is_overall), None)
                    if not chain or overall is None:
                        continue
                    with self.subTest(case=label, floor=storey.index,
                                      axis="depth" if vertical else "width"):
                        self.assertEqual(
                            sum(int(d.text) for d in chain), int(overall.text),
                            "the chain does not add up to its own overall",
                        )


if __name__ == "__main__":
    unittest.main()
