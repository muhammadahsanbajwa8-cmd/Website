"""Starting programs for common building types.

The areas here are ordinary design practice -- what a room needs to work --
and deliberately *not* code minimums. Code minimums vary by jurisdiction
and are applied later, by the rule engine, which will raise a finding if a
template's comfortable bedroom is below the local statutory floor. Keeping
the two apart is what stops a convenient default from being mistaken for a
legal one.
"""

from __future__ import annotations

from ..model import Function
from ..units import area_mm2, mm
from .schema import SpaceProgram, SpaceRequirement


def _r(key: str, function: Function, *, name: str = "", count: int = 1,
       area: str = "0m2", width: str = "0mm", prefer: str = "",
       adj: tuple[str, ...] = (), away: tuple[str, ...] = (),
       storey: int | None = None, priority: int = 5) -> SpaceRequirement:
    return SpaceRequirement(
        key=key,
        name=name or key.replace("_", " ").title(),
        function=function,
        count=count,
        min_area=area_mm2(area),
        min_width=mm(width),
        preferred_area=area_mm2(prefer) if prefer else 0,
        adjacent_to=adj,
        away_from=away,
        storey=storey,
        priority=priority,
    )


def house(bedrooms: int = 3, bathrooms: int = 2, storeys: int = 1) -> SpaceProgram:
    """A single-family house."""
    spaces = [
        _r("entry", Function.ENTRY, area="4m2", width="1.2m", priority=2, storey=0),
        _r("living", Function.LIVING, area="16m2", width="3.0m", prefer="24m2",
           adj=("entry", "dining"), priority=1, storey=0),
        _r("dining", Function.DINING, area="12m2", width="2.7m", prefer="16m2",
           adj=("kitchen",), priority=3, storey=0),
        _r("kitchen", Function.KITCHEN, area="9m2", width="2.4m", prefer="12m2",
           away=("bedroom",), priority=2, storey=0),
        _r("bedroom", Function.BEDROOM, count=bedrooms, area="10m2", width="2.7m",
           prefer="14m2", priority=1),
        _r("bathroom", Function.BATHROOM, count=bathrooms, area="4m2", width="1.7m",
           priority=2),
        _r("corridor", Function.CORRIDOR, area="6m2", width="1.0m", priority=1),
        _r("store", Function.STORAGE, area="3m2", width="1.2m", priority=8),
    ]
    if storeys > 1:
        # Wide enough for a half-turn: two 1 m flights and the wall between
        # them. A 1 m stair well forces a single straight flight, which needs
        # over four metres of run that a house of this size does not have.
        spaces.append(_r("stair", Function.STAIR, area="10m2", width="2.2m",
                         priority=1, storey=0))
    return SpaceProgram(
        name=f"{bedrooms}-bedroom house",
        use="residential",
        spaces=spaces,
        storeys=storeys,
        source="template",
        notes=["Areas are design practice, not code minimums."],
    )


def apartment(bedrooms: int = 2, bathrooms: int = 1) -> SpaceProgram:
    """A single dwelling unit within a larger building."""
    return SpaceProgram(
        name=f"{bedrooms}-bedroom apartment",
        use="residential",
        spaces=[
            _r("entry", Function.ENTRY, area="2.5m2", width="1.0m", priority=3),
            _r("living", Function.LIVING, area="14m2", width="3.0m", prefer="20m2",
               adj=("entry", "kitchen"), priority=1),
            _r("kitchen", Function.KITCHEN, area="7m2", width="2.1m", priority=2),
            _r("bedroom", Function.BEDROOM, count=bedrooms, area="9m2", width="2.6m",
               prefer="12m2", priority=1),
            _r("bathroom", Function.BATHROOM, count=bathrooms, area="3.5m2",
               width="1.7m", priority=2),
            _r("corridor", Function.CORRIDOR, area="4m2", width="1.0m", priority=2),
        ],
        storeys=1,
        source="template",
        notes=["Areas are design practice, not code minimums."],
    )


