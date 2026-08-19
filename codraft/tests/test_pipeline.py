"""End to end: a brief becomes drawings and a report that adds up."""

import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from codraft import codes
from codraft.export import write_dxf, write_ifc, write_svg
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import parse_brief


def _pipeline(brief_text, place=None):
    brief = parse_brief(brief_text)
    jurisdiction = codes.resolve(place or brief.location)
    site = {
        k: v for k, v in codes.site_parameters(jurisdiction, brief.program.use).items()
        if not k.startswith("$")
    }
    plot = Plot(
        rect=Rect(0, 0, *brief.plot_size),
        setback_front=int(site.get("setback_front_mm", 0)),
        setback_rear=int(site.get("setback_rear_mm", 0)),
    )
    layout = solve(brief.program, plot)
    building = build_building(brief.program, plot, layout, jurisdiction=jurisdiction.key)
    report = codes.check(building, jurisdiction, layout.warnings)
    return building, report


class TestPipeline(unittest.TestCase):
    def test_lahore_house(self):
        building, report = _pipeline(
            "3 bed 2 bath double storey house on a 40x60 ft plot in Lahore"
        )
        self.assertEqual(building.storey_count, 2)
        self.assertEqual(len(building.spaces_by_function(
            __import__("codraft.model", fromlist=["Function"]).Function.BEDROOM)), 3)
        self.assertIn("pk-bylaws", report.packs)
        self.assertGreater(report.counts["checked"], 20)

    def test_a_room_with_no_exit_route_is_a_violation(self):
        # The strongest guarantee in the baseline: no room is ever left
        # without a way out and reported as fine.
        _, report = _pipeline("4 bed house on a 30x50 ft plot in Karachi")
        unreachable = [
            f for f in report.findings
            if f.rule_id == "baseline.route.exists" and f.is_failure
        ]
        self.assertEqual(unreachable, [], "a room was left with no route to an exit")

    def test_report_counts_are_consistent(self):
        _, report = _pipeline("3 bed house on a 40x60 ft plot in Lahore")
        counts = report.counts
        self.assertEqual(counts["checked"], counts["passed"] + counts["failed"])
        self.assertEqual(
            counts["failed"],
            counts["violations"] + counts["warnings"] + counts["advisories"],
        )

    def test_unencoded_jurisdiction_still_runs_and_still_warns(self):
        _, report = _pipeline("3 bed house on a 12m x 18m plot in Kenya", place="Somalia")
        self.assertEqual(report.packs, ["baseline"])
        self.assertIn("No rule pack is encoded", report.jurisdiction.caveat())

    def test_a_us_house_is_checked_against_the_irc(self):
        _, report = _pipeline("3 bed 2 bath house on a 50x100 ft plot in California")
        self.assertIn("irc-2021", report.packs)
        self.assertNotIn("ibc-2021", report.packs)  # residential use, not commercial


class TestExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.building, _ = _pipeline(
            "3 bed 2 bath double storey house on a 40x60 ft plot in Lahore"
        )
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_dxf_structure(self):
        text = write_dxf(self.building, self.out / "p.dxf").read_text()
        self.assertTrue(text.startswith("0\nSECTION\n"))
        self.assertTrue(text.rstrip().endswith("EOF"))
        for section in ("HEADER", "TABLES", "ENTITIES"):
            self.assertIn(f"2\n{section}\n", text)
        self.assertEqual(text.count("0\nSECTION\n"), text.count("0\nENDSEC\n"))
        self.assertGreater(text.count("0\nLINE\n"), 100)

    def test_svg_parses_as_xml(self):
        path = write_svg(self.building, self.out / "p.svg")
        root = ET.parse(path).getroot()
        self.assertTrue(root.tag.endswith("svg"))

    def test_ifc_structure(self):
        text = write_ifc(self.building, self.out / "p.ifc").read_text()
        self.assertTrue(text.startswith("ISO-10303-21;"))
        self.assertTrue(text.rstrip().endswith("END-ISO-10303-21;"))
        self.assertIn("FILE_SCHEMA(('IFC4'));", text)
        for entity in ("IFCPROJECT(", "IFCSITE(", "IFCBUILDING(", "IFCBUILDINGSTOREY(",
                       "IFCWALLSTANDARDCASE(", "IFCSPACE(", "IFCDOOR(", "IFCWINDOW("):
            self.assertIn(entity, text, f"the IFC carries no {entity[:-1]}")
        # Every opening must actually cut its wall, or the model has doors
        # drawn over solid walls.
        self.assertEqual(text.count("IFCOPENINGELEMENT("), text.count("IFCRELVOIDSELEMENT("))

    def test_every_sheet_writes_valid_dxf_and_svg(self):
        from codraft.services import design_electrical, design_plumbing

        services = {
            "electrical": {
                st.index: design_electrical(self.building, st.index)
                for st in self.building.storeys
            },
            "plumbing": {
                st.index: design_plumbing(self.building, st.index)
                for st in self.building.storeys
            },
        }
        for sheet in ("architectural", "electrical", "plumbing"):
            dxf = write_dxf(
                self.building, self.out / f"{sheet}.dxf", sheet=sheet,
                services=services.get(sheet),
            ).read_text()
            self.assertTrue(dxf.startswith("0\nSECTION\n"), sheet)
            self.assertTrue(dxf.rstrip().endswith("EOF"), sheet)
            self.assertEqual(dxf.count("0\nSECTION\n"), dxf.count("0\nENDSEC\n"), sheet)

            path = write_svg(
                self.building, self.out / f"{sheet}.svg", sheet=sheet,
                services=services.get(sheet),
            )
            root = ET.parse(path).getroot()
            self.assertTrue(root.tag.endswith("svg"), sheet)

    def test_services_sheets_actually_draw_their_symbols(self):
        from codraft.services import design_plumbing

        services = {
            st.index: design_plumbing(self.building, st.index)
            for st in self.building.storeys
        }
        text = write_svg(
            self.building, self.out / "p-plumb.svg", sheet="plumbing",
            services=services,
        ).read_text()
        # A sheet that draws the architecture and forgets the fittings is
        # the failure mode worth a test: it looks right and says nothing.
        self.assertIn("run-waste", text)
        self.assertIn("Plumbing legend", text)

    def test_an_unknown_sheet_is_refused(self):
        with self.assertRaises(ValueError):
            write_svg(self.building, self.out / "x.svg", sheet="structural")

    def test_ifc_instance_references_all_resolve(self):
        import re
        text = write_ifc(self.building, self.out / "p2.ifc").read_text()
        defined = set(re.findall(r"^(#\d+)= ", text, re.M))
        for line in text.splitlines():
            if not line.startswith("#"):
                continue
            body = line.split("=", 1)[1]
            for ref in re.findall(r"#\d+", body):
                self.assertIn(ref, defined, f"{line[:60]} refers to undefined {ref}")


if __name__ == "__main__":
    unittest.main()
