"""An electrical sheet is at the same scale as the floor plan it marks up.

It was not. The legend was placed 3.5 m to the right of the drawing and
13 m wide, always, so a 13 x 17 m plan came to a content box 32.7 m across
against the 30.8 m an A3 holds at 1:100 -- and 72 of the 108 services
sheets in a lot sweep came out at 1:200 beside their own architectural
sheet at 1:100. A set drawn at two scales is a set somebody measures the
wrong one off, and the sheet that lost was the one an electrician works
from.

Two things fixed it, and they are the same two the elevation and section
sheets already had. The legend's NOTES go to the title block, because they
are general notes rather than a key to the drawing and twenty wrapped lines
of them is seven metres of paper deducted before a scale is chosen. And
where the key goes -- beside the drawing or under it -- is chosen by
measuring which keeps the sheet at the scale the drawing alone would get,
rather than fixed at "to the right".

Where neither placement holds it, the sheet says so. That is a paper-size
decision, and the answer is a bigger sheet rather than a smaller drawing.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.services import design_electrical, design_plumbing
from codraft.sheet import fit_scale

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000), (18000, 30000)]


def _sets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for bedrooms in (3, 5):
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
                       build_building(program, plot, layout, design=design),
                       layout)


def _scale(building, index, sheet, services, layout, size="A3"):
    canvas, _o, width, height, _n = build_sheet(
        building, index, sheet, services, layout.envelope, "metric", size)
    return fit_scale(width, height, size=size).scale, canvas


class ServicesFollowTheArchitecturalScale(unittest.TestCase):
    def test_every_services_sheet_matches_or_says_why_not(self):
        checked = 0
        for label, building, layout in _sets():
            for storey in building.storeys:
                plan, _canvas = _scale(building, storey.index,
                                       "architectural", None, layout)
                for sheet, design in (("electrical", design_electrical),
                                      ("plumbing", design_plumbing)):
                    services = {storey.index: design(building, storey.index)}
                    got, canvas = _scale(building, storey.index, sheet,
                                         services, layout)
                    checked += 1
                    with self.subTest(case=label, floor=storey.index,
                                      sheet=sheet):
                        if got == plan:
                            continue
                        said = " ".join(canvas.sheet_notes)
                        self.assertIn(
                            f"1:{got}", said,
                            f"{label}: the {sheet} sheet is at 1:{got} "
                            f"against a plan at 1:{plan} and does not say so",
                        )
        self.assertGreater(checked, 20, "almost nothing was checked")

    def test_the_common_block_comes_out_matched(self):
        # The assertion above is satisfied by a sheet that drops a step and
        # declares it. This one is the outcome that actually matters: on the
        # blocks a builder sells, the two sheets are at the same scale.
        design = design_parameters(resolve("AU-WA"))
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        program.build_to(design)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=1000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
        building = build_building(program, plot, layout, design=design)
        for storey in building.storeys:
            plan, _c = _scale(building, storey.index, "architectural", None,
                              layout)
            for sheet, maker in (("electrical", design_electrical),
                                 ("plumbing", design_plumbing)):
                services = {storey.index: maker(building, storey.index)}
                got, _c = _scale(building, storey.index, sheet, services,
                                 layout)
                with self.subTest(floor=storey.index, sheet=sheet):
                    self.assertEqual(got, plan)

    def test_the_notes_are_on_the_sheet_somewhere(self):
        # Moved off the drawing, not dropped. A note that only the report
        # carries is a note the person holding the drawing does not have.
        design = design_parameters(resolve("AU-WA"))
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        program.build_to(design)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=1000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
        building = build_building(program, plot, layout, design=design)
        services = {0: design_electrical(building, 0)}
        _scale_, canvas = _scale(building, 0, "electrical", services, layout)
        said = " ".join(canvas.sheet_notes)
        self.assertIn("Schematic layout only", said)
        self.assertIn("RCD", said)


if __name__ == "__main__":
    unittest.main()
