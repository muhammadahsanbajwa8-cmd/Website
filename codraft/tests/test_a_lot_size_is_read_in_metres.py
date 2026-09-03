"""`--lot 15x30` is fifteen metres by thirty, not by thirty millimetres.

The unit was read off the depth alone and applied to the WIDTH, while the
depth fell back to the units library's own default of millimetres. So
`--lot 15mx32m` parsed correctly -- which is the form the help text shows,
and why this survived -- and `--lot 15x30` produced a lot 15 m wide and 30
mm deep. The setbacks then consumed it, and the command reported that the
block was too small to build on rather than that it had not understood the
size, which is the worst way for a parse to fail.
"""

import unittest

from codraft.cli import _pair_of_lengths


class ALengthPairCarriesItsUnitAcrossBothHalves(unittest.TestCase):
    def test_a_bare_pair_is_metres(self):
        self.assertEqual(_pair_of_lengths("15x30"), (15000, 30000))

    def test_the_unit_on_the_depth_applies_to_the_width(self):
        self.assertEqual(_pair_of_lengths("15x32m"), (15000, 32000))

    def test_the_unit_on_the_width_applies_to_the_depth(self):
        self.assertEqual(_pair_of_lengths("15mx32"), (15000, 32000))

    def test_the_documented_form_still_reads(self):
        self.assertEqual(_pair_of_lengths("15mx32m"), (15000, 32000))

    def test_millimetres_are_still_available_when_asked_for(self):
        self.assertEqual(_pair_of_lengths("15000mmx30000mm"), (15000, 30000))

    def test_the_multiplication_sign_reads_like_an_x(self):
        self.assertEqual(_pair_of_lengths("15×30"), (15000, 30000))


if __name__ == "__main__":
    unittest.main()
