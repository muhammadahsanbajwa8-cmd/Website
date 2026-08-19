"""Lengths, areas and the parsing of both.

Everything inside codraft is an integer number of millimetres. Floors are
laid out by adding and subtracting whole millimetres, so a wall that is
3500 long is 3500 long in the DXF, in the IFC and in the compliance report
-- there is no accumulated float drift to explain away later.

Imperial input is exact too: an inch is 25.4 mm, which is a whole number of
tenths of a millimetre, so we parse through Decimal and round once, at the
boundary, rather than letting binary floats decide.
"""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP

MM = 1
CM = 10
M = 1000
INCH = Decimal("25.4")
FOOT = INCH * 12

_UNIT_FACTORS: dict[str, Decimal] = {
    "mm": Decimal(1),
    "cm": Decimal(10),
    "m": Decimal(1000),
    "in": INCH,
    '"': INCH,
    "inch": INCH,
    "inches": INCH,
    "ft": FOOT,
    "'": FOOT,
    "foot": FOOT,
    "feet": FOOT,
}

# 12'6", 12 ft 6 in, 12'-6"
_FEET_INCHES = re.compile(
    r"^\s*(?P<ft>\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*-?\s*"
    r"(?:(?P<in>\d+(?:\.\d+)?)\s*(?:\"|in|inch|inches)?)?\s*$",
    re.IGNORECASE,
)
_SIMPLE = re.compile(
    r"^\s*(?P<num>-?\d+(?:\.\d+)?)\s*(?P<unit>mm|cm|m|in|inch|inches|ft|feet|foot|\"|')?\s*$",
    re.IGNORECASE,
)


class UnitError(ValueError):
    """A length could not be read."""


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def mm(value: str | int | float | Decimal, default_unit: str = "mm") -> int:
    """Read a length and return whole millimetres.

    A bare number is interpreted in `default_unit`, which lets a rule pack
    or a brief declare its units once instead of on every value.

        >>> mm("3.5m"), mm("44in"), mm("12'6\\""), mm(2400)
        (3500, 1118, 3810, 2400)
    """
    if isinstance(value, (int,)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, (float, Decimal)):
        return _round(Decimal(str(value)))
    if not isinstance(value, str):
        raise UnitError(f"cannot read a length from {value!r}")

    text = value.strip()
    if not text:
        raise UnitError("empty length")

    fi = _FEET_INCHES.match(text)
    if fi and (fi.group("in") is not None or "'" in text or "f" in text.lower()):
        feet = Decimal(fi.group("ft")) * FOOT
        inches = Decimal(fi.group("in") or 0) * INCH
        return _round(feet + inches)

    simple = _SIMPLE.match(text)
    if not simple:
        raise UnitError(f"cannot read a length from {value!r}")
    unit = (simple.group("unit") or default_unit).lower()
    factor = _UNIT_FACTORS.get(unit)
    if factor is None:
        raise UnitError(f"unknown unit {unit!r} in {value!r}")
    return _round(Decimal(simple.group("num")) * factor)


def area_mm2(value: str | int | float, default_unit: str = "m2") -> int:
    """Read an area and return whole square millimetres.

    Accepts `45m2`, `45 sqm`, `480 sqft`, `480ft2`, or a bare number in
    `default_unit`.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = f"{value}{default_unit}"
    text = str(value).strip().lower().replace("²", "2")
    match = re.match(
        r"^\s*(-?\d+(?:\.\d+)?)\s*(m2|sqm|sq\.?\s*m|ft2|sqft|sq\.?\s*ft)?\s*$", text
    )
    if not match:
        raise UnitError(f"cannot read an area from {value!r}")
    number = Decimal(match.group(1))
    unit = (match.group(2) or default_unit).replace(" ", "").replace(".", "")
    if unit in ("m2", "sqm"):
        return _round(number * Decimal(1_000_000))
    if unit in ("ft2", "sqft"):
        side = FOOT * FOOT
        return _round(number * side)
    raise UnitError(f"unknown area unit in {value!r}")


def to_m(value_mm: int) -> float:
    """Millimetres as metres, for display only."""
    return value_mm / 1000.0


def to_m2(value_mm2: int) -> float:
    """Square millimetres as square metres, for display only."""
    return value_mm2 / 1_000_000.0


def to_ft(value_mm: int) -> float:
    """Millimetres as feet, for display only."""
    return value_mm / float(FOOT)


def to_ft2(value_mm2: int) -> float:
    """Square millimetres as square feet, for display only."""
    return value_mm2 / float(FOOT * FOOT)


def fmt_len(value_mm: int, system: str = "metric") -> str:
    """A length as a person would write it."""
    if system == "imperial":
        total_inches = Decimal(value_mm) / INCH
        feet = int(total_inches // 12)
        inches = (total_inches - feet * 12).quantize(Decimal("0.1"))
        return f"{feet}'-{inches}\""
    metres = Decimal(value_mm) / 1000
    return f"{metres.normalize():f} m"


def fmt_area(value_mm2: int, system: str = "metric") -> str:
    """An area as a person would write it."""
    if system == "imperial":
        return f"{to_ft2(value_mm2):.0f} sq ft"
    return f"{to_m2(value_mm2):.1f} m²"
