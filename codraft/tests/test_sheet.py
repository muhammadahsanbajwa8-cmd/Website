"""Paper: the scale printed has to be the scale drawn.

codraft's survey reader exists because a drawing whose stated scale does not
match its geometry produces confident millimetres that are wrong. Emitting
one would be the same fault pointed the other way, so the property is
asserted directly: parse the SVG back, read the number in the title block,
read the transform applied to the geometry, and require that they agree.
"""

import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft.export.svg import write_svg
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.sheet import (
    SHEET_SIZES,
    STANDARD_SCALES,
    Revision,
    SheetError,
    TitleBlock,
    fit_scale,
)


def _building(storeys=2, width=15000, depth=30000):
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    return build_building(program, plot, solve(program, plot))


def _render(**kwargs) -> str:
    building = kwargs.pop("building", None) or _building()
    with TemporaryDirectory() as tmp:
        path = write_svg(building, Path(tmp) / "s.svg", **kwargs)
        return path.read_text(encoding="utf-8")


class TestTheScalePrintedIsTheScaleDrawn(unittest.TestCase):
    def _printed_and_drawn(self, svg: str) -> tuple[int, float]:
        printed = re.search(r'class="tb-scale"[^>]*>1:(\d+)<', svg)
        self.assertIsNotNone(printed, "no scale in the title block")
        drawn = re.search(r'<g transform="translate\([^)]*\) scale\(([\d.]+)\)', svg)
        self.assertIsNotNone(drawn, "no scale on the drawing group")
        return int(printed.group(1)), float(drawn.group(1))

    def test_plan_sheet(self):
        printed, drawn = self._printed_and_drawn(_render(storey_index=0))
        self.assertAlmostEqual(drawn, 1 / printed, places=6)

    def test_elevation_sheet(self):
        printed, drawn = self._printed_and_drawn(_render(sheet="elevations"))
        self.assertAlmostEqual(drawn, 1 / printed, places=6)

    def test_no_elevation_carries_a_scale_of_its_own(self):
        # A view title that says 1:100 while the sheet is issued at 1:200 is
        # the drawing contradicting itself about the one number a builder
        # measures with. The sheet states the scale, once.
        svg = _render(sheet="elevations")
        titles = re.findall(r'class="title"[^>]*>([^<]*)<', svg)
        self.assertTrue(titles, "the elevations have no titles at all")
        for title in titles:
            self.assertNotRegex(title, r"1:\d", f"{title!r} states its own scale")


class TestOnlyScalesARuleCanMeasure(unittest.TestCase):
    def test_every_fitted_scale_is_a_standard_one(self):
        for width in range(4000, 90000, 2300):
            for height in range(4000, 60000, 2900):
                try:
                    frame = fit_scale(width, height)
                except SheetError:
                    continue
                self.assertIn(frame.scale, STANDARD_SCALES)

    def test_the_largest_scale_that_fits_is_the_one_chosen(self):
        frame = fit_scale(20000, 15000, size="A3")
        for scale in [s for s in STANDARD_SCALES if s < frame.scale]:
            self.assertFalse(
                20000 <= frame.w * scale and 15000 <= frame.h * scale,
                f"1:{scale} would have fitted and 1:{frame.scale} was used",
            )

    def test_what_will_not_fit_is_refused_not_squeezed(self):
        # The alternative is a ratio invented to make it fit, which no rule
        # can measure. A sheet that cannot hold the drawing is a sheet size
        # decision and belongs to whoever is issuing the set.
        with self.assertRaises(SheetError) as caught:
            fit_scale(5_000_000, 5_000_000, size="A4")
        self.assertIn("larger sheet", str(caught.exception))

    def test_the_drawing_fits_inside_the_window(self):
        for size in SHEET_SIZES:
            frame = fit_scale(30000, 22000, size=size)
            covers_w, covers_h = frame.covers_mm()
            self.assertGreaterEqual(covers_w, 30000)
            self.assertGreaterEqual(covers_h, 22000)


class TestTheTitleBlockDoesNotInventAnything(unittest.TestCase):
    def test_an_unsupplied_field_is_ruled_through(self):
        svg = _render(storey_index=0, title=TitleBlock(project="THE MURRAY"))
        self.assertIn("THE MURRAY", svg)
        # The client was never given, so no value is printed for it -- the
        # box is ruled instead. An obviously empty box beats a plausible
        # invention.
        self.assertIn("tb-blank", svg)

    def test_a_long_value_wraps_rather_than_being_cut(self):
        address = "Lot 55 Purple Court, Baldivis WA 6171"
        svg = _render(storey_index=0, title=TitleBlock(address=address))
        # Every word has to survive somewhere on the sheet. Truncating leaves
        # something that still reads as an address and is not one.
        for word in address.split():
            self.assertIn(word, svg, f"{word!r} was dropped from the address")

    def test_a_first_issue_revision_is_the_only_history_assumed(self):
        block = TitleBlock()
        self.assertEqual(len(block.revisions), 1)
        self.assertEqual(block.revisions[0].mark, "A")
        self.assertEqual(block.revisions[0].description, "First issue")

    def test_supplied_revisions_are_kept_in_order(self):
        block = TitleBlock(revisions=[
            Revision("A", "01.01.26", "First issue"),
            Revision("B", "02.02.26", "Client comments"),
        ])
        svg = _render(storey_index=0, title=block)
        self.assertIn("Client comments", svg)
        self.assertLess(svg.index("First issue"), svg.index("Client comments"))

    def test_the_sheet_carries_its_status_alone(self):
        # A sheet gets separated from its report, so it has to say what it is
        # without one.
        svg = _render(storey_index=0)
        self.assertIn("NOT FOR CONSTRUCTION", svg)


class TestTheSheetIsRealPaper(unittest.TestCase):
    def test_the_viewbox_is_the_paper_size(self):
        for size, (width, height) in SHEET_SIZES.items():
            svg = _render(storey_index=0, sheet_size=size)
            self.assertIn(f'viewBox="0 0 {width} {height}"', svg)

    def test_the_sheet_number_is_carried_through(self):
        svg = _render(storey_index=0, sheet_no=2, sheet_of=5)
        self.assertRegex(svg, r'class="tb-scale"[^>]*>2 of 5<')

    def test_an_unknown_sheet_size_is_refused(self):
        with self.assertRaises(SheetError):
            fit_scale(10000, 8000, size="A9")


if __name__ == "__main__":
    unittest.main()
