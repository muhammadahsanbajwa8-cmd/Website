"""Where the fittings go, so a plan reads as a house rather than as boxes.

A room labelled "Ensuite" with nothing in it is a rectangle with a caption.
The same rectangle with a shower tray in the corner, a basin on the wall and
a WC beside it is somewhere you can picture standing. That is most of the
difference between a diagram and a floor plan, and none of it needs new
geometry -- the symbols already exist for the plumbing sheet.

Placement is deliberately simple and deliberately explicit: fittings go
against the longest run of wall, in the order a fitter would set them out,
starting a fixed distance from the corner. It is not a joinery layout and it
does not pretend to be. What it is is honest about a room's SIZE: if the
fittings do not fit along the wall, they are not drawn crammed on top of each
other -- the room is reported as too small for the fittings it needs, which
is a real finding about the plan rather than a drafting problem.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..geom import Rect
from ..model import Function, Space
from ..symbols import footprint

# Clear of the corner, so a fitting is not drawn jammed into the junction of
# two walls where it could not physically be installed.
CORNER = 150

# Between fittings along a run.
GAP = 120

# Fittings that do not go against a wall at all. A floor waste sits in the
# middle of the fall of the floor, and it is drawn centred on its own origin
# rather than on its back edge -- so it is placed by a different rule, not by
# the wall rule with a fudge.
CENTRED = {"floor_drain"}


@dataclass(slots=True)
class Placed:
    kind: str
    x: int
    y: int
    rotation: int


# What goes in each kind of room, in setting-out order. Kitchens and laundries
# also get a bench, which is drawn as joinery rather than as a symbol.
BY_FUNCTION: dict[Function, tuple[str, ...]] = {
    Function.BATHROOM: ("bath", "basin", "wc"),
    Function.WC: ("wc", "basin"),
    Function.KITCHEN: ("sink",),
    Function.UTILITY: ("washing_machine", "floor_drain"),
}

# A room whose name says what it is more precisely than its function does.
# An ensuite is a bathroom, but it takes a shower rather than a bath.
BY_NAME = {
    "ensuite": ("shower", "basin", "wc"),
    "bath": ("bath", "basin", "wc"),
    "bathroom": ("bath", "basin", "wc"),
}

# Rooms that get a run of joinery rather than fittings: benches and shelving.
BENCH_DEPTH = 600
SHELF_DEPTH = 500
JOINERY = {
    Function.KITCHEN: BENCH_DEPTH,
    Function.UTILITY: BENCH_DEPTH,
    Function.STORAGE: SHELF_DEPTH,
}


# Room enough to stand in front of a fitting and use it. The placement below
# refuses a wall with less than this across from it, so it is the figure a
# room has to reach before its fittings can be drawn at all.
STANDING_ROOM = 500


def min_width_for(function: Function, name: str = "") -> int:
    """The narrowest a room can be and still hold the fittings it is named for.

    Every fitting has to go against a wall with somewhere to stand in front
    of it, so the room's SHORT side has to clear the deepest of them plus
    that standing room. Below that the placement gives up and the drawing
    says the room has no wall left to take them.

    Read off the same catalogue the drawing places from, because the two
    disagreeing is how the template came to ask for a 900 mm WC: a pan is
    680 deep and wants 500 in front of it, so 900 was 280 mm short of a room
    that could hold the one fitting it is named after. Forty-five of the
    sixty-seven plans in the lot sweep drew one.
    """
    kinds = BY_NAME.get(name.strip().lower().split()[0] if name.strip() else "",
                        BY_FUNCTION.get(function, ()))
    depths = [footprint(kind)[1] for kind in kinds if kind not in CENTRED]
    if not depths:
        return 0
    return max(depths) + STANDING_ROOM


def _wanted(space: Space) -> tuple[str, ...]:
    key = space.name.strip().lower().split()[0] if space.name.strip() else ""
    if key in BY_NAME:
        return BY_NAME[key]
    return BY_FUNCTION.get(space.function, ())


def _joinery_side(space: Space) -> str | None:
    """Which wall a run of joinery goes against, if the room gets one."""
    depth = JOINERY.get(space.function)
    if depth is None:
        return None
    rect = space.rect
    if min(rect.w, rect.h) < depth + 600:
        return None                      # no room to stand in front of it
    return "top" if rect.w >= rect.h else "left"


def joinery(space: Space) -> Rect | None:
    """A bench or a run of shelving against the room's longest wall."""
    side = _joinery_side(space)
    if side is None:
        return None
    depth = JOINERY[space.function]
    rect = space.rect
    if side == "top":
        return Rect(rect.x0, rect.y1 - depth, rect.w, depth)
    return Rect(rect.x0, rect.y0, depth, rect.h)


