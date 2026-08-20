"""The builder's range, and whether a design goes on a block."""

import tempfile
import unittest
from pathlib import Path

from codraft import codes
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.library import (
    Design,
    DesignLibrary,
    design_from_building,
    fit_design,
    fit_library,
)
from codraft.model import Plot
from codraft.program import template


def _design(name="Test", width=10000, depth=18000, **kwargs):
    return Design(
        id=name.lower().replace(" ", "-"), name=name,
        width_mm=width, depth_mm=depth,
        total_m2=round(width * depth / 1_000_000, 1), **kwargs
    )


def _plot(w=15000, d=32000, front=6000, rear=1000, side=1000):
    return Plot(
        rect=Rect(0, 0, w, d), setback_front=front, setback_rear=rear,
        setback_left=side, setback_right=side,
    )


class TestDesign(unittest.TestCase):
    def test_a_generated_building_becomes_a_design(self):
        program = template("house", bedrooms=4, bathrooms=2, storeys=1)
        plot = _plot(20000, 40000)
        building = build_building(program, plot, solve(program, plot))
        design = design_from_building(building, "The Test")

        self.assertEqual(design.name, "The Test")
        self.assertEqual(design.bedrooms, 4)
        self.assertGreater(design.width_mm, 0)
        self.assertGreater(design.depth_mm, 0)
        self.assertGreater(design.total_m2, 0)
        self.assertTrue(design.rooms)

    def test_round_trips_through_json(self):
        original = _design("The Murray", 13590, 25190, bedrooms=4, storeys=1)
        restored = Design.from_dict(
            __import__("json").loads(original.to_json())
        )
        self.assertEqual(restored.width_mm, 13590)
        self.assertEqual(restored.bedrooms, 4)
        self.assertEqual(restored.name, "The Murray")

    def test_lengths_may_arrive_with_units(self):
        # A builder's catalogue comes out of a spreadsheet, not a model.
        design = Design.from_dict(
            {"id": "x", "name": "X", "width_mm": "13.59m", "depth_mm": "25.19m"}
        )
        self.assertEqual(design.width_mm, 13590)
        self.assertEqual(design.depth_mm, 25190)


class TestLibrary(unittest.TestCase):
    def test_saves_and_loads(self):
        with tempfile.TemporaryDirectory() as directory:
            library = DesignLibrary.load(directory)
            self.assertEqual(len(library), 0)
            library.add(_design("The Murray", 13590, 25190))
            reloaded = DesignLibrary.load(directory)
            self.assertEqual(len(reloaded), 1)
            self.assertEqual(reloaded.get("the-murray").width_mm, 13590)

    def test_a_broken_file_is_reported_not_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "broken.json").write_text("{not json", encoding="utf-8")
            library = DesignLibrary.load(directory)
            self.assertEqual(len(library), 0)
            self.assertTrue(library.problems)


class TestFit(unittest.TestCase):
    def test_a_design_that_goes_on_the_block(self):
        result = fit_design(_design(width=10000, depth=18000), _plot())
        self.assertTrue(result.fits, result.reasons)
        self.assertEqual(result.margin_width_mm, 13000 - 10000)
        self.assertIsNotNone(result.placement)

    def test_too_wide_says_by_how_much(self):
        # The number is the point. 300 mm over is a conversation with the
        # council; four metres over is a different design.
        result = fit_design(_design(width=14000, depth=18000), _plot())
        self.assertFalse(result.fits)
        self.assertIn("1000 mm too wide", result.reasons[0])

    def test_too_deep_says_by_how_much(self):
        result = fit_design(_design(width=10000, depth=30000), _plot())
        self.assertFalse(result.fits)
        self.assertTrue(any("too deep" in r for r in result.reasons))

    def test_site_cover_is_enforced(self):
        # Fits inside the setbacks, but covers too much of the lot.
        plot = _plot(w=15000, d=20000, front=1000, rear=1000, side=1000)
        design = _design(width=13000, depth=18000)
        result = fit_design(design, plot, max_coverage=0.5)
        self.assertFalse(result.fits)
        self.assertIn("Site cover", result.reasons[0])

    def test_outdoor_living_is_enforced(self):
        plot = _plot(w=15000, d=20000, front=1000, rear=1000, side=1000)
        design = _design(width=13000, depth=18000)
        result = fit_design(design, plot, max_coverage=0.9, min_outdoor_m2=200)
        self.assertFalse(result.fits)
        self.assertIn("outdoor living", result.reasons[0])

    def test_a_tight_fit_is_flagged(self):
        plot = _plot(w=12400, d=32000)
        result = fit_design(_design(width=10200, depth=18000), plot)
        self.assertTrue(result.fits)
        self.assertTrue(
            any("slack" in n for n in result.notes),
            "a 200 mm margin should be called out before anyone quotes it",
        )

    def test_the_range_is_ranked_fits_first(self):
        # On a 15 x 32 m lot (480 m2) with 6 m front and 1 m elsewhere, the
        # buildable envelope is 13 x 25 m.
        designs = [
            _design("Wide", 14000, 18000),     # 1 m too wide for the envelope
            _design("Small", 8000, 12000),     # 96 m2, 20% cover
            _design("Large", 12500, 20000),    # 250 m2, 52% cover
        ]
        results = fit_library(designs, _plot(), max_coverage=0.6)
        self.assertTrue(results[0].fits)
        self.assertFalse(results[-1].fits)
        # Of the ones that fit, the one using the block best comes first.
        self.assertEqual(results[0].design.name, "Large")

    def test_a_design_with_no_footprint_is_refused_not_guessed(self):
        result = fit_design(_design(width=0, depth=0), _plot())
        self.assertFalse(result.fits)
        self.assertIn("no recorded footprint", result.reasons[0])


class TestPlanningControls(unittest.TestCase):
    def test_wa_controls_are_keyed_by_r_code(self):
        perth = codes.resolve("Perth")
        r20 = codes.site_parameters(perth, "residential", "R20")
        r40 = codes.site_parameters(perth, "residential", "R40")
        self.assertEqual(r20["max_coverage_ratio"], 0.50)
        self.assertEqual(r20["setback_front_mm"], 6000)
        self.assertEqual(r40["max_coverage_ratio"], 0.60)
        self.assertEqual(r40["setback_front_mm"], 4000)

    def test_each_state_gets_its_own_planning_pack(self):
        for city, pack in (
            ("Perth", "au-wa-rcodes"), ("Melbourne", "au-vic-rescode"),
            ("Sydney", "au-nsw-codes-sepp"), ("Brisbane", "au-qld-qdc"),
        ):
            self.assertIn(pack, codes.resolve(city).rule_packs, city)

    def test_a_state_with_no_pack_borrows_nobody_elses(self):
        packs = codes.resolve("Adelaide").rule_packs
        for planning in ("au-wa-rcodes", "au-vic-rescode",
                         "au-nsw-codes-sepp", "au-qld-qdc"):
            self.assertNotIn(planning, packs)

    def test_planning_packs_say_they_are_not_the_building_code(self):
        for name in ("au-wa-rcodes", "au-vic-rescode",
                     "au-nsw-codes-sepp", "au-qld-qdc"):
            disclaimer = codes.load_pack(name).disclaimer
            self.assertIn("NOT BUILDING CODE", disclaimer.upper(), name)


if __name__ == "__main__":
    unittest.main()
