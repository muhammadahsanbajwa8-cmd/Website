"""Reading drawings back in. The rule under test: transcribe, never estimate."""

import tempfile
import unittest
from pathlib import Path

from codraft.ingest import PdfError, read_pdf
from codraft.ingest.pdfread import merge_runs, TextRun
from codraft.ingest.survey import _parse_dimension, survey_page, survey_pdf


def _pdf(content: str, media_box: str = "[0 0 595 842]") -> bytes:
    """A minimal, uncompressed PDF carrying one content stream.

    Written out by hand so the tests do not depend on a PDF library or on
    a fixture file whose contents could drift.
    """
    payload = content.encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            "<< /Type /Page /Parent 2 0 R /MediaBox " + media_box +
            " /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ).encode("latin-1"),
        b"<< /Length " + str(len(payload)).encode() + b" >>\nstream\n"
        + payload + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    for index, body in enumerate(objects, start=1):
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    out += b"trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n"
    return bytes(out)


def _write(content: str, **kwargs) -> Path:
    handle = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    handle.write(_pdf(content, **kwargs))
    handle.close()
    return Path(handle.name)


# At 1:100, one point is 100 * 25.4 / 72 = 35.2778 mm. So a 200 pt line is
# 7056 mm, a 150 pt line is 5292 mm and a 100 pt line is 3528 mm. The sheet
# states the scale AND carries dimensions that corroborate it, which is what
# the reader now requires before it will measure anything.
DIMENSIONED = """
1 w
100 100 m 300 100 l S
BT /F1 10 Tf 190 108 Td (7056) Tj ET
100 200 m 250 200 l S
BT /F1 10 Tf 165 208 Td (5292) Tj ET
100 300 m 200 300 l S
BT /F1 10 Tf 140 308 Td (3528) Tj ET
BT /F1 10 Tf 400 500 Td (SCALE 1:100) Tj ET
BT /F1 10 Tf 150 600 Td (Bedroom) Tj ET
100 400 m 300 400 l S
100 411 m 300 411 l S
"""

# States a scale, but nothing on the page corroborates it.
UNCORROBORATED = """
1 w
100 100 m 300 100 l S
BT /F1 10 Tf 190 108 Td (12345) Tj ET
BT /F1 10 Tf 190 118 Td (23456) Tj ET
BT /F1 10 Tf 190 128 Td (34567) Tj ET
BT /F1 10 Tf 400 500 Td (SCALE 1:100) Tj ET
"""

# A site plan's worth of reduced levels, which look just like dimensions.
LEVELS = """
1 w
100 100 m 300 100 l S
BT /F1 10 Tf 190 108 Td (7056) Tj ET
BT /F1 10 Tf 120 200 Td (33.03) Tj ET
BT /F1 10 Tf 140 210 Td (32.85) Tj ET
BT /F1 10 Tf 160 220 Td (33.25) Tj ET
BT /F1 10 Tf 180 230 Td (32.59) Tj ET
BT /F1 10 Tf 200 240 Td (33.11) Tj ET
BT /F1 10 Tf 220 250 Td (32.94) Tj ET
BT /F1 10 Tf 400 500 Td (SCALE 1:100) Tj ET
"""


class TestPdfReading(unittest.TestCase):
    def test_reads_lines_and_text(self):
        path = _write(DIMENSIONED)
        try:
            document = read_pdf(path)
            self.assertEqual(len(document.pages), 1)
            page = document.pages[0]
            self.assertEqual(round(page.width), 595)
            self.assertGreaterEqual(len(page.segments), 3)
            self.assertIn("7056", [t.text.strip() for t in page.texts])
            self.assertIn("Bedroom", [t.text.strip() for t in page.texts])
        finally:
            path.unlink()

    def test_segment_geometry_is_recovered_exactly(self):
        path = _write(DIMENSIONED)
        try:
            page = read_pdf(path).pages[0]
            horizontals = [s for s in page.segments if s.horizontal]
            self.assertTrue(
                any(abs(s.length - 200) < 0.01 for s in horizontals),
                "the 200 pt line was not recovered at its drawn length",
            )
        finally:
            path.unlink()

    def test_a_non_pdf_is_refused_clearly(self):
        handle = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        handle.write(b"this is not a pdf")
        handle.close()
        try:
            with self.assertRaises(PdfError) as caught:
                read_pdf(handle.name)
            self.assertIn("%PDF", str(caught.exception))
        finally:
            Path(handle.name).unlink()

    def test_merging_rebuilds_words_from_glyph_runs(self):
        # Producers emit text a glyph at a time to control kerning, which is
        # why "3653" arrives as four separate runs.
        runs = [
            TextRun("3", 100.0, 200.0, 10.0),
            TextRun("6", 104.6, 200.0, 10.0),
            TextRun("5", 109.2, 200.0, 10.0),
            TextRun("3", 113.8, 200.0, 10.0),
            TextRun("Living", 300.0, 200.0, 10.0),
        ]
        merged = [t.text for t in merge_runs(runs)]
        self.assertIn("3653", merged)
        self.assertIn("Living", merged)


