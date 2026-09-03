"""No label on a sheet may be printed over another.

The sheets have been swept for structure -- every floor tiles, every eaves
has a storey under it, every sheet is at 1:100. Nothing checked that the
words can be READ. A number printed through a letter is a number a builder
cannot trust, and the drawing gives no sign which digits belong to it.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.export.svg import (_clear_of, _text_boxes, build_sheet,
                                elevation_sheets)
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template

LOTS = [(9000, 22000), (10500, 32000), (12500, 28000), (15000, 30000),
        (18000, 30000), (20000, 35000)]


def _sheets():
    design = design_parameters(resolve("AU-WA"))
    for width, depth in LOTS:
        for bedrooms in (3, 5):
            for storeys in (1, 2):
                program = template("au-house", bedrooms=bedrooms,
                                   bathrooms=2, storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=6000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot)
                except LayoutError:
                    continue
                building = build_building(program, plot, layout, design=design)
                pages = [("site", None)]
                pages += [("architectural", s.index) for s in building.storeys]
                pages += [("elevations", p)
                          for p in range(elevation_sheets(building))]
                pages += [("sections", None)]
                for sheet, index in pages:
                    canvas, *_ = build_sheet(building, index, sheet, None,
                                             layout.envelope, "metric")
                    yield (f"{width}x{depth} {bedrooms}bed {storeys}s {sheet}",
                           canvas)


class NoLabelSitsOnAnother(unittest.TestCase):
    def test_across_every_sheet_of_a_lot_sweep(self):
        seen = 0
        for label, canvas in _sheets():
            seen += 1
            boxes = _text_boxes(canvas)
            for index, box in enumerate(boxes):
                rest = boxes[:index] + boxes[index + 1:]
                if not _clear_of(box, rest):
                    self.fail(f"{label}: two labels overlap at "
                              f"{box[0]:.0f},{box[1]:.0f}")
        self.assertGreater(seen, 40, "the sweep drew almost nothing")

    def test_a_turned_label_is_measured_along_its_own_axis(self):
        # The transform is translate(x,y) scale(1,-1) rotate(r), so a text
        # offset of (0, dy) lands at (x, y - dy) upright and (x + dy, y)
        # turned. Reading dy as a y shift either way counts every stacked
        # room label as sitting on its own area figure.
        from codraft.export.svg import _Canvas

        canvas = _Canvas()
        canvas.text(0, 0, "WC", "name", dy=-156, rotate=-90)
        canvas.text(0, 0, "4.7 m2", "area", dy=204, rotate=-90)
        first, second = _text_boxes(canvas)
        self.assertTrue(_clear_of(first, [second]))
        # And they are apart along x, which is what turning them means.
        self.assertLess(first[2], second[0] + 1)


if __name__ == "__main__":
    unittest.main()
