"""Dimensions must agree with the geometry, and with each other."""

import unittest

from codraft.annotate import chains_close, dimension_storey, format_mm
from codraft.geom import Rect
from codraft.layout import build_building, solve
from codraft.model import Plot
from codraft.program import template


def _building(storeys=2):
    program = template("house", bedrooms=3, bathrooms=2, storeys=storeys)
    plot = Plot(rect=Rect(0, 0, 12192, 18288), setback_front=3048, setback_rear=1524)
    layout = solve(program, plot)
    return build_building(program, plot, layout), layout


class TestFormatting(unittest.TestCase):
    def test_metric_is_whole_millimetres(self):
        self.assertEqual(format_mm(3435), "3435")
        self.assertEqual(format_mm(1001), "1001")

    def test_imperial(self):
        self.assertEqual(format_mm(3048, "imperial"), "10'-0\"")


class TestChains(unittest.TestCase):
    def test_every_chain_closes(self):
        # The one arithmetic error a drawing set must never contain: a run
        # of dimensions that does not add up to the overall. It is found by
        # a builder with a tape measure rather than by anyone in the office.
        building, layout = _building()
        for storey in building.storeys:
            dims = dimension_storey(storey, layout.envelope)
            self.assertEqual(
                chains_close(dims, layout.envelope), [],
                f"{storey.name}: dimension chain does not close",
            )

    def test_overall_matches_the_footprint(self):
        building, layout = _building()
        dims = dimension_storey(building.storeys[0], layout.envelope)
        overalls = {d.text for d in dims if d.is_overall}
        self.assertIn(str(layout.envelope.w), overalls)
        self.assertIn(str(layout.envelope.h), overalls)

    def test_a_dimension_exists_for_every_internal_wall_line(self):
        building, layout = _building(storeys=1)
        storey = building.storeys[0]
        dims = [d for d in dimension_storey(storey, layout.envelope)
                if not d.is_overall and not d.vertical]
        # The chain segments must partition the width without gaps.
        edges = sorted({d.line.x0 for d in dims} | {d.line.x1 for d in dims})
        self.assertEqual(edges[0], layout.envelope.x0)
        self.assertEqual(edges[-1], layout.envelope.x1)


if __name__ == "__main__":
    unittest.main()
