"""Will this design go on this block?

The whole question, in the order a builder asks it:

    1. Does the footprint fit inside the setbacks?
    2. Does it stay under the site cover the zoning allows?
    3. Is there enough outdoor living left over?
    4. How much room is left -- is it a comfortable fit or a squeeze?

Every answer is a number with a reason attached, because "no" is only
useful if it says which of the four failed and by how much. A design that
misses by 300 mm is a conversation with the council; one that misses by
four metres is a different design.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..geom import Rect
from ..model import Plot
from .design import Design


@dataclass(slots=True)
class Fit:
    """One design, tried on one block."""

    design: Design
    fits: bool = False
    placement: Rect | None = None
    mirrored: bool = False

    coverage_ratio: float = 0.0
    open_space_m2: float = 0.0
    margin_width_mm: int = 0     # spare room across the frontage
    margin_depth_mm: int = 0     # spare room front to back
    score: float = 0.0

    reasons: list[str] = field(default_factory=list)   # why it does not fit
    notes: list[str] = field(default_factory=list)     # worth knowing if it does

    @property
    def verdict(self) -> str:
        if self.fits:
            return "fits"
        return "does not fit"

    @property
    def summary(self) -> str:
        if self.fits:
            return (
                f"{self.coverage_ratio * 100:.0f}% cover, "
                f"{self.margin_width_mm} mm spare across, "
                f"{self.margin_depth_mm} mm spare deep"
            )
        return self.reasons[0] if self.reasons else "does not fit"


def fit_design(
    design: Design,
    plot: Plot,
    max_coverage: float | None = None,
    min_outdoor_m2: float | None = None,
) -> Fit:
    """Try one design on one block."""
    result = Fit(design=design)
    envelope = plot.buildable

    if envelope.w <= 0 or envelope.h <= 0:
        result.reasons.append(
            "The setbacks leave nothing to build on."
        )
        return result

    width, depth = design.width_mm, design.depth_mm
    if width <= 0 or depth <= 0:
        result.reasons.append(
            f"{design.name} has no recorded footprint, so it cannot be fitted. "
            "Add its width across the frontage and its depth."
        )
        return result

    # -- 1. does it physically go inside the setbacks? -------------------
    short_by_width = width - envelope.w
    short_by_depth = depth - envelope.h
    if short_by_width > 0 or short_by_depth > 0:
        if short_by_width > 0:
            result.reasons.append(
                f"{short_by_width} mm too wide: it needs {width} mm across the "
                f"frontage and the setbacks leave {envelope.w} mm."
            )
        if short_by_depth > 0:
            result.reasons.append(
                f"{short_by_depth} mm too deep: it needs {depth} mm and the "
                f"setbacks leave {envelope.h} mm."
            )
        result.margin_width_mm = -max(0, short_by_width)
        result.margin_depth_mm = -max(0, short_by_depth)
        return result

    result.margin_width_mm = envelope.w - width
    result.margin_depth_mm = envelope.h - depth

    # Sit it against the street frontage, centred across the block, which is
    # where a house goes and leaves the open space at the rear where it is
    # usable.
    offset = (envelope.w - width) // 2
    if plot.road_side in ("south", "west"):
        placement = Rect(envelope.x + offset, envelope.y, width, depth)
    else:
        placement = Rect(envelope.x + offset, envelope.y1 - depth, width, depth)
    result.placement = placement

    # -- 2. site cover ----------------------------------------------------
    footprint_mm2 = int(design.footprint_m2 * 1_000_000) or placement.area
    result.coverage_ratio = round(footprint_mm2 / plot.area, 4) if plot.area else 0.0
    if max_coverage is not None and result.coverage_ratio > max_coverage:
        over = (result.coverage_ratio - max_coverage) * plot.area / 1_000_000
        result.reasons.append(
            f"Site cover is {result.coverage_ratio * 100:.1f}%, over the "
            f"{max_coverage * 100:.0f}% the zoning allows, by about "
            f"{over:.0f} m²."
        )
        return result

    # -- 3. outdoor living ------------------------------------------------
    result.open_space_m2 = round((plot.area - footprint_mm2) / 1_000_000, 1)
    if min_outdoor_m2 is not None and result.open_space_m2 < min_outdoor_m2:
        result.reasons.append(
            f"Only {result.open_space_m2:.0f} m² is left uncovered and the "
            f"zoning wants at least {min_outdoor_m2:.0f} m² of outdoor living."
        )
        return result

    result.fits = True

    # -- 4. how comfortable is it? ---------------------------------------
    # Prefer the design that uses the block well without crowding it. A
    # house with 200 mm to spare either side will be a fight to build.
    tightness = min(result.margin_width_mm, result.margin_depth_mm)
    usage = result.coverage_ratio / max_coverage if max_coverage else result.coverage_ratio
    result.score = round(usage * 100 - max(0, 2000 - tightness) / 100, 1)

    if tightness < 500:
        result.notes.append(
            f"Only {tightness} mm of slack at the tightest point. Scaffold, "
            "eaves and downpipes all live in that gap -- check it before "
            "quoting."
        )
    if design.mirrorable and result.margin_width_mm > 0:
        result.notes.append(
            "Available handed, which may suit the block's orientation better."
        )
    return result


def fit_library(
    designs: list[Design],
    plot: Plot,
    max_coverage: float | None = None,
    min_outdoor_m2: float | None = None,
    bedrooms: int | None = None,
    storeys: int | None = None,
) -> list[Fit]:
    """Try a whole range on one block, best fit first.

    Designs that do not fit are returned too, ordered by how close they
    came. A builder wants to know that the design the client liked misses
    by 300 mm just as much as they want the list of ones that go.
    """
    candidates = designs
    if bedrooms is not None:
        candidates = [d for d in candidates if d.bedrooms == bedrooms]
    if storeys is not None:
        candidates = [d for d in candidates if d.storeys == storeys]

    results = [
        fit_design(design, plot, max_coverage, min_outdoor_m2)
        for design in candidates
    ]
    results.sort(
        key=lambda f: (
            not f.fits,
            -f.score if f.fits else -min(f.margin_width_mm, f.margin_depth_mm),
        )
    )
    return results
