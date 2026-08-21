"""The state rule skeletons, and the one rule they exist to enforce.

The brief these implement says it plainly: do not invent numeric values for
planning rules, scaffold the structure, leave values as TODO and print a
checklist of what a person has to confirm. That is the same rule the rest of
codraft runs on, so the tests here are about provenance rather than content.

A figure with no source is the failure mode. It reads as settled, it is not,
and nobody downstream can tell the difference.
"""

import subprocess
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
STATES = ROOT / "rules" / "states"
CHECKLIST = ROOT / "rules" / "CHECKLIST.md"

# Every state and territory the brief lists.
EXPECTED = {"nsw", "vic", "qld", "wa", "sa", "tas", "nt", "act"}


def _load():
    return {p.stem: yaml.safe_load(p.read_text(encoding="utf-8"))
            for p in sorted(STATES.glob("*.yaml"))}


class TestEveryJurisdictionHasAFile(unittest.TestCase):
    def test_all_eight_are_scaffolded(self):
        self.assertEqual(set(_load()), EXPECTED)

    def test_each_names_its_planning_instrument(self):
        for code, data in _load().items():
            self.assertTrue(data["planning_instrument"],
                            f"{code} does not say what governs it")
            self.assertNotEqual(data["planning_instrument"], "TODO")


class TestNoFigureAppearsWithoutASource(unittest.TestCase):
    """The whole point. A number with no provenance is worse than no number."""

    def test_every_value_that_exists_cites_something(self):
        for code, data in _load().items():
            for rule in data["rules"]:
                if rule["value"] in (None, "TODO"):
                    continue
                self.assertNotIn(
                    rule["source"], (None, "", "TODO"),
                    f"{code}:{rule['id']} carries a value with no source",
                )

    def test_a_missing_value_is_marked_missing_and_says_todo(self):
        for code, data in _load().items():
            for rule in data["rules"]:
                if rule["status"] == "missing":
                    self.assertEqual(
                        rule["value"], "TODO",
                        f"{code}:{rule['id']} is marked missing but has a value",
                    )

    def test_nothing_is_marked_confirmed_that_nobody_checked(self):
        # `confirmed` means a person read it off the instrument, and that
        # means a date. The generator may never emit it.
        for code, data in _load().items():
            for rule in data["rules"]:
                if rule["status"] == "confirmed":
                    self.assertIsNotNone(
                        rule["last_checked"],
                        f"{code}:{rule['id']} is confirmed with no date",
                    )

    def test_the_states_with_no_pack_carry_no_figures_at_all(self):
        # codraft has never held a planning figure for SA, TAS, NT or ACT.
        # If one appears in these files it was invented somewhere.
        for code in ("sa", "tas", "nt", "act"):
            data = _load()[code]
            planning = [
                r for r in data["rules"]
                if r["id"].startswith(("setback.", "site."))
            ]
            self.assertTrue(planning)
            for rule in planning:
                self.assertEqual(
                    rule["value"], "TODO",
                    f"{code}:{rule['id']} has a figure and no pack to take it "
                    "from -- it was invented",
                )


class TestEveryEntryHasTheShapeTheBriefAsksFor(unittest.TestCase):
    def test_id_description_value_source_last_checked(self):
        for code, data in _load().items():
            for rule in data["rules"]:
                for field in ("id", "description", "value", "source",
                              "last_checked", "status"):
                    self.assertIn(field, rule,
                                  f"{code}:{rule.get('id')} has no {field}")

    def test_statuses_are_from_the_known_set(self):
        for code, data in _load().items():
            for rule in data["rules"]:
                self.assertIn(rule["status"], ("confirmed", "confirm", "missing"))

    def test_the_same_ids_appear_in_every_state(self):
        # A field present for one state and absent for another is how a
        # jurisdiction quietly skips a check.
        loaded = _load()
        reference = [r["id"] for r in loaded["wa"]["rules"]]
        for code, data in loaded.items():
            self.assertEqual([r["id"] for r in data["rules"]], reference,
                             f"{code} has a different set of rule ids")


