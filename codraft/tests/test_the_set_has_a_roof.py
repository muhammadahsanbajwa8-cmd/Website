"""A set built through the library carries what a set carries."""

import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft.codes import design_parameters, resolve
from codraft.export.section import section_marker
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.sheet import fit_scale


def _built(design=None, storeys=2, bedrooms=4):
    program = template("au-house", bedrooms=bedrooms, bathrooms=2,
                       storeys=storeys)
    if design:
        program.build_to(design)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design), layout


class BuildBuildingGivesTheBuildingARoof(unittest.TestCase):
    def test_a_building_comes_out_with_one(self):
        # Without it the PDF writer's page list, which is guarded on the
        # roof, drops the elevations AND the section, and the floor plan
        # loses its cut marker -- silently, on every caller but the CLI.
        building, _ = _built()
        self.assertIsNotNone(building.roof)

    def test_the_pitch_comes_from_the_design_it_was_handed(self):
        design = dict(design_parameters(resolve("AU-WA")))
        design["roof_pitch_degrees"] = 30.0
        design["roof_kind"] = "gable"
        building, _ = _built(design)
        self.assertEqual(building.roof.pitch_degrees, 30.0)
        self.assertEqual(building.roof.kind, "gable")

    def test_the_set_carries_elevations_and_a_section(self):
        from codraft.export.pdf import write_pdf

        building, layout = _built(design_parameters(resolve("AU-WA")))
        with TemporaryDirectory() as tmp:
            path = write_pdf(building, Path(tmp) / "set.pdf",
                             footprint=layout.envelope)
            blob = path.read_bytes()
        pages = len(re.findall(rb"/Type\s*/Page[^s]", blob))
        # site, two floor plans, two elevation sheets, a section, schedules
        self.assertEqual(pages, 7)


class TheCutMarkerCostsTheDrawingNothing(unittest.TestCase):
    def test_the_marker_runs_past_the_building_at_both_ends(self):
        building, _ = _built()
        axis, _position, run_from, run_to = section_marker(building)
        rects = [s.rect for s in building.storeys[0].spaces]
        lo, hi = ((min(r.x0 for r in rects), max(r.x1 for r in rects))
                  if axis == "x"
                  else (min(r.y0 for r in rects), max(r.y1 for r in rects)))
        self.assertLess(run_from, lo)
        self.assertGreater(run_to, hi)

    def test_it_does_not_drag_the_floor_plan_to_a_coarser_scale(self):
        # The marker is an annotation. At the 2500 mm overrun it used to run,
        # it pushed a four bedroom plan's box from 26165 to 28370 mm against
        # the 27700 an A3 holds at 1:100, and ten of the hundred floor plan
        # sheets in the lot sweep dropped to 1:200 for it.
        building, layout = _built(design_parameters(resolve("AU-WA")))
        for storey in building.storeys:
            with self.subTest(floor=storey.index):
                _, _, w, h, _ = build_sheet(building, storey.index,
                                            "architectural", None,
                                            layout.envelope, "metric")
                self.assertEqual(fit_scale(w, h, "A3").scale, 100)


if __name__ == "__main__":
    unittest.main()