def _walls(rect: Rect) -> list[tuple[str, int]]:
    """The four inside faces, longest first, with the run each offers."""
    return sorted(
        [("bottom", rect.w), ("top", rect.w), ("left", rect.h), ("right", rect.h)],
        key=lambda pair: -pair[1],
    )


def _put(rect: Rect, side: str, cursor: int, kind: str) -> Placed:
    """Anchor one fitting against one wall face.

    Every plumbing symbol in `codraft.symbols` is built with its origin at
    the MIDDLE OF ITS BACK EDGE, running along local x and projecting out
    along local +y. So the point handed to `symbol()` is a point on the wall
    face itself, not the middle of the fitting -- offsetting it by half the
    depth pushes the fitting through the wall into the next room, which is
    exactly what the first version of this did.

    Rotation follows from that: local +y must point INTO the room. At 90
    degrees local +y is -x, so 90 belongs to the RIGHT-hand wall and 270 to
    the left. Those two were the wrong way round as well, and the two errors
    together put a bath half in the bedroom next door.
    """
    length, _depth = footprint(kind)
    along = cursor + length // 2
    if side == "bottom":
        return Placed(kind, rect.x0 + along, rect.y0, 0)
    if side == "top":
        return Placed(kind, rect.x0 + along, rect.y1, 180)
    if side == "left":
        return Placed(kind, rect.x0, rect.y0 + along, 270)
    return Placed(kind, rect.x1, rect.y0 + along, 90)


def place(space: Space) -> tuple[list[Placed], str | None]:
    """Fittings for one room, set out AROUND its walls.

    Around, not along. A 4.8 m2 bathroom takes a bath, a basin and a WC
    perfectly well -- on different walls. Putting all three on the longest
    one needs 3.2 m of run that a room that size does not have, and the first
    version of this concluded the room was too small and drew nothing: wrong
    about the room, and quiet about it too.

    The note still matters where a fitting genuinely has nowhere to go.
    Fittings drawn overlapping hide a problem somebody finds on site.
    """
    kinds = _wanted(space)
    if not kinds:
        return [], None

    rect = space.rect
    walls = _walls(rect)

    # A sink goes IN the bench, not on the wall opposite it. The bench is
    # drawn from the same room, so ask it which wall it took and try that
    # one first; without this the kitchen came out with a run of joinery
    # down one side and a sink plumbed into the far wall.
    bench_side = _joinery_side(space)
    if bench_side is not None:
        walls = (
            [pair for pair in walls if pair[0] == bench_side]
            + [pair for pair in walls if pair[0] != bench_side]
        )

    cursors = {side: CORNER for side, _ in walls}
    placed: list[Placed] = []
    unplaced: list[str] = []

    for kind in kinds:
        if kind in CENTRED:
            centre = rect.centre
            placed.append(Placed(kind, centre.x, centre.y, 0))
            continue
        length, depth = footprint(kind)
        for side, run in walls:
            across = rect.h if side in ("bottom", "top") else rect.w
            if cursors[side] + length + CORNER > run:
                continue
            if across < depth + STANDING_ROOM:   # room to stand in front
                continue
            placed.append(_put(rect, side, cursors[side], kind))
            cursors[side] += length + GAP
            break
        else:
            unplaced.append(kind)

    if unplaced:
        return placed, (
            f"{space.name} is {rect.w} x {rect.h} mm and has no wall left to "
            f"take its {', '.join(unplaced)}. Those fittings are not drawn, "
            "because drawing them over the others would hide the problem."
        )
    return placed, None


def for_storey(storey) -> tuple[list[tuple[Placed, Space]], list[Rect], list[str]]:
    """Every fitting, every run of joinery, and every room too small for its own."""
    fittings: list[tuple[Placed, Space]] = []
    benches: list[Rect] = []
    notes: list[str] = []
    for space in storey.spaces:
        items, note = place(space)
        fittings += [(item, space) for item in items]
        if note:
            notes.append(note)
        bench = joinery(space)
        if bench is not None:
            benches.append(bench)
    return fittings, benches, notes
