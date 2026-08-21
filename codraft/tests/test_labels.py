"""Room labels, and the three ways a caption stops being one.

A label printed over the bath hides the bath and itself. A label wider than
the room it names runs through the walls either side and lands in the two
neighbours. And a label whose lines come out bottom-first reads
"3719 x 2526 / 9.4 m2 / Bed", which is legible and upside down.

None of the three changes how many labels are on the drawing, so none of
them is caught by counting. They are caught here by geometry.
"""

import unittest

from codraft.export.svg import (
    LEADING, _floor_obstacles, _text_width, build_sheet,
)
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


LABEL_CLASSES = {"name": 300, "name-sm": 210, "name-xs": 150,
                 "area": 260, "roomdim": 240}


def _labels(canvas):
    return [op for op in canvas.ops
            if op[0] == "text" and op[1] in LABEL_CLASSES]


class TestALabelStaysInItsRoom(unittest.TestCase):
    def test_no_label_line_is_wider_than_the_room_it_names(self):
        storey = _building().storeys[0]
        canvas, *_ = build_sheet(_building(), storey_index=0)
        rooms = [s.rect for s in storey.spaces]
        for op in _labels(canvas):
            _, cls, x, y, dy, rotate, value = op
            room = next((r for r in rooms
                         if r.x0 <= x <= r.x1 and r.y0 <= y <= r.y1), None)
            if room is None:
                continue
            run = room.h if rotate else room.w
            with self.subTest(text=value):
                self.assertLessEqual(_text_width(value, LABEL_CLASSES[cls]),
                                     run)

    def test_every_label_line_sits_inside_a_room(self):
        # A label whose anchor is in a wall is a label in a wall.
        storey = _building().storeys[0]
        canvas, *_ = build_sheet(_building(), storey_index=0)
        rooms = [s.rect for s in storey.spaces]
        for op in _labels(canvas):
            _, _cls, x, y, dy, rotate, value = op
            # dy runs down the page for upright text and across it for
            # turned text, which is what the rotation does to the axis.
            px = x + (dy if rotate else 0)
            py = y + (0 if rotate else dy)
            with self.subTest(text=value):
                self.assertTrue(
                    any(r.x0 <= px <= r.x1 and r.y0 <= py <= r.y1
                        for r in rooms),
                    f"{value!r} is anchored at ({px:.0f}, {py:.0f})",
                )


class TestALabelIsNotPrintedOverTheFittings(unittest.TestCase):
    def test_no_label_line_lands_on_a_fitting(self):
        storey = _building().storeys[0]
        canvas, *_ = build_sheet(_building(), storey_index=0)
        boxes = [b for group in _floor_obstacles(storey).values()
                 for b in group]
        for op in _labels(canvas):
            _, _cls, x, y, dy, rotate, value = op
            px = x + (dy if rotate else 0)
            py = y + (0 if rotate else dy)
            hit = next((b for b in boxes
                        if b.x0 <= px <= b.x1 and b.y0 <= py <= b.y1), None)
            with self.subTest(text=value):
                self.assertIsNone(hit, f"{value!r} is printed over a fitting")


class TestTheLinesComeOutInOrder(unittest.TestCase):
    def test_the_name_is_above_the_area(self):
        canvas, *_ = build_sheet(_building(), storey_index=0)
        by_room: dict[tuple, dict] = {}
        for op in _labels(canvas):
            _, cls, x, y, dy, rotate, _value = op
            by_room.setdefault((round(x, -2), round(y, -2), rotate), {})[cls] = dy
        checked = 0
        for (_x, _y, rotate), lines in by_room.items():
            if "name" not in lines or "area" not in lines:
                continue
            checked += 1
            # dy grows downward for upright text; for turned text it grows
            # to the right, and the name goes on the left-hand line.
            self.assertLess(lines["name"], lines["area"])
        self.assertGreater(checked, 4, "no multi-line labels to check")

    def test_the_lines_do_not_sit_on_top_of_each_other(self):
        canvas, *_ = build_sheet(_building(), storey_index=0)
        seen: dict[tuple, list] = {}
        for op in _labels(canvas):
            _, _cls, x, y, dy, rotate, _v = op
            seen.setdefault((round(x, -2), round(y, -2), rotate), []).append(dy)
        for offsets in seen.values():
            offsets.sort()
            for a, b in zip(offsets, offsets[1:]):
                self.assertGreaterEqual(b - a, int(240 * LEADING))


class TestANarrowRoomTurnsItsName(unittest.TestCase):
    def test_a_passage_carries_its_name_on_its_side(self):
        storey = _building().storeys[0]
        canvas, *_ = build_sheet(_building(), storey_index=0)
        narrow = [s for s in storey.spaces
                  if s.rect.w < 2000 and s.rect.h > s.rect.w * 1.6]
        self.assertTrue(narrow, "this house has no narrow room to test")
        turned = {op[6] for op in _labels(canvas) if op[5]}
        for space in narrow:
            with self.subTest(room=space.name):
                self.assertIn(space.name, turned)


class TestNoRoomGoesQuietlyUnlabelled(unittest.TestCase):
    """The invariant: every room is named on the sheet, or named in a note.

    A rectangle with no caption on a drawing is not neutral -- it reads as a
    space the drawing forgot. The label placer is allowed to give up on a
    room; it is not allowed to give up quietly, because the reason it gives
    up is always that the room is not a room. A 91 mm linen cupboard has to
    reach whoever is looking at the plan.
    """

    LOTS = ((9000, 22000, 3), (10000, 25000, 3), (12500, 28000, 5),
            (15000, 30000, 4), (20000, 35000, 5))

    def test_every_room_is_labelled_or_declared(self):
        from codraft.program import template

        for width, depth, beds in self.LOTS:
            program = template("au-house", bedrooms=beds, bathrooms=2,
                               storeys=1)
            plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                        setback_front=6000, setback_rear=6000,
                        setback_left=1000, setback_right=1000)
            building = build_building(program, plot, solve(program, plot))
            canvas, *_ = build_sheet(building, storey_index=0)
            drawn = {op[6] for op in canvas.ops
                     if op[0] == "text" and op[1] in LABEL_CLASSES}
            declared = "\n".join(canvas.notes)
            for space in building.storeys[0].spaces:
                with self.subTest(lot=f"{width}x{depth}", room=space.name):
                    self.assertTrue(
                        space.name in drawn
                        or f"{space.name} is {space.rect.w} x "
                           f"{space.rect.h} mm" in declared,
                        f"{space.name} is neither on the drawing nor in the "
                        "notes",
                    )
