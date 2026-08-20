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
# How far a dimension string may sit from the line it annotates, in points.
_ANNOTATION_RADIUS = 26.0


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


def _establish_scale(page: Page, warnings: list[str]) -> tuple[list[Dimension], float, float, str]:
    """Derive millimetres per point from the dimensions printed on the page."""
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

    scaled = [d for d in candidates if d.scale_mm_per_pt > 0]
    if not scaled:
        if candidates:
            return candidates, 0.0, 0.0, (
                f"{len(candidates)} strings look like dimensions, but none of "
                "them sits close enough to a line to say what it measures. "
                "The scale cannot be established, so nothing on this page can "
                "be measured."
            )
        return candidates, 0.0, 0.0, (
            "No dimension strings were found on this page. Without one there "
            "is no way to know what the geometry means, and codraft will not "
            "guess a scale from the paper size -- a plan on A3 could be at "
            "1:50 or 1:100 and the drawing would look identical."
        )

    # Round each candidate to a sensible precision and take the most common.
    # A handful of dimensions will be mismatched to the wrong line; the
    # majority that agree are the scale.
    buckets = Counter(round(d.scale_mm_per_pt, 2) for d in scaled)
    best_value, best_count = buckets.most_common(1)[0]
    agreeing = [d for d in scaled if abs(d.scale_mm_per_pt - best_value) <= best_value * 0.02]
    scale = statistics.median(d.scale_mm_per_pt for d in agreeing)
    agreement = len(agreeing) / len(scaled)

    if agreement < 0.5:
        warnings.append(
            f"Only {len(agreeing)} of {len(scaled)} dimensions agree on a "
            "scale. Either the page carries more than one drawing at "
            "different scales, or dimensions are being matched to the wrong "
            "lines. Treat every measurement from this page as unconfirmed."
        )
    note = (
        f"Scale taken from {len(agreeing)} printed dimension(s) that agree "
        f"to within 2%, out of {len(scaled)} matched to a line."
    )
    return candidates, scale, agreement, note


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
