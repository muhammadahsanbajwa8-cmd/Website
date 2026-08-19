"""The solver has to produce geometry that closes, every time."""

import unittest

from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.solver import LayoutError
from codraft.model import Function, Plot
from codraft.program import template


def _plot(width=12192, depth=18288, **kwargs):
    return Plot(rect=Rect(0, 0, width, depth), **kwargs)


class TestSolver(unittest.TestCase):
    def test_tiles_do_not_overlap(self):
        program = template("house", bedrooms=3, bathrooms=2, storeys=2)
        layout = solve(program, _plot(setback_front=3048, setback_rear=1524))
        for storey in range(program.storeys):
            cells = layout.for_storey(storey)
            self.assertTrue(cells, f"storey {storey} came out empty")
            for i, a in enumerate(cells):
                for b in cells[i + 1:]:
                    overlap = a.rect.intersection(b.rect)
                    self.assertIsNone(
                        overlap,
                        f"{a.key} and {b.key} overlap by {overlap}",
                    )

    def test_tiles_fill_the_footprint_exactly(self):
        # The tiling is what wall generation depends on: a gap between two
        # tiles becomes a wall with nothing on the far side of it.
        program = template("house", bedrooms=3, bathrooms=2, storeys=2)
        layout = solve(program, _plot(setback_front=3048, setback_rear=1524))
        for storey in range(program.storeys):
            covered = sum(c.area for c in layout.for_storey(storey))
            self.assertEqual(covered, layout.envelope.area)

    def test_deterministic(self):
        program = template("house", bedrooms=4, bathrooms=2, storeys=2)
        first = solve(program, _plot())
        second = solve(template("house", bedrooms=4, bathrooms=2, storeys=2), _plot())
        self.assertEqual(
            [(c.key, c.rect) for c in first.cells],
            [(c.key, c.rect) for c in second.cells],
        )

    def test_footprint_respects_a_coverage_cap(self):
        program = template("house", bedrooms=3, bathrooms=2)
        plot = _plot()
        cap = int(plot.area * 0.25)
        layout = solve(program, plot, max_footprint=cap)
        self.assertLessEqual(layout.envelope.area, cap)

    def test_impossible_plot_is_refused(self):
        with self.assertRaises(LayoutError):
            solve(template("house"), _plot(setback_front=10000, setback_rear=10000))

    def test_narrow_plot_is_refused_rather_than_drawn(self):
        with self.assertRaises(LayoutError):
            solve(template("house"), _plot(width=1500, depth=20000))


class TestBuilding(unittest.TestCase):
    def setUp(self):
        self.program = template("house", bedrooms=3, bathrooms=2, storeys=2)
        self.plot = _plot(setback_front=3048, setback_rear=1524)
        self.layout = solve(self.program, self.plot)
        self.building = build_building(self.program, self.plot, self.layout)

    def test_every_room_is_walled(self):
        for storey in self.building.storeys:
            for space in storey.spaces:
                walls = [w for w in storey.walls if space.id in w.separates]
                self.assertGreaterEqual(
                    len(walls), 4, f"{space.name} has only {len(walls)} walls"
                )

    def test_every_non_circulation_room_has_a_door(self):
        for storey in self.building.storeys:
            for space in storey.spaces:
                if space.function.is_circulation:
                    continue
                self.assertTrue(
                    storey.openings_of(space.id),
                    f"{space.name} has no opening at all",
                )

    def test_there_is_a_front_door(self):
        ground = self.building.storey(0)
        self.assertTrue([o for o in ground.openings if o.is_egress])

    def test_clear_area_is_less_than_the_tile(self):
        # Rooms are measured inside their walls. If a room's reported area
        # equalled its tile, every minimum would be overstated.
        for storey, cells in ((0, self.layout.for_storey(0)),):
            for cell in cells:
                space = self.building.storey(storey).space(cell.key)
                self.assertLess(space.area, cell.area)

    def test_stairs_are_climbable(self):
        for storey in self.building.storeys:
            for stair in storey.stairs:
                self.assertGreater(stair.riser_height, 0)
                self.assertGreaterEqual(stair.tread_depth, 250)
                self.assertEqual(
                    stair.riser_height * stair.risers, storey.height - (storey.height % stair.risers)
                )


if __name__ == "__main__":
    unittest.main()
