"""A drawing dimensioned in feet and inches states its areas in square feet.

`--units imperial` reached the dimension chains and the room dimension
lines and nothing else. Every `fmt_area` call in the program -- on the
drawing, in the title block's AREAS box, in the DXF, and in what the
command prints -- omitted the system and took the default. So a plan whose
frontage read 40'-0" labelled its living room "23.1 m2" and carried a title
block of square metres beside it: one sheet in two systems, with the reader
doing the conversion.

The unit belongs to the sheet, not to the call site that happens to be
formatting a number.
"""

import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft import cli
from codraft.annotate import area_schedule
from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _built(system_free=True):
    design = design_parameters(resolve("PK"))
    program = template("house", bedrooms=3, bathrooms=2, storeys=1)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, 12192, 18288), road_side="south",
                setback_front=3000, setback_rear=1500,
                setback_left=900, setback_right=900)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design), layout


class AreasFollowTheSheetsUnits(unittest.TestCase):
    def test_the_plan_labels_rooms_in_square_feet(self):
        building, layout = _built()
        canvas, *_ = build_sheet(building, 0, "architectural", None,
                                 layout.envelope, "imperial")
        areas = [op[6] for op in canvas.ops
                 if op[0] == "text" and op[1] == "area"]
        self.assertTrue(areas, "no room area was labelled at all")
        for text in areas:
            with self.subTest(label=text):
                self.assertIn("sq ft", text)
                self.assertNotIn("m²", text)

    def test_the_same_plan_in_metric_is_unchanged(self):
        building, layout = _built()
        canvas, *_ = build_sheet(building, 0, "architectural", None,
                                 layout.envelope, "metric")
        areas = [op[6] for op in canvas.ops
                 if op[0] == "text" and op[1] == "area"]
        self.assertTrue(areas)
        for text in areas:
            with self.subTest(label=text):
                self.assertIn("m²", text)

    def test_the_title_block_follows_it_too(self):
        building, _layout = _built()
        for system, unit in (("imperial", "sq ft"), ("metric", "m²")):
            rows, _note = area_schedule(building, system=system)
            figures = [value for _label, value in rows if "%" not in value]
            self.assertTrue(figures)
            for value in figures:
                with self.subTest(system=system, value=value):
                    self.assertIn(unit, value)


class TheWholeSetFollowsIt(unittest.TestCase):
    def test_the_dxf_and_the_printed_report_do_too(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                code = cli.main([
                    "plan", "3 bed house in Lahore", "--plot", "40x60ft",
                    "--units", "imperial", "--out", str(out), "--name", "t",
                    "--formats", "dxf"])
            self.assertEqual(code, 0)
            self.assertIn("sq ft", said.getvalue())
            self.assertNotIn("m²", said.getvalue())
            text = (out / "t.dxf").read_text()
            self.assertIn("sq ft", text)

    def test_a_size_given_on_the_command_line_is_not_reported_missing(self):
        # The brief parser says so truthfully -- the BRIEF has no size in it
        # -- and printing that beside a --plot or a --boundary reads as a
        # fault in what the user typed.
        with TemporaryDirectory() as tmp:
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                cli.main(["plan", "3 bed house in Lahore", "--plot", "40x60ft",
                          "--out", tmp, "--name", "t", "--formats", "pdf"])
            self.assertNotIn("No plot size found", said.getvalue())


if __name__ == "__main__":
    unittest.main()
