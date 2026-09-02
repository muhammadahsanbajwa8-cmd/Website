"""A garage with no driveway is an oversight, not a design decision."""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, Plot
from codraft.program import template

LOTS = [(10500, 32000), (15000, 30000), (18000, 30000)]


def _built(width=15000, depth=30000, storeys=2, road="south"):
    design = design_parameters(resolve("AU-WA"))
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    program.build_to(design)
    plot = Plot(rect=Rect(0, 0, width, depth), road_side=road,
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=design), layout


class BuildBuildingPlacesTheDriveway(unittest.TestCase):
    def test_a_plan_with_a_garage_gets_one(self):
        # Only `cli.py` used to place it, so a site plan built through the
        # library showed a double garage on a lot with no way to drive to it.
        building, _ = _built()
        self.assertIsNotNone(building.driveway)

    def test_it_is_as_wide_as_the_garage_it_serves(self):
        # Narrower and you clip your mirrors; wider is paving nobody drives
        # on. The width is the garage's own, not a figure from a table.
        building, _ = _built()
        garage = next(sp for sp in building.storeys[0].spaces
                      if sp.function is Function.GARAGE)
        self.assertEqual(building.driveway.width_mm, garage.rect.w)

    def test_it_runs_from_the_street_boundary_to_the_house(self):
        building, layout = _built()
        drive = building.driveway
        self.assertEqual(drive.rect.y0, building.plot.rect.y0)
        self.assertEqual(drive.rect.y1, layout.envelope.y0)

    def test_every_plan_in_a_sweep_of_lots_has_one(self):
        design = design_parameters(resolve("AU-WA"))
        seen = 0
        for width, depth in LOTS:
            for storeys in (1, 2):
                program = template("au-house", bedrooms=4, bathrooms=2,
                                   storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=6000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue
                building = build_building(program, plot, layout, design=design)
                seen += 1
                with self.subTest(lot=f"{width}x{depth}", storeys=storeys):
                    self.assertIsNotNone(building.driveway)
        self.assertGreater(seen, 3)

    def test_it_is_drawn_on_the_site_plan_with_its_size(self):
        from codraft.export.svg import build_sheet

        building, layout = _built()
        canvas, *_ = build_sheet(building, 0, "site", None, layout.envelope,
                                 "metric")
        body = "\n".join(canvas.parts)
        self.assertIn("DRIVEWAY", body)
        self.assertIn(str(building.driveway.width_mm), body)


if __name__ == "__main__":
    unittest.main()
