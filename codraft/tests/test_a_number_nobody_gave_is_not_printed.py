"""Where the program had a figure it was never given, and printed one anyway.

Two places, both small, both the same fault: a default standing in for a
measurement, printed in the same face as a measured one. The standing rule
here is that a number nobody established does not get emitted, and "0 m2"
and "no scale found" are both numbers of a kind.
"""

import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft import cli


class ADesignWithNoAreaSaysSo(unittest.TestCase):
    """`library import` from a spreadsheet with no area column says "area
    not given", and then `library list` printed `0m²` for the same design.
    Nought square metres is a measurement of a house, not the absence of
    one.
    """

    def _library(self, tmp: str) -> Path:
        path = Path(tmp) / "range.csv"
        path.write_text(
            "Name,Width,Depth,Bedrooms,Bathrooms,Storeys\n"
            "The Como,12.5,18.2,4,2,1\n"
            "The Marlow,10.0,21.5,3,2,1\n"
        )
        out = Path(tmp) / "designs"
        with contextlib.redirect_stdout(io.StringIO()):
            code = cli.main(["library", "import", "--file", str(path),
                             "--builder", "Vista", "--path", str(out)])
        self.assertEqual(code, 0)
        return out

    def test_the_table_does_not_invent_a_total(self):
        with TemporaryDirectory() as tmp:
            designs = self._library(tmp)
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                cli.main(["library", "list", "--path", str(designs)])
            listing = said.getvalue()
            self.assertIn("the-como", listing)
            self.assertNotIn("0m²", listing)

    def test_a_design_that_has_an_area_still_prints_it(self):
        # The other half: the guard must not swallow a real figure.
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "range.csv"
            path.write_text(
                "Name,Width,Depth,Bedrooms,Bathrooms,Storeys,Area\n"
                "The Como,12.5,18.2,4,2,1,214\n"
            )
            out = Path(tmp) / "designs"
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                cli.main(["library", "import", "--file", str(path),
                          "--builder", "Vista", "--path", str(out)])
                cli.main(["library", "list", "--path", str(out)])
            self.assertIn("214m²", said.getvalue())


class ASheetThatSaysNotToScaleHasNotFailed(unittest.TestCase):
    """The schedules sheet says NTS, deliberately: the sizes are in the
    table, and a ratio printed on one invites somebody to scale a size off a
    column of type. The survey reported it as "No dimension strings and no
    stated scale were found", which reads as a gap in the drawing rather
    than a decision by whoever drew it.
    """

    def test_it_is_reported_as_a_decision_not_a_gap(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            with contextlib.redirect_stdout(io.StringIO()):
                code = cli.main([
                    "plan", "4 bed 2 bath house in Perth, WA",
                    "--plot", "15mx30m", "--storeys", "2", "--elevations",
                    "--out", str(out), "--name", "t", "--formats", "pdf"])
            self.assertEqual(code, 0)
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                cli.main(["survey", str(out / "t.pdf")])
            report = said.getvalue()
            self.assertIn("the sheet says so", report)
            self.assertIn("NOT TO SCALE", report)

    def test_a_drawn_sheet_still_has_its_scale_established(self):
        # The guard must not turn a measurable sheet into an excuse.
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            with contextlib.redirect_stdout(io.StringIO()):
                cli.main(["plan", "4 bed 2 bath house in Perth, WA",
                          "--plot", "15mx30m", "--storeys", "2",
                          "--out", str(out), "--name", "t",
                          "--formats", "pdf"])
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                cli.main(["survey", str(out / "t.pdf")])
            self.assertIn("100% agreement", said.getvalue())


if __name__ == "__main__":
    unittest.main()
