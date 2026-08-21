"""Outdoor living area: a control that was encoded, present, and never run.

`min_outdoor_living_m2` has been in the WA and Victorian packs all along,
keyed by density -- 30 m2 at R20, 20 at R40. Only `codraft fit` ever read
it. The `plan` command drew a house, reported zero violations, and never
looked at outdoor living at all. That is the failure this project exists to
avoid: a figure that is present, looks applied, and is not.

The control has TWO limbs -- an area and a minimum dimension -- and only the
first is encoded. So the rule asserts both and reports UNCHECKED until the
second is supplied, rather than passing on one limb. That matters here more
than usual: on a narrow lot the widest open rectangle is often the 1 m
ribbon down a side boundary, which satisfies 30 m2 on paper and is not
somewhere anybody sits.
"""

import unittest

from codraft import codes
from codraft.codes.facts import outdoor_living
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template

PERTH = codes.resolve("Perth")


def _site(zone="R20", **extra):
    site = {k: v for k, v in
            codes.site_parameters(PERTH, "residential", zone).items()
            if not k.startswith("$")}
    site.update(extra)
    return site


def _built(width=15000, depth=30000, beds=4, storeys=1, cover=None,
           setback_rear=6000):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=setback_rear,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot,
                   max_footprint=int(plot.area * cover) if cover else None)
    return build_building(program, plot, layout,
                          jurisdiction=PERTH.key), layout


def _finding(building, layout, site):
    report = codes.check(building, PERTH, layout.warnings, site=site)
    return next(f for f in report.findings if f.rule_id == "wa.outdoor.living")


class TestTheControlIsActuallyRun(unittest.TestCase):
    def test_the_plan_command_now_reaches_it(self):
        building, layout = _built()
        report = codes.check(building, PERTH, layout.warnings, site=_site())
        self.assertIn("wa.outdoor.living",
                      [f.rule_id for f in report.findings])

    def test_without_the_site_controls_it_is_unchecked_not_absent(self):
        # Checking with no controls at all must not silently drop the rule:
        # that is how a plan comes back clean because nobody looked.
        building, layout = _built()
        report = codes.check(building, PERTH, layout.warnings)
        finding = next(f for f in report.findings
                       if f.rule_id == "wa.outdoor.living")
        self.assertEqual(finding.status, "unchecked")
        self.assertTrue(finding.reason)


class TestItWillNotPassOnOneLimb(unittest.TestCase):
    def test_unchecked_while_the_dimension_figure_is_missing(self):
        building, layout = _built()
        finding = _finding(building, layout, _site())
        self.assertEqual(finding.status, "unchecked")
        self.assertIn("min_outdoor_living_dim_mm", finding.reason)

    def test_a_generous_yard_passes_once_the_figure_is_supplied(self):
        building, layout = _built()
        finding = _finding(building, layout,
                           _site(min_outdoor_living_dimension_mm=4000))
        self.assertEqual(finding.status, "pass")

    def test_a_side_ribbon_that_meets_the_area_still_fails(self):
        # The case the one-limb version would have waved through: 40 m2 of
        # open ground, all of it 1115 mm wide.
        building, layout = _built(width=9500, depth=36000, setback_rear=1000,
                                  cover=0.9)
        measured = outdoor_living(building, _site())
        self.assertGreaterEqual(measured["outdoor_living_m2"], 30)
        self.assertLess(measured["outdoor_living_min_dim_mm"], 4000)
        finding = _finding(building, layout,
                           _site(min_outdoor_living_dimension_mm=4000))
        self.assertEqual(finding.status, "fail")


class TestWhatIsMeasured(unittest.TestCase):
    def test_the_street_setback_is_never_the_answer(self):
        # It is in front of the house. The control is about the back.
        for road in ("south", "north", "east", "west"):
            program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
            plot = Plot(rect=Rect(0, 0, 20000, 34000), road_side=road,
                        setback_front=6000, setback_rear=6000,
                        setback_left=1000, setback_right=1000)
            layout = solve(program, plot)
            building = build_building(program, plot, layout,
                                      jurisdiction=PERTH.key)
            with self.subTest(road=road):
                self.assertNotEqual(
                    outdoor_living(building, _site())["outdoor_living_where"],
                    road,
                )

    def test_it_is_one_rectangle_not_the_sum_of_the_scraps(self):
        # Two 20 m2 ribbons down opposite boundaries are not a 40 m2 outdoor
        # living area, and adding them would say they were.
        building, _ = _built()
        measured = outdoor_living(building, _site())
        lot = building.plot.rect
        rects = [s.rect for s in building.storeys[0].spaces]
        footprint = ((max(r.x1 for r in rects) - min(r.x0 for r in rects))
                     * (max(r.y1 for r in rects) - min(r.y0 for r in rects)))
        self.assertLess(measured["outdoor_living_m2"],
                        (lot.area - footprint) / 1e6)

    def test_the_measurement_is_reported_whether_or_not_it_is_decided(self):
        # A control reported unchecked still leaves the reader wanting the
        # number, and the number is known.
        building, layout = _built()
        report = codes.check(building, PERTH, layout.warnings, site=_site())
        joined = "\n".join(report.assumptions)
        self.assertIn("Outdoor living measures", joined)
        self.assertIn("narrowest", joined)

    def test_a_roofed_alfresco_is_not_counted_and_the_report_says_so(self):
        building, layout = _built()
        report = codes.check(building, PERTH, layout.warnings, site=_site())
        self.assertIn("alfresco is not counted",
                      "\n".join(report.assumptions))


class TestTheFigureCanActuallyBeSupplied(unittest.TestCase):
    def test_the_checklist_entry_maps_to_the_key_the_rule_needs(self):
        # It was on the checklist already, mapped to nothing -- so filling it
        # in changed nothing, which is worse than not asking.
        from codraft.codes.states import _SITE_KEYS

        self.assertEqual(_SITE_KEYS.get("site.min_open_space_dimension"),
                         "min_outdoor_living_dimension_mm")

    def test_supplying_it_turns_the_rule_into_a_real_check(self):
        building, layout = _built()
        unchecked = _finding(building, layout, _site())
        decided = _finding(building, layout,
                           _site(min_outdoor_living_dimension_mm=4000))
        self.assertEqual(unchecked.status, "unchecked")
        self.assertIn(decided.status, ("pass", "fail"))
