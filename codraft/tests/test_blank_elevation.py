"""A face with nothing on it has to say why."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.elevation import elevations
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template


def _built(width, depth, bedrooms=5, storeys=1):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                       storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design)


class ABlankElevationSaysWhy(unittest.TestCase):
    def test_the_case_really_is_blank(self):
        # 16 x 24 m with five bedrooms puts the entry, the porch and the
        # passage down the west boundary, and circulation gets no window.
        # If this stops being true the test below proves nothing.
        blank = [v for v in elevations(_built(16000, 24000)) if not v.panels]
        self.assertTrue(blank, "no elevation on this plan is blank any more")

    def test_it_names_the_rooms_behind_it(self):
        for view in elevations(_built(16000, 24000)):
            if view.panels:
                continue
            note = next((n for n in view.notes if "No openings" in n), "")
            self.assertTrue(note, f"{view.title} is blank and says nothing")
            self.assertIn("Passage", note)
            self.assertIn("by consequence rather than by omission", note)

    def test_an_elevation_with_openings_does_not_carry_the_note(self):
        for view in elevations(_built(15000, 30000, bedrooms=4, storeys=2)):
            if view.panels:
                self.assertFalse([n for n in view.notes if "No openings" in n],
                                 f"{view.title} has openings and denies it")

    def test_every_blank_elevation_in_a_sweep_says_why(self):
        seen = blank = 0
        for width, depth in ((10500, 32000), (15000, 30000), (16000, 24000),
                             (18000, 30000)):
            for bedrooms in (3, 5):
                try:
                    building = _built(width, depth, bedrooms=bedrooms)
                except LayoutError:
                    continue
                for view in elevations(building):
                    seen += 1
                    if view.panels:
                        continue
                    blank += 1
                    with self.subTest(lot=f"{width}x{depth}", view=view.title):
                        self.assertTrue(
                            [n for n in view.notes if "No openings" in n])
        self.assertGreater(seen, 20)


if __name__ == "__main__":
    unittest.main()
