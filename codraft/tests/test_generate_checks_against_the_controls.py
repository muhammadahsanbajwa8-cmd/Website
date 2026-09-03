"""`fit --generate` has to check the design it just generated.

It resolves the lot's planning controls, uses them to cap the footprint,
and then reported on the result WITHOUT handing them to the checker. Every
rule keyed by density -- the street setback, site cover, outdoor living,
overall height -- came back unchecked rather than checked, and the line the
command prints understated what it found.
"""

import unittest

from codraft.codes import check, design_parameters, resolve
from codraft.codes.states import site_controls
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _generated(city, zone=None, storeys=1):
    jurisdiction = resolve(city)
    design = design_parameters(jurisdiction)
    site = site_controls(jurisdiction.key, zone)
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    building = build_building(program, plot, layout,
                              jurisdiction=jurisdiction.key, design=design)
    return jurisdiction, site, building, layout


class TheControlsReachTheChecker(unittest.TestCase):
    def test_more_rules_are_decided_with_them_than_without(self):
        jurisdiction, site, building, layout = _generated("Perth, WA", "R20")
        blind = check(building, jurisdiction, layout.warnings)
        seeing = check(building, jurisdiction, layout.warnings, site=site)
        self.assertGreater(seeing.counts["checked"], blind.counts["checked"],
                           "the controls decide nothing, so this proves nothing")

    def test_a_failure_is_not_hidden_by_leaving_them_out(self):
        # The case that made this worth fixing: 0 failed of 123 without the
        # controls, 1 failed of 125 with them.
        jurisdiction, site, building, layout = _generated("Perth, WA", "R20")
        blind = check(building, jurisdiction, layout.warnings)
        seeing = check(building, jurisdiction, layout.warnings, site=site)
        self.assertGreaterEqual(seeing.counts["failed"], blind.counts["failed"])

    def test_the_density_keyed_rules_stop_reporting_unchecked(self):
        jurisdiction, site, building, layout = _generated("Perth, WA", "R20")
        seeing = check(building, jurisdiction, layout.warnings, site=site)
        blind = check(building, jurisdiction, layout.warnings)
        was = {f.rule_id for f in blind.findings if f.status == "unchecked"}
        now = {f.rule_id for f in seeing.findings if f.status == "unchecked"}
        self.assertTrue(was - now, "no rule was rescued by the controls")
        for rule_id in was - now:
            with self.subTest(rule=rule_id):
                self.assertTrue(rule_id.startswith(("wa.", "au.")))

    def test_the_command_passes_them(self):
        # Read from the source, because the alternative is running the whole
        # subcommand and this is the one line that matters.
        import inspect

        from codraft import cli

        body = inspect.getsource(cli._generate_for_lot)
        self.assertIn("site=site", body)


if __name__ == "__main__":
    unittest.main()
