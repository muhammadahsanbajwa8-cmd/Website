"""Nothing the plan draws may be missing from the schedule it is built from.

The schedule text was assembled from the window rows and the door rows, so
anything that was neither went into neither. That was survivable while an
unframed opening meant a cased gap between the entry and the passage. It
stopped being survivable when the garage got its vehicle opening: 5.2 m
wide, in a loadbearing external wall, wanting a lintel that no page in the
set mentioned.

And the specification item for lintels says, in as many words, "the schedule
marks which openings need one". It did not. `needs_lintel` was worked out for
every row and printed nowhere, so the document made a claim about itself that
was false.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import OpeningKind, Plot
from codraft.program import template
from codraft.schedule import format_schedule, opening_specification, schedule

DESIGN = design_parameters(resolve("AU-WA"))
LOTS = ((12500, 28000), (15000, 30000), (18000, 30000))


def _built(width, depth, beds=4, storeys=1):
    plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=storeys)
    program.build_to(DESIGN)
    layout = solve(program, plot)
    return build_building(program, plot, layout, design=DESIGN)


def _text(building):
    rows, _warnings = schedule(building)
    out = []
    for kind, title in ((OpeningKind.WINDOW, "WINDOW SCHEDULE"),
                        (OpeningKind.DOOR, "DOOR SCHEDULE"),
                        (OpeningKind.OPENING, "OPENING SCHEDULE")):
        out += format_schedule([r for r in rows if r.kind is kind], title)
    return "\n".join(out), rows


class TestEveryOpeningIsScheduled(unittest.TestCase):
    def test_every_mark_appears_in_the_text(self):
        for width, depth in LOTS:
            for storeys in (1, 2):
                building = _built(width, depth, storeys=storeys)
                text, rows = _text(building)
                for row in rows:
                    with self.subTest(lot=(width, depth), mark=row.mark):
                        self.assertIn(row.mark, text)

    def test_the_garage_opening_is_one_of_them(self):
        building = _built(15000, 30000)
        text, rows = _text(building)
        garage = [r for r in rows if any("Garage" in name for name in r.rooms)]
        self.assertTrue(garage, "no scheduled opening serves the garage")
        for row in garage:
            self.assertIn(row.mark, text)

    def test_the_schedule_marks_which_openings_need_a_lintel(self):
        # The specification says it does, so it has to.
        claim = next(body for title, _clause, body in opening_specification()
                     if "Lintel" in title)
        self.assertIn("schedule marks which openings need one", claim)
        building = _built(15000, 30000)
        text, rows = _text(building)
        self.assertTrue(any(r.needs_lintel for r in rows))
        self.assertIn("LINTEL", text)
        self.assertIn("YES", text)

    def test_an_exterior_opening_is_always_marked(self):
        for width, depth in LOTS:
            building = _built(width, depth)
            _text_unused, rows = _text(building)
            for row in rows:
                with self.subTest(lot=(width, depth), mark=row.mark):
                    self.assertEqual(row.needs_lintel, row.exterior)


if __name__ == "__main__":
    unittest.main()
