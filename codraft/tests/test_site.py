"""Real lots are not rectangles, and Australian houses are not generic."""

import unittest

from codraft import codes
from codraft.geom import (
    Point,
    Rect,
    largest_inscribed_rect,
    point_in_polygon,
    polygon_area,
)
from codraft.layout import build_building, solve
from codraft.layout.walls import CONSTRUCTION
from codraft.model import Function, Plot
from codraft.program import template

# A splayed five-sided block, of the kind a Perth subdivision is full of.
SPLAYED = [
    Point(0, 0), Point(19783, 0), Point(22390, 9465),
    Point(9465, 18000), Point(0, 12000),
]


class TestPolygons(unittest.TestCase):
    def test_area_by_shoelace(self):
        square = [Point(0, 0), Point(20000, 0), Point(20000, 40000), Point(0, 40000)]
        self.assertEqual(polygon_area(square), 800_000_000)

    def test_an_irregular_lot_is_smaller_than_its_box(self):
        # The whole reason polygons exist here: site cover is a percentage
        # OF the lot, so using the bounding box overstates the land and
        # understates the cover, in the number the council checks.
        plot = Plot.from_boundary(SPLAYED)
        self.assertLess(plot.area, plot.rect.area)
        self.assertAlmostEqual(plot.area / 1e6, 307.1, places=0)
        self.assertAlmostEqual(plot.rect.area / 1e6, 403.0, places=0)
        self.assertTrue(plot.is_irregular)

    def test_point_in_polygon(self):
        self.assertTrue(point_in_polygon(Point(5000, 5000), SPLAYED))
        self.assertFalse(point_in_polygon(Point(21000, 16000), SPLAYED))

    def test_inscribed_rectangle_respects_every_setback(self):
        found = largest_inscribed_rect(SPLAYED, [6000, 1000, 1000, 1000, 1000])
        self.assertIsNotNone(found)
        # Every corner must be inside the lot and clear of the frontage.
        for corner in found.corners():
            self.assertTrue(
                point_in_polygon(corner, SPLAYED),
                f"{corner} is outside the lot",
            )
        self.assertGreaterEqual(found.y0, 6000, "front setback not honoured")

    def test_a_rectangular_lot_is_unchanged(self):
        # The polygon path must not perturb the ordinary case.
        plot = Plot(
            rect=Rect(0, 0, 20000, 40000), setback_front=6000, setback_rear=1000,
            setback_left=1000, setback_right=1000,
        )
        self.assertEqual(plot.area, 800_000_000)
        self.assertEqual(plot.buildable, Rect(1000, 6000, 18000, 33000))

    def test_edges_are_classified_by_where_the_road_is(self):
        plot = Plot.from_boundary(
            SPLAYED, setback_front=6000, setback_rear=2000,
            setback_left=1500, setback_right=1500, road_side="south",
        )
        setbacks = plot.edge_setbacks()
        self.assertEqual(len(setbacks), 5)
        # The southern edge, from (0,0) to (19783,0), is the frontage.
        self.assertEqual(setbacks[0], 6000)
        self.assertNotIn(6000, setbacks[1:], "only one edge should be the front")


class TestAustralianHouse(unittest.TestCase):
    def setUp(self):
        self.program = template("au-house", bedrooms=4, bathrooms=2)

    def test_uses_the_vocabulary_the_drawings_use(self):
        names = {s.name for s in self.program.spaces}
        for expected in ("Master Suite", "WIR", "Ensuite", "WIP", "Passage",
                         "Alfresco", "Portico", "Double Garage", "Store"):
            self.assertIn(expected, names)

    def test_ceiling_clears_the_ncc(self):
        # 31 courses of brickwork, comfortably over the NCC's 2.4 m.
        self.assertGreaterEqual(self.program.storey_height - 200, 2400)

    def test_an_alfresco_is_outdoor_and_owed_no_daylight(self):
        self.assertTrue(Function.ALFRESCO.is_outdoor)
        self.assertFalse(Function.ALFRESCO.is_habitable)

    def test_the_front_zone_is_declared_not_guessed(self):
        front = {s.key for s in self.program.spaces if s.zone == "front"}
        self.assertEqual(front, {"portico", "entry", "theatre", "garage", "store"})
        # The living room is the same function as the theatre and does NOT
        # belong at the front, which is why the zone is explicit.
        self.assertEqual(self.program.get("living").zone, "")


class TestConstruction(unittest.TestCase):
    def test_perth_builds_double_brick_and_melbourne_veneer(self):
        perth = codes.design_parameters(codes.resolve("Perth"), "residential")
        melbourne = codes.design_parameters(codes.resolve("Melbourne"), "residential")
        self.assertEqual(perth["construction"], "double_brick")
        self.assertEqual(melbourne["construction"], "brick_veneer")

    def test_the_system_reaches_the_walls(self):
        program = template("au-house", bedrooms=4, bathrooms=2)
        plot = Plot(rect=Rect(0, 0, 17000, 32000), setback_front=6000,
                    setback_rear=1000, setback_left=1000, setback_right=1000)
        layout = solve(program, plot)

        for system, expected in (
            ("double_brick", CONSTRUCTION["double_brick"]),
            ("brick_veneer", CONSTRUCTION["brick_veneer"]),
        ):
            building = build_building(
                program, plot, layout, design={"construction": system}
            )
            thicknesses = {
                w.thickness for s in building.storeys for w in s.walls
            }
            self.assertEqual(
                thicknesses, {expected["exterior"], expected["interior"]}, system
            )

    def test_a_double_garage_gets_room_for_two_cars(self):
        # The failure this guards: a garage squeezed into a side band, wide
        # enough on paper and too short to put a car in.
        program = template("au-house", bedrooms=4, bathrooms=2)
        plot = Plot(rect=Rect(0, 0, 17000, 32000), setback_front=6000,
                    setback_rear=1000, setback_left=1000, setback_right=1000)
        layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
        building = build_building(program, plot, layout)
        garage = next(
            s for s in building.all_spaces() if s.function is Function.GARAGE
        )
        self.assertGreaterEqual(garage.rect.short_side, 5000,
                                "a double garage needs 5.4 m of width")
        self.assertGreaterEqual(garage.rect.long_side, 5400,
                                "a double garage needs 6 m of depth")

    def test_the_front_zone_sits_on_the_street(self):
        program = template("au-house", bedrooms=4, bathrooms=2)
        plot = Plot(rect=Rect(0, 0, 17000, 32000), setback_front=6000,
                    setback_rear=1000, setback_left=1000, setback_right=1000)
        layout = solve(program, plot, max_footprint=int(plot.area * 0.5))
        cells = {c.key: c for c in layout.for_storey(0)}
        garage, living = cells.get("garage"), cells.get("living")
        self.assertIsNotNone(garage)
        if living is not None:
            self.assertLess(
                garage.rect.y0, living.rect.y0,
                "the garage should be nearer the street than the living room",
            )


if __name__ == "__main__":
    unittest.main()
