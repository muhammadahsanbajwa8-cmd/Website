"""Lengths must survive the trip from a brief to a drawing unchanged."""

import unittest

from codraft.units import UnitError, area_mm2, fmt_area, fmt_len, mm, to_m2


class TestLengths(unittest.TestCase):
    def test_metric(self):
        self.assertEqual(mm("3.5m"), 3500)
        self.assertEqual(mm("250cm"), 2500)
        self.assertEqual(mm("115mm"), 115)
        self.assertEqual(mm(2400), 2400)

    def test_imperial_is_exact(self):
        # An inch is exactly 25.4 mm. Anything else here means the conversion
        # went through a binary float and lost the last digit.
        self.assertEqual(mm("1in"), 25)
        self.assertEqual(mm("44in"), 1118)
        self.assertEqual(mm("32in"), 813)
        self.assertEqual(mm("7ft"), 2134)
        self.assertEqual(mm("12'6\""), 3810)
        self.assertEqual(mm("40ft"), 12192)

    def test_default_unit(self):
        self.assertEqual(mm("7.5", "in"), 191)
        self.assertEqual(mm("3", "m"), 3000)

    def test_bad_input(self):
        for bad in ("", "wide", "3 furlongs", None, []):
            with self.assertRaises(UnitError):
                mm(bad)


class TestAreas(unittest.TestCase):
    def test_areas(self):
        self.assertEqual(area_mm2("45m2"), 45_000_000)
        self.assertEqual(round(to_m2(area_mm2("100 sqft")), 2), 9.29)
        self.assertEqual(round(to_m2(area_mm2("70sqft")), 2), 6.50)

    def test_formatting(self):
        self.assertEqual(fmt_len(3500), "3.5 m")
        self.assertEqual(fmt_len(3000), "3 m")
        self.assertEqual(fmt_area(45_000_000), "45.0 m²")


if __name__ == "__main__":
    unittest.main()
