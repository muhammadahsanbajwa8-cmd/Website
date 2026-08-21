"""Geometry shared by every exporter: how a wall becomes a drawn thing.

A wall in the model is a centreline and a thickness. On a plan it is two
parallel faces, broken wherever a door or window sits, with jambs closing
each gap. Working that out once here keeps DXF, SVG and any later exporter
drawing the same building rather than three similar ones.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import Opening, OpeningKind, Storey, Wall


@dataclass(slots=True)
class Segment:
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass(slots=True)
class Arc:
    cx: int
    cy: int
    radius: int
    start_deg: float
    end_deg: float


@dataclass(slots=True)
class Band:
    """A filled rectangle of wall, in plan."""

    x: int
    y: int
    w: int
    h: int


@dataclass(slots=True)
class DrawnWall:
    faces: list[Segment]     # the two sides, broken at every opening
    jambs: list[Segment]     # the short lines closing each opening
    door_leaves: list[Segment]
    door_swings: list[Arc]
    window_lines: list[Segment]
    # The wall as a solid, and the holes punched in it. A drawing shows a
    # wall as POCHE -- filled through its thickness -- not as two hairlines
    # with white between them. Two hairlines read as a line on a diagram; a
    # filled band reads as something you cannot walk through, which is the
    # single thing that most makes a plan look like a plan.
    band: Band | None = None
    gaps: list[Band] = field(default_factory=list)


def _axis(wall: Wall) -> tuple[int, int, int, int]:
    """Unit vector along the wall, and its normal, in plan."""
    if wall.vertical:
        direction = 1 if wall.end.y >= wall.start.y else -1
        return 0, direction, direction, 0
    direction = 1 if wall.end.x >= wall.start.x else -1
    return direction, 0, 0, direction


def draw_wall(wall: Wall, openings: list[Opening]) -> DrawnWall:
    """Break a wall at its openings and produce everything to be drawn."""
    ux, uy, nx, ny = _axis(wall)
    half = wall.thickness // 2
    sx, sy = wall.start.x, wall.start.y
    length = wall.length

    def at(distance: int, offset: int) -> tuple[int, int]:
        """A point `distance` along the wall and `offset` across it."""
        return (sx + ux * distance + nx * offset, sy + uy * distance + ny * offset)

    gaps = sorted(
        ((max(0, o.offset), min(length, o.offset + o.width), o) for o in openings),
        key=lambda g: g[0],
    )

    faces: list[Segment] = []
    jambs: list[Segment] = []
    leaves: list[Segment] = []
    swings: list[Arc] = []
    window_lines: list[Segment] = []

    for side in (half, -half):
        cursor = 0
        for start, end, _ in gaps:
            if start > cursor:
                a, b = at(cursor, side), at(start, side)
                faces.append(Segment(a[0], a[1], b[0], b[1]))
            cursor = max(cursor, end)
        if cursor < length:
            a, b = at(cursor, side), at(length, side)
            faces.append(Segment(a[0], a[1], b[0], b[1]))

    for start, end, opening in gaps:
        for distance in (start, end):
            a, b = at(distance, half), at(distance, -half)
            jambs.append(Segment(a[0], a[1], b[0], b[1]))

        if opening.kind is OpeningKind.WINDOW:
            # A window is drawn as the glazing line down the middle of the wall.
            a, b = at(start, 0), at(end, 0)
            window_lines.append(Segment(a[0], a[1], b[0], b[1]))
        elif opening.kind is OpeningKind.DOOR:
            # The leaf stands open at 90 degrees from the hinge, with the
            # swing arc it sweeps -- the convention every plan uses.
            width = end - start
            hinge = at(start, 0)
            leaf_end = at(start, width)
            leaves.append(Segment(hinge[0], hinge[1], leaf_end[0], leaf_end[1]))
            import math

            start_angle = math.degrees(math.atan2(uy, ux))
            swing_angle = math.degrees(math.atan2(ny, nx))
            swings.append(
                Arc(hinge[0], hinge[1], width, min(start_angle, swing_angle),
                    max(start_angle, swing_angle))
            )

    # The wall as a solid, and a hole for every opening in it. Openings are
    # measured along the wall from its start; a wall runs either north-south
    # or east-west, so the band is one rectangle either way.
    half = wall.thickness // 2
    if wall.vertical:
        low = min(wall.start.y, wall.end.y)
        band = Band(wall.start.x - half, low, wall.thickness, wall.length)
        gaps = [
            Band(wall.start.x - half, low + o.offset, wall.thickness, o.width)
            for o in openings
        ]
    else:
        low = min(wall.start.x, wall.end.x)
        band = Band(low, wall.start.y - half, wall.length, wall.thickness)
        gaps = [
            Band(low + o.offset, wall.start.y - half, o.width, wall.thickness)
            for o in openings
        ]

    return DrawnWall(faces, jambs, leaves, swings, window_lines, band, gaps)


def storey_walls(storey: Storey) -> list[tuple[Wall, DrawnWall]]:
    return [(w, draw_wall(w, storey.openings_on(w.id))) for w in storey.walls]
