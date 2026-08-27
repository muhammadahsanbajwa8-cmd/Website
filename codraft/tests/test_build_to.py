"""A brief written for one country, raised to the code of another.

A template is written somewhere. `au-house` sets a 28-course ceiling because
that is what a project home in Perth is built to, and handed to Lahore --
where the by-laws ask 2750 mm -- every habitable room failed on ceiling
height, 67 findings in a sweep of nine plans. The target that would have
prevented it was sitting unread in the pack the plan was checked against.

Doing it in one place is the point of `build_to`. It used to be done in
`cmd_fit`, in a shorter and different form in the fallback beside it, and
not at all for anyone using the library.
"""

import unittest

from codraft.codes import design_parameters, resolve
from codraft.program import template


def _house():
    return template("au-house", bedrooms=4, bathrooms=2, storeys=2)


class TestBuildTo(unittest.TestCase):
    def test_a_taller_ceiling_raises_the_storey(self):
        program = _house()
        design = design_parameters(resolve("Lahore"))
        before = program.storey_height
        program.build_to(design)
        self.assertGreater(program.storey_height, before)
        # Clear height is floor-to-floor less the structure under it, which
        # is what the rule engine subtracts back off when it measures.
        floor = int(design.get("slab_and_finish_mm", 200) or 200)
        self.assertGreaterEqual(
            program.storey_height - floor, design["ceiling_height_mm"]
        )

    def test_a_ceiling_the_template_already_clears_changes_nothing(self):
        # The 28-course ceiling is 2434 mm, over the NCC's 2400. Snapping the
        # floor-to-floor rather than the ceiling raised every Australian
        # storey by a course for a requirement already met.
        for where in ("AU-WA", "Melbourne", "Sydney", "London"):
            with self.subTest(where):
                program = _house()
                before = program.storey_height
                program.build_to(design_parameters(resolve(where)))
                self.assertEqual(program.storey_height, before)

    def test_it_says_what_it_raised(self):
        program = _house()
        raised = program.build_to(design_parameters(resolve("Lahore")))
        self.assertTrue(raised)
        self.assertTrue(any("storey height" in r for r in raised))

    def test_nothing_is_lowered(self):
        program = _house()
        program.storey_height = 4000
        corridor = program.get("corridor") or program.get("passage")
        wide = 2000
        if corridor is not None:
            corridor.min_width = wide
        program.build_to(design_parameters(resolve("Lahore")))
        self.assertEqual(program.storey_height, 4000)
        if corridor is not None:
            self.assertEqual(corridor.min_width, wide)

    def test_an_empty_design_is_a_no_op(self):
        program = _house()
        self.assertEqual(program.build_to({}), [])


if __name__ == "__main__":
    unittest.main()
