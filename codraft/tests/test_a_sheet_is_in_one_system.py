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


class HeightsFollowItToo(unittest.TestCase):
    """The levels up the side of an elevation, and the opening schedule.

    Both were stored as finished strings in millimetres, so a set drawn in
    feet and inches called its ceiling "CL 2864 (33c + PLATE)" and scheduled
    a window as "2260 x 1290". `Level` now carries a number and formats it
    when it is drawn; `set_out` and the schedule's sizes take the system.

    The COURSE count is not converted with them. A course is 86 mm because
    that is the brick, and the count is an instruction to the bricklayer
    rather than a length on the drawing -- turning "33c" into inches would
    be the same mixture of systems in the other direction.
    """

    def test_a_level_reads_in_the_sheets_units(self):
        from codraft.export.elevation import Level

        level = Level(2864, "CL", "(33c + PLATE)")
        self.assertEqual(level.label("metric"), "CL 2864 (33c + PLATE)")
        self.assertEqual(level.label("imperial"), "CL 9'-5\" (33c + PLATE)")

    def test_the_elevation_sheet_carries_the_converted_levels(self):
        building, layout = _built()
        canvas, *_ = build_sheet(building, 0, "elevations", None,
                                 layout.envelope, "imperial")
        levels = [op[6] for op in canvas.ops
                  if op[0] == "text" and op[1] == "elev-level-text"]
        self.assertTrue(levels)
        for text in levels:
            with self.subTest(level=text):
                self.assertIn("'-", text)

    def test_the_schedule_sizes_and_set_out_convert(self):
        from codraft.model import OpeningKind
        from codraft.schedule import format_schedule, schedule

        building, _layout = _built()
        rows, _warnings = schedule(building)
        windows = [r for r in rows if r.kind is OpeningKind.WINDOW]
        self.assertTrue(windows)
        imperial = "\n".join(
            format_schedule(windows, "W", notes=False, system="imperial"))
        metric = "\n".join(
            format_schedule(windows, "W", notes=False, system="metric"))
        self.assertIn("'-", imperial)
        self.assertNotIn(" mm)", imperial)
        # The metric schedule keeps the millimetres it has always printed:
        # inside brackets beside a course count, a bare number is a number
        # of nothing.
        self.assertIn(" mm)", metric)
        self.assertIn("c (", metric)
        self.assertIn("c (", imperial)

    def test_the_columns_still_line_up_in_both(self):
        from codraft.model import OpeningKind
        from codraft.schedule import format_schedule, schedule

        building, _layout = _built()
        rows, _warnings = schedule(building)
        windows = [r for r in rows if r.kind is OpeningKind.WINDOW]
        for system in ("metric", "imperial"):
            lines = format_schedule(windows, "W", notes=False, system=system)
            header = lines[2]
            with self.subTest(system=system):
                for line in lines[3:]:
                    if not line.strip():
                        continue
                    self.assertEqual(
                        line.index(" YES ") if " YES " in line
                        else line.index(" -   "),
                        header.index("LINTEL") - 1,
                        f"{system}: the LINTEL column does not line up",
                    )


class AnInchIsNeverTwelve(unittest.TestCase):
    """600 mm printed as 1'-12".

    The remainder was split off before it was rounded, so 1 ft 11.62 in
    became 1'-12" instead of carrying into 2'-0" -- a dimension no rule
    reads and nobody writes. It reached the drawing: a 600 mm linen press
    was scheduled at 1'-12" x 1'-12".
    """

    def test_a_remainder_that_rounds_to_twelve_carries(self):
        from codraft.annotate import format_mm
        from codraft.units import fmt_len

        self.assertEqual(format_mm(600, "imperial"), "2'-0\"")
        self.assertEqual(fmt_len(305, "imperial"), "1'-0\"")

    def test_no_length_in_a_sweep_prints_twelve_inches(self):
        from codraft.annotate import format_mm

        for value in range(0, 30000, 7):
            with self.subTest(mm=value):
                self.assertNotIn("-12\"", format_mm(value, "imperial"))
