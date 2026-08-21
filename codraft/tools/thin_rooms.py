"""How thin the plans come out, across a sweep of lots and programs.

Two numbers to move, and they pull against each other. A room is counted
THIN when its clear short side is under 1500 mm, which is roughly where a
bedroom stops being a bedroom and a bathroom stops taking a door swing. A
plan is REFUSED when a room falls under 600 mm, which will not take a door
at all.

Driving the thin count down by refusing more is not progress, so both are
printed. The sweep pairs every lot with every program deliberately, including
five bedrooms on a 9 x 22 m block: those SHOULD refuse, and the number worth
watching is whether anything a builder would actually sell is caught with
them.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from codraft.geom import Rect                     # noqa: E402
from codraft.layout import LayoutError, build_building, solve  # noqa: E402
from codraft.model import Plot                    # noqa: E402
from codraft.program import template              # noqa: E402

THIN = 1500

LOTS = [(9000, 22000), (10000, 25000), (10500, 32000), (12500, 28000),
        (15000, 30000), (16000, 24000), (18000, 30000), (20000, 35000)]
PROGRAMS = [(3, 1), (3, 2), (4, 2), (5, 2), (5, 3)]
STOREYS = (1, 2)


def sweep():
    thin = worst = cases = rooms = refused = 0
    examples = []
    refusals = []
    for width, depth in LOTS:
        for beds, baths in PROGRAMS:
            for storeys in STOREYS:
                program = template("au-house", bedrooms=beds,
                                   bathrooms=baths, storeys=storeys)
                plot = Plot(rect=Rect(0, 0, width, depth), road_side="south",
                            setback_front=6000, setback_rear=6000,
                            setback_left=1000, setback_right=1000)
                label = f"{width}x{depth} {beds}b{baths}ba {storeys}s"
                try:
                    layout = solve(program, plot)
                except LayoutError as exc:
                    refused += 1
                    refusals.append((label, str(exc)))
                    continue
                building = build_building(program, plot, layout)
                cases += 1
                for storey in building.storeys:
                    for space in storey.spaces:
                        rooms += 1
                        side = min(space.rect.w, space.rect.h)
                        if side < THIN:
                            thin += 1
                            examples.append(
                                (side, f"{label} {space.name} "
                                       f"{space.rect.w}x{space.rect.h}"))
                        worst = min(worst or side, side)
    examples.sort()
    return cases, rooms, thin, worst, examples, refused, refusals


if __name__ == "__main__":
    cases, rooms, thin, worst, examples, refused, refusals = sweep()
    print(f"{cases} plans drawn, {refused} refused, {rooms} rooms, "
          f"{thin} thinner than {THIN} mm ({thin * 100 / max(1, rooms):.1f}%), "
          f"thinnest {worst} mm")
    for side, label in examples[:15]:
        print(f"  {side:5d}  {label}")
    print()
    for label, _why in refusals:
        print(f"  refused  {label}")
