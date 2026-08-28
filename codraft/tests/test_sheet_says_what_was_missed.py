"""A sheet gets separated from its report, so it carries the statement.

The report now lists every room that came up short. A drawing handed on
without it said nothing at all, which let a plan with a 9.6 m2 master suite
read as the design somebody intended. The schedule stays in the report --
twenty lines is a table, not a drawing note -- and the sheet carries one
sentence saying how many rooms and which is worst.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template

DESIGN = design_parameters(resolve("AU-WA"))
TIGHT = Plot(rect=Rect(0, 0, 12500, 28000), road_side="south",
             setback_front=6000, setback_rear=6000,
             setback_left=1000, setback_right=1000)


def _laid_out(plot, beds=4):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=1)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    return layout, build_building(program, plot, layout, design=DESIGN)


class TestTheSheetCarriesTheStatement(unittest.TestCase):
    def test_a_squeezed_plan_gets_a_note(self):
        layout, _building = _laid_out(TIGHT)
        notes = layout.shortfall_notes()
        self.assertEqual(len(notes), 1, "one sentence, not the schedule")
        self.assertIn("smaller than the brief asked for", notes[0])
        self.assertIn("listed in the compliance report", notes[0])

    def test_the_count_is_the_real_count(self):
        layout, _building = _laid_out(TIGHT)
        short = [
            c for c in layout.cells
            if c.requirement is not None and c.requirement.min_area
            and max(0, c.area - 172 * (c.rect.w + c.rect.h))
            < c.requirement.min_area
        ]
        self.assertTrue(short)
        self.assertTrue(
            layout.shortfall_notes()[0].startswith(f"{len(short)} room"),
            layout.shortfall_notes()[0],
        )

    def test_it_names_a_room_that_is_actually_short(self):
        layout, _building = _laid_out(TIGHT)
        note = layout.shortfall_notes()[0]
        named = [c for c in layout.cells if f"is {c.name}," in note]
        self.assertTrue(named, note)
        cell = named[0]
        clear = max(0, cell.area - 172 * (cell.rect.w + cell.rect.h))
        self.assertLess(clear, cell.requirement.min_area)

    def test_it_reaches_the_drawing(self):
        import tempfile
        from pathlib import Path

        from codraft.export.svg import write_svg

        layout, building = _laid_out(TIGHT)
        with tempfile.TemporaryDirectory() as tmp:
            path = write_svg(
                building, Path(tmp) / "plan.svg", storey_index=0,
                sheet="architectural", footprint=layout.envelope,
                notes=layout.shortfall_notes(),
            )
            drawn = path.read_text(encoding="utf-8")
        self.assertIn("smaller than the brief", drawn)

    def test_a_plan_with_nothing_short_says_nothing(self):
        # Constructed rather than searched for: every room gets what it asked.
        layout, _building = _laid_out(TIGHT)
        for cell in layout.cells:
            if cell.requirement is not None:
                cell.requirement.min_area = 0
        self.assertEqual(layout.shortfall_notes(), [])


if __name__ == "__main__":
    unittest.main()
