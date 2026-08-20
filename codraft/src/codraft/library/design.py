"""What a design is, once it is in the library.

Deliberately not "a drawing". A design is the handful of facts needed to
decide whether it goes on a block -- how big its footprint is, which way
its frontage faces, what it contains -- plus, optionally, the full model so
it can be drawn and code-checked once it has been chosen.

That split matters. A builder's catalogue can be loaded from a spreadsheet
of footprints and room counts long before anyone has extracted geometry
from forty PDF sets, and the fitting engine works from day one on the
former.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

from ..model import Building, Function
from ..units import area_mm2, mm


@dataclass(slots=True)
class RoomEntry:
    """One room in the design's schedule."""

    name: str
    function: str
    area_m2: float = 0.0
    count: int = 1


@dataclass(slots=True)
class Design:
    """A design in the builder's range."""

    id: str
    name: str
    builder: str = ""
    source: str = ""              # where it came from: a PDF, a drawing, generated

    # The two numbers that decide whether it goes on a block at all.
    width_mm: int = 0             # across the frontage
    depth_mm: int = 0             # back from the street

    storeys: int = 1
    storey_height_mm: int = 3000
    bedrooms: int = 0
    bathrooms: int = 0
    garage_spaces: int = 0

    # Areas as a builder quotes them, which is not one number.
    house_m2: float = 0.0
    garage_m2: float = 0.0
    outdoor_m2: float = 0.0       # alfresco, porch, verandah
    total_m2: float = 0.0

    rooms: list[RoomEntry] = field(default_factory=list)
    mirrorable: bool = True       # nearly every design is offered handed
    model: dict | None = None     # the full building model, when there is one
    notes: list[str] = field(default_factory=list)

    @property
    def footprint_m2(self) -> float:
        """Ground-floor area, which is what site cover is measured on."""
        if self.total_m2 and self.storeys > 1:
            # An upper storey does not add to site cover.
            return round(self.width_mm * self.depth_mm / 1_000_000, 1)
        return self.total_m2 or round(self.width_mm * self.depth_mm / 1_000_000, 1)

    @property
    def envelope_m2(self) -> float:
        """The rectangle it needs on the block, including the bits that stick out."""
        return round(self.width_mm * self.depth_mm / 1_000_000, 1)

    @property
    def label(self) -> str:
        beds = f"{self.bedrooms} bed" if self.bedrooms else ""
        storeys = "double storey" if self.storeys > 1 else "single storey"
        return " ".join(p for p in (self.name, f"({beds}, {storeys})") if p)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Design":
        rooms = [RoomEntry(**r) for r in data.get("rooms", ())]
        payload = {k: v for k, v in data.items() if k != "rooms"}
        payload.setdefault("id", payload.get("name", "design").lower().replace(" ", "-"))
        # Lengths may arrive as strings with units, from a spreadsheet.
        for key in ("width_mm", "depth_mm", "storey_height_mm"):
            if isinstance(payload.get(key), str):
                payload[key] = mm(payload[key])
        for key in ("house_m2", "garage_m2", "outdoor_m2", "total_m2"):
            if isinstance(payload.get(key), str):
                payload[key] = round(area_mm2(payload[key]) / 1_000_000, 2)
        known = {f for f in cls.__slots__}
        return cls(rooms=rooms, **{k: v for k, v in payload.items() if k in known})

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


def design_from_building(
    building: Building, name: str, builder: str = "", source: str = "generated"
) -> Design:
    """Turn a model codraft produced into a library entry.

    Lets the library be seeded before a single PDF has been extracted, and
    lets anything the generator invents for an awkward block be kept and
    offered on the next one like it.
    """
    ground = building.storeys[0] if building.storeys else None
    if ground is None or not ground.spaces:
        raise ValueError("a design needs at least one storey with rooms in it")

    xs = [s.rect.x0 for s in ground.spaces] + [s.rect.x1 for s in ground.spaces]
    ys = [s.rect.y0 for s in ground.spaces] + [s.rect.y1 for s in ground.spaces]
    width, depth = max(xs) - min(xs), max(ys) - min(ys)

    rooms: dict[tuple[str, str], RoomEntry] = {}
    for space in building.all_spaces():
        key = (space.name, space.function.value)
        entry = rooms.get(key)
        if entry is None:
            rooms[key] = RoomEntry(
                name=space.name,
                function=space.function.value,
                area_m2=round(space.area / 1_000_000, 1),
            )
        else:
            entry.count += 1
            entry.area_m2 = round(entry.area_m2 + space.area / 1_000_000, 1)

    garage = sum(
        s.area for s in building.all_spaces() if s.function is Function.GARAGE
    )
    outdoor = sum(
        s.area for s in building.all_spaces()
        if s.function in (Function.BALCONY, Function.COURTYARD)
    )
    total = building.gross_floor_area

    return Design(
        id=name.lower().replace(" ", "-"),
        name=name,
        builder=builder,
        source=source,
        width_mm=width,
        depth_mm=depth,
        storeys=building.storey_count,
        storey_height_mm=ground.height,
        bedrooms=len(building.spaces_by_function(Function.BEDROOM)),
        bathrooms=len(building.spaces_by_function(Function.BATHROOM))
        + len(building.spaces_by_function(Function.WC)),
        garage_spaces=2 if garage > 30_000_000 else (1 if garage else 0),
        house_m2=round((total - garage - outdoor) / 1_000_000, 1),
        garage_m2=round(garage / 1_000_000, 1),
        outdoor_m2=round(outdoor / 1_000_000, 1),
        total_m2=round(total / 1_000_000, 1),
        rooms=sorted(rooms.values(), key=lambda r: -r.area_m2),
    )
