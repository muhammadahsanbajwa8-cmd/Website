"""The codes layer is the one that must never overstate what it knows."""

import unittest

from codraft import codes
from codraft.codes.engine import RuleError, evaluate_expression, load_pack
from codraft.codes.jurisdiction import JurisdictionError, registry, resolve


class TestResolution(unittest.TestCase):
    def test_city_beats_country(self):
        j = resolve("Lahore")
        self.assertEqual(j.key, "PK-punjab-lahore")
        self.assertIn("Lahore Development Authority", j.authority)

    def test_word_boundaries(self):
        # 'Mali' is a substring of 'Somalia' and 'Oman' of 'Romania'.
        # Resolving to the wrong country is the worst bug this module has.
        self.assertEqual(resolve("Somalia").country, "SO")
        self.assertEqual(resolve("Mali").country, "ML")
        self.assertEqual(resolve("Romania").country, "RO")
        self.assertEqual(resolve("Oman").country, "OM")
        self.assertEqual(resolve("Niger").country, "NE")
        self.assertEqual(resolve("Nigeria").country, "NG")

    def test_iso_code(self):
        self.assertEqual(resolve("PK").country, "PK")
        self.assertEqual(resolve("US").country, "US")

    def test_unknown_place_is_an_error_not_a_guess(self):
        with self.assertRaises(JurisdictionError):
            resolve("Atlantis")
        with self.assertRaises(JurisdictionError):
            resolve("")

    def test_a_subdivision_can_drop_an_inherited_pack(self):
        # Scotland is under GB, but the Approved Documents do not apply there.
        self.assertIn("uk-approved-documents", resolve("England").rule_packs)
        self.assertNotIn("uk-approved-documents", resolve("Scotland").rule_packs)

    def test_unencoded_countries_say_so(self):
        j = resolve("SO")
        self.assertFalse(j.is_encoded)
        self.assertIn("No rule pack is encoded", j.caveat())


class TestRegistry(unittest.TestCase):
    def test_every_country_is_complete(self):
        for iso, country in registry()["countries"].items():
            self.assertRegex(iso, r"^[A-Z]{2}$")
            for field in ("name", "region", "regime", "rule_packs", "confidence"):
                self.assertIn(field, country, f"{iso} is missing {field}")
            self.assertIn("baseline", country["rule_packs"],
                          f"{iso} does not fall back to the baseline")

    def test_every_referenced_pack_exists(self):
        available = set(codes.available_packs())
        for iso, country in registry()["countries"].items():
            for pack in country["rule_packs"]:
                self.assertIn(pack, available, f"{iso} names a missing pack {pack!r}")

    def test_confidence_is_never_overstated_for_unmapped_countries(self):
        for iso, country in registry()["countries"].items():
            if country["regime"] == "unknown":
                self.assertEqual(country["confidence"], "none", iso)
                self.assertEqual(country["rule_packs"], ["baseline"], iso)


class TestSandbox(unittest.TestCase):
    def test_arithmetic_and_comparison(self):
        self.assertTrue(evaluate_expression("w >= 1118 and n > 10", {"w": 1200, "n": 50}))
        self.assertEqual(evaluate_expression("max(a, b) * 2", {"a": 3, "b": 7}), 14)
        self.assertTrue(evaluate_expression("'bedroom' in serves", {"serves": ["bedroom"]}))

    def test_escape_attempts_are_refused(self):
        for attack in (
            "__import__('os').system('id')",
            "open('/etc/passwd').read()",
            "().__class__.__bases__",
            "[x for x in range(10)]",
            "(lambda: 1)()",
            "globals()",
        ):
            with self.assertRaises((RuleError, Exception), msg=attack):
                evaluate_expression(attack, {})


class TestPacks(unittest.TestCase):
    def test_every_pack_loads_and_is_labelled(self):
        for name in codes.available_packs():
            pack = load_pack(name)
            self.assertTrue(pack.rules, f"{name} has no rules")
            self.assertTrue(pack.disclaimer, f"{name} carries no disclaimer")
            for rule in pack.rules:
                self.assertTrue(rule.message, f"{name}:{rule.id} has no message")
                if name != "baseline":
                    self.assertTrue(rule.clause, f"{name}:{rule.id} cites no clause")

    def test_every_rule_expression_parses(self):
        for name in codes.available_packs():
            for rule in load_pack(name).rules:
                for expression in (rule.applies_when, rule.assertion):
                    try:
                        evaluate_expression(expression, {})
                    except RuleError as exc:
                        if "not a valid expression" in str(exc):
                            self.fail(f"{name}:{rule.id}: {exc}")
                    except Exception:
                        pass  # a missing fact here is expected and fine


if __name__ == "__main__":
    unittest.main()
