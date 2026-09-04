"""A note that belongs to a rule is printed once, not once per finding.

The findings section printed a rule's source, confidence and note in full
under every finding that rule produced. On an Australian sweep half of that
section -- 25387 characters of 50663 -- was a line already printed on the
same page, and one report repeated the same 400-character privacy note
verbatim eight times because eight upper bedroom windows failed the same
setback.

Nothing was wrong with the note. What was wrong is that the repetition
buries the findings that DO differ: on the same sweep, the 28 findings
about room width and the 4 about room area sat under 51 copies of one
paragraph about visual privacy.

Grouping by rule loses nothing -- every finding still prints its own
subject and its own message, which is the half that varies.
"""

import unittest

from codraft import codes
from codraft.codes import design_parameters, resolve
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template

LOTS = [(10500, 32000), (12500, 28000), (15000, 30000), (18000, 30000)]


def _reports():
    jurisdiction = resolve("Perth, WA")
    design = design_parameters(jurisdiction)
    site = {k: v for k, v in codes.site_parameters(
        jurisdiction, "residential", "R20").items() if not k.startswith("$")}
    for width, depth in LOTS:
        for bedrooms in (3, 5):
            for storeys in (1, 2):
                program = template("au-house", bedrooms=bedrooms,
                                   bathrooms=2, storeys=storeys)
                program.build_to(design)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=1000,
                            setback_left=1000, setback_right=1000)
                try:
                    layout = solve(program, plot,
                                   max_footprint=int(plot.area * 0.5))
                except LayoutError:
                    continue
                building = build_building(program, plot, layout,
                                          jurisdiction=jurisdiction.key,
                                          design=design)
                yield (f"{width}x{depth} {bedrooms}bed {storeys}s",
                       codes.check(building, jurisdiction, layout.warnings,
                                   site=site, unsatisfied=layout.unsatisfied))


def _findings_block(text: str) -> list[str]:
    if "FINDINGS" not in text:
        return []
    block = text.split("FINDINGS", 1)[1].split("COULD NOT BE CHECKED", 1)[0]
    return [line.strip() for line in block.splitlines() if line.strip()]


class ARuleSaysItsPieceOnce(unittest.TestCase):
    def test_no_line_of_a_findings_section_is_printed_twice(self):
        checked = 0
        for label, report in _reports():
            lines = _findings_block(report.to_text())
            if not lines:
                continue
            checked += 1
            seen: set[str] = set()
            for line in lines:
                # A rule's own message can legitimately repeat when two
                # subjects genuinely produce the same sentence; what may not
                # repeat is the framing around it.
                if line.startswith(("- ", "Source:", "Confidence:")):
                    continue
                with self.subTest(case=label, line=line[:60]):
                    self.assertNotIn(
                        line, seen,
                        f"{label}: this line is printed more than once",
                    )
                seen.add(line)
        self.assertGreater(checked, 5, "almost no report had findings")

    def test_every_finding_still_reaches_the_page(self):
        # Grouping must not lose one. Each failure's subject appears.
        for label, report in _reports():
            text = report.to_text()
            for finding in report.failures:
                with self.subTest(case=label, subject=finding.subject):
                    self.assertIn(finding.subject, text)
                    self.assertIn(finding.message, text)

    def test_a_rule_with_several_findings_says_how_many(self):
        for _label, report in _reports():
            counts: dict[str, int] = {}
            for finding in report.failures:
                counts[finding.rule_id] = counts.get(finding.rule_id, 0) + 1
            if not any(n > 1 for n in counts.values()):
                continue
            text = report.to_text()
            biggest = max(counts.values())
            self.assertIn(f"({biggest} findings)", text)
            return
        self.skipTest("no report in the sweep repeated a rule")


if __name__ == "__main__":
    unittest.main()
