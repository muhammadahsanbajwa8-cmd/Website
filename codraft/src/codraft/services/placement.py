"""Where to put things, given a room and a wall to put them on.

Services layouts live or die on this: a socket in the middle of a room is
wrong in a way a reader spots instantly, and a pipe that runs diagonally
across a floor plate is not a pipe anyone will install.
"""

from __future__ import annotations

from ..geom import Point, Rect
from ..model import Function, OpeningKind, Space, Storey

# Which way a symbol must face to stand on each wall, given that every
# symbol is drawn facing north (into the room from a south wall).
FACING = {"south": 0, "north": 180, "west": 270, "east": 90}


def wall_points(
    rect: Rect, side: str, count: int, inset: int = 250, margin: int = 600
) -> list[tuple[int, int, int]]:
    """Spread `count` fixtures evenly along one wall of a room.

    Returns (x, y, rotation). The margin keeps them off the corners, where
    a socket is unreachable behind furniture and a basin will not fit.
    """
    if count <= 0:
        return []
    horizontal = side in ("south", "north")
    span = rect.w if horizontal else rect.h
    usable = max(0, span - 2 * margin)
    if usable <= 0:
        margin = span // 4
        usable = max(0, span - 2 * margin)

    positions = (
        [margin + usable // 2]
        if count == 1
        else [margin + usable * i // (count - 1) for i in range(count)]
    )

    out: list[tuple[int, int, int]] = []
    for position in positions:
        if side == "south":
            out.append((rect.x0 + position, rect.y0 + inset, 0))
        elif side == "north":
            out.append((rect.x0 + position, rect.y1 - inset, 180))
        elif side == "west":
            out.append((rect.x0 + inset, rect.y0 + position, 270))
        else:
            out.append((rect.x1 - inset, rect.y0 + position, 90))
    return out


def pack_along_wall(
    rect: Rect, side: str, widths: list[int], inset: int = 150, gap: int = 150
) -> tuple[list[tuple[int, int, int]], int]:
    """Lay fixtures along a wall in the order given, each taking its own width.

    Returns the placements and how much the run overruns the wall, so the
    caller can say the room is too small rather than draw a basin inside a
    bath and leave the reader to notice.
    """
    if not widths:
        return [], 0
    horizontal = side in ("south", "north")
    span = rect.w if horizontal else rect.h
    needed = sum(widths) + gap * (len(widths) - 1)
    overrun = max(0, needed - (span - 2 * gap))

    start = max(gap, (span - needed) // 2)
    out: list[tuple[int, int, int]] = []
    cursor = start
    for width in widths:
        centre = cursor + width // 2
        if side == "south":
            out.append((rect.x0 + centre, rect.y0 + inset, 0))
        elif side == "north":
            out.append((rect.x0 + centre, rect.y1 - inset, 180))
        elif side == "west":
            out.append((rect.x0 + inset, rect.y0 + centre, 270))
        else:
            out.append((rect.x1 - inset, rect.y0 + centre, 90))
        cursor += width + gap
    return out, overrun


def grid_points(rect: Rect, count: int) -> list[tuple[int, int]]:
    """Lay ceiling points out on a grid centred in the room."""
    if count <= 1:
        c = rect.centre
        return [(c.x, c.y)]
    columns = 2 if count <= 4 else 3
    rows = -(-count // columns)
    out: list[tuple[int, int]] = []
    for row in range(rows):
        for column in range(columns):
            if len(out) >= count:
                break
            x = rect.x0 + rect.w * (column * 2 + 1) // (columns * 2)
            y = rect.y0 + rect.h * (row * 2 + 1) // (rows * 2)
            out.append((x, y))
    return out


def opening_point(storey: Storey, opening) -> Point | None:
    """Where an opening sits, in plan."""
    wall = storey.wall(opening.wall)
    if wall is None:
        return None
    length = wall.length or 1
    t = min(1.0, (opening.offset + opening.width / 2) / length)
    return Point(
        round(wall.start.x + (wall.end.x - wall.start.x) * t),
        round(wall.start.y + (wall.end.y - wall.start.y) * t),
    )


def door_point(storey: Storey, space: Space) -> Point | None:
    """The doorway a room is entered through."""
    for opening in storey.openings_of(space.id):
        if opening.kind in (OpeningKind.DOOR, OpeningKind.OPENING):
            return opening_point(storey, opening)
    return None


def beside_door(storey: Storey, space: Space, offset: int = 500) -> tuple[int, int, int]:
    """Just inside the room, to the side of its door -- where a switch goes."""
    door = door_point(storey, space)
    centre = space.rect.centre
    if door is None:
        return (centre.x, centre.y, 0)

    # Step in from the doorway towards the middle of the room, then along
    # the wall, so the switch is on the wall rather than in the opening.
    dx, dy = centre.x - door.x, centre.y - door.y
    if abs(dx) > abs(dy):
        inward = 250 if dx > 0 else -250
        return (door.x + inward, door.y + offset, 270 if dx > 0 else 90)
    inward = 250 if dy > 0 else -250
    return (door.x + offset, door.y + inward, 0 if dy > 0 else 180)


def longest_free_side(storey: Storey, space: Space) -> str:
    """The wall of a room with the fewest openings in it.

    Fixtures want a solid wall behind them. Choosing the side with the most
    unbroken length keeps a basin from being drawn across a doorway.
    """
    door = door_point(storey, space)
    rect = space.rect
    sides = {
        "south": rect.w, "north": rect.w, "west": rect.h, "east": rect.h,
    }
    if door is not None:
        # Penalise whichever wall the door is in.
        if abs(door.y - rect.y0) <= abs(door.y - rect.y1) and abs(door.y - rect.y0) < rect.h / 2:
            sides["south"] = 0
        elif abs(door.y - rect.y1) < rect.h / 2:
            sides["north"] = 0
        if abs(door.x - rect.x0) <= abs(door.x - rect.x1) and abs(door.x - rect.x0) < rect.w / 2:
            sides["west"] = 0
        elif abs(door.x - rect.x1) < rect.w / 2:
            sides["east"] = 0
    return max(sides, key=lambda k: sides[k])


def corridor_axis(storey: Storey) -> tuple[bool, int, tuple[int, int]] | None:
    """The circulation spine: (is_vertical, position, (from, to)).

    Services follow circulation for the same reason people do -- it is the
    one route that reaches everywhere without going through a bedroom.
    """
    corridors = [s for s in storey.spaces if s.function is Function.CORRIDOR]
    if not corridors:
        return None
    corridor = max(corridors, key=lambda s: s.area)
    rect = corridor.rect
    if rect.h >= rect.w:
        return (True, rect.centre.x, (rect.y0, rect.y1))
    return (False, rect.centre.y, (rect.x0, rect.x1))


def route(storey: Storey, start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    """An orthogonal route from one point to another, via the corridor.

    Not a shortest path: a services route that cuts the corner through two
    bedrooms is shorter and useless. This goes out to the spine, along it,
    and back in -- which is how the run would actually be installed.
    """
    axis = corridor_axis(storey)
    if axis is None:
        # No corridor to follow: a simple L, which is still orthogonal.
        return [start, (end[0], start[1]), end]

    vertical, position, (lo, hi) = axis
    if vertical:
        spine_start = (position, max(lo, min(hi, start[1])))
        spine_end = (position, max(lo, min(hi, end[1])))
        points = [start, (position, start[1])] if start[0] != position else [start]
        points += [spine_start, spine_end]
        if end[0] != position:
            points += [(position, end[1]), end]
        else:
            points.append(end)
    else:
        spine_start = (max(lo, min(hi, start[0])), position)
        spine_end = (max(lo, min(hi, end[0])), position)
        points = [start, (start[0], position)] if start[1] != position else [start]
        points += [spine_start, spine_end]
        if end[1] != position:
            points += [(end[0], position), end]
        else:
            points.append(end)

    # Drop any point that repeats the one before it.
    cleaned: list[tuple[int, int]] = []
    for point in points:
        if not cleaned or point != cleaned[-1]:
            cleaned.append(point)
    return cleaned
