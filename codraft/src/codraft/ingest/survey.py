"""Working out what a PDF drawing is actually saying.

A PDF gives you lines and text. It does not tell you which lines are walls,
how big anything is, or what scale it was drawn at. This module infers
those, and the order it does them in is the whole point:

    1. Read the dimension strings printed on the drawing.
    2. Match each one to the dimension line it annotates.
    3. Divide to get the scale -- millimetres per point.
    4. Only then measure anything else.

Scale is established from numbers a person wrote on the drawing, not from
a guess about paper size or a title-block label. That is what makes every
measurement downstream a transcription rather than an estimate, and it is
why a drawing with no dimensions on it gets no measurements out of this
module at all. It says so instead.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass, field

from .pdfread import PdfDocument, Page, Segment, TextRun

# A dimension on a metric drawing is a bare number of millimetres, usually
# three to five digits. Imperial drawings write feet and inches.
_METRIC = re.compile(r"^(\d{2,6})$")
_METRES = re.compile(r"^(\d{1,2})[.,](\d{1,3})\s*m?$")
_FEET_INCHES = re.compile(r"^(\d{1,3})'\s*-?\s*(\d{1,2}(?:\s*\d/\d)?)?\"?$")

MM_PER_INCH = 25.4
PT_PER_MM = 72 / MM_PER_INCH
# How far a dimension string may sit from the line it annotates, in points.
_ANNOTATION_RADIUS = 26.0

# "SCALE: 1:100" in a title block is a printed fact about the drawing, and a
# far better starting point than guessing which of twelve thousand segments
# a dimension string belongs to. It is treated as a candidate and then
# CHECKED against the dimensions, never trusted on its own.
_STATED_SCALE = re.compile(r"\b1\s*[:;]\s*(\d{1,5})\b")

# Scales a drawing is actually issued at. A title block that parses to 1:37
# is a misread, not an unusual scale.
_PLAUSIBLE_SCALES = (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2000)


@dataclass(slots=True)
class Dimension:
    """A printed dimension, and the line it appears to annotate."""

    text: str
    value_mm: float
    x: float
    y: float
    segment: Segment | None = None
    scale_mm_per_pt: float = 0.0


@dataclass(slots=True)
class WallCandidate:
    """Two parallel lines close together -- probably the faces of a wall."""

    x0: float
    y0: float
    x1: float
    y1: float
    thickness_mm: float
    length_mm: float
    vertical: bool


@dataclass(slots=True)
class Survey:
    """What could be read off one page, and what could not."""

    page: int
    width_pt: float
    height_pt: float
    segment_count: int = 0
    text_count: int = 0
    dimensions: list[Dimension] = field(default_factory=list)
    scale_mm_per_pt: float = 0.0
    scale_agreement: float = 0.0     # 0..1, how well the dimensions agree
    scale_note: str = ""
    labels: list[TextRun] = field(default_factory=list)
    walls: list[WallCandidate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_scale(self) -> bool:
        return self.scale_mm_per_pt > 0

    @property
    def scale_ratio(self) -> str:
        """The scale as a drawing would state it, e.g. 1:50."""
        if not self.has_scale:
            return "unknown"
        # 1 pt = 1/72 inch = 25.4/72 mm on paper.
        ratio = self.scale_mm_per_pt / (MM_PER_INCH / 72)
        return f"1:{ratio:.0f}"

    def mm(self, points: float) -> float:
        return points * self.scale_mm_per_pt


def _parse_dimension(text: str) -> float | None:
    """Read a dimension string as millimetres, or decide it is not one."""
    cleaned = text.strip().replace(",", "")
    if not cleaned:
        return None

    match = _FEET_INCHES.match(cleaned)
    if match:
        feet = float(match.group(1))
        inches = 0.0
        if match.group(2):
            part = match.group(2).strip()
            if "/" in part:
                whole, _, fraction = part.partition(" ")
                if "/" in whole:
                    num, _, den = whole.partition("/")
                    inches = float(num) / float(den or 1)
                else:
                    num, _, den = fraction.partition("/")
                    inches = float(whole) + float(num) / float(den or 1)
            else:
                inches = float(part)
        return (feet * 12 + inches) * MM_PER_INCH

    match = _METRES.match(cleaned)
    if match:
        return float(f"{match.group(1)}.{match.group(2)}") * 1000

    match = _METRIC.match(cleaned)
    if match:
        value = float(match.group(1))
        # A bare number under 100 is far more likely a room number, a level
        # or a note reference than a dimension anyone would draw.
        return value if 100 <= value <= 100000 else None
    return None


def _drop_levels(dimensions: list[Dimension]) -> tuple[list[Dimension], int]:
    """Remove survey levels, which look exactly like metric dimensions.

    A site plan is covered in reduced levels -- 33.03, 12.59, 11.26 -- which
    parse as 33 metres, 12.6 metres and so on. They are heights above datum,
    not lengths, and feeding them to the scale check pulls it badly off.
    They give themselves away by clustering: a dozen decimal values inside a
    narrow band, all to two decimal places, is a contour survey, not a set
    of room dimensions.
    """
    decimals = [
        d for d in dimensions
        if re.fullmatch(r"\d{1,2}[.,]\d{2}", d.text.strip())
    ]
    if len(decimals) < 6:
        return dimensions, 0
    values = sorted(d.value_mm for d in decimals)
    spread = values[-1] - values[0]
    # Levels on one sheet rarely span more than about 40 m of height.
    if spread > 40000:
        return dimensions, 0
    keep = [d for d in dimensions if d not in decimals]
    return keep, len(decimals)


def _nearest_segment(text: TextRun, segments: list[Segment]) -> Segment | None:
    """The dimension line a string is annotating, if one is obviously it.

    A dimension sits on or just off its line, and runs the same way. Both
    tests matter: without the orientation check, a number floating near a
    wall gets matched to the wall and the scale comes out wrong.
    """
    best: tuple[float, Segment] | None = None
    for segment in segments:
        if segment.length < 8:
            continue
        mid_x = (segment.x0 + segment.x1) / 2
        mid_y = (segment.y0 + segment.y1) / 2
        distance = ((mid_x - text.x) ** 2 + (mid_y - text.y) ** 2) ** 0.5
        if distance > _ANNOTATION_RADIUS:
            continue
        # Text on a horizontal dimension is written horizontally; text on a
        # vertical one is rotated, and lands beside rather than above.
        if best is None or distance < best[0]:
            best = (distance, segment)
    return best[1] if best else None


# A sheet that says NTS has stated something, and what it has stated is
# that there is no scale on it. Reporting that as "no stated scale was
# found" reads as a gap in the drawing rather than a decision by whoever
# drew it -- and it is the right decision on a schedule, which is a table:
# printing a ratio on one invites somebody to scale a size off a column of
# type.
_NOT_TO_SCALE = re.compile(r"(?<![A-Za-z])(NTS|N\.T\.S\.?|NOT TO SCALE)(?![A-Za-z])",
                           re.IGNORECASE)


def _says_not_to_scale(page: Page) -> bool:
    return any(_NOT_TO_SCALE.search(text.text) for text in page.texts)


def _stated_scales(page: Page) -> list[int]:
    """Scales printed on the sheet, most-repeated first."""
    found: Counter = Counter()
    for text in page.texts:
        for match in _STATED_SCALE.finditer(text.text):
            value = int(match.group(1))
            if value in _PLAUSIBLE_SCALES:
                found[value] += 1
    return [value for value, _ in found.most_common()]


def _score_scale(page: Page, mm_per_pt: float, dimensions: list[Dimension]) -> int:
    """How many printed dimensions this scale actually explains.

    For each dimension, ask whether the page contains a line of the length
    that dimension claims, near where it is written. That is a much steadier
    test than picking the nearest line and hoping: on a real drawing the
    nearest line to a dimension string is usually hatching.
    """
    if mm_per_pt <= 0:
        return 0
    matched = 0
    for dimension in dimensions:
        wanted_pt = dimension.value_mm / mm_per_pt
        if wanted_pt < 4 or wanted_pt > max(page.width, page.height) * 1.5:
            continue
        for segment in page.segments:
            if abs(segment.length - wanted_pt) > max(1.0, wanted_pt * 0.02):
                continue
            mid_x = (segment.x0 + segment.x1) / 2
            mid_y = (segment.y0 + segment.y1) / 2
            if abs(mid_x - dimension.x) + abs(mid_y - dimension.y) <= 90:
                matched += 1
                break
    return matched


def _establish_scale(page: Page, warnings: list[str]) -> tuple[list[Dimension], float, float, str]:
    """Work out millimetres per point, from what the drawing states and shows."""
    candidates: list[Dimension] = []
    for text in page.texts:
        value = _parse_dimension(text.text)
        if value is None:
            continue
        segment = _nearest_segment(text, page.segments)
        dimension = Dimension(text.text.strip(), value, text.x, text.y, segment)
        if segment is not None and segment.length > 0:
            dimension.scale_mm_per_pt = value / segment.length
        candidates.append(dimension)

    candidates, levels = _drop_levels(candidates)
    if levels:
        warnings.append(
            f"{levels} values that look like survey levels (heights above "
            "datum) were set aside rather than treated as dimensions."
        )

    # Try the scales the sheet states, scoring each against the dimensions.
    usable = [d for d in candidates if 200 <= d.value_mm <= 60000]
    best_stated: tuple[int, int, float] | None = None
    for stated in _stated_scales(page):
        mm_per_pt = stated / PT_PER_MM
        score = _score_scale(page, mm_per_pt, usable)
        if best_stated is None or score > best_stated[1]:
            best_stated = (stated, score, mm_per_pt)

    if best_stated and usable and best_stated[1] >= max(3, len(usable) * 0.15):
        stated, score, mm_per_pt = best_stated
        for dimension in usable:
            dimension.scale_mm_per_pt = mm_per_pt
        return (
            candidates, mm_per_pt, score / len(usable),
            f"Scale 1:{stated} is printed on the sheet, and {score} of "
            f"{len(usable)} printed dimensions match a line of that length "
            "on the page. Both had to agree before it was accepted.",
        )

    # No fallback. An earlier version matched each dimension to its nearest
    # line and took the most common ratio; on a real drawing with twelve
    # thousand segments that produced confident nonsense -- 1:1249 on a
    # sheet drawn at 1:200. A scale that cannot be corroborated is reported
    # as unknown, because a wrong scale yields wrong millimetres that look
    # exactly like right ones.
    stated = _stated_scales(page)
    if stated and usable:
        return candidates, 0.0, 0.0, (
            f"The sheet states 1:{stated[0]}, but too few of the "
            f"{len(usable)} printed dimensions match a line of the "
            "corresponding length to confirm it. The page may hold several "
            "drawings at different scales, or the dimensions may be leaders "
            "rather than measured lines. No measurement is offered."
        )
    if stated:
        return candidates, 0.0, 0.0, (
            f"The sheet states 1:{stated[0]}, but carries no dimension "
            "strings to check it against. A stated scale alone is not "
            "enough: title blocks are copied between sheets and go stale."
        )
    if usable:
        return candidates, 0.0, 0.0, (
            f"{len(usable)} strings look like dimensions, but the sheet "
            "states no scale and none of them could be tied to a line of "
            "matching length. Nothing here can be measured."
        )
    if _says_not_to_scale(page):
        return candidates, 0.0, 0.0, (
            "The sheet says NOT TO SCALE, so there is no scale to establish "
            "and nothing on it is meant to be measured. That is the right "
            "thing for a schedule or a notes sheet to say: the sizes are in "
            "the table, and a ratio printed on one invites somebody to scale "
            "a size off a column of type."
        )
    return candidates, 0.0, 0.0, (
        "No dimension strings and no stated scale were found on this page. "
        "codraft will not guess a scale from the paper size -- a plan on A3 "
        "could be at 1:50 or 1:100 and the drawing would look identical."
    )


def _wall_candidates(page: Page, scale: float) -> list[WallCandidate]:
    """Pairs of parallel lines a wall's thickness apart.

    A wall on a plan is two lines. Finding the pairs is what separates the
    walls from the furniture, the hatching and the dimension lines -- and
    the spacing between them is the wall thickness, which is a real number
    the drawing is telling you.
    """
    if scale <= 0:
        return []

    walls: list[WallCandidate] = []
    for vertical in (False, True):
        runs = [
            s for s in page.segments
            if (s.vertical if vertical else s.horizontal) and s.length * scale > 500
        ]
        # Group by the axis they sit on, then look for near neighbours.
        runs.sort(key=lambda s: (s.x0 if vertical else s.y0))
        for i, a in enumerate(runs):
            a_pos = a.x0 if vertical else a.y0
            for b in runs[i + 1:]:
                b_pos = b.x0 if vertical else b.y0
                gap_mm = abs(b_pos - a_pos) * scale
                if gap_mm > 500:
                    break            # sorted, so nothing further is closer
                if gap_mm < 60:
                    continue         # the same line drawn twice
                # They must overlap along their length to be one wall.
                a_lo, a_hi = sorted((a.y0, a.y1) if vertical else (a.x0, a.x1))
                b_lo, b_hi = sorted((b.y0, b.y1) if vertical else (b.x0, b.x1))
                overlap = min(a_hi, b_hi) - max(a_lo, b_lo)
                if overlap * scale < 500:
                    continue
                centre = (a_pos + b_pos) / 2
                lo, hi = max(a_lo, b_lo), min(a_hi, b_hi)
                walls.append(
                    WallCandidate(
                        x0=centre if vertical else lo,
                        y0=lo if vertical else centre,
                        x1=centre if vertical else hi,
                        y1=hi if vertical else centre,
                        thickness_mm=round(gap_mm),
                        length_mm=round(overlap * scale),
                        vertical=vertical,
                    )
                )
                break  # one partner per line is enough
    return walls


def survey_page(page: Page) -> Survey:
    """Read everything that can be read off one page."""
    result = Survey(
        page=page.index,
        width_pt=page.width,
        height_pt=page.height,
        segment_count=len(page.segments),
        text_count=len(page.texts),
    )
    dimensions, scale, agreement, note = _establish_scale(page, result.warnings)
    result.dimensions = dimensions
    result.scale_mm_per_pt = scale
    result.scale_agreement = agreement
    result.scale_note = note

    result.labels = [
        t for t in page.texts
        if re.search(r"[A-Za-z]{3,}", t.text) and _parse_dimension(t.text) is None
    ]
    result.walls = _wall_candidates(page, scale)

    if scale > 0 and not result.walls:
        result.warnings.append(
            "No pairs of parallel lines were found that look like walls. The "
            "drawing may use single-line walls, or a hatch that hides them."
        )
    return result


def survey_pdf(document: PdfDocument) -> list[Survey]:
    """Survey every page of a document."""
    surveys = [survey_page(page) for page in document.pages]
    for survey in surveys:
        survey.warnings = document.warnings + survey.warnings
    return surveys
