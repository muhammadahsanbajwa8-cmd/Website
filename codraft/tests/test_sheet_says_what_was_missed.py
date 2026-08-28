"""A sheet gets separated from its report, so it carries the statement.

The report lists every room that came up short. A drawing handed on without
it said nothing at all, which let a plan with a 9.6 m2 master suite read as
the design somebody intended. The schedule stays in the report -- twenty
lines is a table, not a drawing note -- and the sheet carries a sentence
saying how many rooms and which is worst.

Rooms that are not drawn AT ALL get their own sentence, because they are
worse to leave unsaid: somebody comparing the sheet against the brief they
gave finds a room missing with nothing on the page saying it was a decision.
"""


def _about_shortfall(notes):
    return next((n for n in notes if "smaller than the brief" in n), "")


def _about_omission(notes):
    return next((n for n in notes if "left out" in n), "")

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
        note = _about_shortfall(layout.shortfall_notes())
        self.assertTrue(note, "nothing said about the squeezed rooms")
        self.assertIn("smaller than the brief asked for", note)
        self.assertIn("listed in the compliance report", note)
        # A sentence each, not the schedule.
        self.assertLessEqual(len(layout.shortfall_notes()), 2)

    def test_the_count_is_the_real_count(self):
        layout, _building = _laid_out(TIGHT)
        short = [
            c for c in layout.cells
            if c.requirement is not None and c.requirement.min_area
            and max(0, c.area - 172 * (c.rect.w + c.rect.h))
            < c.requirement.min_area
        ]
        self.assertTrue(short)
        note = _about_shortfall(layout.shortfall_notes())
        self.assertTrue(note.startswith(f"{len(short)} room"), note)

    def test_it_names_a_room_that_is_actually_short(self):
        layout, _building = _laid_out(TIGHT)
        note = _about_shortfall(layout.shortfall_notes())
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
        # Constructed rather than searched for: every room gets what it asked
        # and none was dropped.
        layout, _building = _laid_out(TIGHT)
        for cell in layout.cells:
            if cell.requirement is not None:
                cell.requirement.min_area = 0
        layout.omitted.clear()
        self.assertEqual(layout.shortfall_notes(), [])

    def test_a_room_that_was_dropped_is_named(self):
        layout, _building = _laid_out(TIGHT)
        self.assertTrue(layout.omitted, "this plot is meant to shed extras")
        note = _about_omission(layout.shortfall_notes())
        self.assertTrue(note, "a room went and the sheet did not say so")
        for name in layout.omitted:
            self.assertIn(name, note)
        drawn = {c.name for c in layout.cells}
        for name in layout.omitted:
            self.assertNotIn(name, drawn, f"{name} is named as gone and drawn")


if __name__ == "__main__":
    unittest.main()
