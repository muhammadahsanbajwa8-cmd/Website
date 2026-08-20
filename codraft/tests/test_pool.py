"""Pools, and the barrier that is the regulated part of one."""

import unittest

from codraft import codes
from codraft.geom import Rect
from codraft.layout import build_building, place_pool, rear_yard, solve
from codraft.model import Plot, Pool
from codraft.program import parse_brief, template


def _plot(w=17000, d=32000):
    return Plot(rect=Rect(0, 0, w, d), setback_front=6000, setback_rear=1000,
                setback_left=1000, setback_right=1000)


def _footprint(plot):
    program = template("au-house", bedrooms=4, bathrooms=2)
    layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
    return layout.envelope


class TestPlacement(unittest.TestCase):
    def test_a_pool_goes_in_the_rear_yard(self):
        plot = _plot()
        footprint = _footprint(plot)
        pool, _ = place_pool(plot, footprint)
        self.assertIsNotNone(pool)
        yard = rear_yard(plot, footprint)
        self.assertGreaterEqual(pool.rect.y0, yard.y0)
        self.assertLessEqual(pool.rect.y1, yard.y1)

    def test_the_barrier_and_its_zone_fit_the_yard(self):
        # The reason a pool that "obviously fits" often does not: the water
        # is the smallest part of what has to go in the yard.
        plot = _plot()
        footprint = _footprint(plot)
        pool, _ = place_pool(plot, footprint)
        yard = rear_yard(plot, footprint)
        self.assertGreaterEqual(pool.barrier.x0, yard.x0)
        self.assertLessEqual(pool.barrier.x1, yard.x1)
        self.assertGreaterEqual(pool.barrier.y0, yard.y0)
        self.assertLessEqual(pool.barrier.y1, yard.y1)

    def test_a_yard_too_small_says_how_short_it_is(self):
        plot = _plot(12000, 24000)
        pool, warnings = place_pool(plot, _footprint(plot))
        self.assertIsNone(pool)
        self.assertTrue(warnings)
        self.assertIn("mm short", warnings[0])
        self.assertIn("non-climbable", warnings[0])

    def test_using_a_boundary_fence_is_flagged_not_assumed(self):
        plot = _plot()
        pool, warnings = place_pool(plot, _footprint(plot))
        self.assertIsNotNone(pool)
        self.assertTrue(
            any("neighbour" in w for w in warnings),
            "relying on a boundary fence as part of the barrier must be said "
            "out loud, because the non-climbable zone then lands on land the "
            "owner does not control",
        )

    def test_a_brief_can_ask_for_one(self):
        self.assertTrue(parse_brief("4 bed house with a pool in Perth").pool)
        self.assertTrue(parse_brief("3 bed house and a plunge pool").pool)
        self.assertFalse(parse_brief("3 bed house in Perth").pool)


class TestBarrierRules(unittest.TestCase):
    def _check(self, pool):
        plot = _plot()
        program = template("au-house", bedrooms=4, bathrooms=2)
        layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
        building = build_building(program, plot, layout)
        building.pool = pool
        return codes.check(building, codes.resolve("Perth"))

    def test_a_compliant_pool_passes(self):
        plot = _plot()
        pool, _ = place_pool(plot, _footprint(plot))
        report = self._check(pool)
        failed = [f.rule_id for f in report.failures if f.rule_id.startswith("au.pool")]
        self.assertEqual(failed, [])

    def test_a_low_barrier_is_a_violation(self):
        pool = Pool(rect=Rect(0, 0, 8000, 4000), barrier_height_mm=900)
        report = self._check(pool)
        ids = [f.rule_id for f in report.violations]
        self.assertIn("au.pool.barrier.height", ids)

    def test_a_gate_that_swings_the_wrong_way_is_a_violation(self):
        pool = Pool(rect=Rect(0, 0, 8000, 4000), gate_swings_outward=False)
        self.assertIn("au.pool.gate.swing",
                      [f.rule_id for f in self._check(pool).violations])

    def test_a_gate_without_self_closing_hardware_is_a_violation(self):
        pool = Pool(rect=Rect(0, 0, 8000, 4000), gate_self_closing=False)
        self.assertIn("au.pool.gate.hardware",
                      [f.rule_id for f in self._check(pool).violations])

    def test_a_squeezed_non_climbable_zone_is_a_violation(self):
        pool = Pool(rect=Rect(0, 0, 8000, 4000), non_climbable_zone_mm=600)
        self.assertIn("au.pool.barrier.ncz",
                      [f.rule_id for f in self._check(pool).violations])

    def test_shallow_water_still_needs_a_barrier(self):
        # 300 mm is the line, and it catches spas and portable pools.
        deep = Pool(rect=Rect(0, 0, 3000, 2000), water_depth_mm=400)
        shallow = Pool(rect=Rect(0, 0, 3000, 2000), water_depth_mm=250)
        self.assertTrue(deep.needs_barrier)
        self.assertFalse(shallow.needs_barrier)

    def test_the_pack_says_the_gate_cannot_be_checked_from_a_plan(self):
        pack = codes.load_pack("au-pool-barrier")
        self.assertIn("SAFETY CRITICAL", pack.disclaimer)
        self.assertIn("gate", pack.disclaimer.lower())

    def test_every_australian_state_applies_it(self):
        for city in ("Perth", "Melbourne", "Sydney", "Brisbane"):
            self.assertIn("au-pool-barrier", codes.resolve(city).rule_packs, city)


if __name__ == "__main__":
    unittest.main()