class TestTheGeneratorsAreTheSourceOfTruth(unittest.TestCase):
    def test_regenerating_keeps_what_a_person_supplied(self):
        # The states with no pack behind them are exactly the ones somebody
        # has to fill in by hand, so a generator that rewrote the file
        # wholesale would throw away the only figures that matter. It merges.
        import shutil
        import tempfile

        target = STATES / "sa.yaml"
        with tempfile.TemporaryDirectory() as tmp:
            backup = Path(tmp) / "sa.yaml"
            shutil.copy(target, backup)
            try:
                text = target.read_text(encoding="utf-8").replace(
                    "  - id: site.max_coverage\n"
                    '    description: "Maximum site coverage"\n'
                    "    unit: ratio\n"
                    "    value: TODO\n"
                    "    source: TODO\n"
                    "    last_checked: null\n"
                    "    status: missing",
                    "  - id: site.max_coverage\n"
                    '    description: "Maximum site coverage"\n'
                    "    unit: ratio\n"
                    "    value: 0.6\n"
                    '    source: "Planning and Design Code, checked by hand"\n'
                    "    last_checked: 2026-08-21\n"
                    "    status: confirmed",
                )
                target.write_text(text, encoding="utf-8")
                subprocess.run(
                    [sys.executable, "tools/build_state_rules.py"],
                    cwd=ROOT, check=True, capture_output=True,
                )
                after = yaml.safe_load(target.read_text(encoding="utf-8"))
                rule = next(r for r in after["rules"]
                            if r["id"] == "site.max_coverage")
                self.assertEqual(rule["value"], 0.6)
                self.assertEqual(rule["status"], "confirmed")
                self.assertIsNotNone(rule["last_checked"])
            finally:
                shutil.copy(backup, target)

    def test_the_checklist_lists_everything_outstanding(self):
        text = CHECKLIST.read_text(encoding="utf-8")
        outstanding = [
            r for data in _load().values() for r in data["rules"]
            if r["status"] != "confirmed"
        ]
        self.assertTrue(outstanding)
        for rule in outstanding[:40]:
            self.assertIn(f"`{rule['id']}`", text,
                          f"{rule['id']} is outstanding and not on the checklist")

    def test_the_checklist_says_nothing_was_guessed(self):
        text = CHECKLIST.read_text(encoding="utf-8")
        self.assertIn("has guessed any of these figures", text)


if __name__ == "__main__":
    unittest.main()


class TestEveryAustralianJurisdictionFindsItsFile(unittest.TestCase):
    """Slug drift is silent and it looks exactly like a missing figure.

    The registry abbreviates some subdivisions ('wa', 'sa', 'nt', 'act') and
    spells others out ('victoria', 'queensland', 'tasmania'). Splitting a key
    and trusting the middle part sent Melbourne and Brisbane to files that do
    not exist, so both were refused as though nobody had supplied their
    planning figures -- when in fact codraft has carried them all along.
    """

    def test_every_state_and_territory_resolves_to_a_file(self):
        from codraft.codes.jurisdiction import resolve
        from codraft.codes.states import state_of

        cities = {
            "Perth": "wa", "Sydney": "nsw", "Melbourne": "vic",
            "Brisbane": "qld", "Adelaide": "sa", "Hobart": "tas",
            "Darwin": "nt", "Canberra": "act",
        }
        for city, expected in cities.items():
            key = resolve(city).key
            self.assertEqual(
                state_of(key), expected,
                f"{city} resolves to {key!r}, which does not map to "
                f"rules/states/{expected}.yaml",
            )
            self.assertTrue((STATES / f"{expected}.yaml").exists())

    def test_the_states_with_packs_are_not_reported_as_missing(self):
        # WA, NSW, VIC and QLD have carried planning figures since long before
        # these files existed. If any of them reports its essentials missing,
        # something has stopped finding them.
        from codraft.codes.jurisdiction import resolve
        from codraft.codes.states import missing_essential

        for city in ("Perth", "Sydney", "Melbourne", "Brisbane"):
            self.assertEqual(
                missing_essential(resolve(city).key), [],
                f"{city} reports essential controls missing",
            )

    def test_the_states_without_packs_are_reported_as_missing(self):
        from codraft.codes.jurisdiction import resolve
        from codraft.codes.states import missing_essential

        for city in ("Adelaide", "Hobart", "Darwin", "Canberra"):
            self.assertTrue(
                missing_essential(resolve(city).key),
                f"{city} has no pack and no supplied figures, yet reports "
                "nothing missing -- a plan there would be drawn on nothing",
            )

    def test_somewhere_outside_australia_is_unaffected(self):
        from codraft.codes.jurisdiction import resolve
        from codraft.codes.states import missing_essential, state_of

        key = resolve("Lahore").key
        self.assertIsNone(state_of(key))
        self.assertEqual(missing_essential(key), [])
