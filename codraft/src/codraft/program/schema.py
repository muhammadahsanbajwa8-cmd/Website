"""What a space program is, and what makes one valid."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..courses import snap_to_course
from ..model import Function
from ..units import area_mm2, mm


class ProgramError(ValueError):
    """A brief could not be turned into a usable program."""


@dataclass(slots=True)
class SpaceRequirement:
    """One kind of room, and what it needs.

    `min_area` and `min_width` are the brief's asks. They are floors, not
    targets: the solver may give more, and a code rule may demand more
    still, but it will never quietly give less -- a program that cannot be
    satisfied is reported as unsatisfiable rather than shrunk to fit.
    """

    key: str
    name: str
    function: Function
    count: int = 1
    min_area: int = 0            # mm²
    min_width: int = 0           # mm, the shorter plan dimension
    preferred_area: int = 0      # mm², what to grow towards if there is room
    adjacent_to: tuple[str, ...] = ()   # keys this should touch or open onto
    away_from: tuple[str, ...] = ()     # keys it should not adjoin
    needs_exterior_wall: bool = False   # for daylight, ventilation or egress
    storey: int | None = None    # None means the solver may place it anywhere
    priority: int = 5            # 1 is most important; used when space runs out
    solo: bool = False           # must not share its slice of the floor
    zone: str = ""               # 'front' puts it across the street frontage
    notes: str = ""

    def __post_init__(self) -> None:
        if self.count < 1:
            raise ProgramError(f"{self.key}: count must be at least 1")
        if self.min_area < 0 or self.min_width < 0:
            raise ProgramError(f"{self.key}: negative minimums make no sense")
        if self.preferred_area and self.preferred_area < self.min_area:
            raise ProgramError(
                f"{self.key}: preferred area is below the minimum area"
            )
        if self.needs_exterior_wall is False and self.function.is_habitable:
            # A habitable room without an exterior wall fails a daylight rule
            # in most of the world. Default it on rather than let the brief
            # produce a plan that is dead on arrival.
            self.needs_exterior_wall = True

    @property
    def total_min_area(self) -> int:
        return self.min_area * self.count

    @classmethod
    def from_dict(cls, data: dict) -> "SpaceRequirement":
        try:
            function = Function(str(data["function"]).lower())
        except (KeyError, ValueError) as exc:
            raise ProgramError(
                f"space {data.get('key', '?')!r}: "
                f"unknown function {data.get('function')!r}; "
                f"expected one of {', '.join(f.value for f in Function)}"
            ) from exc
        key = str(data.get("key") or data.get("name") or function.value).strip()
        if not key:
            raise ProgramError("every space needs a key")
        return cls(
            key=key,
            name=str(data.get("name") or key.replace("_", " ").title()),
            function=function,
            count=int(data.get("count", 1)),
            min_area=_area(data.get("min_area")),
            min_width=_len(data.get("min_width")),
            preferred_area=_area(data.get("preferred_area")),
            adjacent_to=tuple(data.get("adjacent_to", ()) or ()),
            away_from=tuple(data.get("away_from", ()) or ()),
            needs_exterior_wall=bool(data.get("needs_exterior_wall", False)),
            storey=data.get("storey"),
            priority=int(data.get("priority", 5)),
            solo=bool(data.get("solo", False)),
            zone=str(data.get("zone", "")),
            notes=str(data.get("notes", "")),
        )


def _area(value) -> int:
    return 0 if value in (None, "") else area_mm2(value)


def _len(value) -> int:
    return 0 if value in (None, "") else mm(value)


@dataclass(slots=True)
class SpaceProgram:
    """Everything the solver needs, and nothing about how it will look."""

    name: str
    use: str = "residential"
    spaces: list[SpaceRequirement] = field(default_factory=list)
    storeys: int = 1
    storey_height: int = 3000
    notes: list[str] = field(default_factory=list)
    source: str = "manual"   # 'template', 'brief', 'json' -- provenance matters

    def __post_init__(self) -> None:
        if self.storeys < 1:
            raise ProgramError("a building has at least one storey")
        seen: set[str] = set()
        for space in self.spaces:
            if space.key in seen:
                raise ProgramError(f"duplicate space key {space.key!r}")
            seen.add(space.key)
        for space in self.spaces:
            for ref in (*space.adjacent_to, *space.away_from):
                if ref not in seen:
                    raise ProgramError(
                        f"{space.key!r} refers to {ref!r}, which is not in the program"
                    )
            if space.storey is not None and not 0 <= space.storey < self.storeys:
                raise ProgramError(
                    f"{space.key!r} is assigned to storey {space.storey}, "
                    f"but the building has {self.storeys}"
                )

    @property
    def total_min_area(self) -> int:
        return sum(s.total_min_area for s in self.spaces)

    @property
    def room_count(self) -> int:
        return sum(s.count for s in self.spaces)

    def get(self, key: str) -> SpaceRequirement | None:
        return next((s for s in self.spaces if s.key == key), None)

    def for_storey(self, index: int) -> list[SpaceRequirement]:
        return [s for s in self.spaces if s.storey == index]

    def unplaced(self) -> list[SpaceRequirement]:
        return [s for s in self.spaces if s.storey is None]

    def build_to(self, design: dict) -> list[str]:
        """Raise the brief to the targets the jurisdiction's packs ask for.

        A program comes from a template, and a template is written somewhere:
        `au-house` sets a 28-course ceiling because that is what a project
        home in Perth is built to. Handed to Lahore, where the by-laws ask
        2750 mm, every habitable room fails on ceiling height -- 67 findings
        in a sweep of nine plans -- and the target that would have prevented
        it was sitting unread in the pack the plan was checked against.

        Doing this in one place is the point. It was done in `cmd_fit`, in a
        different and shorter form in the fallback beside it, and not at all
        for anyone using the library, so which corrections a plan got
        depended on which entry point drew it.

        Returns what was raised, so a caller can say so.
        """
        changed: list[str] = []
        corridor_width = int(design.get("corridor_width_mm", 0) or 0)
        if corridor_width:
            corridor = self.get("corridor")
            if corridor is not None and corridor_width > corridor.min_width:
                corridor.min_width = corridor_width
                changed.append(f"corridor widened to {corridor_width} mm")

        ceiling = int(design.get("ceiling_height_mm", 0) or 0)
        if ceiling:
            # Floor to floor has to clear the required ceiling AND the floor
            # structure under it. `slab_and_finish_mm` is the same allowance
            # the rule engine subtracts back off when it measures the clear
            # height, so the two agree by construction.
            # The CEILING is what gets snapped to a whole course, not the
            # floor-to-floor: brickwork runs from floor level to the plate,
            # and the floor structure sits under it as a slab, not as courses.
            # Snapping the sum instead raised every Australian storey from
            # 2634 to 2666 for a 2400 mm requirement the 28-course ceiling
            # already cleared.
            floor = int(design.get("slab_and_finish_mm", 200) or 200)
            wanted = snap_to_course(ceiling) + floor
            if wanted > self.storey_height:
                self.storey_height = wanted
                changed.append(f"storey height raised to {wanted} mm")

        # Done after the storey height, which is one of its inputs.
        if self.size_stair_for(
            int(design.get("stair_riser_max_mm", 0) or 0),
            int(design.get("stair_going_min_mm", 0) or 0),
        ):
            changed.append("stair sized to the local riser and going limits")
        return changed

    def size_stair_for(self, riser_max_mm: int, going_min_mm: int,
                       flights: int = 2, landing_mm: int = 900,
                       flight_width_mm: int = 1000) -> bool:
        """Give the stair the room the code's limits actually require.

        Riser and going minimums plus the storey height fix how much run a
        stair needs; the room it sits in has to be at least that. Leaving it
        to a template default means a plan that is fine in one jurisdiction
        fails on stair pitch in another, having never been given the space
        to comply.

        Returns True if the requirement was raised.
        """
        stair = next((s for s in self.spaces if s.function is Function.STAIR), None)
        if stair is None or self.storeys < 2 or riser_max_mm <= 0 or going_min_mm <= 0:
            return False

        risers = max(2, -(-self.storey_height // riser_max_mm))
        goings = max(1, risers - 1)
        per_flight = -(-goings // max(1, flights))
        run = per_flight * going_min_mm + landing_mm
        width = flights * flight_width_mm + (flights - 1) * 100

        # A little over, so rounding in the layout does not eat the margin.
        needed_area = int(run * width * 1.05)
        raised = False
        if needed_area > stair.min_area:
            stair.min_area = needed_area
            raised = True
        if width > stair.min_width:
            stair.min_width = width
            raised = True
        if stair.preferred_area and stair.preferred_area < stair.min_area:
            stair.preferred_area = stair.min_area
        return raised

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "use": self.use,
            "storeys": self.storeys,
            "storey_height": self.storey_height,
            "source": self.source,
            "notes": self.notes,
            "spaces": [
                {
                    "key": s.key,
                    "name": s.name,
                    "function": s.function.value,
                    "count": s.count,
                    "min_area_m2": round(s.min_area / 1e6, 2),
                    "min_width_mm": s.min_width,
                    "adjacent_to": list(s.adjacent_to),
                    "needs_exterior_wall": s.needs_exterior_wall,
                    "storey": s.storey,
                    "priority": s.priority,
                }
                for s in self.spaces
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SpaceProgram":
        if not isinstance(data, dict):
            raise ProgramError("a program must be a JSON object")
        raw = data.get("spaces")
        if not isinstance(raw, list) or not raw:
            raise ProgramError("a program needs a non-empty 'spaces' array")
        return cls(
            name=str(data.get("name", "Untitled")),
            use=str(data.get("use", "residential")),
            spaces=[SpaceRequirement.from_dict(s) for s in raw],
            storeys=int(data.get("storeys", 1)),
            storey_height=_len(data.get("storey_height")) or 3000,
            notes=list(data.get("notes", ())),
            source=str(data.get("source", "json")),
        )
