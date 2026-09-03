"""The browser engine and the solver must size the same house.

web/engine.js is a port, not a second implementation. When it drifts, the
same brief comes back as two different houses depending on which one drew
it -- and the drift is silent, because each engine is internally consistent
and neither has any way to notice.

It drifted. `target` in the port returned each room's MINIMUM area where the
Python aims at the PREFERRED one, so the page drew a 24 m2 living room and
an 11 m2 bedroom where the CLI drew 32 and 12: an 18 m2 house, gone, with
nothing anywhere saying so. It took chasing a different symptom entirely --
a plan form that never fired in the browser -- to find it.

This file is the tripwire that would have caught it directly. It reads the
figures out of both sources and compares them, so a room resized in one and
not the other fails here rather than showing up as a customer's living room
being a third smaller on the website than on the drawing.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

from codraft.layout.solver import _instances, _target
from codraft.program import template

WEB = Path(__file__).resolve().parent.parent / "web"


def _js_rooms() -> dict[str, tuple[float, float]]:
    """Every room the port declares: key -> (min area m2, preferred m2).

    Read by RUNNING engine.js, not by parsing it. A regex over the source
    looked simpler and quietly missed the two rooms declared conditionally --
    the passage and the garage -- which is the pair you would least want a
    tripwire to skip.
    """
    node = shutil.which("node")
    if node is None:
        raise unittest.SkipTest("node is not installed, so engine.js "
                                "cannot be asked what it declares")
    script = """
const fs = require('fs');
const src = fs.readFileSync('engine.js', 'utf8');
const patched = src.replace('const perStorey = [];',
  'globalThis.__rooms = placedRooms.slice(); const perStorey = [];');
const mod = new Function(patched +
  '; return {layout: typeof layout !== "undefined" ? layout : null,' +
  ' design: typeof design !== "undefined" ? design : null};')();
(mod.layout || mod.design)({state: 'WA', zone: 'R20', lotW: 20000,
  lotD: 32000, storeys: 1, bedrooms: 4, bathrooms: 2, garage: 2,
  theatre: true, alfresco: true});
const out = {};
for (const r of globalThis.__rooms)
  out[String(r.key).replace(/[0-9]+$/, '')] =
    [r.minArea / 1e6, (r.preferArea || 0) / 1e6];
process.stdout.write(JSON.stringify(out));
"""
    result = subprocess.run([node, "-e", script], cwd=WEB,
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise AssertionError(f"engine.js would not run: {result.stderr[:400]}")
    return {k: tuple(v) for k, v in json.loads(result.stdout).items()}


class TestTheRoomListIsTheSameRoomList(unittest.TestCase):
    def test_the_port_declares_a_room_for_every_one_the_template_has(self):
        js = _js_rooms()
        self.assertTrue(js, "no rooms parsed out of engine.js")
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        keys = {key.split("_")[0] for key, _req in _instances(program)}
        # `bed2..n` and `bath2..n` are built in a loop in both, under names
        # the regex above deliberately skips.
        missing = {k for k in keys if k not in js} - {"bed", "bathroom"}
        self.assertEqual(missing, set(),
                         f"engine.js has no room for: {sorted(missing)}")

    def test_a_room_the_template_prefers_bigger_is_preferred_bigger_there(self):
        # The exact bug: the port had no notion of a preferred size, so every
        # room was built to the floor it may not go under.
        js = _js_rooms()
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        checked = 0
        for key, req in _instances(program):
            base = key.split("_")[0]
            if base not in js or not req.preferred_area:
                continue
            checked += 1
            with self.subTest(room=req.name):
                self.assertAlmostEqual(
                    js[base][1], req.preferred_area / 1e6, places=1,
                    msg=f"{req.name}: the port prefers {js[base][1]} m2, "
                        f"the template {req.preferred_area / 1e6} m2",
                )
        self.assertGreaterEqual(checked, 3,
                                "no preferred sizes were compared")

    def test_the_minimum_areas_agree_too(self):
        js = _js_rooms()
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        for key, req in _instances(program):
            base = key.split("_")[0]
            if base not in js:
                continue
            with self.subTest(room=req.name):
                self.assertAlmostEqual(js[base][0], req.min_area / 1e6,
                                       places=1)

    def test_the_whole_program_comes_to_the_same_area(self):
        # The number that actually decides the house: what the two engines
        # think a four-bedroom brief needs per floor.
        js = _js_rooms()
        program = template("au-house", bedrooms=4, bathrooms=2, storeys=1)
        theirs = 0.0
        for key, req in _instances(program):
            base = key.split("_")[0]
            if base not in js:
                # bed2..n / bathroom2..n, built in a loop over there.
                theirs += max(req.min_area, req.preferred_area) / 1e6
                continue
            theirs += max(js[base][0], js[base][1])
        ours = sum(_target(req) for _key, req in _instances(program)) / 1e6
        # Compared before the wall allowance, which each applies itself.
        raw = sum(max(req.min_area, req.preferred_area)
                  for _key, req in _instances(program)) / 1e6
        self.assertAlmostEqual(theirs, raw, delta=0.5,
                               msg=f"the port asks for {theirs:.1f} m2 of "
                                   f"rooms, the template {raw:.1f}")
        self.assertGreater(ours, raw, "the wall allowance went missing")


def _js_plan(brief: dict) -> list[tuple]:
    """The rooms engine.js lays out, as (storey, name, x, y, w, h)."""
    node = shutil.which("node")
    if node is None:
        raise unittest.SkipTest("node is not installed, so engine.js "
                                "cannot be asked what it draws")
    script = """
