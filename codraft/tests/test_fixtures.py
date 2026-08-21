"""Fittings, and the fact that a drawing is painted in an order.

A room with a name and an area in it is a diagram. A room with a bath, a
pan and a basin in it is a plan of somewhere you could stand. So the wet
rooms and the kitchen get their fittings drawn.

The failure this file exists to catch is not that the fittings are missing.
It is that they are PRESENT and invisible: the room fills are opaque, so a
bath drawn before them is a bath nobody will ever see. Counting the ops
passes that bug. Checking the order does not.
"""

import unittest

from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _building(storeys=1):
    program = template("au-house", bedrooms=4, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    return build_building(program, plot, solve(program, plot))


OPAQUE = {"room", "room-wet", "room-circ", "wall-fill", "wall-fill-int",
          "wall-gap", "ghost-room"}


class TestTheFittingsAreDrawn(unittest.TestCase):
    def test_a_four_bedroom_house_gets_fittings(self):
        canvas, *_ = build_sheet(_building(), storey_index=0)
        self.assertTrue([op for op in canvas.ops if op[1] == "fixture"],
                        "no sanitaryware anywhere in a two bathroom house")

    def test_nothing_opaque_is_painted_over_them(self):
        canvas, *_ = build_sheet(_building(), storey_index=0)
        first = next(i for i, op in enumerate(canvas.ops)
                     if op[1] in ("fixture", "bench"))
        later = [op[1] for op in canvas.ops[first:] if op[1] in OPAQUE]
        self.assertEqual(
            later, [],
            "these are drawn after the fittings and will hide them: "
            f"{sorted(set(later))}",
        )

    def test_the_site_plan_leaves_them_off(self):
        # A site plan is at 1:200. A WC pan is 700mm, which is 3.5mm of
        # paper, and its outline reads as a smudge rather than as a pan.
        canvas, *_ = build_sheet(_building(), storey_index=0, sheet="site")
        self.assertEqual(
            [op for op in canvas.ops if op[1] in ("fixture", "bench")], [])

    def test_a_services_sheet_leaves_them_off(self):
        # The ghosted plans carry their own symbols. Two sets of symbols on
        # one drawing is how a drawing stops being readable.
        canvas, *_ = build_sheet(_building(), storey_index=0,
                                 sheet="electrical")
        self.assertEqual(
            [op for op in canvas.ops if op[1] in ("fixture", "bench")], [])


class TestARoomTooSmallSaysSo(unittest.TestCase):
    def test_what_could_not_be_placed_is_named_not_dropped(self):
        # The layout still produces wet rooms that are thin strips. When a
        # fitting will not fit, drawing it on top of another one hides that;
        # saying so does not.
        canvas, *_ = build_sheet(_building(), storey_index=0)
        for note in canvas.notes:
            if "no wall left" in note:
                self.assertRegex(note, r"\d+ x \d+ mm",
                                 "the note must carry the size it failed at")


class TestAFittingIsInsideItsRoom(unittest.TestCase):
    """The bug this catches put a bath half in the bedroom next door.

    Every plumbing symbol is built with its origin on its BACK EDGE, not at
    its centre, and a rotation of 90 degrees points it at -x, not +x. Get
    either wrong and the fitting still draws, still lands roughly where you
    expect, and is still through a wall. Nothing but geometry catches that,
    so this checks the geometry.
    """

    def _all(self, storeys=1):
        from codraft.export.fixtures import for_storey
        from codraft.symbols import symbol

        out = []
        for storey in _building(storeys).storeys:
            fittings, benches, _ = for_storey(storey)
            for item, space in fittings:
                geometry = symbol(item.kind, item.x, item.y, item.rotation)
                xs = [c for line in geometry.lines for c in (line.x0, line.x1)]
                ys = [c for line in geometry.lines for c in (line.y0, line.y1)]
                xs += [c.cx - c.r for c in geometry.circles]
                xs += [c.cx + c.r for c in geometry.circles]
                ys += [c.cy - c.r for c in geometry.circles]
                ys += [c.cy + c.r for c in geometry.circles]
                out.append((space, item, min(xs), max(xs), min(ys), max(ys)))
            for bench in benches:
                out.append((None, bench, bench.x0, bench.x1,
                            bench.y0, bench.y1))
        return out

    def test_no_fitting_crosses_the_wall_it_stands_against(self):
        for space, item, x0, x1, y0, y1 in self._all():
            if space is None:
                continue
            r = space.rect
            with self.subTest(room=space.name, fitting=item.kind):
                self.assertGreaterEqual(x0, r.x0)
                self.assertLessEqual(x1, r.x1)
                self.assertGreaterEqual(y0, r.y0)
                self.assertLessEqual(y1, r.y1)

    def test_two_fittings_do_not_stand_in_the_same_place(self):
        # Overlapping fittings are how a room too small for its fittings gets
        # drawn as though it were big enough.
        by_room: dict[str, list] = {}
        for space, item, x0, x1, y0, y1 in self._all():
            if space is None:
                continue
            by_room.setdefault(id(space), []).append(
                (space.name, item.kind, x0, x1, y0, y1))
        for entries in by_room.values():
            for i, a in enumerate(entries):
                for b in entries[i + 1:]:
                    overlap = (a[2] < b[3] and b[2] < a[3]
                               and a[4] < b[5] and b[4] < a[5])
                    self.assertFalse(
                        overlap,
                        f"in {a[0]}, {a[1]} and {b[1]} occupy the same floor",
                    )

    def test_the_sink_is_in_the_bench(self):
        from codraft.export.fixtures import for_storey, joinery
        from codraft.model import Function

        storey = _building().storeys[0]
        fittings, _, _ = for_storey(storey)
        for item, space in fittings:
            if space.function is not Function.KITCHEN:
                continue
            bench = joinery(space)
            if bench is None:
                continue
            with self.subTest(fitting=item.kind):
                self.assertTrue(
                    bench.x0 <= item.x <= bench.x1
                    and bench.y0 <= item.y <= bench.y1,
                    f"{item.kind} at ({item.x}, {item.y}) is not in the bench",
                )
