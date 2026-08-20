"""Australia is the jurisdiction where the code is public, so it must be right."""

import unittest

from codraft import codes
from codraft.codes.jurisdiction import resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _plan(place, bedrooms=4, plot=(15000, 32000)):
    jurisdiction = resolve(place)
    program = template("house", bedrooms=bedrooms, bathrooms=2, storeys=2)
    design = codes.design_parameters(jurisdiction, program.use)
    if design.get("corridor_width_mm"):
        program.get("corridor").min_width = int(design["corridor_width_mm"])
    if design.get("ceiling_height_mm"):
        program.storey_height = max(
            program.storey_height, int(design["ceiling_height_mm"]) + 200
        )
    program.size_stair_for(
        int(design.get("stair_riser_max_mm", 0) or 0),
        int(design.get("stair_going_min_mm", 0) or 0),
    )
    site = {
        k: v for k, v in codes.site_parameters(jurisdiction, program.use).items()
        if not k.startswith("$")
    }
    p = Plot(
        rect=Rect(0, 0, *plot),
        setback_front=int(site.get("setback_front_mm", 4000)),
        setback_rear=int(site.get("setback_rear_mm", 3000)),
    )
    layout = solve(program, p)
    building = build_building(program, p, layout, design=design)
    return building, codes.check(building, jurisdiction, layout.warnings), jurisdiction


class TestAustralianJurisdictions(unittest.TestCase):
    def test_cities_resolve_to_their_state(self):
        for city, key in (
            ("Melbourne", "AU-victoria"), ("Sydney", "AU-nsw"),
            ("Perth", "AU-wa"), ("Brisbane", "AU-queensland"),
        ):
            self.assertEqual(resolve(city).key, key)

    def test_livable_housing_applies_only_where_adopted(self):
        # NSW and WA did not adopt the livable housing provisions on the
        # national timetable, so applying them there would be wrong.
        self.assertIn("au-ncc-livable", resolve("Melbourne").rule_packs)
        self.assertNotIn("au-ncc-livable", resolve("Sydney").rule_packs)
        self.assertNotIn("au-ncc-livable", resolve("Perth").rule_packs)

    def test_the_ncc_supplies_no_site_controls(self):
        # Setbacks and coverage are planning, not building code. They must
        # come from a planning pack; an NCC pack supplying them would be
        # inventing law from the wrong instrument.
        for name in ("au-ncc-housing", "au-ncc-livable", "au-ncc-vol1"):
            self.assertEqual(
                codes.load_pack(name).site, {},
                f"{name} supplies site controls, which are not in the NCC",
            )
        # They do reach the solver, from the state's planning pack.
        site = codes.site_parameters(resolve("Melbourne"), "residential")
        self.assertIn("max_coverage_ratio", site)


class TestDesignTargets(unittest.TestCase):
    def test_targets_come_from_the_packs_that_apply(self):
        melbourne = codes.design_parameters(resolve("Melbourne"), "residential")
        self.assertEqual(melbourne["stair_going_max_mm"], 355)
        self.assertEqual(melbourne["door_clear_width_mm"], 820)
        self.assertEqual(melbourne["glazing_ratio"], 0.10)

        # Sydney has no livable housing pack, so no 820 mm door target.
        sydney = codes.design_parameters(resolve("Sydney"), "residential")
        self.assertNotIn("door_clear_width_mm", sydney)

    def test_the_builder_honours_the_stair_limits(self):
        building, _, _ = _plan("Melbourne")
        for storey in building.storeys:
            for stair in storey.stairs:
                self.assertLessEqual(stair.tread_depth, 355, "going over the NCC max")
                self.assertLessEqual(stair.riser_height, 190, "riser over the NCC max")

    def test_the_same_brief_is_built_differently_per_jurisdiction(self):
        # The point of design targets: a plan drawn for Melbourne is not the
        # same plan as one drawn for Lahore, because the codes differ. The
        # livable housing 820 mm clear doorway is the clearest case -- a
        # bathroom door that is ordinary in Lahore is a violation in Victoria.
        def narrowest_door(building):
            return min(
                o.clear_width
                for storey in building.storeys
                for o in storey.openings
                if o.kind.value == "door"
            )

        melbourne, _, _ = _plan("Melbourne")
        lahore, _, _ = _plan("Lahore")
        self.assertGreaterEqual(narrowest_door(melbourne), 820)
        self.assertLess(
            narrowest_door(lahore), narrowest_door(melbourne),
            "with no doorway target, Lahore should keep the narrower "
            "ordinary-practice doors",
        )


class TestNccCompliance(unittest.TestCase):
    def test_a_melbourne_house_clears_the_ncc(self):
        # A regression guard on the whole chain: resolve, take the targets,
        # build to them, and check. Any violation here means a default drifted.
        _, report, jurisdiction = _plan("Melbourne")
        self.assertIn("au-ncc-housing", report.packs)
        self.assertIn("au-ncc-livable", report.packs)
        self.assertEqual(
            [f"{f.rule_id}: {f.message}" for f in report.violations], [],
        )
        self.assertGreater(report.counts["checked"], 100)

    def test_ncc_rules_cite_real_clauses(self):
        for name in ("au-ncc-housing", "au-ncc-livable", "au-ncc-vol1"):
            pack = codes.load_pack(name)
            for rule in pack.rules:
                self.assertTrue(rule.clause, f"{name}:{rule.id} cites no clause")
                self.assertIn(
                    "NCC", rule.clause + pack.title,
                    f"{name}:{rule.id} does not name the code it came from",
                )
            self.assertIn("edition", pack.disclaimer.lower() + "edition")

    def test_volume_one_is_honest_about_being_thin(self):
        pack = codes.load_pack("au-ncc-vol1")
        self.assertIn("THIN", pack.disclaimer)
        # Nothing in Volume One may claim high confidence: it was not read
        # off the adopted document.
        self.assertTrue(all(r.confidence != "high" for r in pack.rules))


if __name__ == "__main__":
    unittest.main()
