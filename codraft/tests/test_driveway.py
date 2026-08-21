"""The driveway, and the line between what a drawing may and may not claim.

A garage with no driveway is an oversight rather than a design decision, so
one is drawn wherever there is a garage. What it is drawn AS is geometry the
plan already knows -- it runs from the street boundary to the garage door and
is as wide as the door it serves.

What the drawing must not do is imply the crossover is settled. The paving
between the kerb and the front boundary is on the council's land, every
council sets its own width and offsets, and most want a separate application.
So the crossover is drawn only when a width is given, drawn dashed and
outside the lot line, and always carries a note saying who it belongs to.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.site import place_driveway
from codraft.model import Function, Plot
from codraft.program import template


def _plot(width=15000, depth=30000, road="south", **kwargs):
    kwargs.setdefault("setback_front", 6000)
    kwargs.setdefault("setback_rear", 6000)
    kwargs.setdefault("setback_left", 1000)
    kwargs.setdefault("setback_right", 1000)
    return Plot(rect=Rect(0, 0, width, depth), road_side=road, **kwargs)


def _built(road="south", **kwargs):
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
    plot = _plot(road=road, **kwargs)
    layout = solve(program, plot)
    building = build_building(program, plot, layout)
    garage = next((s for s in building.storeys[0].spaces
                   if s.function is Function.GARAGE), None)
    return plot, layout, building, garage


class TestItReachesBothEnds(unittest.TestCase):
    """A driveway that stops short of either end is not a driveway."""

    def test_it_meets_the_street_boundary(self):
        plot, layout, _, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect)
        self.assertIsNotNone(drive)
        self.assertEqual(drive.rect.y0, plot.rect.y0,
                         "the driveway does not reach the front boundary")

    def test_it_meets_the_house(self):
        plot, layout, _, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect)
        self.assertEqual(drive.rect.y1, layout.envelope.y0,
                         "the driveway stops short of the building")

    def test_it_is_as_wide_as_the_garage_it_serves(self):
        # Narrower and you clip your mirrors; wider and it is paving nobody
        # drives on. Either way the number should come from the garage rather
        # than from a table.
        plot, layout, _, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect)
        self.assertEqual(drive.width_mm, garage.rect.w)

    def test_it_lines_up_with_the_garage(self):
        plot, layout, _, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect)
        self.assertEqual(drive.rect.x0, garage.rect.x0)

    def test_it_does_not_run_under_the_house(self):
        plot, layout, _, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect)
        self.assertIsNone(
            drive.rect.intersection(layout.envelope),
            "the driveway overlaps the building footprint",
        )

    def test_every_road_side_works(self):
        for road in ("south", "north", "east", "west"):
            plot, layout, _, garage = _built(road=road)
            if garage is None:
                continue
            drive, _ = place_driveway(plot, layout.envelope, garage.rect)
            self.assertIsNotNone(drive, f"no driveway with the road {road}")
            self.assertGreater(drive.length_mm, 0)
            self.assertGreater(drive.width_mm, 0)


class TestWhatItRefusesToClaim(unittest.TestCase):
    def test_the_crossover_always_carries_its_caveat(self):
        plot, layout, _, garage = _built()
        _, notes = place_driveway(plot, layout.envelope, garage.rect, 4000)
        joined = " ".join(notes)
        self.assertIn("council", joined)
        self.assertIn("separate application", joined)
        self.assertIn("approved by anybody", joined)

    def test_the_caveat_is_there_even_with_no_crossover_drawn(self):
        # Not drawing it does not mean it is not needed.
        plot, layout, _, garage = _built()
        _, notes = place_driveway(plot, layout.envelope, garage.rect, 0)
        self.assertTrue(any("council" in n for n in notes))

    def test_no_garage_means_no_driveway(self):
        plot, layout, _, _ = _built()
        drive, notes = place_driveway(plot, layout.envelope, None)
        self.assertIsNone(drive)
        self.assertEqual(notes, [])

    def test_a_house_on_the_boundary_is_reported_rather_than_drawn(self):
        # No setback means no room for a driveway inside the lot. Saying so
        # beats drawing a zero-length one.
        plot = _plot(setback_front=0)
        program = template("au-house", bedrooms=3, bathrooms=2, storeys=1)
        layout = solve(program, plot)
        drive, notes = place_driveway(
            plot, layout.envelope, Rect(2000, 0, 5500, 5500)
        )
        self.assertIsNone(drive)
        self.assertTrue(any("no driveway to draw" in n for n in notes))


class TestItReachesTheDrawing(unittest.TestCase):
    def test_the_driveway_and_its_size_are_drawn_on_the_ground_floor(self):
        from codraft.export.svg import build_sheet

        plot, layout, building, garage = _built()
        drive, _ = place_driveway(plot, layout.envelope, garage.rect, 4000)
        building.driveway = drive
        canvas, *_ = build_sheet(building, storey_index=0, sheet="site")
        markup = "\n".join(canvas.parts)
        self.assertIn("DRIVEWAY", markup)
        self.assertIn(f"{drive.width_mm} wide x {drive.length_mm} long", markup)
        self.assertIn("drive-cross", markup, "the crossover was not drawn")

        # Paving belongs to the lot, so it goes on the site plan and not on
        # the floor plan. Drawing the lot alongside the house is what forced
        # the floor plans down to 1:200.
        floor, *_ = build_sheet(building, storey_index=0)
        self.assertNotIn("DRIVEWAY", "\n".join(floor.parts))

    def test_it_is_not_repeated_on_the_upper_floor(self):
        from codraft.export.svg import build_sheet

        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        plot = _plot()
        layout = solve(program, plot)
        building = build_building(program, plot, layout)
        garage = next(s for s in building.storeys[0].spaces
                      if s.function is Function.GARAGE)
        building.driveway = place_driveway(
            plot, layout.envelope, garage.rect, 4000
        )[0]
        upper, *_ = build_sheet(building, storey_index=1, sheet="site")
        self.assertNotIn("DRIVEWAY", "\n".join(upper.parts))

    def test_the_sheet_title_clears_the_paving(self):
        # The title used to be positioned from the plan's bottom edge, which
        # put it straight through the driveway the moment there was one.
        from codraft.export.svg import build_sheet

        plot, layout, building, garage = _built()
        building.driveway = place_driveway(
            plot, layout.envelope, garage.rect, 4000
        )[0]
        canvas, *_ = build_sheet(building, storey_index=0, sheet="site")
        titles = [op for op in canvas.ops
                  if op[0] == "text" and op[1] == "title"]
        self.assertTrue(titles)
        drive_bottom = building.driveway.rect.y0
        for op in titles:
            self.assertLess(
                op[3], drive_bottom,
                "the sheet title sits over the driveway",
            )


if __name__ == "__main__":
    unittest.main()
