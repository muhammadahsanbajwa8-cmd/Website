"""Read a builder's range out of a spreadsheet.

A builder's catalogue lives in a spreadsheet somebody maintains by hand, and
every one of them has different column headings. This reads the common ones,
says which it used, and says what it could not read -- rather than importing
forty designs of which six are quietly wrong.

Three things here are worth more than the parsing:

UNITS ARE AMBIGUOUS AND THE AMBIGUITY IS REFUSED. A frontage written "12.5"
is metres. Written "12500" it is millimetres. Written "250" it is neither
obviously -- 250 mm is not a house and 250 m is not a lot -- so that row is
skipped and reported, not guessed. Guessing here is the same fault as reading
a drawing's scale wrong: it produces a number that looks right and is out by
a thousand.

SQUARES ARE A REAL UNIT AND EXACTLY DEFINED. Australian builders quote house
area in squares, and a "25 square home" is not 25 m². One square is 100
square feet, and a foot is exactly 0.3048 m, so a square is exactly 9.290304
m². A column headed "squares" is converted; a column headed "area" is taken
as m², because that is what it says.

A ROW THAT CANNOT BE FITTED IS NOT IMPORTED. The fitting engine needs a name,
a frontage width and a depth. Anything else is optional. A row without those
three is reported by line number with what was missing, because a catalogue
entry that cannot go on a block is not a catalogue entry.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

from .design import Design, RoomEntry

# 100 square feet, and a foot is exactly 0.3048 m by international
# agreement, so this is exact rather than a rounded conversion factor.
SQUARE_M2 = 9.290304

# Below this a bare number is read as metres, above it as millimetres.
# Between them it is refused: 250 mm is not a house and 250 m is not a lot,
# so there is no reading of "250" that is safe to assume.
METRES_BELOW = 100
MILLIMETRES_ABOVE = 1000

# What a builder's spreadsheet calls each thing. Matched case-insensitively
# on the header with punctuation and spaces stripped, so "Lot Width (m)" and
# "lot_width" both land on the same field.
COLUMNS: dict[str, tuple[str, ...]] = {
    "name": ("name", "design", "designname", "home", "homedesign", "model",
             "plan", "product"),
    "builder": ("builder", "company", "brand", "range"),
    "width_mm": ("width", "frontage", "housewidth", "overallwidth",
                 "widthm", "frontagem", "buildingwidth"),
    "depth_mm": ("depth", "length", "housedepth", "overalldepth",
                 "depthm", "lengthm", "buildingdepth"),
    # A "minimum lot width" is NOT a house width: it is the block the design
    # needs, with the setbacks already allowed for. Feed one to a fitter that
    # subtracts setbacks again and every design reads as too big by exactly
    # the setbacks. Kept separate so the difference can be stated.
    "lot_width_mm": ("lotwidth", "minlotwidth", "minimumlotwidth",
                     "blockwidth", "minblockwidth"),
    "lot_depth_mm": ("lotdepth", "minlotdepth", "minimumlotdepth",
                     "blockdepth", "minblockdepth"),
    "storeys": ("storeys", "stories", "levels", "floors", "storey"),
    "bedrooms": ("bedrooms", "beds", "bed", "br", "noofbedrooms"),
    "bathrooms": ("bathrooms", "baths", "bath", "ba", "noofbathrooms"),
    "garage_spaces": ("garage", "garages", "cars", "carspaces", "car",
                      "garagespaces"),
    "house_m2": ("housem2", "livingm2", "housearea", "livingarea", "internal"),
    "garage_m2": ("garagem2", "garagearea"),
    "outdoor_m2": ("alfrescom2", "alfresco", "outdoor", "porch", "verandah"),
    "total_m2": ("totalm2", "total", "totalarea", "area", "areagm2",
                 "grossarea", "m2"),
    "squares": ("squares", "sq", "sqs", "totalsquares"),
    "notes": ("notes", "comment", "comments", "description"),
}

_ALIASES = {alias: field for field, aliases in COLUMNS.items() for alias in aliases}

# A unit written in the header -- "Min Lot Width (m)", "Depth (mm)" -- is
# better evidence than the magnitude of the cell under it, and spreadsheets
# carry it far more often than they repeat it in every cell.
_HEADER_UNITS = {
    "mm": "mm", "millimetres": "mm", "millimeters": "mm",
    "cm": "cm",
    "m": "m", "metres": "m", "meters": "m", "lm": "m",
}

# A frontage outside this band is a typo, whatever unit it is read in. Named
# rather than silently clamped: 250 in a column of 12.5s is somebody's finger
# slipping, and the builder needs to fix the sheet, not have codraft paper
# over it.
PLAUSIBLE_WIDTH_MM = (3000, 100_000)
PLAUSIBLE_DEPTH_MM = (3000, 200_000)


def _split_unit(header: str) -> tuple[str, str | None]:
    """Separate a header from any unit it carries: 'Width (m)' -> ('width', 'm')."""
    text = header.strip().lower()
    match = re.search(r"[\(\[]?\s*(mm|cm|m|metres|meters|lm|m2|sqm)\s*[\)\]]?\s*$", text)
    unit = None
    if match:
        token = match.group(1)
        if token in _HEADER_UNITS:
            unit = _HEADER_UNITS[token]
        text = text[: match.start()]
    return re.sub(r"[^a-z0-9]", "", text), unit


@dataclass(slots=True)
class ImportReport:
    """What the importer read, skipped, and could not make sense of."""

    rows: int = 0
    imported: list[Design] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    used_columns: dict[str, str] = field(default_factory=dict)   # header -> field
    ignored_columns: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> list[str]:
        out = [
            f"{self.rows} rows read, {len(self.imported)} imported, "
            f"{len(self.skipped)} skipped."
        ]
        if self.used_columns:
            out.append("Columns used:")
            for header, field_name in self.used_columns.items():
                out.append(f"  {header!r} -> {field_name}")
        if self.ignored_columns:
            # Naming them matters: a column called "Min Lot Width" that was
            # not recognised is the difference between a catalogue that fits
            # blocks and one that does not.
            out.append(
                "Columns ignored, because nothing here knows what they mean: "
                + ", ".join(repr(c) for c in self.ignored_columns)
            )
        for note in self.notes:
            out.append(note)
        if self.skipped:
            out.append("Not imported:")
            out.extend(f"  {reason}" for reason in self.skipped)
        return out


def _normalise(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", header.lower())


class UnitError(ValueError):
    """A number whose unit cannot be established."""


def length_mm(raw: str, what: str, hint: str | None = None,
              plausible: tuple[int, int] = PLAUSIBLE_WIDTH_MM) -> int:
    """A length from a spreadsheet cell, in millimetres.

    An explicit unit is honoured. A bare number is read by magnitude, and
    where the magnitude does not settle it, this raises rather than picking
    one -- a frontage out by a factor of a thousand is not a rounding error,
    it is a different building.
    """
    text = str(raw).strip().lower().replace(",", "")
    if not text:
        raise UnitError(f"{what} is empty")

    match = re.fullmatch(r"([0-9]*\.?[0-9]+)\s*(mm|cm|m|metres|meters|')?", text)
    if not match:
        raise UnitError(f"{what} {raw!r} is not a number")
    value = float(match.group(1))
    unit = match.group(2)

    if unit in ("mm",):
        return int(round(value))
    if unit in ("cm",):
        return int(round(value * 10))
    if unit in ("m", "metres", "meters"):
        return int(round(value * 1000))
    if unit == "'":
        return int(round(value * 304.8))

    # Two readings: what the column heading says, and what the magnitude
    # says. A sheet whose heading says metres but whose cells are millimetres
    # is not unusual -- somebody changed the units halfway and did not change
    # the heading -- so take whichever reading is a building, and say so when
    # they disagree. Where both work they agree anyway; where neither does,
    # nothing is assumed.
    by_hint: int | None = None
    if hint == "mm":
        by_hint = int(round(value))
    elif hint == "cm":
        by_hint = int(round(value * 10))
    elif hint == "m":
        by_hint = int(round(value * 1000))

    by_size: int | None = None
    if value < METRES_BELOW:
        by_size = int(round(value * 1000))
    elif value >= MILLIMETRES_ABOVE:
        by_size = int(round(value))

    low, high = plausible
    fits = [v for v in (by_hint, by_size) if v is not None and low <= v <= high]
    if fits:
        # The hint wins when both readings are plausible, which is the case
        # where they agree anyway.
        return by_hint if by_hint in fits else fits[0]

    if by_hint is None and by_size is None:
        raise UnitError(
            f"{what} {raw!r} has no unit and its size does not settle it: "
            f"{value:g} mm is not a house and {value:g} m is not a lot. "
            "Write it as '12.5 m' or '12500 mm', or put the unit in the "
            "column heading."
        )
    millimetres = by_hint if by_hint is not None else by_size
    low, high = plausible
    if not low <= millimetres <= high:
        raise UnitError(
            f"{what} {raw!r} reads as {millimetres} mm, which is outside "
            f"{low / 1000:g}-{high / 1000:g} m. That is a typo in the sheet "
            "rather than a design, so it is left for you to fix."
        )
    return millimetres


def _number(raw: str) -> float | None:
    text = str(raw).strip().replace(",", "")
    if not text:
        return None
    match = re.search(r"[0-9]*\.?[0-9]+", text)
    return float(match.group(0)) if match else None


def _integer(raw: str) -> int:
    value = _number(raw)
    return int(round(value)) if value is not None else 0


def read_catalogue(
    path: str | Path, builder: str = "", delimiter: str | None = None
) -> ImportReport:
    """Read a CSV or TSV of a builder's range into Design entries."""
    path = Path(path)
    report = ImportReport()
    text = path.read_text(encoding="utf-8-sig")

    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t").delimiter
        except csv.Error:
            delimiter = "\t" if "\t" in text.split("\n")[0] else ","
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    if not reader.fieldnames:
        report.notes.append(f"{path.name} has no header row, so nothing was read.")
        return report

    mapping: dict[str, str] = {}
    hints: dict[str, str | None] = {}
    for header in reader.fieldnames:
        if header is None:
            continue
        stem, unit = _split_unit(header)
        field_name = _ALIASES.get(stem) or _ALIASES.get(_normalise(header))
        if field_name and field_name not in mapping.values():
            mapping[header] = field_name
            hints[field_name] = unit
            report.used_columns[header] = (
                f"{field_name} (unit from the heading: {unit})" if unit
                else field_name
            )
        else:
            report.ignored_columns.append(header)

    for line, row in enumerate(reader, start=2):
        report.rows += 1
        values = {
            mapping[header]: (value or "")
            for header, value in row.items()
            if header in mapping
        }
        name = str(values.get("name", "")).strip()
        if not name:
            report.skipped.append(f"line {line}: no design name")
            continue

        # Prefer a true house dimension. Fall back to the lot dimension only
        # when there is no other, and mark the design so the difference is
        # never silently lost.
        from_lot = False
        width_raw = values.get("width_mm", "").strip()
        depth_raw = values.get("depth_mm", "").strip()
        width_hint, depth_hint = hints.get("width_mm"), hints.get("depth_mm")
        if not width_raw and values.get("lot_width_mm", "").strip():
            width_raw = values["lot_width_mm"]
            width_hint = hints.get("lot_width_mm")
            from_lot = True
        if not depth_raw and values.get("lot_depth_mm", "").strip():
            depth_raw = values["lot_depth_mm"]
            depth_hint = hints.get("lot_depth_mm")
            from_lot = True

        try:
            width = length_mm(width_raw, "frontage width",
                              width_hint, PLAUSIBLE_WIDTH_MM)
            depth = length_mm(depth_raw, "depth", depth_hint, PLAUSIBLE_DEPTH_MM)
        except UnitError as exc:
            report.skipped.append(f"line {line} ({name}): {exc}")
            continue
        if width <= 0 or depth <= 0:
            report.skipped.append(
                f"line {line} ({name}): a frontage of {width} mm and a depth of "
                f"{depth} mm cannot be fitted to a block"
            )
            continue

        design = Design(
            id=re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or f"row-{line}",
            name=name,
            builder=str(values.get("builder", "")).strip() or builder,
            source=f"{path.name} line {line}",
            width_mm=width,
            depth_mm=depth,
            storeys=max(1, _integer(values.get("storeys", "")) or 1),
            bedrooms=_integer(values.get("bedrooms", "")),
            bathrooms=_integer(values.get("bathrooms", "")),
            garage_spaces=_integer(values.get("garage_spaces", "")),
            house_m2=_number(values.get("house_m2", "")) or 0.0,
            garage_m2=_number(values.get("garage_m2", "")) or 0.0,
            outdoor_m2=_number(values.get("outdoor_m2", "")) or 0.0,
            total_m2=_number(values.get("total_m2", "")) or 0.0,
        )

        squares = _number(values.get("squares", ""))
        if squares and not design.total_m2:
            design.total_m2 = round(squares * SQUARE_M2, 1)
            design.notes.append(
                f"{squares:g} squares converted at {SQUARE_M2} m² per square "
                "(100 square feet exactly)."
            )
        elif squares and design.total_m2:
            # Both given. Say whether they agree rather than silently
            # preferring one -- a mismatch means the spreadsheet is wrong
            # somewhere and the builder should know which column to trust.
            expected = squares * SQUARE_M2
            if abs(expected - design.total_m2) > max(2.0, expected * 0.03):
                design.notes.append(
                    f"The squares column says {squares:g} squares "
                    f"({expected:.1f} m²) and the area column says "
                    f"{design.total_m2:.1f} m². They disagree; the area column "
                    "was used."
                )

        if from_lot:
            design.notes.append(
                "These are MINIMUM LOT dimensions from the spreadsheet, not "
                "the house envelope. The setbacks are already inside them, so "
                "`codraft fit` -- which takes the setbacks off the lot before "
                "comparing -- will read this design as larger than it is. Add "
                "a house width and depth column to fit it properly."
            )
        note = str(values.get("notes", "")).strip()
        if note:
            design.notes.append(note)
        if not design.total_m2:
            design.notes.append(
                "No floor area was given, so the envelope is used where an "
                "area is needed. That is the rectangle it occupies, not what "
                "a builder would quote."
            )
        report.imported.append(design)

    if any("MINIMUM LOT dimensions" in n for d in report.imported for n in d.notes):
        report.notes.append(
            "WARNING: some rows had only minimum-lot columns, no house "
            "dimensions. A minimum lot width already contains the setbacks, "
            "so fitting those designs will be wrong in the conservative "
            "direction -- they will be reported as too big by roughly the "
            "setbacks. The affected designs carry a note saying so."
        )
    if report.imported and not any(d.bedrooms for d in report.imported):
        report.notes.append(
            "No bedroom counts were read, so `codraft fit` cannot narrow the "
            "range by bedrooms -- every design will be tried against a block. "
            "A 'Beds' column fixes that."
        )
    return report
