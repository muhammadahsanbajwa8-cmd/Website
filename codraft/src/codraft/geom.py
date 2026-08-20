"""Points, rectangles and the small amount of geometry a floor plan needs.

All coordinates are integer millimetres in a right-handed plan coordinate
system: x runs east, y runs north, the origin sits at the south-west corner
of the plot. Storey height is carried separately -- plans are laid out in
two dimensions and extruded once, at export.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

# Two coordinates are the same point if they are within this distance. At a
# tenth of a millimetre this only ever absorbs rounding at a unit boundary,
# never a real dimension: no building detail is drawn that finely.
EPS = 1


@dataclass(frozen=True, slots=True)
class Point:
    x: int
    y: int

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def as_tuple(self) -> tuple[int, int]:
        return (self.x, self.y)


@dataclass(frozen=True, slots=True)
class Rect:
    """An axis-aligned rectangle, addressed by its south-west corner."""

    x: int
    y: int
    w: int
    h: int

    def __post_init__(self) -> None:
        if self.w < 0 or self.h < 0:
            raise ValueError(f"rectangle cannot have negative extent: {self}")

    # -- edges ----------------------------------------------------------
    @property
    def x0(self) -> int:
        return self.x

    @property
    def y0(self) -> int:
        return self.y

    @property
    def x1(self) -> int:
        return self.x + self.w

    @property
    def y1(self) -> int:
        return self.y + self.h

    @property
    def area(self) -> int:
        return self.w * self.h

    @property
    def centre(self) -> Point:
        return Point(self.x + self.w // 2, self.y + self.h // 2)

    @property
    def short_side(self) -> int:
        return min(self.w, self.h)

    @property
    def long_side(self) -> int:
        return max(self.w, self.h)

    @property
    def aspect(self) -> float:
        """Long side over short side. 1.0 is square; large is a corridor."""
        if self.short_side == 0:
            return float("inf")
        return self.long_side / self.short_side

    def corners(self) -> list[Point]:
        """Anticlockwise from the south-west corner."""
        return [
            Point(self.x0, self.y0),
            Point(self.x1, self.y0),
            Point(self.x1, self.y1),
            Point(self.x0, self.y1),
        ]

    def edges(self) -> Iterator[tuple[Point, Point]]:
        pts = self.corners()
        for i in range(4):
            yield pts[i], pts[(i + 1) % 4]

    # -- relationships ---------------------------------------------------
    def contains_point(self, p: Point) -> bool:
        return self.x0 <= p.x <= self.x1 and self.y0 <= p.y <= self.y1

    def contains(self, other: "Rect") -> bool:
        return (
            other.x0 >= self.x0 - EPS
            and other.y0 >= self.y0 - EPS
            and other.x1 <= self.x1 + EPS
            and other.y1 <= self.y1 + EPS
        )

    def intersection(self, other: "Rect") -> "Rect | None":
        x0 = max(self.x0, other.x0)
        y0 = max(self.y0, other.y0)
        x1 = min(self.x1, other.x1)
        y1 = min(self.y1, other.y1)
        if x1 <= x0 or y1 <= y0:
            return None
        return Rect(x0, y0, x1 - x0, y1 - y0)

    def overlaps(self, other: "Rect") -> bool:
        return self.intersection(other) is not None

    def inset(self, d: int) -> "Rect":
        """Shrink on every side. Used for setbacks and for wall thickness."""
        return Rect(self.x + d, self.y + d, max(0, self.w - 2 * d), max(0, self.h - 2 * d))

    def inset_sides(self, left: int, bottom: int, right: int, top: int) -> "Rect":
        """Shrink each side independently -- setbacks are rarely equal."""
        return Rect(
            self.x + left,
            self.y + bottom,
            max(0, self.w - left - right),
            max(0, self.h - bottom - top),
        )

    def shared_edge(self, other: "Rect") -> tuple[Point, Point] | None:
        """The segment two rectangles share, if they abut along a face.

        Rooms laid out by the solver touch exactly, so this is how a plan
        discovers where a party wall -- and therefore a doorway -- can go.
        Returns None when they only meet at a corner, or not at all.
        """
        # Vertical shared edge: one's right face is the other's left face.
        for a, b in ((self, other), (other, self)):
            if abs(a.x1 - b.x0) <= EPS:
                lo, hi = max(a.y0, b.y0), min(a.y1, b.y1)
                if hi - lo > EPS:
                    return Point(a.x1, lo), Point(a.x1, hi)
        # Horizontal shared edge.
        for a, b in ((self, other), (other, self)):
            if abs(a.y1 - b.y0) <= EPS:
                lo, hi = max(a.x0, b.x0), min(a.x1, b.x1)
                if hi - lo > EPS:
                    return Point(lo, a.y1), Point(hi, a.y1)
        return None


def segment_length(a: Point, b: Point) -> int:
    """Length of an axis-aligned segment."""
    return abs(b.x - a.x) + abs(b.y - a.y)


def is_vertical(a: Point, b: Point) -> bool:
    return abs(a.x - b.x) <= EPS


def point_on_segment(a: Point, b: Point, t: float) -> Point:
    """A point a fraction `t` along a segment."""
    return Point(round(a.x + (b.x - a.x) * t), round(a.y + (b.y - a.y) * t))


def manhattan(a: Point, b: Point) -> int:
    """Rectilinear distance -- how a person actually walks a plan."""
    return abs(a.x - b.x) + abs(a.y - b.y)


# ---------------------------------------------------------------------------
# Polygons: because real lots are not rectangles
# ---------------------------------------------------------------------------
def polygon_area(points: list[Point]) -> int:
    """Area by the shoelace formula, always positive.

    A Perth subdivision is full of splayed corners, battle-axe legs and
    curved frontages surveyed as chords. Treating those as their bounding
    rectangle overstates the lot by ten or twenty percent, and site cover is
    a percentage OF the lot -- so the error lands straight in the number the
    council checks.
    """
    if len(points) < 3:
        return 0
    total = 0
    for a, b in zip(points, points[1:] + points[:1]):
        total += a.x * b.y - b.x * a.y
    return abs(total) // 2


def point_in_polygon(p: Point, polygon: list[Point]) -> bool:
    """Ray casting. Points exactly on an edge count as inside."""
    if len(polygon) < 3:
        return False
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a.y > p.y) != (b.y > p.y):
            # x of the edge at this y.
            crossing = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)
            if crossing > p.x:
                inside = not inside
    return inside


def distance_to_segment(p: Point, a: Point, b: Point) -> float:
    """Shortest distance from a point to a line segment."""
    dx, dy = b.x - a.x, b.y - a.y
    if dx == 0 and dy == 0:
        return ((p.x - a.x) ** 2 + (p.y - a.y) ** 2) ** 0.5
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = a.x + t * dx, a.y + t * dy
    return ((p.x - cx) ** 2 + (p.y - cy) ** 2) ** 0.5


def polygon_bounds(points: list[Point]) -> Rect:
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    return Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


def edge_normal(a: Point, b: Point, inside: Point) -> tuple[float, float]:
    """The outward unit normal of an edge, given a point known to be inside."""
    dx, dy = b.x - a.x, b.y - a.y
    length = (dx * dx + dy * dy) ** 0.5 or 1.0
    nx, ny = dy / length, -dx / length
    # Flip it if it points towards the interior.
    mid_x, mid_y = (a.x + b.x) / 2, (a.y + b.y) / 2
    if (inside.x - mid_x) * nx + (inside.y - mid_y) * ny > 0:
        nx, ny = -nx, -ny
    return nx, ny


def centroid(points: list[Point]) -> Point:
    return Point(
        sum(p.x for p in points) // len(points),
        sum(p.y for p in points) // len(points),
    )


def largest_inscribed_rect(
    polygon: list[Point],
    clearances: list[int],
    cell: int = 250,
    min_side: int = 3000,
) -> Rect | None:
    """The biggest axis-aligned rectangle that fits inside the setbacks.

    Offsetting a polygon inwards exactly is fiddly and goes wrong on
    reflex corners, which is exactly where battle-axe lots live. Rasterising
    the buildable area and taking the largest rectangle inside it is
    approximate to one cell, robust on any shape, and answers the question a
    builder is actually asking: what is the biggest rectangle I can put a
    house in.

    `clearances` gives the setback for each edge, in the same order as the
    polygon's edges.
    """
    if len(polygon) < 3:
        return None
    bounds = polygon_bounds(polygon)
    if bounds.w < min_side or bounds.h < min_side:
        return None

    inside_point = centroid(polygon)
    edges = list(zip(polygon, polygon[1:] + polygon[:1]))
    columns = max(1, bounds.w // cell)
    rows = max(1, bounds.h // cell)
    if columns * rows > 4_000_000:      # keep it quick on a huge site
        cell = max(cell, int((bounds.w * bounds.h / 4_000_000) ** 0.5))
        columns = max(1, bounds.w // cell)
        rows = max(1, bounds.h // cell)

    # Mark every cell whose centre is inside the lot and clear of every
    # boundary by that boundary's setback.
    grid: list[list[bool]] = []
    for row in range(rows):
        y = bounds.y0 + row * cell + cell // 2
        line: list[bool] = []
        for column in range(columns):
            x = bounds.x0 + column * cell + cell // 2
            p = Point(x, y)
            ok = point_in_polygon(p, polygon)
            if ok:
                for (a, b), clearance in zip(edges, clearances):
                    if clearance and distance_to_segment(p, a, b) < clearance:
                        ok = False
                        break
            line.append(ok)
        grid.append(line)

    # Largest rectangle in a binary grid, row by row, by the standard
    # largest-rectangle-in-a-histogram scan. The stack holds (start column,
    # height) pairs so the height is never read back out of the array the
    # scan is still updating.
    heights = [0] * columns
    best = (0, 0, 0, 0, 0)   # area, left, right, bottom row, height in rows
    for row in range(rows):
        for column in range(columns):
            heights[column] = heights[column] + 1 if grid[row][column] else 0

        stack: list[tuple[int, int]] = []
        for column in range(columns + 1):
            current = heights[column] if column < columns else 0
            start = column
            while stack and stack[-1][1] >= current:
                index, height = stack.pop()
                area = height * (column - index)
                if area > best[0]:
                    best = (area, index, column, row, height)
                start = index
            stack.append((start, current))

    area, left, right, row, height = best
    if area == 0:
        return None
    x0 = bounds.x0 + left * cell
    y0 = bounds.y0 + (row - height + 1) * cell
    width = (right - left) * cell
    depth = height * cell
    if width < min_side or depth < min_side:
        return None
    return Rect(x0, y0, width, depth)
