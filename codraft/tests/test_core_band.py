"""The service core: three bands where two would be too deep.

A single spine puts every room across one of two bands, so on a wide
frontage each band is half the frontage deep and every room spans it. A
bedroom on an 18 m frontage came out 7161 x 2127 -- the area is right and
the room is a passage. Pairing is the usual answer and cannot help, because
two rooms that both need daylight can never share a slice and a sleep wing
is nothing but rooms that need daylight.

What a wide house does instead is put the rooms that need no window in the
middle, with a passage down each side. This file is about the two things
that form must not break: every room can still be walked out of, and every
room that needs daylight still has an external wall.
"""

import unittest

from codraft import codes
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.solver import _MAX_ASPECT, _awkward
from codraft.model import Function, Plot
from codraft.program import template

# A 20 x 32 m lot with four bedrooms is the case the core exists for.
WIDE = (20000, 32000)
# A 15 x 30 m Perth block is not: two bands serve it, and the core it would
# otherwise have chosen squeezed the double garage to 4897 mm.
COMMON = (15000, 30000)


def _solve(lot, beds=4, storeys=1):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, *lot), road_side="south", setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    return program, plot, solve(program, plot)


def _used_core(layout):
    return any("middle band" in w for w in layout.warnings)


class TestItFiresOnlyWhereItWins(unittest.TestCase):
    def test_a_wide_frontage_gets_the_core(self):
        _p, _l, layout = _solve(WIDE)
        self.assertTrue(_used_core(layout))

    def test_the_common_block_keeps_a_single_spine(self):
        _p, _l, layout = _solve(COMMON)
        self.assertFalse(_used_core(layout))

    def test_the_double_garage_survives_it(self):
        # The reason the common block keeps a single spine: the core moved
        # the entry and left 4897 mm for two cars.
        for lot in (COMMON, WIDE):
            _program, _plot, layout = _solve(lot)
            garage = next(c for c in layout.for_storey(0)
                          if c.function is Function.GARAGE)
            with self.subTest(lot=lot):
                self.assertGreaterEqual(min(garage.rect.w, garage.rect.h), 5000)

    def test_it_is_chosen_by_measuring_both_not_by_frontage(self):
        # Both layouts get built and the better one wins. A rule of thumb
        # about frontage cannot tell 20 x 32 from 26 x 28.
        _p, _l, wide = _solve(WIDE)
        _p2, _l2, other = _solve((26000, 28000))
        self.assertTrue(_used_core(wide))
        self.assertFalse(_used_core(other))

    def test_the_wide_lot_stops_producing_passage_shaped_bedrooms(self):
        # The fault this form exists for: on an 18 m frontage a bedroom came
        # out 7161 x 2127, which has the right area and is a passage.
        #
        # This asserted that NO room on the floor was over the aspect limit,
        # and that stopped being true when an outdoor room was made to need
        # an external wall like every other room that is not in the middle of
        # the house. The alfresco used to sit in the unlit core -- a sealed
        # room in the centre of the plan, labelled as outdoor space. Out on
        # the wall it takes a slice of the live band, and the dining, the
        # kitchen and the alfresco come out at aspect 2.7 against a limit of
        # 2.2. Over the whole lot sweep that trade is 11 more awkward rooms
        # in 1621, against 25 of 33 alfrescos that were buried.
        #
        # So the assertion is the one the file is actually about: the SLEEP
        # wing is what the core protects, and no bedroom is a passage.
        _p, _l, layout = _solve(WIDE)
        for cell in layout.for_storey(0):
            if cell.function is not Function.BEDROOM:
                continue
            long_side = max(cell.rect.w, cell.rect.h)
            short = max(1, min(cell.rect.w, cell.rect.h))
            with self.subTest(room=cell.name):
                self.assertLessEqual(
                    long_side / short, _MAX_ASPECT,
                    f"{cell.name} is {cell.rect.w} x {cell.rect.h}, which is "
                    "a passage with a bed in it",
                )

    def test_the_core_still_beats_the_spine_on_shape(self):
        # And the count is still worth having: the whole floor is measured,
        # not just its bedrooms, so a regression that made every room
        # awkward would not hide behind the assertion above.
        _p, _l, layout = _solve(WIDE)
        self.assertLessEqual(
            _awkward(layout.for_storey(0))[0], 4,
            "more rooms on the wide lot read like passages than the "
            "alfresco's move to the external wall accounts for",
        )


