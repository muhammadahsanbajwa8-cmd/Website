"""Every target the plan is built to must be a target something checks.

A rule pack says two things about the same control. Its `design` block is
the number the solver aims at; a rule is the number the finished drawing is
measured against. A pack that states a target and asserts nothing produces a
plan built to a figure that no column of the report ever mentions -- it does
not pass, it does not fail, it is not even listed as unchecked, because
nothing asked. Three of those have now been found by hand (building height,
outdoor living, IRC ventilation), which is two more than is worth finding by
hand again.

The mapping below is the point of the test: it names, for each target, the
fact that measures whether the built thing met it. Those names differ on
purpose -- the target is `ceiling_height_mm` because that is what a builder
sets, and the fact is `clear_height_mm` because that is what an inspector
measures under the ceiling. The pair that matters most is the last one:
ventilation is aimed at as a ratio of glazing and must be checked as a ratio
of what OPENS, and reading the glazed area instead passes a room with a
picture window that does not open.

What this does NOT check is that the two numbers agree. A pack may aim
higher than its jurisdiction demands -- Pakistan builds a 1000 mm corridor
where only the practice baseline's 900 is asserted -- and aiming above the
law is not a defect.
"""

from __future__ import annotations

import json
import pathlib
import unittest

from codraft.codes.engine import evaluate_expression, load_pack

RULES = pathlib.Path(__file__).resolve().parents[1] / "src/codraft/codes/rules"
REGISTRY = (
    pathlib.Path(__file__).resolve().parents[1]
    / "src/codraft/codes/registry/countries.json"
)

# design target -> (fact that measures it, words the asserting rule must be about)
MEASURED_BY: dict[str, tuple[str, tuple[str, ...]]] = {
    "ceiling_height_mm": ("clear_height_mm", ()),
    "door_clear_width_mm": ("clear_width_mm", ()),
    "corridor_width_mm": ("width_mm", ("corridor", "hall", "passage", "exit")),
    "stair_riser_max_mm": ("riser_mm", ()),
    "stair_going_min_mm": ("going_mm", ()),
    "stair_going_max_mm": ("going_mm", ()),
    "glazing_ratio": ("glazing_ratio", ()),
    "ventilation_ratio": ("openable_ratio", ()),
}

# Stated for the builder, not assertable: these describe how the thing is
# made or how a fact is estimated, and no measurement of the finished
# drawing can pass or fail them.
NOT_A_CHECKABLE_TARGET = {"construction", "openable_fraction"}


def _packs() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text("utf-8")) for p in RULES.glob("*.json")}


def _pack_groups() -> set[tuple[str, ...]]:
    """Every set of packs that actually applies somewhere, from the registry."""
    data = json.loads(REGISTRY.read_text("utf-8"))
    groups: set[tuple[str, ...]] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            names = node.get("rule_packs")
            if isinstance(names, list) and names:
                groups.add(tuple(names))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return groups


class DesignTargetsAreChecked(unittest.TestCase):
    def test_every_target_has_something_that_asserts_it(self) -> None:
        packs = _packs()
        unasserted: list[str] = []

        for group in sorted(_pack_groups()):
            applying = [packs[name] for name in group if name in packs]
            rules = [rule for pack in applying for rule in pack.get("rules", ())]
            for name in group:
                pack = packs.get(name)
                if pack is None:
                    continue
                for target in pack.get("design", {}):
                    if target.startswith("$") or target in NOT_A_CHECKABLE_TARGET:
                        continue
                    self.assertIn(
                        target,
                        MEASURED_BY,
                        f"{name} states a target `{target}` that this test has no "
                        "fact for. Either name the fact that measures it, or say "
                        "in NOT_A_CHECKABLE_TARGET why nothing can.",
                    )
                    fact, about = MEASURED_BY[target]
                    if not any(_asserts(rule, fact, about) for rule in rules):
                        unasserted.append(
                            f"{'+'.join(group)}: {name} builds to `{target}` "
                            f"and no rule asserts `{fact}`"
                        )

        self.assertEqual(
            [], sorted(set(unasserted)),
            "\n".join(sorted(set(unasserted))),
        )

    def test_ventilation_is_never_checked_on_the_glazed_area(self) -> None:
        """The one substitution that reads as a pass and is not one."""
        for name, pack in sorted(_packs().items()):
            for rule in pack.get("rules", ()):
                if "vent" not in rule["id"] and "vent" not in rule["title"].lower():
                    continue
                self.assertNotIn(
                    "glazing_ratio", rule.get("assert", ""),
                    f"{rule['id']} in {name} is about ventilation and asserts the "
                    "GLAZED area. A window that does not open is glazed. Assert "
                    "openable_ratio.",
                )

    def test_the_substitution_has_teeth(self) -> None:
        """A window that is glazed enough and opens too little must fail.

        Without this the fix above is cosmetic. The room here is glazed to
        6% of its floor area -- comfortably past the 5% the purge rule used
        to read -- and half of that opens, so it delivers 3%. It has to come
        out a failure under both rules that were changed.
        """
        room = {
            "name": "Bedroom 2", "is_habitable": True, "is_wet": False,
            "has_window": True, "glazing_ratio": 0.06, "openable_ratio": 0.03,
        }
        for pack_name, rule_id in (
            ("uk-approved-documents", "uk.ventilation.purge"),
            ("irc-2021", "irc.ventilation.natural"),
        ):
            with self.subTest(rule=rule_id):
                rule = next(
                    r for r in load_pack(pack_name).rules if r.id == rule_id
                )
                self.assertTrue(
                    evaluate_expression(rule.applies_when, room),
                    f"{rule_id} does not even apply to a glazed habitable room",
                )
                self.assertFalse(
                    evaluate_expression(rule.assertion, room),
                    f"{rule_id} passes a room that delivers 3% openable area. "
                    "It is reading the glazed area again.",
                )

    def test_the_openable_estimate_is_shared_by_builder_and_checker(self) -> None:
        """The solver reads it from `design`, the facts from `parameters`."""
        for name, pack in sorted(_packs().items()):
            built = pack.get("design", {}).get("openable_fraction")
            checked = pack.get("parameters", {}).get("openable_fraction")
            if built is None and checked is None:
                continue
            self.assertEqual(
                built, checked,
                f"{name} sizes windows against openable_fraction={built} and "
                f"checks them against {checked}. The solver reads `design` and "
                "codes.facts reads `parameters`, so both need the number.",
            )


def _asserts(rule: dict, fact: str, about: tuple[str, ...]) -> bool:
    if fact not in rule.get("assert", ""):
        return False
    if not about:
        return True
    subject = f"{rule['id']} {rule.get('title', '')} {rule.get('applies_when', '')}"
    return any(word in subject.lower() for word in about)


if __name__ == "__main__":
    unittest.main()
