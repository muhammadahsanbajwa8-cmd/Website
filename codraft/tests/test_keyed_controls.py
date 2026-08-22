"""A control keyed by place must be checked against that place's figure.

Rule packs carry tables: the R-Codes set a different street setback for each
density, the Pakistan bylaws a different plot ratio for each city. Several
rules asserted a single number out of those tables regardless -- whichever
one the author happened to be looking at.

That fails in both directions and the second is the dangerous one:

  a FALSE VIOLATION tells a builder to redraw a compliant plan, and spends
  the credibility that makes the true findings worth reading;

  a FALSE PASS tells them a non-compliant plan is fine. The Islamabad site
  coverage cap is 0.55 and the rule asserted 0.65, so a plot built over the
  cap was passed.

This file walks the tables and checks that no rule is still reading one row
of them for every place.
"""

import json
import pathlib
import re
import unittest

from codraft import codes
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot, Roof
from codraft.program import template

RULES = pathlib.Path(__file__).resolve().parent.parent / "src" / "codraft" / "codes" / "rules"


def _keyed_tables(pack: dict) -> dict[str, dict]:
    """Controls the pack gives more than one value for."""
    out = {}
    for key, value in (pack.get("site") or {}).items():
        if key.startswith("$") or not isinstance(value, dict):
            continue
        rows = {k: v for k, v in value.items() if not k.startswith("$")}
        if len({v for k, v in rows.items() if k != "default"}) > 1:
            out[key] = rows
    return out


class TestNoRuleReadsOneRowOfATable(unittest.TestCase):
    def test_every_pack(self):
        tables = 0
        for path in sorted(RULES.glob("*.json")):
            pack = json.loads(path.read_text())
            keyed = _keyed_tables(pack)
            tables += len(keyed)
            for rule in pack.get("rules", []):
                assertion = rule.get("assert", "")
                literals = re.findall(r"[<>]=?\s*([\d.]+)", assertion)
                if not literals:
                    continue
                for key, rows in keyed.items():
                    # Does this rule test the quantity that control governs?
                    stem = key.replace("max_", "").replace("min_", "")
                    subject = stem.replace("_mm", "").replace("_ratio", "")
                    if subject.split("_")[0] not in assertion:
                        continue
                    with self.subTest(pack=path.stem, rule=rule["id"]):
                        self.fail(
                            f"{rule['id']} asserts a bare {literals} where "
                            f"{key} is keyed by place "
                            f"({sorted({v for k, v in rows.items() if k != 'default'})})"
                        )
        self.assertGreater(tables, 0, "no pack keys any control by place")


class TestThePakistanControlsFollowTheCity(unittest.TestCase):
    CITIES = ("Lahore", "Karachi", "Islamabad")

    def _site(self, place):
        j = codes.resolve(place)
        return j, {k: v for k, v
                   in codes.site_parameters(j, "residential").items()
                   if not k.startswith("$")}

    def test_the_cities_really_do_differ(self):
        caps = {self._site(c)[1]["max_coverage_ratio"] for c in self.CITIES}
        fars = {self._site(c)[1]["max_floor_area_ratio"] for c in self.CITIES}
        self.assertGreater(len(caps), 1)
        self.assertGreater(len(fars), 1)

    def _report(self, place, site_override=None):
        j, site = self._site(place)
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        plot = Plot(rect=Rect(0, 0, 12000, 20000), road_side="south",
                    setback_front=4500, setback_rear=1500,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout, jurisdiction=j.key)
        return codes.check(building, j, layout.warnings,
                           site={**site, **(site_override or {})}), building

    def test_a_plan_inside_its_own_citys_caps_passes(self):
        for city in self.CITIES:
            report, _b = self._report(city)
            offenders = [f.rule_id for f in report.violations
                         if f.rule_id in ("pk.site.coverage", "pk.site.far")]
            with self.subTest(city=city):
                self.assertEqual(offenders, [])

    def test_coverage_over_the_citys_cap_is_caught(self):
        # The false pass: a cap tightened below what was built must fail.
        report, building = self._report("Islamabad",
                                        {"max_coverage_ratio": 0.2})
        finding = next(f for f in report.findings
                       if f.rule_id == "pk.site.coverage")
        self.assertEqual(finding.status, "fail")
        self.assertGreater(building.coverage_ratio, 0.2)

    def test_a_ratio_over_the_citys_limit_is_caught(self):
        report, building = self._report("Karachi",
                                        {"max_floor_area_ratio": 0.5})
        finding = next(f for f in report.findings
                       if f.rule_id == "pk.site.far")
        self.assertEqual(finding.status, "fail")
        self.assertGreater(building.floor_area_ratio, 0.5)


class TestHeightIsCarriedAndNowChecked(unittest.TestCase):
    """A height limit every state file carries and no rule looked at."""

    def _report(self, override=None):
        j = codes.resolve("Perth")
        site = {k: v for k, v
                in codes.site_parameters(j, "residential", "R20").items()
                if not k.startswith("$")}
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                    setback_front=6000, setback_rear=1000,
                    setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout, jurisdiction=j.key)
        # A height limit is about the roof, so the building under test has
        # to have one. Without it `overall_height` is the wall height and
        # the rule would be checking a different number than it claims to.
        building.roof = Roof(pitch_degrees=25.0, overhang_mm=600, kind="hip")
        return codes.check(building, j, layout.warnings,
                           site={**site, **(override or {})}), building

    def test_the_rule_exists_now(self):
        report, _b = self._report()
        self.assertIn("wa.height.overall",
                      [f.rule_id for f in report.findings])

    def test_it_is_unchecked_until_a_limit_is_supplied(self):
        # No state file carries the figure yet, and none has been invented.
        report, _b = self._report()
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.height.overall")
        self.assertEqual(finding.status, "unchecked")

    def test_supplying_a_limit_makes_it_a_real_check(self):
        report, building = self._report({"max_height_mm": 3000})
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.height.overall")
        self.assertEqual(finding.status, "fail")
        self.assertGreater(building.overall_height, 3000)

        report, _b = self._report({"max_height_mm": 9000})
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.height.overall")
        self.assertEqual(finding.status, "pass")

    def test_it_measures_to_the_ridge_and_says_so(self):
        # The wall height and the ridge differ by the pitch of the roof, and
        # a rule written against the wrong one is wrong by that much.
        report, building = self._report({"max_height_mm": 9000})
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.height.overall")
        self.assertIn(str(building.overall_height), finding.message)
        self.assertIn("RIDGE", finding.note.upper())
        self.assertNotEqual(building.overall_height, building.height)
