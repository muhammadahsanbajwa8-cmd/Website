"""Symbol geometry, in millimetres, for services drawings.

Each symbol is built at the origin facing east, then rotated and moved into
place. Defining them once here means the DXF and the SVG draw the same
switch, rather than two drawings that disagree about what a switch looks
like.

Electrical symbols are conventional and roughly to the sizes used on a
1:50 plan. Plumbing fixtures are drawn at their real sizes, because a basin
that fits on the drawing but not in the room is worse than no drawing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

E = 180  # nominal radius for electrical symbols


@dataclass(slots=True)
class Line:
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(slots=True)
class Circle:
    cx: float
    cy: float
    r: float
    filled: bool = False


@dataclass(slots=True)
class Arc:
    cx: float
    cy: float
    r: float
    a0: float
    a1: float


@dataclass(slots=True)
class Label:
    x: float
    y: float
    text: str
    height: float = 150


@dataclass(slots=True)
class Symbol:
    lines: list[Line] = field(default_factory=list)
    circles: list[Circle] = field(default_factory=list)
    arcs: list[Arc] = field(default_factory=list)
    labels: list[Label] = field(default_factory=list)

    def transform(self, x: int, y: int, rotation: int, scale: float = 1.0) -> "Symbol":
        """Scale, rotate about the origin, then move to where it belongs.

        Scale exists for the legend. A bath is drawn 1700 mm long on the
        plan, which is correct there and absurd in a legend column.
        """
        radians = math.radians(rotation)
        cos, sin = math.cos(radians), math.sin(radians)

        def point(px: float, py: float) -> tuple[float, float]:
            px, py = px * scale, py * scale
            return (x + px * cos - py * sin, y + px * sin + py * cos)

        out = Symbol()
        for line in self.lines:
            a = point(line.x0, line.y0)
            b = point(line.x1, line.y1)
            out.lines.append(Line(a[0], a[1], b[0], b[1]))
        for circle in self.circles:
            c = point(circle.cx, circle.cy)
            out.circles.append(Circle(c[0], c[1], circle.r * scale, circle.filled))
        for arc in self.arcs:
            c = point(arc.cx, arc.cy)
            out.arcs.append(
                Arc(c[0], c[1], arc.r * scale, arc.a0 + rotation, arc.a1 + rotation)
            )
        for label in self.labels:
            p = point(label.x, label.y)
            # Text is never rotated: a drawing is read one way up.
            out.labels.append(Label(p[0], p[1], label.text, label.height * scale))
        return out


def _rect(w: float, h: float, cx: float = 0, cy: float = 0) -> list[Line]:
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    return [
        Line(x0, y0, x1, y0), Line(x1, y0, x1, y1),
        Line(x1, y1, x0, y1), Line(x0, y1, x0, y0),
    ]


# ---------------------------------------------------------------------------
# Electrical
# ---------------------------------------------------------------------------
def _light_ceiling() -> Symbol:
    return Symbol(
        circles=[Circle(0, 0, E)],
        lines=[Line(-E, 0, E, 0), Line(0, -E, 0, E)],
    )


def _light_wall() -> Symbol:
    return Symbol(
        arcs=[Arc(0, 0, E, 90, 270)],
        lines=[Line(0, -E, 0, E), Line(0, 0, E * 0.9, 0)],
    )


def _fan_ceiling() -> Symbol:
    blades = []
    for angle in (90, 210, 330):
        radians = math.radians(angle)
        blades.append(
            Line(0, 0, E * 1.9 * math.cos(radians), E * 1.9 * math.sin(radians))
        )
    return Symbol(circles=[Circle(0, 0, E * 0.5, filled=True)], lines=blades)


def _switch(ways: int = 1) -> Symbol:
    # A switch sits on a wall: a short stem, a dot, and the number of ways.
    return Symbol(
        circles=[Circle(0, 0, E * 0.35, filled=True)],
        lines=[Line(0, 0, E * 1.1, E * 1.1)],
        labels=[Label(E * 1.5, E * 1.3, "S" if ways == 1 else f"S{ways}", 170)],
    )


def _socket(label: str = "") -> Symbol:
    # The conventional socket: a semicircle standing on the wall line.
    symbol = Symbol(
        arcs=[Arc(0, 0, E * 0.85, 0, 180)],
        lines=[Line(-E * 0.85, 0, E * 0.85, 0), Line(0, 0, 0, -E * 0.6)],
    )
    if label:
        symbol.labels.append(Label(E * 1.1, E * 0.5, label, 150))
    return symbol


def _distribution_board() -> Symbol:
    symbol = Symbol(lines=_rect(700, 320))
    symbol.lines += [Line(-350 + i * 175, -160, -350 + i * 175 + 160, 160)
                     for i in range(4)]
    symbol.labels.append(Label(0, 300, "DB", 200))
    return symbol


def _exhaust_fan() -> Symbol:
    return Symbol(
        circles=[Circle(0, 0, E)],
        lines=[Line(-E * 0.7, -E * 0.7, E * 0.7, E * 0.7),
               Line(-E * 0.7, E * 0.7, E * 0.7, -E * 0.7)],
        labels=[Label(0, E * 1.5, "EF", 150)],
    )


def _water_heater() -> Symbol:
    return Symbol(
        circles=[Circle(0, 0, 250)],
        labels=[Label(0, -60, "WH", 180)],
    )


# ---------------------------------------------------------------------------
# Plumbing -- drawn at the sizes these things actually are
# ---------------------------------------------------------------------------
def _wc() -> Symbol:
    """Cistern against the wall, pan in front of it."""
    symbol = Symbol(lines=_rect(700, 200, 0, 100))
    symbol.arcs.append(Arc(0, 480, 200, 0, 360))
    symbol.lines += [Line(-200, 200, -200, 480), Line(200, 200, 200, 480)]
    return symbol


def _basin() -> Symbol:
    symbol = Symbol(lines=_rect(600, 450, 0, 225))
    symbol.arcs.append(Arc(0, 250, 180, 0, 360))
    symbol.circles.append(Circle(0, 80, 40))  # the tap
    return symbol


def _shower() -> Symbol:
    symbol = Symbol(lines=_rect(900, 900, 0, 450))
    symbol.lines += [Line(-450, 0, 450, 900), Line(450, 0, -450, 900)]
    symbol.circles.append(Circle(0, 450, 60))  # the gully
    return symbol


def _bath() -> Symbol:
    symbol = Symbol(lines=_rect(1700, 750, 0, 375))
    symbol.lines += _rect(1560, 620, 0, 375)
    symbol.circles.append(Circle(-680, 375, 55))
    return symbol


def _sink() -> Symbol:
    symbol = Symbol(lines=_rect(1000, 600, 0, 300))
    symbol.lines += _rect(400, 400, -220, 300)
    symbol.lines += _rect(400, 400, 220, 300)
    symbol.circles.append(Circle(0, 80, 45))
    return symbol


def _washing_machine() -> Symbol:
    symbol = Symbol(lines=_rect(600, 600, 0, 300))
    symbol.circles.append(Circle(0, 300, 200))
    symbol.labels.append(Label(0, 700, "WM", 150))
    return symbol


def _floor_drain() -> Symbol:
    symbol = Symbol(lines=_rect(150, 150))
    symbol.lines += [Line(-75, -75, 75, 75), Line(-75, 75, 75, -75)]
    return symbol


def _stack(text: str) -> Symbol:
    return Symbol(
        circles=[Circle(0, 0, 90), Circle(0, 0, 130)],
        labels=[Label(0, 220, text, 160)],
    )


BUILDERS = {
    # electrical
    "light_ceiling": _light_ceiling,
    "light_wall": _light_wall,
    "fan_ceiling": _fan_ceiling,
    "switch": lambda: _switch(1),
    "switch_2": lambda: _switch(2),
    "socket": lambda: _socket(),
    "socket_protected": lambda: _socket("RCD"),
    "socket_appliance": lambda: _socket("A"),
    "distribution_board": _distribution_board,
    "exhaust_fan": _exhaust_fan,
    "water_heater": _water_heater,
    # plumbing
    "wc": _wc,
    "basin": _basin,
    "shower": _shower,
    "bath": _bath,
    "sink": _sink,
    "washing_machine": _washing_machine,
    "floor_drain": _floor_drain,
    "stack_soil": lambda: _stack("SVP"),
    "stack_vent": lambda: _stack("VP"),
    "stack_water": lambda: _stack("WR"),
}

# What each symbol is called in a legend.
NAMES = {
    "light_ceiling": "Ceiling light point",
    "light_wall": "Wall light point",
    "fan_ceiling": "Ceiling fan point",
    "switch": "Switch, 1 gang",
    "switch_2": "Switch, 2 gang",
    "socket": "Socket outlet",
    "socket_protected": "Socket outlet, RCD/GFCI protected",
    "socket_appliance": "Appliance outlet",
    "distribution_board": "Distribution board",
    "exhaust_fan": "Extract fan",
    "water_heater": "Water heater",
    "wc": "WC and cistern",
    "basin": "Wash basin",
    "shower": "Shower tray",
    "bath": "Bath",
    "sink": "Kitchen sink",
    "washing_machine": "Washing machine point",
    "floor_drain": "Floor gully",
    "stack_soil": "Soil and vent pipe",
    "stack_vent": "Vent pipe",
    "stack_water": "Water riser",
}


# How much wall each fixture takes up, along the wall and out from it.
# Spacing fixtures evenly and hoping is how three fittings end up drawn on
# top of each other in a small bathroom.
FOOTPRINT = {
    "wc": (700, 680),
    "basin": (600, 450),
    "shower": (900, 900),
    "bath": (1700, 750),
    "sink": (1000, 600),
    "washing_machine": (600, 600),
    "water_heater": (500, 500),
    "floor_drain": (150, 150),
    "stack_soil": (260, 260),
    "stack_vent": (260, 260),
    "stack_water": (260, 260),
}


def footprint(kind: str) -> tuple[int, int]:
    """(along the wall, out from the wall) in millimetres."""
    return FOOTPRINT.get(kind, (2 * E, 2 * E))


def symbol(kind: str, x: int = 0, y: int = 0, rotation: int = 0,
           scale: float = 1.0) -> Symbol:
    """Build one symbol, placed, rotated and scaled."""
    builder = BUILDERS.get(kind)
    if builder is None:
        raise KeyError(
            f"no symbol named {kind!r}; known symbols are "
            + ", ".join(sorted(BUILDERS))
        )
    return builder().transform(x, y, rotation, scale)
