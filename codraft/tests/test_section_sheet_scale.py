"""The section is drawn at the scale the rest of the set is drawn at."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.sheet import fit_scale

LOTS = [(10500, 32000), (15000, 30000), (18000, 30000), (20000, 35000)]


def _sets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for bedrooms in (3, 4, 5):
            for storeys in (1, 2):
                program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                                   storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=6000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue
                yield (f"{width}x{depth} {bedrooms}bed {storeys}s",
                       build_building(program, plot, layout, design=design),
                       layout)


def _scale(building, index, sheet, footprint):
    _, _, w, h, _ = build_sheet(building, index, sheet, None, footprint,
                                "metric")
    return fit_scale(w, h, "A3").scale


class TheSectionIsNeverCoarserThanThePlan(unittest.TestCase):
    def test_across_the_lot_sweep(self):
        # A set drawn at two scales is a set a builder measures wrongly off.
        # Fifteen of the sixty-five sections in the sweep were at 1:200 while
        # their own floor plans were at 1:100, for 360 mm of margin.
        seen = 0
        for label, building, layout in _sets():
            seen += 1
            section = _scale(building, None, "sections", layout.envelope)
            plans = [_scale(building, s.index, "architectural", layout.envelope)
                     for s in building.storeys]
            with self.subTest(case=label):
                self.assertLessEqual(section, min(plans))
        self.assertGreater(seen, 10, "the sweep drew almost nothing")


class TheSectionsNotesAreInTheTitleBlock(unittest.TestCase):
    def test_they_do_not_stand_under_the_drawing(self):
        # Under it they are deducted from the paper before a scale is chosen,
        # which is paying for the caption with the drawing it captions. The
        # elevation sheet already makes this call; this one now matches.
        _, building, layout = next(iter(_sets()))
        canvas, _, _, _, _ = build_sheet(building, None, "sections", None,
                                         layout.envelope, "metric")
        self.assertTrue(canvas.sheet_notes, "the section carries no notes")
        body = "\n".join(canvas.parts)
        for note in canvas.sheet_notes:
            with self.subTest(note=note[:40]):
                self.assertNotIn(note[:30], body)


if __name__ == "__main__":
    unittest.main()
