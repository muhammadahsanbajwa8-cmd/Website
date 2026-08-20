"""Reading a builder's spreadsheet, and the four ways it lies to you.

Every one of these tests came from a row in a plausible catalogue that would
have imported silently and wrongly. The importer's job is not to read as many
rows as possible -- it is to read the ones it can and name the ones it
cannot, because forty designs of which six are quietly wrong is worse than
thirty-four and a list.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft.library.catalogue import (
    PLAUSIBLE_WIDTH_MM,
    SQUARE_M2,
    UnitError,
    length_mm,
    read_catalogue,
)


def _read(text: str, **kwargs):
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "range.csv"
        path.write_text(text, encoding="utf-8")
        return read_catalogue(path, **kwargs)


class TestUnitsAreNeverGuessed(unittest.TestCase):
    def test_an_explicit_unit_is_honoured(self):
        self.assertEqual(length_mm("12.5 m", "w"), 12500)
        self.assertEqual(length_mm("12500mm", "w"), 12500)
        self.assertEqual(length_mm("1250cm", "w"), 12500)

    def test_magnitude_settles_the_clear_cases(self):
        self.assertEqual(length_mm("12.5", "w"), 12500)
        self.assertEqual(length_mm("12500", "w"), 12500)

    def test_the_ambiguous_middle_is_refused(self):
        # 250 mm is not a house and 250 m is not a lot. Picking one produces a
        # number that looks right and is out by a factor of a thousand --
        # which is the same fault as reading a drawing's scale wrong.
        with self.assertRaises(UnitError) as caught:
            length_mm("250", "frontage width")
        self.assertIn("does not settle it", str(caught.exception))

    def test_a_unit_in_the_column_heading_is_used(self):
        report = _read(
            "Design,Min Lot Width (m),Min Lot Depth (m)\nThe Murray,12.5,28\n"
        )
        self.assertEqual(len(report.imported), 1)
        self.assertEqual(report.imported[0].width_mm, 12500)

    def test_a_column_heading_does_not_override_an_obvious_millimetre(self):
        # A sheet whose heading says metres but whose cells are millimetres is
        # common -- somebody changed the units and not the heading. 16000 m is
        # not a frontage; 16000 mm is.
        report = _read("Design,Width (m),Depth (m)\nThe Grange,16000,32000\n")
        self.assertEqual(len(report.imported), 1)
        self.assertEqual(report.imported[0].width_mm, 16000)
        self.assertEqual(report.imported[0].depth_mm, 32000)

    def test_a_value_outside_any_plausible_band_is_refused(self):
        low, high = PLAUSIBLE_WIDTH_MM
        with self.assertRaises(UnitError):
            length_mm(str(high * 10), "frontage width")


class TestSquares(unittest.TestCase):
    def test_a_square_is_exactly_a_hundred_square_feet(self):
        # A foot is exactly 0.3048 m by international agreement, so this is
        # exact rather than a rounded conversion.
        self.assertAlmostEqual(SQUARE_M2, 100 * 0.3048 ** 2, places=9)

    def test_squares_convert_when_no_area_is_given(self):
        report = _read("Design,Width,Depth,Squares\nThe Hamilton,14,26,21\n")
        design = report.imported[0]
        self.assertAlmostEqual(design.total_m2, round(21 * SQUARE_M2, 1), places=1)
        self.assertTrue(any("squares converted" in n for n in design.notes))

    def test_a_disagreement_between_squares_and_area_is_reported(self):
        # Both columns given and they do not agree means the sheet is wrong
        # somewhere. Say which was used rather than silently preferring one.
        report = _read(
            "Design,Width,Depth,Squares,Total Area\nThe Coastal,12.5,28,25,300\n"
        )
        design = report.imported[0]
        self.assertEqual(design.total_m2, 300.0)
        self.assertTrue(any("disagree" in n for n in design.notes))

    def test_squares_and_area_that_agree_raise_nothing(self):
        report = _read(
            "Design,Width,Depth,Squares,Total Area\nThe Murray,12.5,28,25,232.3\n"
        )
        self.assertFalse(any("disagree" in n for n in report.imported[0].notes))


class TestARowThatCannotBeFittedIsNotImported(unittest.TestCase):
    def test_a_row_with_no_name_is_skipped_by_line_number(self):
        report = _read("Design,Width,Depth\n,12.5,28\n")
        self.assertEqual(report.imported, [])
        self.assertTrue(any("line 2" in s for s in report.skipped))

    def test_a_row_with_no_dimensions_is_skipped(self):
        report = _read("Design,Width,Depth\nThe Murray,,\n")
        self.assertEqual(report.imported, [])
        self.assertEqual(len(report.skipped), 1)

    def test_good_rows_survive_a_bad_neighbour(self):
        report = _read(
            "Design,Width,Depth\nThe Murray,12.5,28\nBad,250,28\nThe Trio,10.5,30\n"
        )
        self.assertEqual([d.name for d in report.imported], ["The Murray", "The Trio"])
        self.assertEqual(len(report.skipped), 1)


class TestTheReportSaysWhatItDidAndDidNotUnderstand(unittest.TestCase):
    def test_unrecognised_columns_are_named(self):
        # A column called "Min Lot Width" that was silently ignored is the
        # difference between a catalogue that fits blocks and one that does
        # not, so the ignored ones are listed by name.
        report = _read("Design,Width,Depth,Facade Options\nThe Murray,12.5,28,3\n")
        self.assertIn("Facade Options", report.ignored_columns)
        self.assertTrue(any("ignored" in line for line in report.summary()))

    def test_missing_bedroom_counts_are_called_out(self):
        report = _read("Design,Width,Depth\nThe Murray,12.5,28\n")
        self.assertTrue(any("bedroom" in n for n in report.notes))

    def test_the_source_line_is_recorded_on_each_design(self):
        report = _read("Design,Width,Depth\nThe Murray,12.5,28\n")
        self.assertIn("line 2", report.imported[0].source)


class TestLotDimensionsAreNotHouseDimensions(unittest.TestCase):
    """A minimum lot width already contains the setbacks."""

    def test_a_lot_only_row_is_marked_and_warned_about(self):
        report = _read(
            "Design,Min Lot Width (m),Min Lot Depth (m)\nThe Murray,12.5,28\n"
        )
        design = report.imported[0]
        self.assertTrue(
            any("MINIMUM LOT dimensions" in n for n in design.notes),
            "a lot dimension was imported as a house dimension with no note",
        )
        self.assertTrue(any("WARNING" in n for n in report.notes))

    def test_a_house_dimension_wins_over_a_lot_one(self):
        report = _read(
            "Design,Width,Depth,Min Lot Width,Min Lot Depth\n"
            "The Murray,10.5,24,12.5,28\n"
        )
        design = report.imported[0]
        self.assertEqual((design.width_mm, design.depth_mm), (10500, 24000))
        self.assertFalse(any("MINIMUM LOT" in n for n in design.notes))

    def test_a_house_only_row_raises_no_warning(self):
        report = _read("Design,Width,Depth\nThe Murray,12.5,28\n")
        self.assertFalse(any("WARNING" in n for n in report.notes))


class TestTheShippedExample(unittest.TestCase):
    def test_examples_builder_range_reads_as_documented(self):
        path = Path(__file__).resolve().parent.parent / "examples" / "builder-range.csv"
        report = read_catalogue(path)
        self.assertEqual(report.rows, 7)
        self.assertEqual(len(report.imported), 5)
        self.assertEqual(len(report.skipped), 2)


if __name__ == "__main__":
    unittest.main()
