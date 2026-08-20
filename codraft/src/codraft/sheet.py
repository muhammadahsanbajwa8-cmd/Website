"""Paper: sheet sizes, drawing scales, and the title block.

Until now a sheet was whatever size the drawing came out. That is fine for
looking at on screen and useless for anything else: a drawing is issued at a
stated scale on a stated sheet, and a builder measures off it with a scale
rule. Two rules follow, and both are the same rule this project applies to
reading a drawing, pointed the other way.

THE SCALE PRINTED IS THE SCALE DRAWN. codraft's own survey reader exists
because a drawing whose stated scale does not match its geometry produces
confident millimetres that are wrong. Emitting one would be the same fault
from the other side, so the scale in the title block is the divisor actually
applied to the geometry, and nothing else is written there.

ONLY STANDARD SCALES. A drawing at 1:137 cannot be measured -- no rule has
that edge. The scale is the largest of the conventional set that fits, and
where nothing fits, the sheet is refused rather than drawn at some ratio
invented to make it fit.

Fields nobody supplied are ruled through, not filled in. A job number
invented to fill a box is worse than an empty box, because the empty box is
obviously empty.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

# ISO A sizes, landscape, in millimetres of paper.
SHEET_SIZES: dict[str, tuple[int, int]] = {
    "A4": (297, 210),
    "A3": (420, 297),
    "A2": (594, 420),
    "A1": (841, 594),
    "A0": (1189, 841),
}

# The scales an architectural drawing is issued at. A scale rule carries
# these edges and no others, so a drawing at anything else cannot be
# measured off.
STANDARD_SCALES: tuple[int, ...] = (1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000)

# Trimmed margin, and the title block down the right-hand edge -- which is
# where the reference sets put it, so it survives being folded and filed.
MARGIN = 10
TITLE_BLOCK_WIDTH = 92


class SheetError(ValueError):
    """The drawing will not go on the paper at any standard scale."""


@dataclass(slots=True)
class Revision:
    """One row of the revision table."""

    mark: str          # A, B, C ...
    date: str          # as written on the sheet
    description: str
    by: str = ""


@dataclass(slots=True)
class TitleBlock:
    """What the box down the edge of the sheet says.

    Every field defaults to empty and prints as a rule. Nothing here is
    derived from the design, because none of it can be: a lot's street
    address is not a function of its dimensions, and a job number is not a
    function of anything at all.
    """

    project: str = ""
    client: str = ""
    address: str = ""
    job_number: str = ""
    drawn_by: str = ""
    checked_by: str = ""
    issued: str = ""
    revisions: list[Revision] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.issued:
            self.issued = date.today().strftime("%d.%m.%y")
        if not self.revisions:
            # "First issue" is a fact about a drawing being generated now.
            # Anything beyond it would be a history this file does not have.
            self.revisions = [Revision("A", self.issued, "First issue", self.drawn_by)]

    def rows(self) -> list[tuple[str, str]]:
        """Label and value, in the order they are printed."""
        return [
            ("PROJECT", self.project),
            ("CLIENT", self.client),
            ("SITE", self.address),
            ("JOB NO", self.job_number),
            ("DRAWN", self.drawn_by),
            ("CHECKED", self.checked_by),
            ("ISSUED", self.issued),
        ]


@dataclass(slots=True)
class Frame:
    """A sheet, and the window on it the drawing goes into.

    All dimensions are millimetres of paper. `scale` is the divisor: 100
    means 1:100, so a 12 000 mm wall is drawn 120 mm long.
    """

    size: str
    width: int
    height: int
    scale: int
    x: int              # the drawing window, in paper mm from the sheet's
    y: int              # bottom-left corner
    w: int
    h: int

    @property
    def title_x(self) -> int:
        return self.width - MARGIN - TITLE_BLOCK_WIDTH

    def covers_mm(self) -> tuple[int, int]:
        """How much real space the window holds at this scale."""
        return self.w * self.scale, self.h * self.scale


def fit_scale(
    content_w: int,
    content_h: int,
    size: str = "A3",
    scales: tuple[int, ...] = STANDARD_SCALES,
) -> Frame:
    """Put `content_w` x `content_h` of real millimetres on a sheet.

    Picks the largest standard scale that fits, so the drawing is as big as
    the paper allows without leaving the set of scales a rule can measure.
    Raises rather than inventing a ratio when nothing fits -- a sheet that
    cannot hold the drawing is a sheet size decision, and it belongs to
    whoever is issuing the set.
    """
    try:
        paper_w, paper_h = SHEET_SIZES[size]
    except KeyError:
        raise SheetError(
            f"unknown sheet size {size!r}; choose from "
            f"{', '.join(sorted(SHEET_SIZES))}"
        ) from None

    window_w = paper_w - MARGIN * 2 - TITLE_BLOCK_WIDTH
    window_h = paper_h - MARGIN * 2
    if window_w <= 0 or window_h <= 0:
        raise SheetError(f"{size} is too small to carry a title block")

    for scale in sorted(scales):
        if content_w <= window_w * scale and content_h <= window_h * scale:
            return Frame(
                size=size, width=paper_w, height=paper_h, scale=scale,
                x=MARGIN, y=MARGIN, w=window_w, h=window_h,
            )

    biggest = max(scales)
    needed_w = -(-content_w // window_w)
    needed_h = -(-content_h // window_h)
    raise SheetError(
        f"{content_w} x {content_h} mm will not fit the {window_w} x "
        f"{window_h} mm window on {size} at any standard scale: it needs "
        f"about 1:{max(needed_w, needed_h)}, and the smallest standard scale "
        f"is 1:{biggest}. Use a larger sheet."
    )
