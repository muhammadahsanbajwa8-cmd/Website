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
       storey: int | None = None, priority: int = 5,
       solo: bool = False, zone: str = "") -> SpaceRequirement:
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
        solo=solo,
        zone=zone,
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


def au_house(
    bedrooms: int = 4,
    bathrooms: int = 2,
    storeys: int = 1,
    garage_spaces: int = 2,
    theatre: bool = True,
    alfresco: bool = True,
) -> SpaceProgram:
    """An Australian project house, in the vocabulary the drawings use.

    Room names and the room list are taken from real permit sets: a master
    suite with a walk-in robe and ensuite, a passage rather than a corridor,
    a walk-in pantry off the kitchen, a theatre, an alfresco under the main
    roof, and a double garage with a store. Areas are ordinary project-home
    practice -- the NCC sets no minimum floor area for a room in a house, so
    nothing here is a code figure and none of it should be read as one.
    """
    spaces = [
        _r("portico", Function.ENTRY, name="Portico", area="4m2", width="1.5m",
           priority=4, storey=0, zone="front"),
        # The entry must run the full depth of the front zone: it is the only
        # thing joining the garage and portico at the street to the passage
        # behind them, and a house whose back half cannot reach the front
        # door is not a house.
        _r("entry", Function.ENTRY, name="Entry", area="6m2", width="1.5m",
           adj=("portico",), priority=1, storey=0, zone="front", solo=True),
        _r("passage", Function.CORRIDOR, name="Passage", area="12m2", width="1.0m",
           priority=1),
        _r("living", Function.LIVING, name="Living", area="24m2", width="3.6m",
           prefer="32m2", adj=("dining",), priority=1, storey=0),
        _r("dining", Function.DINING, name="Dining", area="14m2", width="3.0m",
           prefer="18m2", adj=("kitchen",), priority=2, storey=0),
        _r("kitchen", Function.KITCHEN, name="Kitchen", area="12m2", width="3.0m",
           priority=1, storey=0),
        _r("wip", Function.STORAGE, name="WIP", area="4m2", width="1.4m",
           adj=("kitchen",), priority=4, storey=0),
        _r("master", Function.BEDROOM, name="Master Suite", area="16m2",
           width="3.4m", prefer="18m2", priority=1),
        _r("wir", Function.STORAGE, name="WIR", area="5m2", width="1.6m",
           adj=("master",), priority=3),
        _r("ensuite", Function.BATHROOM, name="Ensuite", area="6m2", width="1.8m",
           adj=("master",), priority=2),
        _r("bed", Function.BEDROOM, name="Bed", count=max(1, bedrooms - 1),
           area="11m2", width="3.0m", prefer="12m2", priority=1),
        _r("bathroom", Function.BATHROOM, name="Bathroom",
           count=max(1, bathrooms - 1), area="6m2", width="1.8m", priority=2),
        _r("wc", Function.WC, name="WC", area="1.8m2", width="0.9m", priority=3),
        _r("laundry", Function.UTILITY, name="Laundry", area="7m2", width="1.8m",
           priority=3, storey=0),
        _r("linen", Function.STORAGE, name="Linen", area="1.5m2", width="0.6m",
           priority=8),
    ]
    if theatre:
        spaces.append(
            _r("theatre", Function.LIVING, name="Theatre", area="14m2",
               width="3.4m", priority=4, storey=0, zone="front")
        )
    if alfresco:
        spaces.append(
            _r("alfresco", Function.ALFRESCO, name="Alfresco", area="15m2",
               width="3.0m", adj=("living",), priority=5, storey=0)
        )
    if garage_spaces:
        # 3.0 m per bay plus the room to walk between car and wall.
        area = 20 if garage_spaces == 1 else 36
        spaces.append(
            _r("garage", Function.GARAGE,
               name="Garage" if garage_spaces == 1 else "Double Garage",
               area=f"{area}m2", width="3.2m", priority=2, storey=0,
               # A garage cannot give up half its depth to the room beside
               # it: two cars need 5.4 by 6.0 m and no less.
               solo=True, zone="front")
        )
        spaces.append(
            _r("store", Function.STORAGE, name="Store", area="4m2", width="1.5m",
               adj=("garage",), priority=7, storey=0, zone="front")
        )
    if storeys > 1:
        spaces.append(
            _r("stair", Function.STAIR, name="Stair", area="10m2", width="2.2m",
               priority=1, storey=0)
        )

    return SpaceProgram(
        name=f"{bedrooms} x {bathrooms} project home",
        use="residential",
        spaces=spaces,
        storeys=storeys,
        # 31 course brickwork gives about 2.55 m ceilings, which is what a
        # project home is built to and comfortably over the NCC's 2.4 m.
        storey_height=2750,
        source="template",
        notes=[
            "Room names follow Australian project-home practice.",
            "The NCC sets no minimum floor area for a room in a house. These "
            "areas are ordinary practice, not code figures.",
        ],
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
    "au-house": au_house,
    "australian": au_house,
    "project-home": au_house,
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
