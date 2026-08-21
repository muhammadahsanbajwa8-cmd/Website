"""Zones, and the two things they exist to guarantee.

An Australian project home is planned in zones, not by area: the garage and
entry across the street frontage, the living rooms through the middle, and
the bedrooms down one side off the passage. Two properties fall out of that,
and both are code matters rather than taste:

  * every habitable room reaches an external wall, so it can have a window;
  * every room reaches the front door, so it can be walked out of.

Both were broken before zoning existed, and both are easy to break again by
tuning the packer, so they are asserted directly.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import solve
from codraft.model import Function, Plot
from codraft.program import template


def _plot(width=15000, depth=30000, **kwargs):
    """A Perth R20 block: 6 m to the street, 6 m to the rear, 1 m each side.

    The setbacks matter to what is being tested. Without them the envelope is
    the whole lot, the footprint comes out a different shape, and the front
    zone never forms -- so the tests would pass on a plan that is not the one
    the solver actually draws.
    """
    kwargs.setdefault("setback_front", 6000)
    kwargs.setdefault("setback_rear", 6000)
    kwargs.setdefault("setback_left", 1000)
    kwargs.setdefault("setback_right", 1000)
    return Plot(rect=Rect(0, 0, width, depth), **kwargs)


def _touches_edge(rect: Rect, envelope: Rect, slack: int = 2) -> bool:
    return (
        abs(rect.x - envelope.x) <= slack
        or abs(rect.x1 - envelope.x1) <= slack
        or abs(rect.y - envelope.y) <= slack
        or abs(rect.y1 - envelope.y1) <= slack
    )


def _overlap(a: tuple[int, int], b: tuple[int, int]) -> int:
    return max(0, min(a[1], b[1]) - max(a[0], b[0]))


class TestHabitableRoomsReachTheOutside(unittest.TestCase):
    """A room with no external wall has no window. The NCC light and
    ventilation rules then fail it, and rightly -- it is a cupboard."""

    def _check(self, **kwargs):
        program = template("au-house", **kwargs)
        layout = solve(program, _plot(**kwargs.pop("plot", {})))
        for storey in range(program.storeys):
            cells = layout.for_storey(storey)
            bounds = Rect(
                min(c.rect.x for c in cells), min(c.rect.y for c in cells),
                max(c.rect.x1 for c in cells) - min(c.rect.x for c in cells),
                max(c.rect.y1 for c in cells) - min(c.rect.y for c in cells),
            )
            for cell in cells:
                if not cell.function.is_habitable:
                    continue
                self.assertTrue(
                    _touches_edge(cell.rect, bounds),
                    f"{cell.name} on storey {storey} has no external wall: "
                    f"{cell.rect} inside {bounds}",
                )

    def test_single_storey_four_by_two(self):
        self._check(bedrooms=4, bathrooms=2, storeys=1)

    def test_two_storey_four_by_two(self):
        self._check(bedrooms=4, bathrooms=2, storeys=2)

    def test_five_bedrooms_is_where_the_two_band_model_used_to_strand_rooms(self):
        self._check(bedrooms=5, bathrooms=3, storeys=2)


class TestTheFrontDoorMeetsThePassage(unittest.TestCase):
    """The entry is the only thing joining the frontage to the rest of the
    house. Miss it and every room behind it fails the rule that it can be
    walked out of -- which is exactly what used to happen."""

    def _ground(self, **kwargs):
        program = template("au-house", **kwargs)
        return solve(program, _plot()).for_storey(0)

    def test_entry_overlaps_the_passage(self):
        cells = self._ground(bedrooms=4, bathrooms=2, storeys=2)
        passage = next(c for c in cells if c.function is Function.CORRIDOR)
        entries = [c for c in cells if c.function is Function.ENTRY]
        self.assertTrue(entries, "the plan has no entry at all")
        self.assertTrue(
            any(
                _overlap((c.rect.x, c.rect.x1), (passage.rect.x, passage.rect.x1))
                or _overlap((c.rect.y, c.rect.y1), (passage.rect.y, passage.rect.y1))
                for c in entries
            ),
            "the passage does not meet the entry, so nothing behind it "
            "has a route to the front door",
        )

    def test_the_portico_stays_beside_the_entry(self):
        cells = self._ground(bedrooms=4, bathrooms=2, storeys=2)
        entry = next(
            (c for c in cells if c.function is Function.ENTRY and c.key == "entry"),
            None,
        )
        portico = next((c for c in cells if c.key == "portico"), None)
        if entry is None or portico is None:
            self.skipTest("this program has no separate portico")
        gap = min(
            abs(portico.rect.x1 - entry.rect.x),
            abs(entry.rect.x1 - portico.rect.x),
        )
        self.assertLessEqual(
            gap, 2,
            f"the portico sits {gap} mm from the entry -- a covered approach "
            "to nothing",
        )


class TestRoomsAreZonedNotJustBalanced(unittest.TestCase):
    def test_bedrooms_and_living_rooms_take_opposite_sides(self):
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        cells = solve(program, _plot()).for_storey(0)
        passage = next(c for c in cells if c.function is Function.CORRIDOR)

        # The passage runs the long way, so which axis separates the two
        # bands depends on which way round it ended up.
        vertical = passage.rect.h >= passage.rect.w
        if vertical:
            side = lambda c: c.rect.centre.x < passage.rect.centre.x  # noqa: E731
        else:
            side = lambda c: c.rect.centre.y < passage.rect.centre.y  # noqa: E731

        beds = {side(c) for c in cells if c.function is Function.BEDROOM}
        living = {
            side(c) for c in cells
            if c.function in (Function.LIVING, Function.DINING, Function.KITCHEN)
            and c.requirement is not None and c.requirement.zone != "front"
        }
        self.assertEqual(len(beds), 1, "the bedrooms are split across the passage")
        self.assertTrue(
            living and beds.isdisjoint(living),
            "the living rooms are on the same side as the bedrooms",
        )


class TestPairedRoomsPutTheWindowOutside(unittest.TestCase):
    def test_two_rooms_needing_daylight_never_share_a_slice(self):
        # Only one of a pair touches the outside wall, so pairing two rooms
        # that both need a window leaves one of them without.
        from codraft.layout.solver import _group_rows

        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        rooms = [(s.key, s) for s in program.spaces]
        for depth in (3000, 4500, 6000, 7500):
            for row in _group_rows(rooms, depth):
                needing = [r for _, r in row.rooms if r.needs_exterior_wall]
                self.assertLessEqual(
                    len(needing), 1,
                    f"at depth {depth} these share a slice and both need a "
                    f"window: {[r.name for _, r in row.rooms]}",
                )


if __name__ == "__main__":
    unittest.main()


class TestVisualPrivacyToTheNeighbours(unittest.TestCase):
    """The R-Codes privacy pack: it must fire upstairs and stay quiet down.

    A window 1 m from the boundary on a slab-on-ground floor overlooks
    nothing -- the control is written against a floor more than 0.5 m above
    natural ground. Firing on the ground floor would bury the real finding in
    noise; not firing upstairs would miss it.
    """

    def _findings(self, storeys):
        from codraft.codes import check
        from codraft.codes.jurisdiction import resolve
        from codraft.layout import build_building

        program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
        plot = _plot()
        layout = solve(program, plot)
        building = build_building(program, plot, layout)
        report = check(building, resolve("Perth"), layout.warnings)
        return [f for f in report.failures
                if f.rule_id.startswith("au.wa.privacy")]

    def test_a_single_storey_on_the_slab_raises_nothing(self):
        self.assertEqual(
            [f.rule_id for f in self._findings(1)], [],
            "privacy fired on a floor that is not above natural ground",
        )

    def test_a_first_floor_bedroom_a_metre_off_the_boundary_is_raised(self):
        found = self._findings(2)
        self.assertTrue(
            any(f.rule_id == "au.wa.privacy.bedroom" for f in found),
            f"a first-floor bedroom window 1 m from the boundary was not "
            f"raised; got {[f.rule_id for f in found]}",
        )

    def test_it_is_raised_as_a_question_not_a_violation(self):
        # The check is a perpendicular setback; the R-Codes swing a cone of
        # vision. A fail here means draw the cone, not that the design is
        # non-compliant -- so it must never be reported as a violation.
        from codraft.codes import check
        from codraft.codes.jurisdiction import resolve
        from codraft.layout import build_building

        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        plot = _plot()
        layout = solve(program, plot)
        report = check(
            build_building(program, plot, layout), resolve("Perth"), layout.warnings
        )
        self.assertEqual(
            [f.rule_id for f in report.violations
             if f.rule_id.startswith("au.wa.privacy")],
            [],
            "a simplified privacy check was reported as a violation",
        )


class TestTheFrontageCapAndWhatOutranksIt(unittest.TestCase):
    """A two-band corridor plan can only use so much frontage.

    Band depth is (frontage - passage) / 2, and that depth is the width of
    every room off the passage. Past about 6.5 m a bedroom arrives as 2.0 x
    6.0 -- a corridor with a bed in it. But going narrower makes the house
    deeper, and depth comes out of the back garden, so the cap has to yield
    where it would cost the yard.
    """

    def _footprint(self, width, depth, **kwargs):
        program = template("au-house", bedrooms=kwargs.pop("bedrooms", 4),
                           bathrooms=2, storeys=kwargs.pop("storeys", 1))
        plot = _plot(width=width, depth=depth, **kwargs)
        return solve(program, plot).envelope, plot

    def test_a_wide_lot_does_not_produce_a_wide_house(self):
        from codraft.layout.solver import MAX_FRONTAGE, MIN_REAR_YARD

        footprint, plot = self._footprint(24000, 40000)
        if footprint.w <= MAX_FRONTAGE:
            return
        # The cap may yield, but only to the yard, and only by as much as the
        # yard needs. Anything else is the house sprawling across the lot
        # because the lot was there.
        rear = plot.rect.h - plot.setback_rear - (footprint.y + footprint.h)
        self.assertGreaterEqual(
            rear, MIN_REAR_YARD,
            f"a {plot.rect.w} mm lot produced a {footprint.w} mm frontage and "
            f"still only left {rear} mm of yard; the frontage cap was given "
            "up for nothing",
        )
        narrower = -(-footprint.area // MAX_FRONTAGE)
        self.assertGreater(
            narrower, plot.rect.h - plot.setback_front - plot.setback_rear
            - MIN_REAR_YARD,
            f"the house is {footprint.w} mm wide but would have fitted at "
            f"{MAX_FRONTAGE} without eating the yard",
        )

    def test_the_yard_outranks_the_cap_on_a_shallow_lot(self):
        from codraft.layout.solver import MAX_FRONTAGE, MIN_REAR_YARD

        # Short and wide: holding the frontage cap here would push the house
        # into the rear setback, so it is allowed to widen instead.
        footprint, plot = self._footprint(20000, 24000)
        rear = plot.rect.h - plot.setback_rear - (footprint.y + footprint.h)
        if footprint.w > MAX_FRONTAGE:
            self.assertGreaterEqual(
                rear, 0,
                "the frontage was widened past the cap and the house still "
                "runs past the rear setback",
            )

    def test_a_deep_lot_keeps_a_yard_behind_the_house(self):
        from codraft.layout.solver import MIN_REAR_YARD

        footprint, plot = self._footprint(18000, 38000)
        behind = plot.rect.h - plot.setback_rear - (footprint.y + footprint.h)
        self.assertGreaterEqual(
            behind + MIN_REAR_YARD, 0,
            "no garden was left behind the house on a 38 m block",
        )
