"""Every schedule the sheet says it has is actually on the paper.

The schedules sheet is drawn from the same lines the text file carries, so
the two cannot disagree about the sizes. They can disagree about whether
the reader ever sees them: the sheet's origin is the canvas point that
lands at the TOP-LEFT of the content box, and this sheet draws its first
line at y = 0 with the rest running down into negative y. Handing back the
box's bottom put the first line at the bottom and everything after it off
the paper -- 23 of 37 lines, which is the whole DOOR SCHEDULE and the whole
OPENING SCHEDULE. The window schedule survived because it prints first.

Nothing failed, and nothing could: the sheet was the right size for the
table and the table was drawn past the edge of it, so the lines went into
the page stream outside the media box. A set that looked like it had a
schedule sheet had no door sizes on it anywhere.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.sheet import MARGIN, fit_scale

LOTS = [(12500, 28000), (15000, 30000), (20000, 35000)]


def _sheets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for storeys in (1, 2):
            program = template("au-house", bedrooms=4, bathrooms=2,
                               storeys=storeys)
            program.build_to(design)
            plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                        setback_front=6000, setback_rear=1000,
                        setback_left=1000, setback_right=1000)
            try:
                layout = solve(program, plot,
                               max_footprint=int(plot.area * 0.5))
            except LayoutError:
                continue
            building = build_building(program, plot, layout, design=design)
            yield (f"{width}x{depth} {storeys}s",
                   build_sheet(building, None, "schedules", None,
                               layout.envelope, "metric"))


class NothingIsDrawnPastTheEdgeOfTheSheet(unittest.TestCase):
    def test_every_line_lands_inside_the_drawing_window(self):
        checked = 0
        for label, (canvas, origin, content_w, content_h, _name) in _sheets():
            frame = fit_scale(content_w, content_h, size="A3")
            ox, oy = origin
            pad_x = frame.x + (frame.w - content_w / frame.scale) / 2
            pad_y = MARGIN + (frame.h - content_h / frame.scale) / 2
            for op in canvas.ops:
                if op[0] != "text":
                    continue
                checked += 1
                across = pad_x + (ox + op[2]) / frame.scale
                down = pad_y + (oy - op[3]) / frame.scale
                with self.subTest(sheet=label, line=op[6][:40]):
                    self.assertGreaterEqual(down, 0)
                    self.assertLessEqual(
                        down, frame.height,
                        f"{label}: {op[6][:40]!r} is drawn {down:.0f} mm "
                        f"down a {frame.height} mm page",
                    )
                    self.assertGreaterEqual(across, 0)
                    self.assertLessEqual(across, frame.width)
        self.assertGreater(checked, 60, "almost nothing was checked")

    def test_all_three_schedules_reach_the_sheet(self):
        for label, (canvas, *_rest) in _sheets():
            headings = {op[6].strip() for op in canvas.ops
                        if op[0] == "text" and op[6].strip().endswith("SCHEDULE")}
            with self.subTest(sheet=label):
                self.assertIn("WINDOW SCHEDULE", headings)
                self.assertIn("DOOR SCHEDULE", headings)

    def test_the_explanatory_notes_are_printed_once(self):
        # Printed per block they came out three times word for word, which
        # reads as a document nobody has looked at.
        for label, (canvas, *_rest) in _sheets():
            lines = [op[6] for op in canvas.ops if op[0] == "text"]
            for phrase in ("LINTEL YES means", "Size codes read HEIGHT"):
                with self.subTest(sheet=label, note=phrase):
                    self.assertEqual(
                        sum(1 for line in lines if phrase in line), 1)


class NoSheetDrawsPastItsPage(unittest.TestCase):
    """The same check, over every sheet in the set rather than one of them.

    The schedules sheet was the only one that overflowed, and this is what
    establishes that -- 130 sheets of every kind, and nothing else lands off
    the paper. Worth keeping rather than throwing away with the fix: a
    sheet's origin and its content box are computed separately, per sheet
    type, and they can disagree again in the next one.
    """

    def test_across_every_sheet_of_a_lot_sweep(self):
        from codraft.export.svg import elevation_sheets

        design = design_parameters(resolve("AU-WA"))
        checked = 0
        for width, depth in LOTS:
            for storeys in (1, 2):
                program = template("au-house", bedrooms=4, bathrooms=2,
                                   storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=1000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot,
                                   max_footprint=int(plot.area * 0.5))
                except LayoutError:
                    continue
                building = build_building(program, plot, layout, design=design)
                pages = [("site", None)]
                pages += [("architectural", s.index) for s in building.storeys]
                pages += [("elevations", p)
                          for p in range(elevation_sheets(building))]
                pages += [("sections", None), ("schedules", None)]
                for sheet, index in pages:
                    canvas, origin, content_w, content_h, _n = build_sheet(
                        building, index, sheet, None, layout.envelope, "metric")
                    frame = fit_scale(content_w, content_h, size="A3")
                    ox, oy = origin
                    pad_x = frame.x + (frame.w - content_w / frame.scale) / 2
                    pad_y = MARGIN + (frame.h - content_h / frame.scale) / 2
                    checked += 1
                    for op in canvas.ops:
                        if op[0] == "text":
                            points = [(op[2], op[3])]
                        elif op[0] == "line":
                            points = [(op[2], op[3]), (op[4], op[5])]
                        elif op[0] == "rect":
                            points = [(op[2], op[3]),
                                      (op[2] + op[4], op[3] + op[5])]
                        else:
                            continue
                        for x, y in points:
                            across = pad_x + (ox + x) / frame.scale
                            down = pad_y + (oy - y) / frame.scale
                            with self.subTest(lot=f"{width}x{depth}",
                                              sheet=sheet, kind=op[0]):
                                self.assertGreaterEqual(down, -0.5)
                                self.assertLessEqual(down, frame.height + 0.5)
                                self.assertGreaterEqual(across, -0.5)
                                self.assertLessEqual(across, frame.width + 0.5)
        self.assertGreater(checked, 20, "almost no sheets were checked")


if __name__ == "__main__":
    unittest.main()
