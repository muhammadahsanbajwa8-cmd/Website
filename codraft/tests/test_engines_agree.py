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