class TestNothingIsStrandedInTheMiddle(unittest.TestCase):
    def test_no_room_in_the_core_needs_daylight(self):
        _p, _l, layout = _solve(WIDE)
        cells = layout.for_storey(0)
        passages = [c for c in cells if c.function is Function.CORRIDOR]
        self.assertGreaterEqual(len(passages), 2,
                                "the core form has two passages and a link")
        xs = sorted(p.rect.centre.x for p in passages)
        low, high = xs[0], xs[-1]
        for cell in cells:
            if cell.requirement is None or cell.function is Function.CORRIDOR:
                continue
            if not (low < cell.rect.centre.x < high):
                continue
            with self.subTest(room=cell.name):
                self.assertFalse(
                    cell.requirement.needs_exterior_wall,
                    f"{cell.name} is in the core and needs a window",
                )

    def test_every_lit_room_reaches_an_outside_wall(self):
        program, plot, layout = _solve(WIDE)
        building = build_building(program, plot, layout)
        envelope = layout.envelope
        for space in building.storeys[0].spaces:
            req = next((c.requirement for c in layout.for_storey(0)
                        if c.name == space.name), None)
            if req is None or not req.needs_exterior_wall:
                continue
            r = space.rect
            with self.subTest(room=space.name):
                self.assertTrue(
                    r.x0 <= envelope.x + 200 or r.x1 >= envelope.x1 - 200
                    or r.y0 <= envelope.y + 200 or r.y1 >= envelope.y1 - 200,
                    f"{space.name} needs daylight and touches no outside wall",
                )


class TestBothPassagesAreConnected(unittest.TestCase):
    """The reason the core band carries a link at one end.

    Separated by a core that spans the whole run, the far passage is
    reachable only by walking through a bathroom, and every room beyond it
    fails the rule that it can be walked out of. That is the one guarantee
    this solver will not trade for a better shape.
    """

    def test_no_room_is_left_without_a_route_out(self):
        program, plot, layout = _solve(WIDE)
        building = build_building(program, plot, layout,
                                  jurisdiction="AU-WA-perth")
        report = codes.check(building, codes.resolve("Perth"), layout.warnings)
        stranded = [f for f in report.findings
                    if f.rule_id == "baseline.route.exists" and f.is_failure]
        self.assertEqual(stranded, [], "the core cut the route out of the house")

    def test_the_two_passages_touch_something_in_common(self):
        _p, _l, layout = _solve(WIDE)
        passages = [c for c in layout.for_storey(0)
                    if c.function is Function.CORRIDOR]
        self.assertGreaterEqual(len(passages), 3, "two passages and a link")

        def touches(a, b):
            return not (a.x1 < b.x0 or b.x1 < a.x0
                        or a.y1 < b.y0 or b.y1 < a.y0)

        # Every passage reaches every other, directly or through another.
        seen = {0}
        frontier = [0]
        while frontier:
            i = frontier.pop()
            for j, other in enumerate(passages):
                if j in seen or not touches(passages[i].rect, other.rect):
                    continue
                seen.add(j)
                frontier.append(j)
        self.assertEqual(len(seen), len(passages),
                         "the passages do not join up")


class TestTheGeometryStillCloses(unittest.TestCase):
    def test_the_cells_tile_the_envelope_without_gaps_or_overlaps(self):
        _p, _l, layout = _solve(WIDE)
        cells = layout.for_storey(0)
        covered = sum(c.rect.w * c.rect.h for c in cells)
        self.assertEqual(covered, layout.envelope.w * layout.envelope.h)
        for i, a in enumerate(cells):
            for b in cells[i + 1:]:
                overlap = (min(a.rect.x1, b.rect.x1) - max(a.rect.x0, b.rect.x0)) * \
                          (min(a.rect.y1, b.rect.y1) - max(a.rect.y0, b.rect.y0))
                if (min(a.rect.x1, b.rect.x1) > max(a.rect.x0, b.rect.x0)
                        and min(a.rect.y1, b.rect.y1) > max(a.rect.y0, b.rect.y0)):
                    self.fail(f"{a.name} and {b.name} overlap by {overlap} mm2")

    def test_the_extra_passages_get_their_own_keys(self):
        # The link and the far passage are new cells on the storey, and two
        # cells sharing a key is how a wall ends up attached to the wrong one.
        _p, _l, layout = _solve(WIDE)
        keys = [c.key for c in layout.for_storey(0)]
        self.assertEqual(len(keys), len(set(keys)))
