"""Schedule marks on the plan, and the areas in the title block.

These are the two things that turn a drawing into a SET. Without a mark on
the plan the window schedule is a list of sizes with no way to tell which
hole is which; without the areas the sheet cannot be priced from.

Both are places where a confident wrong number would do real damage. A tag a
builder trusts that points at the wrong window is worse than no tag, and an
internal area printed under a heading a builder reads as the quoted area is
several square metres of lie. So the marks are checked against the schedule
they claim to index, and the areas against the rooms they claim to total.
"""

import unittest

from codraft.annotate import area_schedule
from codraft.export.svg import build_sheet
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot, WallKind
from codraft.program import template
from codraft.schedule import marks, schedule


def _built(beds=4, storeys=1):
    program = template("au-house", bedrooms=beds, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, 15000, 30000), road_side="south",
                setback_front=6000, setback_rear=6000,
                setback_left=1000, setback_right=1000)
    layout = solve(program, plot)
    return build_building(program, plot, layout), layout


class TestEveryMarkFindsItsRow(unittest.TestCase):
    def test_every_opening_gets_a_mark(self):
        building, _ = _built()
        found = marks(building)
        for storey in building.storeys:
            for opening in storey.openings:
                with self.subTest(opening=opening.id):
                    self.assertIn(opening.id, found)

    def test_the_mark_names_a_row_of_the_right_size(self):
        # The failure that matters: a mark that resolves to the wrong row.
        building, _ = _built()
        found = marks(building)
        rows = {row.mark: row for row in schedule(building)[0]}
        for storey in building.storeys:
            for opening in storey.openings:
                row = rows[found[opening.id]]
                with self.subTest(opening=opening.id):
                    self.assertEqual(
                        (row.kind, row.width, row.height, row.sill),
                        (opening.kind, opening.width, opening.height,
                         opening.sill),
                    )

    def test_two_openings_of_one_size_share_a_mark(self):
        building, _ = _built()
        found = marks(building)
        by_size: dict[tuple, set[str]] = {}
        for storey in building.storeys:
            for opening in storey.openings:
                wall = next(w for w in storey.walls if w.id == opening.wall)
                key = (opening.kind, opening.width, opening.height,
                       opening.sill, wall.kind is WallKind.EXTERIOR)
                by_size.setdefault(key, set()).add(found[opening.id])
        for key, seen in by_size.items():
            with self.subTest(size=key):
                self.assertEqual(len(seen), 1)


class TestTheMarksReachThePlan(unittest.TestCase):
    def _tags(self, sheet="architectural", index=0):
        building, layout = _built()
        canvas, *_ = build_sheet(building, storey_index=index, sheet=sheet,
                                 footprint=layout.envelope)
        return {op[6] for op in canvas.ops
                if op[0] == "text" and op[1] == "tag"}, building

    def test_every_exterior_opening_is_tagged(self):
        tags, building = self._tags()
        found = marks(building)
        expected = set()
        for storey in building.storeys:
            if storey.index != 0:
                continue
            for opening in storey.openings:
                wall = next(w for w in storey.walls if w.id == opening.wall)
                if wall.kind is WallKind.EXTERIOR:
                    expected.add(found[opening.id])
        self.assertEqual(tags, expected)

    def test_no_tag_names_a_mark_that_is_not_in_the_schedule(self):
        tags, building = self._tags()
        known = {row.mark for row in schedule(building)[0]}
        self.assertTrue(tags)
        self.assertTrue(tags <= known, f"unknown marks: {tags - known}")

    def test_the_site_plan_and_the_services_sheets_are_left_clean(self):
        for sheet in ("site", "electrical", "plumbing"):
            with self.subTest(sheet=sheet):
                tags, _ = self._tags(sheet)
                self.assertEqual(tags, set())

    def test_a_tag_sits_outside_the_wall_it_marks(self):
        # Inside, it lands on the room name or the fittings.
        building, layout = _built()
        canvas, *_ = build_sheet(building, storey_index=0,
                                 footprint=layout.envelope)
        rooms = [s.rect for s in building.storeys[0].spaces]
        for op in canvas.ops:
            if op[0] != "text" or op[1] != "tag":
                continue
            x, y = op[2], op[3]
            with self.subTest(mark=op[6]):
                self.assertFalse(
                    any(r.x0 < x < r.x1 and r.y0 < y < r.y1 for r in rooms),
                    f"{op[6]} is printed inside a room",
                )


class TestTheAreasAddUp(unittest.TestCase):
    def test_the_lines_total_to_the_internal_area(self):
        building, layout = _built()
        rows, _note = area_schedule(building, layout.envelope)
        figures = dict(rows)
        parts = sum(
            float(figures[label].split()[0])
            for label in ("LIVING", "GARAGE", "ALFRESCO", "PORCH")
            if label in figures
        )
        total = float(figures["TOTAL INTERNAL"].split()[0])
        self.assertAlmostEqual(parts, total, delta=0.3)

    def test_the_entry_hall_is_living_and_the_portico_is_porch(self):
        # Function.ENTRY covers both, and they are not the same thing to
        # price. Keying the porch line on the function put 18.2 m2 of porch
        # on a house with an 8.9 m2 one.
        building, layout = _built()
        porch = dict(area_schedule(building, layout.envelope)[0]).get("PORCH")
        self.assertIsNotNone(porch)
        portico = [s for st in building.storeys for s in st.spaces
                   if s.name.lower().startswith("portico")]
        self.assertTrue(portico, "this plan has no portico to check")
        self.assertAlmostEqual(
            float(porch.split()[0]),
            sum(s.area for s in portico) / 1e6, delta=0.15)

    def test_the_footprint_is_larger_than_the_internal_total(self):
        # It has to be: the footprint is over the walls and the total is
        # inside them. If this ever inverts, one of the two is wrong.
        building, layout = _built()
        figures = dict(area_schedule(building, layout.envelope)[0])
        self.assertGreater(float(figures["FOOTPRINT"].split()[0]),
                           float(figures["TOTAL INTERNAL"].split()[0]))

    def test_the_note_says_which_figure_is_the_quoted_one(self):
        building, layout = _built()
        _rows, note = area_schedule(building, layout.envelope)
        self.assertIn("FOOTPRINT", note)

    def test_the_note_fits_the_box_it_is_printed_in(self):
        # Three lines at 46 characters. A note that runs off takes its last
        # clause -- which is the one saying what to price from -- with it.
        from codraft.export.svg import _wrap

        building, layout = _built()
        _rows, note = area_schedule(building, layout.envelope)
        self.assertLessEqual(len(_wrap(note, 46)), 3)


class TestBothFormatsCarryThem(unittest.TestCase):
    def test_the_pdf_has_the_tags_and_the_areas(self):
        import tempfile
        from pathlib import Path

        from codraft.export.pdf import write_pdf
        from codraft.ingest.pdfread import read_pdf
        from codraft.sheet import TitleBlock

        building, layout = _built()
        rows, note = area_schedule(building, layout.envelope)
        with tempfile.TemporaryDirectory() as tmp:
            path = write_pdf(
                building, Path(tmp) / "set.pdf",
                title=TitleBlock(project="T", areas=rows, area_note=note),
                footprint=layout.envelope,
            )
            text = {t.text for page in read_pdf(str(path)).pages
                    for t in page.texts}
        self.assertIn("AREAS", text)
        self.assertIn("TOTAL INTERNAL", text)
        self.assertIn("FOOTPRINT", text)
