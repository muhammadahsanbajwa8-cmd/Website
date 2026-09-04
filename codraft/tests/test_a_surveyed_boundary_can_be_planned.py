"""`--boundary` is the plot size, and a better one than a rectangle.

The help text says to use it for anything that is not a rectangle --
splayed corners, battle-axe legs, curved frontages. `codraft plan` asked
for the rectangle anyway and refused the command without it, so the one
input the option exists for could not be used on its own. The `fit` command
already got this right, which is how the two came to disagree.

Underneath that, `largest_inscribed_rect` had an opinion about what counts
as usable: under a 3000 mm side it returned None, and `Plot.buildable`
turned None into a zero rectangle. So a lot whose buildable rectangle came
out 19500 x 2750 mm reported no buildable area at all -- the measurement
thrown away and replaced with nothing, and the same message as a lot with
genuinely none. What is usable is a judgement for the caller, which can say
2750 mm and let somebody argue with the setbacks.
"""

import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codraft import cli
from codraft.geom import Point, largest_inscribed_rect
from codraft.model import Plot

# 19.8 m across the frontage, splaying out to 22.4 m, 30 m deep.
SURVEYED = "0,0 19783,0 22390,26000 0,30000"
# The same shape 12 m deep, which leaves 2750 mm once the setbacks are off.
TOO_SHALLOW = "0,0 19783,0 22390,9465 0,12000"


def _plan(out: Path, boundary: str, plot: str | None = None) -> tuple[int, str]:
    argv = ["plan", "3 bed house in Perth, WA", "--boundary", boundary,
            "--out", str(out), "--name", "t", "--formats", "pdf"]
    if plot:
        argv += ["--plot", plot]
    said = io.StringIO()
    with contextlib.redirect_stdout(said), contextlib.redirect_stderr(said):
        code = cli.main(argv)
    return code, said.getvalue()


class ABoundaryIsEnoughOnItsOwn(unittest.TestCase):
    def test_a_surveyed_lot_draws_without_a_plot_size(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            code, said = _plan(out, SURVEYED)
            self.assertEqual(code, 0, said[-600:])
            self.assertTrue((out / "t.pdf").exists())
            self.assertIn("surveyed", said)

    def test_it_does_not_report_the_plot_size_as_missing(self):
        # The brief parser says so, truthfully, and printing it beside a lot
        # given corner by corner reads as a fault in what the user typed.
        with TemporaryDirectory() as tmp:
            _code, said = _plan(Path(tmp), SURVEYED)
            self.assertNotIn("No plot size found", said)

    def test_the_lot_is_the_polygon_not_its_bounding_box(self):
        # What the refusal is worth nothing without: site cover is a
        # percentage OF the lot.
        with TemporaryDirectory() as tmp:
            _code, said = _plan(Path(tmp), SURVEYED)
            self.assertIn("bounding box", said)


class ARefusalNamesTheRectangleItFound(unittest.TestCase):
    def test_a_shallow_lot_is_refused_with_its_measurement(self):
        with TemporaryDirectory() as tmp:
            code, said = _plan(Path(tmp), TOO_SHALLOW)
            self.assertNotEqual(code, 0)
            self.assertNotIn("no rectangle of a usable size", said)

    def test_the_measurement_survives_being_taken(self):
        corners = [Point(0, 0), Point(19783, 0), Point(22390, 9465),
                   Point(0, 12000)]
        plot = Plot.from_boundary(
            corners, setback_front=6000, setback_rear=1000,
            setback_left=1000, setback_right=1000, road_side="south")
        found = largest_inscribed_rect(corners, plot.edge_setbacks())
        self.assertIsNotNone(
            found, "the largest rectangle was discarded for being small")
        self.assertGreater(found.area, 0)
        self.assertLess(min(found.w, found.h), 3000,
                        "this lot no longer exercises the case")
        self.assertEqual(plot.buildable.area, found.area)


if __name__ == "__main__":
    unittest.main()
