"""Services layouts must land inside the rooms they serve."""

import unittest

from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Function, Plot
from codraft.program import template
from codraft.services import design_electrical, design_plumbing
from codraft.symbols import BUILDERS, NAMES, footprint, symbol


def _building(storeys=2, bedrooms=3, bathrooms=2, plot=(12192, 18288)):
    program = template("house", bedrooms=bedrooms, bathrooms=bathrooms, storeys=storeys)
    p = Plot(rect=Rect(0, 0, *plot), setback_front=3048, setback_rear=1524)
    layout = solve(program, p)
    return build_building(program, p, layout)


class TestSymbols(unittest.TestCase):
    def test_every_symbol_builds_and_is_named(self):
        for kind in BUILDERS:
            geometry = symbol(kind, 1000, 2000, 90)
            self.assertTrue(
                geometry.lines or geometry.circles or geometry.arcs,
                f"{kind} draws nothing",
            )
            self.assertIn(kind, NAMES, f"{kind} has no legend name")

    def test_scaling_shrinks_geometry(self):
        full = symbol("bath", 0, 0, 0)
        half = symbol("bath", 0, 0, 0, scale=0.5)
        span_full = max(abs(l.x0) for l in full.lines)
        span_half = max(abs(l.x0) for l in half.lines)
        self.assertAlmostEqual(span_half * 2, span_full, places=3)

    def test_footprints_are_positive(self):
        for kind in BUILDERS:
            along, out = footprint(kind)
            self.assertGreater(along, 0, kind)
            self.assertGreater(out, 0, kind)


class TestElectrical(unittest.TestCase):
    def setUp(self):
        self.building = _building()

    def test_every_room_has_a_light_and_a_switch(self):
        for storey in self.building.storeys:
            plan = design_electrical(self.building, storey.index)
            for space in storey.spaces:
                lights = [
                    f for f in plan.fixtures
                    if f.space == space.id
                    and f.kind in ("light_ceiling", "fan_ceiling")
                ]
                switches = [
                    f for f in plan.fixtures
                    if f.space == space.id and f.kind.startswith("switch")
                ]
                self.assertTrue(lights, f"{space.name} has no light")
                self.assertTrue(switches, f"{space.name} has no switch")

    def test_fixtures_land_inside_their_rooms(self):
        for storey in self.building.storeys:
            plan = design_electrical(self.building, storey.index)
            rects = {s.id: s.rect for s in storey.spaces}
            for fixture in plan.fixtures:
                rect = rects.get(fixture.space)
                if rect is None:
                    continue
                self.assertTrue(
                    rect.x0 <= fixture.x <= rect.x1 and rect.y0 <= fixture.y <= rect.y1,
                    f"{fixture.kind} {fixture.id} is outside the room it serves",
                )

    def test_wet_rooms_get_protected_outlets_and_extract(self):
        for storey in self.building.storeys:
            plan = design_electrical(self.building, storey.index)
            for space in storey.spaces:
                if not space.function.is_wet:
                    continue
                kinds = {f.kind for f in plan.fixtures if f.space == space.id}
                self.assertIn("exhaust_fan", kinds, f"{space.name} has no extract")
                self.assertNotIn(
                    "socket", kinds,
                    f"{space.name} has an unprotected socket in a wet room",
                )

    def test_every_run_is_orthogonal_or_a_switch_leg(self):
        for storey in self.building.storeys:
            plan = design_electrical(self.building, storey.index)
            for run in plan.runs:
                if run.kind == "switch_leg":
                    continue  # drawn as a direct line, by convention
                for (x0, y0), (x1, y1) in zip(run.points, run.points[1:]):
                    self.assertTrue(
                        x0 == x1 or y0 == y1,
                        f"{run.kind} run cuts diagonally across the plan",
                    )


class TestPlumbing(unittest.TestCase):
    def test_fixtures_land_inside_their_rooms(self):
        building = _building()
        for storey in building.storeys:
            plan = design_plumbing(building, storey.index)
            rects = {s.id: s.rect for s in storey.spaces}
            for fixture in plan.fixtures:
                rect = rects.get(fixture.space)
                if rect is None:
                    continue
                self.assertTrue(
                    rect.x0 <= fixture.x <= rect.x1 and rect.y0 <= fixture.y <= rect.y1,
                    f"{fixture.kind} {fixture.id} is outside {fixture.space}",
                )

    def test_every_bathroom_gets_a_wc_and_a_basin(self):
        building = _building()
        for storey in building.storeys:
            plan = design_plumbing(building, storey.index)
            for space in storey.spaces:
                if space.function is not Function.BATHROOM:
                    continue
                kinds = {f.kind for f in plan.fixtures if f.space == space.id}
                self.assertIn("wc", kinds, f"{space.name} has no WC")
                self.assertIn("basin", kinds, f"{space.name} has no basin")

    def test_one_stack_serves_the_floor(self):
        building = _building()
        for storey in building.storeys:
            plan = design_plumbing(building, storey.index)
            if not [s for s in storey.spaces if s.function.is_wet]:
                continue
            self.assertEqual(plan.count("stack_soil"), 1,
                             f"{storey.name} should have exactly one soil stack")

    def test_a_cramped_bathroom_is_reported_not_hidden(self):
        # A bathroom too small for its fittings must produce a warning
        # rather than a drawing with a basin inside a bath.
        building = _building(plot=(9000, 14000))
        warned = False
        for storey in building.storeys:
            plan = design_plumbing(building, storey.index)
            if any("clear floor" in w or "longer than the walls" in w
                   for w in plan.warnings):
                warned = True
        self.assertTrue(
            warned,
            "a small plot produced no clearance or fit warning at all",
        )

    def test_pipe_runs_are_orthogonal(self):
        building = _building()
        for storey in building.storeys:
            plan = design_plumbing(building, storey.index)
            for run in plan.runs:
                for (x0, y0), (x1, y1) in zip(run.points, run.points[1:]):
                    self.assertTrue(
                        x0 == x1 or y0 == y1,
                        f"{run.kind} pipe runs diagonally",
                    )


if __name__ == "__main__":
    unittest.main()
