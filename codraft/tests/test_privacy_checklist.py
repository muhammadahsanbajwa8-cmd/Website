"""The values a privacy check runs on are on the list somebody has to confirm.

codraft checks visual privacy and reports on it -- 84 findings on a sweep of
sixty-seven Western Australian plans -- and none of the values it checks
against was on the checklist. The setbacks it carries are reproduced at
medium confidence and the pack says the table is amended regularly.

The two that matter most are the ones the R-Codes offer INSTEAD of a
setback: screening, and a sill above the height at which an opening stops
being a major opening. codraft models neither, so a plan that fails the
setback may still comply, and the finding has to say so rather than read as
a verdict.
"""

import unittest
from pathlib import Path

import yaml

from codraft.codes.engine import load_pack

ROOT = Path(__file__).resolve().parents[1]
STATES = ROOT / "rules" / "states"
CHECKLIST = ROOT / "rules" / "CHECKLIST.md"
WANTED = (
    "privacy.setback.bedroom",
    "privacy.setback.habitable",
    "privacy.setback.unenclosed",
    "privacy.sill_exempt_height",
    "privacy.screening",
)


def _rules(code):
    data = yaml.safe_load((STATES / f"{code}.yaml").read_text("utf-8"))
    return {r["id"]: r for r in data["rules"]}


class TestPrivacyIsOnTheList(unittest.TestCase):
    def test_every_state_carries_the_privacy_fields(self):
        for path in sorted(STATES.glob("*.yaml")):
            rules = _rules(path.stem)
            for key in WANTED:
                with self.subTest(state=path.stem, key=key):
                    self.assertIn(key, rules)

    def test_the_setbacks_wa_checks_against_are_the_ones_it_lists(self):
        # If the pack's figure and the checklist's drift apart, the report
        # measures against one number and asks somebody to confirm another.
        rules = _rules("wa")
        pack = {r.id: r for r in load_pack("au-wa-privacy").rules}
        for key, rule_id in (("privacy.setback.bedroom", "au.wa.privacy.bedroom"),
                             ("privacy.setback.habitable",
                              "au.wa.privacy.habitable")):
            with self.subTest(key=key):
                asserted = int("".join(c for c in pack[rule_id].assertion
                                       if c.isdigit()))
                self.assertEqual(rules[key]["value"], asserted)
                self.assertEqual(rules[key]["status"], "confirm")

    def test_nothing_invented_a_figure_for_the_remedies(self):
        # Screening and the sill height are what the R-Codes offer instead of
        # the setback, and nothing here knows either. TODO is the answer.
        for path in sorted(STATES.glob("*.yaml")):
            rules = _rules(path.stem)
            for key in ("privacy.sill_exempt_height", "privacy.screening"):
                with self.subTest(state=path.stem, key=key):
                    self.assertEqual(rules[key]["value"], "TODO")
                    self.assertEqual(rules[key]["status"], "missing")

    def test_the_checklist_lists_them(self):
        text = CHECKLIST.read_text("utf-8")
        for key in WANTED:
            self.assertIn(f"`{key}`", text)

    def test_the_finding_says_the_remedy_is_not_modelled(self):
        pack = {r.id: r for r in load_pack("au-wa-privacy").rules}
        for rule_id in ("au.wa.privacy.bedroom", "au.wa.privacy.habitable"):
            with self.subTest(rule=rule_id):
                note = pack[rule_id].note
                self.assertIn("screening", note.lower())
                self.assertIn("modelled here", note.lower())
                self.assertIn("checklist.md", note.lower())

    def test_no_state_but_wa_pretends_to_know_the_setbacks(self):
        for path in sorted(STATES.glob("*.yaml")):
            if path.stem == "wa":
                continue
            rules = _rules(path.stem)
            for key in ("privacy.setback.bedroom", "privacy.setback.habitable"):
                with self.subTest(state=path.stem, key=key):
                    self.assertEqual(rules[key]["value"], "TODO")


if __name__ == "__main__":
    unittest.main()
