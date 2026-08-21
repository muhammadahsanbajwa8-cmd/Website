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


class TestABriefThatDoesNotFitIsRefused(unittest.TestCase):
    """A plan of slivers is not a smaller version of a good plan.

    The solver has said since its first line that a room under 900 mm across
    is unusable whatever a code says and that it refuses to emit one. It did
    not refuse. Asked for five bedrooms on a 9 x 22 m lot it warned that
    rooms had been "scaled down proportionally" and drew a linen cupboard
    139 mm deep and a WC with a dimension of zero -- and a warning is the
    wrong instrument, because the customer reads the drawing, not the log.

    The line for refusing is well under 900: at 600 mm a 720 mm door leaf
    will not fit, so nothing can get in. Between 600 and 900 the plan is
    drawn and every room in that band is named. Under 600 there is nothing
    to name it for.
    """

    def _plot(self, width, depth):
        return Plot(rect=Rect(0, 0, width, depth), road_side="south",
                    setback_front=6000, setback_rear=6000,
                    setback_left=1000, setback_right=1000)

    def test_five_bedrooms_on_a_nine_metre_block_is_refused(self):
        program = template("au-house", bedrooms=5, bathrooms=3, storeys=1)
        with self.assertRaises(LayoutError) as caught:
            solve(program, self._plot(9000, 22000))
        self.assertIn("does not fit on this lot", str(caught.exception))

    def test_the_refusal_says_what_would_fit_instead(self):
        # The answer somebody needs is a number of storeys or a number of
        # bedrooms, not a rectangle.
        program = template("au-house", bedrooms=5, bathrooms=3, storeys=1)
        with self.assertRaises(LayoutError) as caught:
            solve(program, self._plot(9000, 22000))
        message = str(caught.exception)
        self.assertRegex(message, r"needs about \d+ m2 per floor")
        self.assertRegex(message, r"wants about \d+ storeys")

    def test_the_refusal_names_the_rooms_and_their_sizes(self):
        program = template("au-house", bedrooms=5, bathrooms=3, storeys=1)
        with self.assertRaises(LayoutError) as caught:
            solve(program, self._plot(9000, 22000))
        self.assertRegex(str(caught.exception), r"\w+ at \d+ x \d+ mm")

    def test_what_a_builder_actually_sells_still_draws(self):
        # The refusal is worth nothing if it also refuses the ordinary work.
        # Bedroom counts matched to the block, the way a project builder
        # matches a design to a lot.
        for width, depth, beds, storeys in (
            (10000, 28000, 4, 2), (12500, 28000, 3, 1), (12500, 28000, 4, 1),
            (15000, 28000, 4, 1), (15000, 30000, 4, 1), (17000, 32000, 4, 1),
            (18000, 30000, 5, 1), (20000, 35000, 5, 1),
        ):
            with self.subTest(lot=f"{width}x{depth}", beds=beds):
                program = template("au-house", bedrooms=beds, bathrooms=2,
                                   storeys=storeys)
                layout = solve(program, self._plot(width, depth))
                self.assertTrue(layout.cells)

    def test_a_room_under_nine_hundred_is_still_named_even_when_drawn(self):
        # The band between refusing and being happy: drawn, and declared.
        from codraft.layout.solver import _ABSOLUTE_MIN_DIM, _WALL_ALLOWANCE

        program = template("au-house", bedrooms=3, bathrooms=2, storeys=1)
        layout = solve(program, self._plot(12500, 28000))
        declared = "\n".join(layout.unsatisfied)
        for cell in layout.cells:
            clear = cell.rect.short_side - _WALL_ALLOWANCE
            if clear < _ABSOLUTE_MIN_DIM:
                with self.subTest(room=cell.name):
                    self.assertIn(cell.name, declared)
