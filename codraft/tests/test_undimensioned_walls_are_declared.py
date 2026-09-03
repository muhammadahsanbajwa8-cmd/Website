"""A wall the chain leaves out has to be named, not just left out."""

import unittest

from codraft.annotate import MIN_CHAIN_STEP
from codraft.codes import design_parameters, resolve
from codraft.export.svg import _undimensioned, build_sheet, drawing_notes
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template


def _built(width, depth, bedrooms=5, bathrooms=3, storeys=1):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=bedrooms, bathrooms=bathrooms,
                       storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design), layout


class TheSheetSaysWhichWallsItCannotDimension(unittest.TestCase):
    def test_a_floor_that_drops_ordinates_says_how_many(self):
        # A chain keeps its figures legible by dropping ordinates closer than
        # MIN_CHAIN_STEP. Over the lot sweep that is 18% of wall positions,
        # and up to 4 of the 11 on one floor.
        building, layout = _built(18000, 30000)
        dropped = _undimensioned(building.storeys[0], layout.envelope)
        self.assertGreater(dropped, 0, "this plan drops nothing; it proves nothing")
        notes = [n for n in drawing_notes(building, footprint=layout.envelope)
                 if "dimension chains" in n]
        self.assertEqual(len(notes), 1)
        self.assertIn(str(dropped), notes[0])
        self.assertIn(str(MIN_CHAIN_STEP), notes[0])

    def test_it_does_not_claim_the_room_sizes_recover_them(self):
        # Only 464 of 809 rooms in the sweep print their size, so telling a
        # builder to take it off the room would be true of a bit over half
        # the drawing.
        building, layout = _built(18000, 30000)
        note = next(n for n in drawing_notes(building, footprint=layout.envelope)
                    if "dimension chains" in n)
        self.assertIn("does not give a figure for them", note)

    def test_a_floor_that_drops_nothing_says_nothing(self):
        seen = quiet = 0
        for width, depth in ((9000, 22000), (10500, 32000), (12500, 28000),
                             (15000, 30000), (18000, 30000)):
            for bedrooms in (3, 5):
                try:
                    building, layout = _built(width, depth, bedrooms=bedrooms,
                                              bathrooms=2)
                except LayoutError:
                    continue
                seen += 1
                dropped = sum(_undimensioned(s, layout.envelope)
                              for s in building.storeys)
                notes = [n for n in drawing_notes(building,
                                                  footprint=layout.envelope)
                         if "dimension chains" in n]
                with self.subTest(lot=f"{width}x{depth}", beds=bedrooms):
                    self.assertEqual(bool(notes), dropped > 0)
                if not dropped:
                    quiet += 1
        self.assertGreater(seen, 5)

    def test_every_figure_still_fits_its_own_segment(self):
        # The dropping is what buys this, so it is asserted next to it.
        from codraft.annotate import dimension_storey
        from codraft.export.svg import CHAR_WIDTH, TEXT_SIZES

        building, layout = _built(18000, 30000)
        for storey in building.storeys:
            for dim in dimension_storey(storey, layout.envelope, "metric"):
                size = TEXT_SIZES["dim-overall" if dim.is_overall else "dim-text"]
                width = len(dim.text) * size * CHAR_WIDTH
                span = (abs(dim.line.y1 - dim.line.y0) if dim.vertical
                        else abs(dim.line.x1 - dim.line.x0))
                with self.subTest(text=dim.text):
                    self.assertLessEqual(width, span)


if __name__ == "__main__":
    unittest.main()
