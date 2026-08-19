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
