"""What a services layout is made of."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Fixture:
    """One thing that gets installed, at a point on the plan."""

    id: str
    kind: str            # the symbol to draw, see codraft.symbols
    x: int
    y: int
    space: str = ""      # the space id it serves
    rotation: int = 0    # degrees, for symbols that face a wall
    label: str = ""      # what to letter beside it
    height_mm: int = 0   # above finished floor, for the schedule
    circuit: str = ""    # which circuit or run it belongs to
    note: str = ""


@dataclass(slots=True)
class Run:
    """A route between fixtures: a cable, or a pipe."""

    kind: str            # 'circuit_light', 'circuit_power', 'switch_leg',
                         # 'cold', 'hot', 'waste', 'vent'
    points: list[tuple[int, int]] = field(default_factory=list)
    label: str = ""


@dataclass(slots=True)
class ServicesPlan:
    """One discipline's layout for one storey."""

    discipline: str      # 'electrical' or 'plumbing'
    storey: int
    fixtures: list[Fixture] = field(default_factory=list)
    runs: list[Run] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def count(self, kind: str) -> int:
        return sum(1 for f in self.fixtures if f.kind == kind)

    def schedule(self) -> list[tuple[str, int]]:
        """How many of each thing, for the drawing's schedule block."""
        tally: dict[str, int] = {}
        for fixture in self.fixtures:
            tally[fixture.kind] = tally.get(fixture.kind, 0) + 1
        return sorted(tally.items())
