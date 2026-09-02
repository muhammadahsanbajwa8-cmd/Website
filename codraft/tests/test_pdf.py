"""The PDF is the file a customer is actually given, so it has to be real.

Not "opens in something" real -- structurally valid, readable by a tool that
did not write it, and carrying the same geometry at the same scale as the
sheet it claims to be. codraft has its own PDF reader, written for taking
apart other people's drawings, so the set can be written, read back, and
measured: a wall drawn 30 m long comes back 30 m long or the writer is wrong.
"""

import itertools
import re
import unittest
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft.export.pdf import MM_TO_PT, parse_style, write_pdf
from codraft.export.svg import STYLE
from codraft.geom import Rect
from codraft.ingest.pdfread import read_pdf
from codraft.layout import build_building, solve
from codraft.model import Plot, Roof
from codraft.program import template
from codraft.sheet import SHEET_SIZES, TitleBlock


def _building(storeys=2, width=15000, depth=30000, roof=True):
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    building = build_building(program, plot, solve(program, plot))
    # `build_building` gives every building a roof now, so a roofless one has
    # to be made roofless on purpose rather than by omission.
    building.roof = (Roof(pitch_degrees=25.0, overhang_mm=600, kind="hip")
                     if roof else None)
    return building


# One scratch directory for the module, cleaned up when it unloads. Handing
# each call its own TemporaryDirectory leaked them: the object was collected
# while the test still held the path.
_SCRATCH = TemporaryDirectory()
_COUNTER = itertools.count()


def _write(**kwargs) -> Path:
    building = kwargs.pop("building", None) or _building()
    path = Path(_SCRATCH.name) / f"set-{next(_COUNTER)}.pdf"
    return write_pdf(building, path, **kwargs)


def _streams(path: Path) -> list[str]:
    """Every page's content stream, inflated.

    Read by the declared /Length, which is how a PDF says where a stream
    ends. Searching for the "endstream" keyword instead looks equivalent and
    is not: the pattern has to allow an optional CR before the newline, so a
    compressed stream whose last byte happens to be 0x0D loses it, and the
    inflate fails. Which byte that is depends on the drawing -- adding one
    opening to an elevation was enough to trip it -- so the test failed on a
    file that was perfectly valid.
    """
    raw = path.read_bytes()
    out = []
    for match in re.finditer(rb"/Length (\d+)[^>]*>>\s*stream\r?\n", raw):
        body = raw[match.end():match.end() + int(match.group(1))]
        try:
            out.append(zlib.decompress(body).decode("cp1252", "replace"))
        except zlib.error:
            out.append(body.decode("cp1252", "replace"))
    return out


class TestItIsAValidPdf(unittest.TestCase):
    def test_the_file_has_the_parts_a_pdf_must_have(self):
        raw = _write().read_bytes()
        self.assertTrue(raw.startswith(b"%PDF-1.4"))
        self.assertIn(b"/Type /Catalog", raw)
        self.assertIn(b"/Type /Pages", raw)
        self.assertIn(b"xref", raw)
        self.assertIn(b"trailer", raw)
        self.assertTrue(raw.rstrip().endswith(b"%%EOF"))

    def test_the_cross_reference_offsets_point_at_their_objects(self):
        # A wrong xref is the classic hand-rolled-PDF bug: readers that
        # rebuild the table silently forgive it and stricter ones do not.
        raw = _write().read_bytes()
        start = int(re.search(rb"startxref\s+(\d+)", raw).group(1))
        table = raw[start:]
        offsets = [int(m.group(1)) for m in
                   re.finditer(rb"(\d{10}) 00000 n", table)]
        self.assertTrue(offsets)
        for number, offset in enumerate(offsets, start=1):
            self.assertTrue(
                raw[offset:].startswith(f"{number} 0 obj".encode()),
                f"xref entry {number} points at {raw[offset:offset + 20]!r}",
            )

    def test_a_reader_that_did_not_write_it_can_read_it(self):
        document = read_pdf(str(_write()))
        self.assertTrue(document.pages)
        for page in document.pages:
            self.assertTrue(page.segments, f"page {page.index} drew nothing")


