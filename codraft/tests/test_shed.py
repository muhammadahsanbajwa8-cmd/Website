"""A brief bigger than the block loses its extras, not its bedrooms.

A floor asked for 261 m2 on a 168 m2 footprint used to be drawn at 64 per
cent of everything: the shortfall is shared along the bands, a band's depth
is fixed, so all of it landed on one dimension and every bedroom came out
1321 mm across. The warnings were honest and the drawing was still useless.
"""

import unittest

from codraft.geom import Rect
from codraft.layout import solve
from codraft.layout.solver import _EXTRA_PRIORITY
from codraft.model import Plot
from codraft.program import template

# 10.5 x 16 m of buildable ground for a brief that asks for 261 m2.
TIGHT = Plot(rect=Rect(0, 0, 12500, 28000), road_side="south",
             setback_front=6000, setback_rear=6000,
             setback_left=1000, setback_right=1000)
ROOMY = Plot(rect=Rect(0, 0, 20000, 35000), road_side="south",
             setback_front=6000, setback_rear=6000,
             setback_left=1000, setback_right=1000)


def _program(**kw):
    return template("au-house", bedrooms=4, bathrooms=2, storeys=1, **kw)


class TestSheddingExtras(unittest.TestCase):
    def test_an_over_subscribed_floor_drops_its_extras(self):
        layout = solve(_program(), TIGHT)
        drawn = {c.key for c in layout.cells}
        self.assertNotIn("alfresco", drawn)
        self.assertTrue(
            any("was left out of storey 0" in w for w in layout.warnings),
            "a room was dropped and nothing said so",
        )

    def test_nothing_is_dropped_when_the_brief_fits(self):
        layout = solve(_program(), ROOMY)
        self.assertNotIn(
            "was left out",
            " ".join(layout.warnings),
        )
        self.assertIn("alfresco", {c.key for c in layout.cells})

    def test_the_house_itself_is_never_dropped(self):
        program = _program()
        ranked = {r.key: r.priority for r in program.spaces}
        layout = solve(program, TIGHT)
        drawn = {c.key.split("_")[0] for c in layout.cells}
        for key, priority in ranked.items():
            if priority < _EXTRA_PRIORITY:
                self.assertIn(
                    key, drawn,
                    f"{key} is ranked {priority} -- part of the house, not an extra",
                )

    def test_the_bedrooms_are_wider_for_it(self):
        layout = solve(_program(), TIGHT)
        beds = [c for c in layout.cells if c.key.startswith("bed_")]
        self.assertTrue(beds)
        # 1321 mm was what the un-shed brief drew. Anything at or under that
        # means the extras went and the bedrooms got nothing for it.
        self.assertGreater(min(c.rect.short_side - 172 for c in beds), 1321)


if __name__ == "__main__":
    unittest.main()