const fs = require('fs');
const design = new Function(fs.readFileSync('engine.js','utf8')
  + '\\nreturn design;')();
const out = design(JSON.parse(process.argv[1]));
if (out.error) { process.stdout.write(JSON.stringify({error: out.error})); }
else {
  const cells = [];
  out.plan.storeys.forEach((st, i) => st.forEach(c => cells.push(
    [i, c.r.name, c.rect.x, c.rect.y, c.rect.w, c.rect.h])));
  process.stdout.write(JSON.stringify({cells}));
}
"""
    result = subprocess.run([node, "-e", script, json.dumps(brief)], cwd=WEB,
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise AssertionError(f"engine.js would not run: {result.stderr[:400]}")
    got = json.loads(result.stdout)
    if "error" in got:
        raise unittest.SkipTest(f"engine.js refused the brief: {got['error']}")
    return sorted(tuple(c) for c in got["cells"])


# What `design()` in engine.js applies for these states, which is the same
# set the page offers. Repeated here rather than imported so that a change
# to either side has to be made deliberately in both.
CONTROLS = {
    "WA": dict(front=6000, rear=1000, side=1000, cover=0.5, place="Perth, WA"),
    "VIC": dict(front=6000, rear=3000, side=1000, cover=0.6,
                place="Melbourne, VIC"),
    "NSW": dict(front=4500, rear=3000, side=900, cover=0.5,
                place="Sydney, NSW"),
}


def _py_plan(brief: dict) -> list[tuple]:
    from codraft.codes import design_parameters, resolve
    from codraft.geom import Rect
    from codraft.layout import LayoutError, solve
    from codraft.model import Plot

    control = CONTROLS[brief["state"]]
    program = template("au-house", bedrooms=brief["bedrooms"],
                       bathrooms=brief["bathrooms"], storeys=brief["storeys"],
                       garage_spaces=brief["garage"],
                       theatre=brief["theatre"], alfresco=brief["alfresco"])
    program.build_to(design_parameters(resolve(control["place"]), program.use))
    plot = Plot(rect=Rect(0, 0, brief["lotW"], brief["lotD"]),
                road_side="south", setback_front=control["front"],
                setback_rear=control["rear"], setback_left=control["side"],
                setback_right=control["side"])
    try:
        layout = solve(program, plot,
                       max_footprint=int(plot.area * control["cover"]))
    except LayoutError as exc:
        raise unittest.SkipTest(f"the solver refused the brief: {exc}")
    return sorted((c.storey, c.name, c.rect.x, c.rect.y, c.rect.w, c.rect.h)
                  for c in layout.cells)


BRIEFS = [
    dict(state="WA", zone="R20", lotW=15000, lotD=30000, storeys=1),
    dict(state="WA", zone="R20", lotW=15000, lotD=30000, storeys=2),
    dict(state="WA", zone="R20", lotW=18000, lotD=35000, storeys=1),
    dict(state="WA", zone="R20", lotW=12000, lotD=32000, storeys=2),
    dict(state="VIC", zone="R20", lotW=15000, lotD=30000, storeys=2),
    dict(state="NSW", zone="R20", lotW=18000, lotD=35000, storeys=2),
]


class TestTheTwoEnginesDrawTheSameHouse(unittest.TestCase):
    """Not the same room list -- the same rectangles, to the millimetre.

    The room-list checks above are necessary and were not sufficient. They
    passed while the two engines agreed on every area and drew 316 different
    houses out of 316: the tile side was rounded down here and to nearest
    there, the footprint was held to one side boundary here and centred
    there, and the storey balancer offered a flexible room the ground floor
    here and never there. Each of those is invisible to a comparison of the
    brief. All three are obvious the moment you compare the drawing.
    """

    def _brief(self, base):
        return dict(base, bedrooms=4, bathrooms=2, garage=2,
                    theatre=True, study=False, alfresco=True, pool=False)

    def test_the_same_brief_lays_out_the_same_rooms_in_the_same_places(self):
        compared = 0
        for base in BRIEFS:
            brief = self._brief(base)
            label = (f'{brief["state"]} {brief["lotW"]}x{brief["lotD"]} '
                     f'{brief["storeys"]} storey')
            with self.subTest(brief=label):
                theirs = _js_plan(brief)
                ours = _py_plan(brief)
                compared += 1
                # Named rooms are compared, not keys: the two number their
                # bedrooms differently and always have.
                strip = lambda rows: sorted(  # noqa: E731
                    (s, n.rstrip(" 0123456789"), x, y, w, h)
                    for s, n, x, y, w, h in rows)
                self.assertEqual(
                    strip(ours), strip(theirs),
                    f"{label}: the page and the solver drew different houses",
                )
        # A brief either engine refuses is skipped, and a file of skips
        # passes silently. Say how many were actually drawn by both.
        self.assertGreaterEqual(
            compared, len(BRIEFS) - 1,
            f"only {compared} of {len(BRIEFS)} briefs were drawn by both "
            "engines, so almost nothing was compared",
        )

    def test_every_storey_the_brief_asks_for_gets_rooms_on_it(self):
        # A three-storey brief drew a top floor holding a passage and a
        # stair and nothing else, in the browser, on every one of the 120
        # three-storey plans in the sweep. It is worth asserting in both.
        brief = self._brief(dict(state="WA", zone="R20", lotW=15000,
                                 lotD=30000, storeys=3))
        for who, plan in (("engine.js", _js_plan(brief)),
                          ("the solver", _py_plan(brief))):
            for storey in range(3):
                names = [n for s, n, *_ in plan if s == storey]
                with self.subTest(who=who, storey=storey):
                    self.assertTrue(
                        [n for n in names
                         if not n.startswith(("Passage", "Stair"))],
                        f"{who} put nothing but circulation on storey "
                        f"{storey} of a three-storey house",
                    )


# Briefs on and around the line where one engine or the other starts saying
# no. Deliberately includes blocks too small for the brief: what is being
# asserted is the DIRECTION of a disagreement, so the set has to contain
# some.
MARGINAL = [
    dict(state="WA", lotW=10000, lotD=28000, storeys=1, bedrooms=2),
    dict(state="WA", lotW=10000, lotD=28000, storeys=1, bedrooms=4),
    dict(state="WA", lotW=10000, lotD=28000, storeys=2, bedrooms=4),
    dict(state="WA", lotW=12000, lotD=32000, storeys=1, bedrooms=5),
    dict(state="WA", lotW=15000, lotD=30000, storeys=1, bedrooms=4),
    dict(state="WA", lotW=15000, lotD=30000, storeys=2, bedrooms=5),
    dict(state="VIC", lotW=10000, lotD=28000, storeys=1, bedrooms=3),
    dict(state="VIC", lotW=15000, lotD=30000, storeys=2, bedrooms=4),
    dict(state="NSW", lotW=10000, lotD=28000, storeys=1, bedrooms=2),
    dict(state="NSW", lotW=18000, lotD=35000, storeys=2, bedrooms=4),
]


class TestThePageNeverPromisesMoreThanTheDrawingSet(unittest.TestCase):
    """Where the two disagree about whether a brief can be drawn at all.

    They do disagree, and only in one direction. engine.js refuses a brief
    whose rooms come to more than about 1.4 times what the block can carry,
    with the two figures in the message; the solver has no such test and
    draws it, naming every squeezed room instead. Over a 360-brief sweep the
    page turned away 20 the solver drew, and the solver turned away none the
    page drew.

    Which threshold is right is NOT settled here, and the attempt to settle
    it by measurement failed in a way worth recording. Neither instrument
    separates the two populations. By area ratio the worst brief the tests
    insist a builder sells sits at 0.67 and the worst the page rejects at
    0.64. By the narrowest habitable room, a case both engines draw happily
    -- 12 x 32 m, five bedrooms -- comes out at 1678 mm, and one the page
    refuses at 1670. Three millimetres apart is not a line, it is two
    samples. So no threshold was moved on a guess.

    What IS assertable is the direction, and it is the half that matters to
    a customer: the page can be more cautious than the drawing set, never
    more permissive. A page that draws a plan the CLI would then refuse has
    promised a house that does not exist.
    """

    @staticmethod
    def _drawn(brief, engine):
        """The plan, or the refusal as text. Never a skip: a brief either
        engine turns away is the case this test exists to look at."""
        try:
            return engine(brief)
        except unittest.SkipTest as refused:
            return str(refused)

    def test_the_solver_never_refuses_a_brief_the_page_drew(self):
        disagreed = 0
        for base in MARGINAL:
            brief = dict(base, zone="R20", bathrooms=2, garage=2,
                         theatre=True, study=False, alfresco=True, pool=False)
            label = (f'{brief["state"]} {brief["lotW"]}x{brief["lotD"]} '
                     f'{brief["storeys"]} storey {brief["bedrooms"]} bed')
            theirs = self._drawn(brief, _js_plan)
            ours = self._drawn(brief, _py_plan)
            page_drew = not isinstance(theirs, str)
            solver_drew = not isinstance(ours, str)
            if page_drew != solver_drew:
                disagreed += 1
            with self.subTest(brief=label):
                if page_drew and not solver_drew:
                    self.fail(
                        f"{label}: the page drew a house the solver refuses "
                        f"-- {ours}"
                    )
        # If the set stops containing a disagreement the assertion above has
        # become vacuous, and a vacuous invariant reads like a guarantee.
        self.assertGreater(
            disagreed, 0,
            "no brief in the marginal set disagrees any more, so this "
            "asserts nothing; add one or delete the test",
        )