class TestDimensionParsing(unittest.TestCase):
    def test_metric(self):
        self.assertEqual(_parse_dimension("3653"), 3653)
        self.assertEqual(_parse_dimension("8254"), 8254)
        self.assertEqual(_parse_dimension("3.5 m"), 3500)

    def test_imperial(self):
        self.assertAlmostEqual(_parse_dimension("10'-0\""), 3048, places=0)
        self.assertAlmostEqual(_parse_dimension("12'-6\""), 3810, places=0)

    def test_things_that_are_not_dimensions(self):
        # Room numbers, levels and note references are not dimensions, and
        # treating one as a dimension corrupts the scale for the whole page.
        for text in ("12", "A", "Bedroom", "", "1:50", "99"):
            self.assertIsNone(_parse_dimension(text), text)


class TestScale(unittest.TestCase):
    def test_scale_needs_both_a_statement_and_corroboration(self):
        path = _write(DIMENSIONED)
        try:
            survey = survey_page(read_pdf(path).pages[0])
            self.assertTrue(survey.has_scale, survey.scale_note)
            self.assertAlmostEqual(survey.scale_mm_per_pt, 35.2778, places=2)
            self.assertEqual(survey.scale_ratio, "1:100")
        finally:
            path.unlink()

    def test_a_stated_scale_alone_is_not_enough(self):
        # The failure this guards against: an earlier version matched each
        # dimension to its nearest line and reported 1:1249 on a sheet drawn
        # at 1:200. A scale nothing corroborates is reported as unknown.
        path = _write(UNCORROBORATED)
        try:
            survey = survey_page(read_pdf(path).pages[0])
            self.assertFalse(survey.has_scale)
            self.assertIn("1:100", survey.scale_note)
            self.assertIn("No measurement is offered", survey.scale_note)
        finally:
            path.unlink()

    def test_survey_levels_are_not_treated_as_dimensions(self):
        # A site plan is covered in reduced levels that parse as metric
        # dimensions. Feeding them to the scale check pulls it badly off.
        path = _write(LEVELS)
        try:
            survey = survey_page(read_pdf(path).pages[0])
            self.assertTrue(
                any("survey levels" in w for w in survey.warnings),
                f"levels were not set aside: {survey.warnings}",
            )
        finally:
            path.unlink()

    def test_no_dimensions_means_no_scale_and_no_guessing(self):
        # The failure that matters: a page with geometry but no dimensions
        # must yield no measurements at all, not measurements inferred from
        # the paper size.
        path = _write("1 w\n100 100 m 300 100 l S\n100 111 m 300 111 l S\n")
        try:
            survey = survey_page(read_pdf(path).pages[0])
            self.assertFalse(survey.has_scale)
            self.assertEqual(survey.walls, [])
            self.assertIn("guess a scale", survey.scale_note)
        finally:
            path.unlink()

    def test_walls_are_found_as_parallel_pairs(self):
        path = _write(DIMENSIONED)
        try:
            survey = survey_page(read_pdf(path).pages[0])
            # The pair 11 pt apart at 35.28 mm/pt is a 388 mm wall.
            self.assertTrue(survey.walls, "no wall candidate found")
            self.assertTrue(
                any(370 <= w.thickness_mm <= 400 for w in survey.walls),
                f"expected a ~388 mm wall, got "
                f"{[w.thickness_mm for w in survey.walls]}",
            )
        finally:
            path.unlink()

    def test_a_scan_is_identified_as_one(self):
        path = _write("")
        try:
            document = read_pdf(path)
            self.assertTrue(document.looks_like_a_scan)
            self.assertTrue(
                any("scan" in w for w in document.warnings),
                "an empty page was not reported as a scan or image",
            )
        finally:
            path.unlink()


if __name__ == "__main__":
    unittest.main()
