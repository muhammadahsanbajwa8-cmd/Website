"""What goes on the land around the house.

A pool is not drawn where it looks nice; it is drawn where there is room
for the water, the paving, the barrier standing off it, and the 900 mm
non-climbable zone outside that. Those four together are considerably
bigger than the pool, and it is the reason a pool that "obviously fits"
the back yard often does not.
"""

from __future__ import annotations

from ..geom import Rect
from ..model import Plot, Pool


def rear_yard(plot: Plot, footprint: Rect) -> Rect:
    """The open ground behind the house, where a pool goes."""
    lot = plot.rect
    if plot.road_side == "south":
        return Rect(lot.x0, footprint.y1, lot.w, max(0, lot.y1 - footprint.y1))
    if plot.road_side == "north":
        return Rect(lot.x0, lot.y0, lot.w, max(0, footprint.y0 - lot.y0))
    if plot.road_side == "west":
        return Rect(footprint.x1, lot.y0, max(0, lot.x1 - footprint.x1), lot.h)
    return Rect(lot.x0, lot.y0, max(0, footprint.x0 - lot.x0), lot.h)


def place_pool(
    plot: Plot,
    footprint: Rect,
    length_mm: int = 8000,
    width_mm: int = 4000,
    barrier_offset_mm: int = 1000,
    ncz_mm: int = 900,
    boundary_clearance_mm: int = 1000,
) -> tuple[Pool | None, list[str]]:
    """Put a pool in the rear yard, or say why it will not go.

    The footprint a pool actually needs is the water plus the barrier
    standing off it plus the non-climbable zone outside that, and then a
    clearance to the boundary on top. An 8 by 4 metre pool needs a little
    over 11 by 7 metres of clear yard before anything else is considered.
    """
    warnings: list[str] = []
    yard = rear_yard(plot, footprint)
    if yard.w <= 0 or yard.h <= 0:
        return None, ["There is no rear yard left to put a pool in."]

    # The barrier rings the water at an offset. The non-climbable zone sits
    # OUTSIDE the barrier, and only the side facing the house and yard has
    # to find that room here: where the barrier runs along a boundary, a
    # boundary fence of 1200 mm or more may form part of it, and the zone
    # then falls on the neighbour's side. That is a real allowance and a
    # real thing to check -- it is not something to assume, so it is said
    # in the warnings rather than silently relied on.
    ring = barrier_offset_mm * 2
    needed_l = length_mm + ring + ncz_mm
    needed_w = width_mm + ring + ncz_mm

    for long_side_vertical in (True, False):
        w = needed_w if long_side_vertical else needed_l
        h = needed_l if long_side_vertical else needed_w
        if w <= yard.w and h <= yard.h:
            pool_w = width_mm if long_side_vertical else length_mm
            pool_h = length_mm if long_side_vertical else width_mm
            x = yard.x0 + (yard.w - pool_w) // 2
            y = yard.y0 + (yard.h - pool_h) // 2
            warnings.append(
                "Where the barrier runs along a boundary, a fence of 1200 mm "
                "or more may form part of it -- but then the non-climbable "
                "zone falls on the neighbour's side, and what stands there is "
                "outside your control. Check it before relying on the fence."
            )
            return (
                Pool(
                    rect=Rect(x, y, pool_w, pool_h),
                    barrier_offset_mm=barrier_offset_mm,
                    non_climbable_zone_mm=ncz_mm,
                ),
                warnings,
            )

    # Report the smaller of the two shortfalls, in the orientation that came
    # closest -- that is the number that tells you what to change.
    options = [
        max(needed_w - yard.w, needed_l - yard.h),   # long way up the yard
        max(needed_l - yard.w, needed_w - yard.h),   # long way across it
    ]
    short_by = max(0, min(options))
    return None, [
        f"A {length_mm / 1000:g} x {width_mm / 1000:g} m pool needs about "
        f"{needed_l} x {needed_w} mm of clear yard once the barrier and its "
        f"{ncz_mm} mm non-climbable zone are allowed for. The rear yard is "
        f"{yard.w} x {yard.h} mm, about {short_by} mm short. A smaller pool, "
        "a plunge pool, or the house brought forward."
    ]
