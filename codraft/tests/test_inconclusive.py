"""A failure only means something if the rule could only have been met the
way it was tested.

Part 10.6 is satisfied by natural ventilation OR by a mechanical system. The
model carries windows; it carries no exhaust fans, ducts or flow rates. So a
wet room falling short of 5% openable area is not evidence of non-compliance
-- the other route was never looked at. Reporting a violation there asserts
more than has been established.

The danger in that reasoning is that it becomes a loophole, so the tests that
matter most here are the ones that show it has NOT swallowed anything: a
windowless bedroom still fails, a kitchen still fails, and a room that meets
the rule naturally still passes rather than being excused.
"""

import unittest

from codraft.codes import check
from codraft.codes.engine import Rule, RuleError
from codraft.codes.jurisdiction import resolve
from codraft.codes.report import (
    STATUS_PASS,
    STATUS_UNCHECKED,
)
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _report(bedrooms=4, storeys=2, width=15000, depth=30000):
    program = template("au-house", bedrooms=bedrooms, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    building = build_building(program, plot, layout)
    return check(building, resolve("Perth"), layout.warnings)


def _ventilation(report):
    return [f for f in report.findings if f.rule_id == "au.h.ventilation"]


class TestAWetRoomsShortfallIsNotAFinding(unittest.TestCase):
    def test_wet_rooms_short_of_natural_air_are_unchecked(self):
        findings = _ventilation(_report())
        unchecked = [f for f in findings if f.status == STATUS_UNCHECKED]
        self.assertTrue(
            unchecked,
            "no wet room was reported as unchecked; either the plan changed or "
            "the inconclusive path stopped firing",
        )

    def test_unchecked_is_not_counted_as_a_pass(self):
        report = _report()
        unchecked = [f for f in _ventilation(report) if f.status == STATUS_UNCHECKED]
        for finding in unchecked:
            self.assertNotIn(finding, report.passes)
            self.assertNotIn(finding, report.failures)

    def test_every_unchecked_finding_says_why(self):
        # "Unchecked" with no reason is a shrug, and reads to a builder as
        # though the tool simply did not bother.
        for finding in _report().unchecked:
            self.assertTrue(
                finding.reason.strip(),
                f"{finding.rule_id} on {finding.subject} was left unchecked "
                "with no reason given",
            )

    def test_the_reason_says_plainly_that_it_is_not_a_pass(self):
        reasons = [f.reason for f in _report().unchecked
                   if f.rule_id == "au.h.ventilation"]
        self.assertTrue(reasons)
        for reason in reasons:
            self.assertIn("NOT a pass", reason)
            self.assertIn("mechanical", reason.lower())


class TestItIsNotALoophole(unittest.TestCase):
    """The whole risk of this change is that it excuses real failures."""

    def test_a_habitable_room_is_never_excused(self):
        # A bedroom is not wet, so a ventilation shortfall there stays a
        # violation. Mechanical exhaust is not an answer to a bedroom.
        for finding in _ventilation(_report()):
            if finding.status != STATUS_UNCHECKED:
                continue
            self.assertNotIn(
                "Bed", finding.subject,
                f"a bedroom ({finding.subject}) was excused from ventilation",
            )
            self.assertNotIn("Master", finding.subject)

    def test_a_kitchen_is_never_excused(self):
        # A kitchen is wet AND habitable, and it is the habitable half that
        # decides. The condition is "is_wet and not is_habitable" for exactly
        # this case.
        for finding in _ventilation(_report()):
            if finding.status == STATUS_UNCHECKED:
                self.assertNotIn("Kitchen", finding.subject)

    def test_natural_light_is_untouched(self):
        # Daylight cannot be provided mechanically, so that rule has no second
        # route and no case for being inconclusive.
        light = [f for f in _report().findings if f.rule_id == "au.h.light"]
        for finding in light:
            self.assertNotEqual(
                finding.status, STATUS_UNCHECKED,
                "a daylight rule was marked inconclusive; there is no "
                "mechanical alternative to a window",
            )

    def test_a_room_that_meets_the_rule_naturally_still_passes(self):
        # The inconclusive path runs only after a failure. A wet room with
        # enough openable area is a pass, not an excuse.
        passes = [f for f in _ventilation(_report()) if f.status == STATUS_PASS]
        self.assertTrue(
            passes,
            "no room passed ventilation naturally; the inconclusive path has "
            "swallowed the passes as well as the failures",
        )


class TestTheRuleFormatDemandsAReason(unittest.TestCase):
    def test_inconclusive_without_a_reason_is_refused_at_load(self):
        with self.assertRaises(RuleError) as caught:
            Rule.from_dict(
                {"id": "x.y", "scope": "space", "assert": "True",
                 "inconclusive_when": "is_wet"},
                pack="test",
            )
        self.assertIn("inconclusive_reason", str(caught.exception))

    def test_a_rule_without_the_field_behaves_as_before(self):
        rule = Rule.from_dict(
            {"id": "x.y", "scope": "space", "assert": "True"}, pack="test"
        )
        self.assertEqual(rule.inconclusive_when, "")


if __name__ == "__main__":
    unittest.main()
