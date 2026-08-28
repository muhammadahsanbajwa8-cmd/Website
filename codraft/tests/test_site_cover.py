"""Site cover is measured over the walls, and built to stay under the cap.

`Space.rect` is the CLEAR rectangle -- what is left once half a wall comes
off each side -- so summing the rooms gives a NET area. `Storey.floor_area`
returned that sum under a docstring saying gross, and every ratio a planning
scheme is written against reads it: on a 15 x 30 m lot a house covering
241.2 m2 was reported at 218.0, and site cover at 48.4 per cent where it is
really 53.6. The R-Codes cap that density at 50, so the plan came back
passing a limit it breached.

The other half is the solver. A cap handed to it as an area was spent on
TILES, and the tiles meet on wall centrelines -- the outline runs half an
external wall further out on every side. Both halves are needed: measuring
honestly without building to it only means the plan fails instead.
"""

import unittest

from codraft.codes import check, design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template

WA = resolve("AU-WA")
DESIGN = design_parameters(WA)
LOTS = [(12500, 28000), (15000, 30000), (18000, 30000), (20000, 35000)]


def _plot(width, depth):
    return Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)


class TestGrossMeansGross(unittest.TestCase):
    def test_the_walls_are_counted(self):
        plot = _plot(15000, 30000)
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        program.build_to(DESIGN)
        layout = solve(program, plot)
        building = build_building(program, plot, layout, design=DESIGN)
        storey = building.storeys[0]
        self.assertGreater(
            storey.floor_area, storey.net_area,
            "gross floor area does not include the walls",
        )
        # The tiling covers the footprint exactly and the walls sit on its
        # edges, so the built outline is the footprint plus half an external
        # wall all round -- never less than the footprint itself.
        self.assertGreaterEqual(storey.floor_area, layout.envelope.area)

    def test_a_plan_built_to_a_cover_cap_stays_under_it(self):
        for width, depth in LOTS:
            for beds in (3, 4, 5):
                plot = _plot(width, depth)
                cap = int(plot.area * 0.5)
                program = template("au-house", bedrooms=beds, bathrooms=2,
                                   storeys=1)
                program.build_to(DESIGN)
                try:
                    layout = solve(program, plot, max_footprint=cap)
                except Exception as refused:      # noqa: BLE001
                    if type(refused).__name__ != "LayoutError":
                        raise
                    continue                      # refusing is not a breach
                building = build_building(program, plot, layout, design=DESIGN)
                with self.subTest(lot=(width, depth), beds=beds):
                    self.assertLessEqual(
                        building.footprint, cap,
                        f"covers {building.footprint / 1e6:.1f} m² against a "
                        f"{cap / 1e6:.1f} m² cap",
                    )

    def test_the_wa_cover_rule_is_not_breached_by_a_plan_built_to_it(self):
        from codraft.codes import site_parameters

        site = site_parameters(WA, "residential", zone="R20")
        ratio = site["max_coverage_ratio"]
        plot = _plot(15000, 30000)
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        program.build_to(DESIGN)
        layout = solve(program, plot, max_footprint=int(plot.area * ratio))
        building = build_building(program, plot, layout, design=DESIGN)
        report = check(building, WA, layout.warnings, site=site)
        breached = [f.rule_id for f in report.violations
                    if "cover" in f.rule_id]
        self.assertEqual(breached, [])


if __name__ == "__main__":
    unittest.main()
