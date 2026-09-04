"""Every format the CLI offers actually writes, for every sheet it offers.

`--formats dxf` raised a TypeError before writing a byte, on every
invocation, because the CLI's sheet loop passes `notes=` to its writers and
the DXF writer did not take the argument. Nothing exercised that loop: the
DXF writer has its own tests, and they call it directly with the arguments
it happens to accept.

`--formats dxf --sheets site` then raised ValueError out of the writer and
killed the command having already written the sheets before it. A DXF has
no site plan -- it is model space at full size, and the plot boundary and
the setback line are already on the architectural sheet -- and no schedules
sheet, because a schedule is a table rather than geometry. Those are
reasonable things for a format not to have; a traceback is not a reasonable
way to say so.
"""

import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft import cli

FORMATS = ("dxf", "svg", "pdf", "ifc", "json")
SHEETS = ("site", "architectural", "elevations", "sections", "schedules")


def _run(out: Path, formats: str, sheets: str | None = None) -> int:
    argv = ["plan", "4 bed 2 bath house in Perth, WA", "--plot", "15mx30m",
            "--storeys", "2", "--elevations", "--out", str(out),
            "--name", "t", "--formats", formats]
    if sheets:
        argv += ["--sheets", sheets]
    # The command prints a compliance report as long as this file. Swallowed
    # so a failure here is readable.
    with contextlib.redirect_stdout(io.StringIO()):
        return cli.main(argv)


class EveryFormatWritesSomething(unittest.TestCase):
    def test_each_format_on_its_own(self):
        for name in FORMATS:
            with self.subTest(format=name), TemporaryDirectory() as tmp:
                out = Path(tmp)
                self.assertEqual(_run(out, name), 0,
                                 f"--formats {name} did not succeed")
                made = [p for p in out.iterdir() if p.suffix == f".{name}"]
                self.assertTrue(made, f"--formats {name} wrote no .{name} file")
                for path in made:
                    self.assertGreater(path.stat().st_size, 0)

    def test_every_sheet_through_every_sheet_format(self):
        for name in ("dxf", "svg"):
            with self.subTest(format=name), TemporaryDirectory() as tmp:
                out = Path(tmp)
                self.assertEqual(_run(out, name, ",".join(SHEETS)), 0)
                self.assertTrue([p for p in out.iterdir()
                                 if p.suffix == f".{name}"])

    def test_all_of_them_together(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(_run(out, ",".join(FORMATS), ",".join(SHEETS)), 0)


class ASheetWithNoStoreyIsWrittenOnce(unittest.TestCase):
    """A site plan shows what covers the GROUND, a section cuts the whole
    building, and a schedule is a table of every opening in it. None has a
    storey to select, and paginating them per storey wrote each of them
    twice for a two-storey brief -- two byte-identical sections, two
    identical schedules, and a site plan drawn a second time with the first
    floor inside the lot outline.
    """

    def test_one_file_each_however_many_floors(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(_run(out, "svg", ",".join(SHEETS)), 0)
            names = sorted(p.name for p in out.iterdir() if p.suffix == ".svg")
            for stem in ("site", "sections", "schedules"):
                with self.subTest(sheet=stem):
                    self.assertEqual(
                        [n for n in names if stem in n], [f"t-{stem}.svg"],
                        f"{stem} was written more than once: {names}",
                    )

    def test_the_dxf_writes_one_elevations_file(self):
        # Two views to an A3 sheet is a paper decision, and a DXF has no
        # paper: the writer draws all four elevations whichever page it is
        # handed, so two pages of it wrote the same file twice.
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(_run(out, "dxf", "architectural,elevations"), 0)
            elevations = [p for p in out.iterdir()
                          if "elevations" in p.name and p.suffix == ".dxf"]
            self.assertEqual(len(elevations), 1,
                             f"wrote {[p.name for p in elevations]}")


class ADxfCarriesWhatThePlanSaysAboutItself(unittest.TestCase):
    def test_the_shortfall_notes_reach_the_file(self):
        # Accepting `notes` and dropping it would have been the other
        # failure: geometry handed over without the caveat that goes with it.
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            # A block tight enough that rooms come up short.
            with contextlib.redirect_stdout(io.StringIO()):
                code = cli.main([
                    "plan", "4 bed 2 bath house in Perth, WA",
                    "--plot", "12mx28m", "--storeys", "1", "--out", str(out),
                    "--name", "t", "--formats", "dxf"])
            self.assertEqual(code, 0)
            text = (out / "t.dxf").read_text()
            self.assertIn("A-ANNO-NOTE", text)

    def test_nothing_is_written_as_a_question_mark(self):
        # The file is ASCII, and `errors="replace"` turned every area label
        # into "12.3 m?" -- sixteen of them on one ground floor. That is not
        # a smaller version of "12.3 m2", it is a figure with its unit taken
        # off.
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.assertEqual(_run(out, "dxf"), 0)
            for path in out.glob("*.dxf"):
                with self.subTest(file=path.name):
                    self.assertNotIn("?", path.read_text())
                    self.assertIn(" m2", path.read_text())


if __name__ == "__main__":
    unittest.main()
