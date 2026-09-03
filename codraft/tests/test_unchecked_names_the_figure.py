"""An unchecked rule has to name the figure that would settle it.

"the model carries no fact called 'max_height_mm'" is true and useless to
anybody who has not read `codes/facts.py`. The same gap has a name in
`rules/CHECKLIST.md`, which is the file a builder is pointed at.
"""

import unittest

from codraft.codes import check, design_parameters, resolve
from codraft.codes.report import _where_to_find
from codraft.codes.states import site_controls
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _report(city, zone=None, with_site=True):
    jurisdiction = resolve(city)
    design = design_parameters(jurisdiction)
    site = site_controls(jurisdiction.key, zone) if with_site else None
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    building = build_building(program, plot, layout,
                              jurisdiction=jurisdiction.key, design=design)
    return check(building, jurisdiction, layout.warnings, site=site,
                 unsatisfied=layout.unsatisfied)


def _missing_fact_reasons(report):
    return [f.reason for f in report.findings
            if f.status == "unchecked" and "no fact called" in (f.reason or "")]


class TheReasonNamesTheChecklistId(unittest.TestCase):
    def test_a_figure_nobody_has_supplied_says_so(self):
        reasons = _missing_fact_reasons(_report("Perth, WA", "R20"))
        self.assertTrue(reasons, "nothing was unchecked; this proves nothing")
        for reason in reasons:
            with self.subTest(reason=reason[:60]):
                self.assertIn("rules/CHECKLIST.md", reason)
                self.assertIn("nobody has supplied it", reason)

    def test_it_quotes_an_id_the_checklist_actually_carries(self):
        from pathlib import Path
        import re

        checklist = (Path(__file__).resolve().parent.parent
                     / "rules" / "CHECKLIST.md").read_text(encoding="utf-8")
        for reason in _missing_fact_reasons(_report("Perth, WA", "R20")):
            found = re.search(r"That figure is `([^`]+)`", reason)
            self.assertIsNotNone(found, reason)
            with self.subTest(key=found.group(1)):
                self.assertIn(f"`{found.group(1)}`", checklist)

    def test_a_figure_that_exists_but_was_not_passed_says_that_instead(self):
        # Two different problems, and the reader cannot tell them apart from
        # "no fact called X".
        reasons = _missing_fact_reasons(_report("Perth, WA", with_site=False))
        supplied = [r for r in reasons if "was not passed to the check" in r]
        self.assertTrue(supplied,
                        "no rule reported a figure that exists but was withheld")

    def test_a_fact_that_is_not_a_planning_control_adds_nothing(self):
        # Only site controls have a checklist id. Anything else gets the bare
        # reason rather than a guess at where to look.
        self.assertEqual(_where_to_find("some_fact_nobody_declares"), "")
        self.assertEqual(_where_to_find("overall_height_mm"), "")

    def test_the_two_hops_are_read_and_not_written_down_again(self):
        from codraft.codes.facts import FROM_SITE_CONTROLS
        from codraft.codes.states import _SITE_KEYS

        for fact, control in FROM_SITE_CONTROLS.items():
            with self.subTest(fact=fact):
                # Every fact a rule can ask for traces to a checklist id, or
                # the reason has nothing to offer and should say nothing.
                ids = [k for k, v in _SITE_KEYS.items() if v == control]
                self.assertLessEqual(len(ids), 1, f"{control} has two ids")


if __name__ == "__main__":
    unittest.main()
