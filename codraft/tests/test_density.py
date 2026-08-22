"""Western Australia's controls are keyed by density, and the rules must be too.

The R-Codes are not one set of numbers. R20 wants 6 m to the street and caps
site cover at half the lot; R60 wants 2 m and allows seven tenths. The solver
already built to whichever code the lot carries -- and then two rules checked
the result against R20's figures whatever the lot was.

So a plan built exactly to the R-Codes came back reported as breaching them:
three of the four densities produced violations on controls they met, and only
R20 was clean because R20's numbers were the ones hardcoded. A false violation
is worse than a missing check. It tells a builder to redraw a compliant plan,
and it spends the credibility that makes the true findings worth reading.
"""

import unittest

from codraft import codes
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template

PERTH = codes.resolve("Perth")
DENSITIES = ("R20", "R25", "R30", "R40", "R60", "R80")


def _site(zone):
    return {k: v for k, v
            in codes.site_parameters(PERTH, "residential", zone).items()
            if not k.startswith("$")}


def _built(zone):
    site = _site(zone)
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=int(site["setback_front_mm"]),
                setback_rear=int(site["setback_rear_mm"]),
                setback_left=int(site["setback_left_mm"]),
                setback_right=int(site["setback_right_mm"]))
    layout = solve(program, plot,
                   max_footprint=int(plot.area * site["max_coverage_ratio"]))
    building = build_building(program, plot, layout, jurisdiction=PERTH.key)
    return building, layout, site


class TestAPlanBuiltToTheCodePassesTheCode(unittest.TestCase):
    def test_no_density_reports_a_violation_of_a_control_it_was_built_to(self):
        for zone in DENSITIES:
            building, layout, site = _built(zone)
            report = codes.check(building, PERTH, layout.warnings, site=site)
            offenders = [f.rule_id for f in report.violations
                         if f.rule_id in ("wa.site.cover", "wa.setback.front")]
            with self.subTest(zone=zone):
                self.assertEqual(offenders, [])

    def test_the_densities_really_do_differ(self):
        # If they did not, the test above would prove nothing.
        fronts = {_site(z)["setback_front_mm"] for z in DENSITIES}
        covers = {_site(z)["max_coverage_ratio"] for z in DENSITIES}
        self.assertGreater(len(fronts), 1)
        self.assertGreater(len(covers), 1)

    def test_a_plan_that_does_breach_the_setback_is_still_caught(self):
        # The fix must not have turned the rule off.
        building, layout, site = _built("R20")
        tightened = {**site, "setback_front_mm": 9000}
        report = codes.check(building, PERTH, layout.warnings, site=tightened)
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.setback.front")
        self.assertEqual(finding.status, "fail")

    def test_a_plan_that_does_breach_the_cover_cap_is_still_caught(self):
        building, layout, site = _built("R80")
        tightened = {**site, "max_coverage_ratio": 0.2}
        report = codes.check(building, PERTH, layout.warnings, site=tightened)
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.site.cover")
        self.assertEqual(finding.status, "fail")


class TestWithoutADensityItSaysSo(unittest.TestCase):
    """R20 and R60 are different buildings on the same lot.

    Answering without the code is answering a different question, so the
    rules report unchecked rather than falling back on a figure nobody
    supplied -- which is what they used to do, silently.
    """

    def test_both_rules_report_unchecked_rather_than_a_default(self):
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=1000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout,
                                  jurisdiction=PERTH.key)
        report = codes.check(building, PERTH, layout.warnings)
        for rule_id in ("wa.site.cover", "wa.setback.front"):
            finding = next(f for f in report.findings
                           if f.rule_id == rule_id)
            with self.subTest(rule=rule_id):
                self.assertEqual(finding.status, "unchecked")
                self.assertIn("no fact called", finding.reason)

    def test_unchecked_is_not_counted_as_a_pass(self):
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=1000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout,
                                  jurisdiction=PERTH.key)
        report = codes.check(building, PERTH, layout.warnings)
        passed = {f.rule_id for f in report.passes}
        self.assertNotIn("wa.site.cover", passed)
        self.assertNotIn("wa.setback.front", passed)