def office(workstations: int = 20, meeting_rooms: int = 2) -> SpaceProgram:
    """A small open-plan office floor."""
    # Roughly 8 m² of open floor per workstation once circulation within the
    # open area is included -- a planning convention, not a rule.
    open_area = max(40, workstations * 8)
    return SpaceProgram(
        name=f"office for {workstations}",
        use="office",
        spaces=[
            _r("lobby", Function.LOBBY, area="12m2", width="2.4m", priority=1),
            _r("open_office", Function.OFFICE, area=f"{open_area}m2", width="6m",
               adj=("lobby",), priority=1),
            _r("meeting", Function.MEETING, count=meeting_rooms, area="14m2",
               width="3.0m", priority=3),
            _r("wc", Function.WC, count=2, area="4m2", width="1.7m", priority=2),
            _r("store", Function.STORAGE, area="6m2", width="1.5m", priority=8),
            _r("corridor", Function.CORRIDOR, area="10m2", width="1.5m", priority=1),
            _r("stair", Function.STAIR, area="14m2", width="2.4m", priority=1),
        ],
        storeys=1,
        storey_height=3300,
        source="template",
        notes=["Areas are design practice, not code minimums."],
    )


def clinic(consult_rooms: int = 4) -> SpaceProgram:
    """A small outpatient clinic."""
    return SpaceProgram(
        name=f"clinic, {consult_rooms} consulting rooms",
        use="institutional",
        spaces=[
            _r("reception", Function.LOBBY, area="18m2", width="3.0m", priority=1),
            _r("waiting", Function.ASSEMBLY, area="20m2", width="3.0m",
               adj=("reception",), priority=1),
            _r("consult", Function.OFFICE, count=consult_rooms, area="12m2",
               width="2.7m", priority=1),
            _r("treatment", Function.OFFICE, area="16m2", width="3.0m", priority=2),
            _r("wc", Function.WC, count=2, area="4.5m2", width="1.7m", priority=2),
            _r("store", Function.STORAGE, area="6m2", width="1.5m", priority=6),
            _r("corridor", Function.CORRIDOR, area="14m2", width="1.5m", priority=1),
        ],
        storeys=1,
        storey_height=3300,
        source="template",
        notes=["Healthcare occupancies carry extra requirements almost everywhere;"
               " this template covers the plan only."],
    )


def school(classrooms: int = 6) -> SpaceProgram:
    """A teaching block."""
    return SpaceProgram(
        name=f"school block, {classrooms} classrooms",
        use="educational",
        spaces=[
            _r("lobby", Function.LOBBY, area="20m2", width="3.0m", priority=1),
            _r("classroom", Function.CLASSROOM, count=classrooms, area="48m2",
               width="6.0m", priority=1),
            _r("staff", Function.OFFICE, area="20m2", width="3.0m", priority=3),
            _r("wc", Function.WC, count=2, area="12m2", width="2.4m", priority=2),
            _r("store", Function.STORAGE, area="8m2", width="1.5m", priority=8),
            _r("corridor", Function.CORRIDOR, area="40m2", width="2.4m", priority=1),
            _r("stair", Function.STAIR, count=2, area="16m2", width="2.4m", priority=1),
        ],
        storeys=1,
        storey_height=3600,
        source="template",
        notes=["Areas are design practice, not code minimums."],
    )


def shop(sales_area: int = 120) -> SpaceProgram:
    """A single retail unit."""
    return SpaceProgram(
        name="retail unit",
        use="mercantile",
        spaces=[
            _r("sales", Function.RETAIL, area=f"{sales_area}m2", width="5m", priority=1),
            _r("store", Function.STORAGE, area="20m2", width="3m", priority=3),
            _r("wc", Function.WC, area="4m2", width="1.7m", priority=2),
            _r("corridor", Function.CORRIDOR, area="8m2", width="1.2m", priority=2),
        ],
        storeys=1,
        storey_height=3600,
        source="template",
        notes=["Areas are design practice, not code minimums."],
    )


TEMPLATES = {
    "house": house,
    "apartment": apartment,
    "office": office,
    "clinic": clinic,
    "school": school,
    "shop": shop,
}


def template(name: str, **kwargs) -> SpaceProgram:
    """Build a program from a named template."""
    try:
        factory = TEMPLATES[name.lower()]
    except KeyError:
        raise KeyError(
            f"unknown template {name!r}; try one of {', '.join(sorted(TEMPLATES))}"
        ) from None
    return factory(**kwargs)
