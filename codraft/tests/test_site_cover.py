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


class TestTheFloorAreaRatioIsHonouredToo(unittest.TestCase):
    """Cover limits the footprint; a ratio limits it times the storeys.

    A three-storey brief comfortably inside its cover cap can be half again
    over its floor-area ratio, and the solver was never told the second
    limit. Fifteen of a hundred and six Pakistani plans were over it, by up
    to 0.25 -- every one of them under its cover cap.
    """

    CITIES = ("Lahore", "Karachi", "Islamabad")
    LOTS = ((12000, 20000), (15000, 25000), (18000, 30000))

    def _controls(self, city):
        from codraft.codes import site_parameters

        j = resolve(city)
        return j, site_parameters(j, "residential"), design_parameters(j)

    def test_a_plan_built_to_both_caps_breaks_neither(self):
        for city in self.CITIES:
            j, site, design = self._controls(city)
            cover = site.get("max_coverage_ratio")
            ratio = site.get("max_floor_area_ratio")
            self.assertTrue(ratio, f"{city} states no floor-area ratio to test")
            for width, depth in self.LOTS:
                for storeys in (1, 2, 3):
                    plot = Plot(rect=Rect(0, 0, width, depth),
                                road_side="south", setback_front=4500,
                                setback_rear=1500, setback_left=1000,
                                setback_right=1000)
                    program = template("au-house", bedrooms=4, bathrooms=2,
                                       storeys=storeys)
                    program.build_to(design)
                    try:
                        layout = solve(
                            program, plot,
                            max_footprint=int(plot.area * float(cover))
                            if cover else None,
                            max_gross_area=int(plot.area * float(ratio)),
                        )
                    except Exception as refused:      # noqa: BLE001
                        if type(refused).__name__ != "LayoutError":
                            raise
                        continue
                    building = build_building(program, plot, layout,
                                              design=design)
                    with self.subTest(city=city, lot=(width, depth),
                                      storeys=storeys):
                        self.assertLessEqual(
                            round(building.floor_area_ratio, 4),
                            round(float(ratio), 4),
                            f"{building.floor_area_ratio:.2f} against a "
                            f"{ratio} ratio",
                        )
                        if cover:
                            self.assertLessEqual(
                                round(building.coverage_ratio, 4),
                                round(float(cover), 4),
                            )

    def test_the_tighter_cap_is_the_one_that_binds(self):
        # Three storeys under a 1.4 ratio may cover less ground than the
        # cover cap alone would allow, and the solver has to take the smaller.
        plot = Plot(rect=Rect(0, 0, 15000, 25000), road_side="south",
                    setback_front=4500, setback_rear=1500,
                    setback_left=1000, setback_right=1000)
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=3)
        one = solve(program, plot, max_footprint=int(plot.area * 0.55))
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=3)
        both = solve(program, plot, max_footprint=int(plot.area * 0.55),
                     max_gross_area=int(plot.area * 1.4))
        self.assertLess(both.envelope.area, one.envelope.area)
