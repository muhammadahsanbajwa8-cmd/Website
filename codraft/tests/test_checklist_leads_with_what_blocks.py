"""The checklist has to say which of its 152 rows actually matter."""

import subprocess
import sys
import unittest
from pathlib import Path

from codraft.codes.states import missing_essential

ROOT = Path(__file__).resolve().parent.parent
CHECKLIST = ROOT / "rules" / "CHECKLIST.md"
STATES = ("act", "nsw", "nt", "qld", "sa", "tas", "vic", "wa")


class TheChecklistLeadsWithWhatBlocks(unittest.TestCase):
    def setUp(self):
        self.text = CHECKLIST.read_text(encoding="utf-8")
        self.head = self.text.split("## Missing")[0]

    def test_it_is_regenerated_from_the_yaml(self):
        # Written by the tool, never by hand, so it cannot drift from the
        # files it describes.
        before = self.text
        subprocess.run([sys.executable, "tools/build_checklist.py"],
                       cwd=ROOT, check=True, capture_output=True)
        self.assertEqual(CHECKLIST.read_text(encoding="utf-8"), before,
                         "CHECKLIST.md is out of step with rules/states/*.yaml")

    def test_a_state_that_cannot_plan_for_a_location_is_named_up_front(self):
        blocked = {c for c in STATES if missing_essential(f"AU-{c.upper()}")}
        self.assertTrue(blocked, "no state is blocked; this test proves nothing")
        for code in blocked:
            with self.subTest(state=code):
                self.assertIn(f"(`{code}`)", self.head,
                              f"{code} cannot draw and the summary omits it")

    def test_a_state_that_can_plan_is_not_in_the_blocking_table(self):
        table = self.head.split("| state |")[-1] if "| state |" in self.head else ""
        for code in STATES:
            if missing_essential(f"AU-{code.upper()}"):
                continue
            with self.subTest(state=code):
                self.assertNotIn(f"(`{code}`)", table,
                                 f"{code} plans today and is listed as blocked")

    def test_it_names_the_figures_rather_than_a_count(self):
        # "five values" is not actionable; the ids are.
        for key in ("setback.front", "site.max_coverage"):
            self.assertIn(f"`{key}`", self.head)

    def test_it_does_not_claim_a_drawing_is_impossible(self):
        # A caller that supplies its own setbacks still gets a plan. What it
        # does not get is the state's controls applied to it, and the
        # checklist has to say which of those two it means.
        self.assertIn("supplies its own setbacks still gets a drawing",
                      self.head)


if __name__ == "__main__":
    unittest.main()
