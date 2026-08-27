"""The solver aims at the same habitable-room figures the baseline asserts.

`test_design_targets` checks that every target something is BUILT to is also
something the finished drawing is measured on, and deliberately does not
check that the two numbers agree -- a pack may aim above its jurisdiction's
law, and aiming high is not a defect.

This pair is the exception. `baseline`'s design block does not state a
practice higher than the rule; it states the SAME figure, because the rule
is what the solver is choosing plan forms against. Drift here would mean the
solver picking layouts by a number nothing checks, silently, which is the
failure mode the design-target test exists to catch everywhere else.
"""

from __future__ import annotations

import unittest

from codraft.codes.engine import load_pack
from codraft.layout.solver import _habitable_targets


def _asserted(rule_id: str) -> float:
    rule = next(r for r in load_pack("baseline").rules if r.id == rule_id)
    return float(rule.assertion.rsplit(">=", 1)[1])


class TestTheTargetsMatchTheRule(unittest.TestCase):
    def test_the_width_the_solver_aims_at_is_the_width_the_rule_asserts(self):
        width, _area = _habitable_targets()
        self.assertEqual(width, _asserted("baseline.habitable.width"))

    def test_the_area_the_solver_aims_at_is_the_area_the_rule_asserts(self):
        _width, area = _habitable_targets()
        self.assertEqual(area / 1e6, _asserted("baseline.habitable.area"))

    def test_they_are_actually_read_rather_than_defaulted_away(self):
        # The reader falls back to zero if the pack cannot be read, which
        # would quietly drop the habitable term out of the score.
        width, area = _habitable_targets()
        self.assertGreater(width, 0)
        self.assertGreater(area, 0)


if __name__ == "__main__":
    unittest.main()
