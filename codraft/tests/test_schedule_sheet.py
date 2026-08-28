"""The schedule is in the set, not only in a text file beside it.

A drawing gets separated from the files that came with it. A builder holding
the plans and no schedule has the sizes of nothing -- and the schedule is
what an opening is actually built from. It is drawn from the very lines the
text file carries, so the two cannot disagree: a schedule that says one
thing on paper and another in a file is worse than one schedule, because
somebody will build from whichever they are holding.
"""

import tempfile
import unittest
from pathlib import Path

from codraft.codes import design_parameters, resolve
from codraft.export.pdf import fit_scale, write_pdf
from codraft.export.svg import NOT_TO_SCALE, build_sheet, write_svg
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import OpeningKind, Plot, Roof
from codraft.program import template
from codraft.schedule import schedule

DESIGN = design_parameters(resolve("AU-WA"))


def _building(storeys=1):
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    building = build_building(program, plot, layout, design=DESIGN)
    building.roof = Roof(pitch_degrees=25.0, overhang_mm=600, kind="hip")
    return building, layout


class TestTheScheduleSheet(unittest.TestCase):
    def test_every_mark_is_on_the_sheet(self):
        building, layout = _building()
        rows, _warnings = schedule(building)
        with tempfile.TemporaryDirectory() as tmp:
            drawn = write_svg(
                building, Path(tmp) / "s.svg", sheet="schedules",
                footprint=layout.envelope,
            ).read_text(encoding="utf-8")
        for row in rows:
            with self.subTest(mark=row.mark):
                self.assertIn(row.mark, drawn)

    def test_the_garage_opening_is_on_it(self):
        building, layout = _building()
        rows, _warnings = schedule(building)
        garage = [r for r in rows if any("Garage" in n for n in r.rooms)]
        self.assertTrue(garage)
        with tempfile.TemporaryDirectory() as tmp:
            drawn = write_svg(
                building, Path(tmp) / "s.svg", sheet="schedules",
                footprint=layout.envelope,
            ).read_text(encoding="utf-8")
        self.assertIn("OPENING SCHEDULE", drawn)
        for row in garage:
            self.assertIn(row.mark, drawn)

    def test_it_says_not_to_scale(self):
        # "1:100" on a table invites somebody to scale a size off a column
        # of type, and the sizes are written in the table.
        building, layout = _building()
        with tempfile.TemporaryDirectory() as tmp:
            drawn = write_svg(
                building, Path(tmp) / "s.svg", sheet="schedules",
                footprint=layout.envelope,
            ).read_text(encoding="utf-8")
        self.assertIn(">NTS<", drawn)
        self.assertIn("Schedules", NOT_TO_SCALE)

    def test_the_rows_come_out_big_enough_to_read(self):
        # `_Canvas.saw` allows for CENTRED text about 90 units a character
        # either side, which is twice the run of a left-anchored line and in
        # the wrong place. Believing it made this sheet 39400 units across
        # for a table 14000 wide, and put the rows at 1.05 mm on paper.
        building, layout = _building()
        _canvas, _origin, width, height, name = build_sheet(
            building, None, "schedules", None, layout.envelope, "metric")
        frame = fit_scale(width, height, size="A3")
        self.assertEqual(name, "Schedules")
        self.assertGreaterEqual(210 / frame.scale, 1.8,
                                "the schedule rows are too small to read")

    def test_the_set_carries_it(self):
        # Page content is compressed, so the words are only in the inflated
        # streams -- read by the declared /Length, which is how a PDF says
        # where a stream ends.
        import re
        import zlib

        building, _layout = _building()
        with tempfile.TemporaryDirectory() as tmp:
            raw = write_pdf(building, Path(tmp) / "set.pdf").read_bytes()
        pages = []
        for match in re.finditer(rb"/Length (\d+)[^>]*>>\s*stream\r?\n", raw):
            body = raw[match.end():match.end() + int(match.group(1))]
            try:
                pages.append(zlib.decompress(body).decode("cp1252", "replace"))
            except zlib.error:
                pages.append(body.decode("cp1252", "replace"))
        joined = "\n".join(pages)
        self.assertIn("WINDOW SCHEDULE", joined,
                      "the set has no schedule sheet")
        self.assertIn("OPENING SCHEDULE", joined)
        self.assertIn("NTS", joined)


if __name__ == "__main__":
    unittest.main()
