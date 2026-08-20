"""The schedule, and the three things it is there to make impossible to miss.

A plan that draws a rectangle in a wall has not described an opening. What
gets built from is the size, the course the head sits on, and the
specification that goes with it -- and the schedule is where a mistake in any
of those becomes visible. Every bug these tests pin was found by reading the
first schedule the code produced.
"""

import unittest

from codraft.courses import COURSE_MM
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.layout.walls import DOOR_MIN_STRUCTURAL, MAX_WINDOW_UNIT
from codraft.model import OpeningKind, Plot
from codraft.program import template
from codraft.schedule import opening_specification, schedule


def _building(bedrooms=4, bathrooms=2, storeys=2, width=15000, depth=30000):
    program = template("au-house", bedrooms=bedrooms, bathrooms=bathrooms,
                       storeys=storeys)
    plot = Plot(rect=Rect(0, 0, width, depth), setback_front=6000,
                setback_rear=6000, setback_left=1000, setback_right=1000)
    return build_building(program, plot, solve(program, plot))


class TestHeadsLandOnCourses(unittest.TestCase):
    """A head off a course means somebody cuts bricks on site."""

    def test_every_external_head_is_a_whole_course(self):
        building = _building()
        for storey in building.storeys:
            for opening in storey.openings:
                wall = next((w for w in storey.walls if w.id == opening.wall), None)
                if wall is None or not wall.is_exterior:
                    continue
                head = opening.sill + opening.height
                self.assertEqual(
                    head % COURSE_MM, 0,
                    f"a head at {head} mm is {head % COURSE_MM} mm off a "
                    f"{COURSE_MM} mm course",
                )

    def test_door_heads_are_a_whole_course(self):
        # 2100 is the number a joiner says and 2150 is the number a
        # bricklayer lays. The head is snapped up, never down: a course low
        # is a door that does not fit.
        from codraft.layout.walls import DOOR_HEIGHT
        self.assertEqual(DOOR_HEIGHT % COURSE_MM, 0)
        self.assertGreaterEqual(DOOR_HEIGHT, 2100)


class TestWindowsAreUnitsSomebodyCanMake(unittest.TestCase):
    def test_no_window_is_wider_than_a_unit(self):
        # The first schedule this code produced had a 5206 mm window in a
        # bedroom. That is not a window, it is two or three with piers
        # between them, and the piers are what the lintels bear on.
        for storeys in (1, 2):
            building = _building(storeys=storeys)
            for storey in building.storeys:
                for opening in storey.openings:
                    if opening.kind is not OpeningKind.WINDOW:
                        continue
                    self.assertLessEqual(
                        opening.width, MAX_WINDOW_UNIT,
                        f"a {opening.width} mm window unit cannot be made",
                    )

    def test_windows_do_not_overrun_their_wall(self):
        building = _building()
        for storey in building.storeys:
            for opening in storey.openings:
                wall = next(w for w in storey.walls if w.id == opening.wall)
                self.assertLessEqual(
                    opening.offset + opening.width, wall.length,
                    f"an opening runs {opening.offset + opening.width - wall.length} "
                    f"mm past the end of its wall",
                )

    def test_units_on_one_wall_do_not_overlap(self):
        building = _building()
        for storey in building.storeys:
            by_wall: dict[str, list] = {}
            for opening in storey.openings:
                by_wall.setdefault(opening.wall, []).append(opening)
            for wall_id, group in by_wall.items():
                group.sort(key=lambda o: o.offset)
                for a, b in zip(group, group[1:]):
                    self.assertLessEqual(
                        a.offset + a.width, b.offset,
                        f"two openings overlap on wall {wall_id}",
                    )


class TestTheScheduleReportsRatherThanHides(unittest.TestCase):
    def test_a_wall_too_short_for_a_door_is_reported(self):
        # The solver used to shrink the door to whatever the wall had left,
        # which produced a 390 mm "door" and said nothing at all.
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=2)
        plot = Plot(rect=Rect(0, 0, 15000, 30000), setback_front=6000,
                    setback_rear=6000, setback_left=1000, setback_right=1000)
        layout = solve(program, plot)
        building = build_building(program, plot, layout)
        narrow = [
            o for storey in building.storeys for o in storey.openings
            if o.kind is OpeningKind.DOOR and o.width < DOOR_MIN_STRUCTURAL
        ]
        if not narrow:
            self.skipTest("this plan happens to have no narrow doors")
        self.assertTrue(
            any("cannot take a door" in w or "of doorway against" in w
                for w in layout.warnings),
            f"{len(narrow)} doors are under {DOOR_MIN_STRUCTURAL} mm and "
            f"nothing was said about it: {layout.warnings}",
        )

    def test_marks_are_unique_and_sizes_are_grouped(self):
        rows, _ = schedule(_building())
        marks = [r.mark for r in rows]
        self.assertEqual(len(marks), len(set(marks)), "two types share a mark")
        sizes = [(r.kind, r.width, r.height, r.sill, r.exterior) for r in rows]
        self.assertEqual(len(sizes), len(set(sizes)), "one size got two marks")

    def test_the_size_code_reads_height_then_width(self):
        rows, _ = schedule(_building())
        for row in rows:
            self.assertEqual(row.code[:2], f"{row.height // 100:02d}")
            self.assertEqual(row.code[2:], f"{row.width // 100:02d}")

    def test_external_openings_are_marked_for_a_lintel(self):
        rows, _ = schedule(_building())
        external = [r for r in rows if r.exterior]
        self.assertTrue(external)
        self.assertTrue(all(r.needs_lintel for r in external))

    def test_the_specification_cites_a_standard_for_every_item(self):
        for title, clause, body in opening_specification():
            self.assertTrue(title and body)
            self.assertTrue(
                any(token in clause for token in ("AS ", "NCC")),
                f"{title!r} names no standard: {clause!r}",
            )

    def test_the_specification_does_not_state_an_r_value(self):
        # R-values are set by climate zone and by which NCC edition the state
        # has adopted. Stating one here would be inventing a code figure.
        for title, clause, body in opening_specification():
            self.assertNotRegex(
                body, r"\bR\d",
                f"{title!r} states an R-value it cannot know",
            )


if __name__ == "__main__":
    unittest.main()