class TestItIsTheSameDrawing(unittest.TestCase):
    def test_a_known_length_survives_the_round_trip(self):
        # The lot is 30 m deep and is drawn on the plan. Read the set back,
        # take the longest segment that is not sheet furniture, and it should
        # measure 30 m once the sheet's own scale is applied.
        page = read_pdf(str(_write())).pages[0]
        lengths = {
            round(((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2) ** 0.5 / MM_TO_PT * 200)
            for s in page.segments
        }
        self.assertIn(
            30000, lengths,
            "the 30 m lot depth did not come back out of the PDF at 1:200",
        )

    def test_the_scale_printed_is_the_scale_drawn(self):
        # The same property the SVG sheets are held to: the number in the
        # title block is the divisor actually applied to the geometry.
        stream = _streams(_write())[0]
        printed = int(re.search(r"\(1:(\d+)\)", stream).group(1))
        drawn = float(re.search(r"^([\d.]+) 0 0 [\d.]+ ", stream, re.M).group(1))
        self.assertAlmostEqual(drawn, MM_TO_PT / printed, places=6)

    def test_every_page_is_the_paper_size_it_claims(self):
        for size, (width, height) in SHEET_SIZES.items():
            raw = _write(sheet_size=size).read_bytes()
            self.assertIn(
                f"/MediaBox [0 0 {width * MM_TO_PT:.2f} "
                f"{height * MM_TO_PT:.2f}]".encode(),
                raw,
                f"{size} pages are not {width} x {height} mm",
            )

    def test_the_default_set_is_what_a_permit_set_is(self):
        # Site plan, floor plans, elevations, at least one section, and the
        # schedules. Asserted by what each page SAYS, never by counting them:
        # the comment here has claimed that since it was written and the test
        # counted anyway, so every added sheet has cost a round of debugging
        # an off-by-one instead of reading a name that was missing.
        # Case-insensitively: which floor a sheet is now comes from the
        # title block, which sets a sheet name in capitals, and the test
        # should not fail over a styling choice.
        joined = "\n".join(_streams(_write())).lower()
        for expected in ("site plan", "ground floor", "floor 1",
                         "elevation", "section a-a", "window schedule"):
            self.assertIn(expected, joined, f"the set has no {expected}")

        # One storey means one floor plan, and no "Floor 1".
        single = "\n".join(_streams(_write(building=_building(storeys=1)))).lower()
        for expected in ("site plan", "ground floor", "elevation",
                         "section a-a", "window schedule"):
            self.assertIn(expected, single, f"the set has no {expected}")
        self.assertNotIn("floor 1", single,
                         "a single-storey set has an upper floor plan")

    def test_a_building_with_no_roof_gets_no_elevation_or_section(self):
        # Both are drawn against the roof, so without one there is nothing
        # honest to draw rather than a flat-topped guess.
        # The schedules stay: they are the sizes of what IS drawn, and a
        # roofless model still has walls with holes in them.
        bare = _building(roof=False)
        joined = "\n".join(_streams(_write(building=bare)))
        self.assertNotIn("Elevation", joined)
        self.assertNotIn("Section A-A", joined)
        self.assertIn("SITE PLAN", joined)
        self.assertIn("WINDOW SCHEDULE", joined)


class TestNothingIsLostQuietly(unittest.TestCase):
    def test_an_operation_with_no_pdf_equivalent_raises(self):
        # A drawing missing a line it was asked to carry is the failure this
        # whole project is built to avoid, so it is loud rather than absent.
        from codraft.export.pdf import SheetError, _Stream, _emit

        stream = _Stream()
        skipped = _emit(stream, [("mystery", "wall-ext", 0.0, 0.0)], {}, 1.0)
        self.assertEqual(skipped, 1)

        building = _building()
        original = None
        try:
            from codraft.export import svg as svg_module
            original = svg_module._Canvas.line

            def sabotage(self, x0, y0, x1, y1, cls):
                original(self, x0, y0, x1, y1, cls)
                self.ops.append(("not-a-real-op", cls))

            svg_module._Canvas.line = sabotage
            with self.assertRaises(SheetError):
                _write(building=building)
        finally:
            if original is not None:
                svg_module._Canvas.line = original

    def test_the_title_block_reaches_every_page(self):
        block = TitleBlock(project="THE MURRAY", client="M. A. Bajwa",
                           job_number="CD-0001")
        for stream in _streams(_write(title=block)):
            self.assertIn("THE MURRAY", stream)
            self.assertIn("CD-0001", stream)
            self.assertIn("NOT FOR CONSTRUCTION", stream)

    def test_the_sheet_numbers_run_through_the_set(self):
        streams = _streams(_write())
        for number, stream in enumerate(streams, start=1):
            self.assertIn(f"({number} of {len(streams)})", stream)

    def test_an_em_dash_survives_rather_than_becoming_a_question_mark(self):
        # The base-14 fonts use WinAnsi, which HAS the em dash; encoding to
        # Latin-1 loses it and a sheet title reads "Ground floor ? plan".
        raw = _write().read_bytes()
        self.assertNotIn(b"Ground floor ?", raw)


class TestTheStylesheetIsShared(unittest.TestCase):
    def test_the_pdf_reads_the_svg_stylesheet(self):
        # One stylesheet, so a line weight changed in one place follows in
        # both formats rather than drifting.
        styles = parse_style(STYLE)
        self.assertIn("wall-ext", styles)
        self.assertEqual(styles["wall-ext"]["stroke-width"], "40")

    def test_wall_weight_in_the_pdf_comes_from_that_stylesheet(self):
        stream = _streams(_write())[0]
        self.assertIn("40.000 w", stream)


if __name__ == "__main__":
    unittest.main()
