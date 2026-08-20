"""Getting a program out of what a person actually typed.

Two routes in, and they are not rivals:

`parse_brief` reads a short brief with regular expressions. It handles the
shape of request that makes up most of the work -- "3 bed 2 bath double
storey house on a 40x60 plot in Lahore" -- deterministically, offline, and
identically every time.

`from_json` takes a validated program object, which is how a language model
contributes. Give the model `PROGRAM_JSON_SCHEMA`, let it read a messy
paragraph, and hand its JSON here. Every field is checked before the solver
sees it, so a model that invents a room type or a negative area produces an
error rather than a drawing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from ..units import mm
from .schema import ProgramError, SpaceProgram
from .templates import TEMPLATES, template

PROGRAM_JSON_SCHEMA = {
    "type": "object",
    "required": ["name", "spaces"],
    "properties": {
        "name": {"type": "string"},
        "use": {
            "type": "string",
            "description": "residential, office, mercantile, educational, "
                           "institutional, industrial, assembly",
        },
        "storeys": {"type": "integer", "minimum": 1},
        "storey_height": {
            "type": "string",
            "description": "floor to floor, with units, e.g. '3m' or '10ft'",
        },
        "spaces": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["key", "function"],
                "properties": {
                    "key": {"type": "string"},
                    "name": {"type": "string"},
                    "function": {
                        "type": "string",
                        "description": "one of: bedroom, living, dining, kitchen, "
                                       "bathroom, wc, corridor, lobby, stair, entry, "
                                       "storage, utility, garage, office, meeting, "
                                       "classroom, retail, assembly, balcony, courtyard",
                    },
                    "count": {"type": "integer", "minimum": 1},
                    "min_area": {
                        "type": "string",
                        "description": "with units, e.g. '12m2' or '130sqft'",
                    },
                    "min_width": {"type": "string", "description": "e.g. '2.7m'"},
                    "adjacent_to": {"type": "array", "items": {"type": "string"}},
                    "needs_exterior_wall": {"type": "boolean"},
                    "storey": {"type": "integer", "minimum": 0},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 9},
                },
            },
        },
    },
}

LLM_INSTRUCTIONS = """\
Convert the brief into JSON matching the schema. Rules:
  - Describe only what the brief asks for. Do not add rooms it did not mention.
  - Give areas as requests, with units. Never cite them as code minimums.
  - If the brief is silent on a dimension, omit the field; the solver has
    defaults and the code check has authority.
  - If the brief is too vague to place a room, say so in "notes" rather
    than inventing a requirement.
"""

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "single": 1, "double": 2, "triple": 3,
}

_BUILDING_WORDS = {
    "house": "house", "home": "house", "villa": "house", "bungalow": "house",
    "cottage": "house", "kothi": "house", "project home": "house",
    "display home": "house", "duplex": "house",
    "apartment": "apartment", "flat": "apartment", "unit": "apartment",
    "office": "office", "workspace": "office",
    "clinic": "clinic", "surgery": "clinic",
    "school": "school", "classroom block": "school",
    "shop": "shop", "store": "shop", "retail": "shop", "showroom": "shop",
}


@dataclass(slots=True)
class Brief:
    """What could be read out of a sentence, and what could not."""

    program: SpaceProgram
    plot_width: int | None = None
    plot_depth: int | None = None
    location: str | None = None
    understood: list[str] = field(default_factory=list)
    unclear: list[str] = field(default_factory=list)

    @property
    def plot_size(self) -> tuple[int, int] | None:
        if self.plot_width and self.plot_depth:
            return self.plot_width, self.plot_depth
        return None


def _count(text: str, *nouns: str, default: int = 0) -> int | None:
    """Find 'three bedrooms', '3 bed', '2-bath' and so on."""
    alternatives = "|".join(nouns)
    pattern = re.compile(
        rf"(\d+|{'|'.join(_NUMBER_WORDS)})[\s\-]*(?:{alternatives})\b",
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        return None
    token = match.group(1).lower()
    return int(token) if token.isdigit() else _NUMBER_WORDS[token]


def _plot(text: str) -> tuple[int, int, str] | None:
    """Read '40x60 ft', '30 x 50', '10m by 20m', '1 kanal', '5 marla'."""
    # South Asian land units, in the sizes actually used on plot signage.
    if re.search(r"\bkanal\b", text, re.IGNORECASE):
        n = _count(text, "kanal") or 1
        # 1 kanal = 605 sq yd, conventionally laid out 50 ft x 90 ft.
        return mm("50ft"), mm(f"{90 * n}ft"), f"{n} kanal"
    if re.search(r"\bmarla\b", text, re.IGNORECASE):
        n = _count(text, "marla") or 5
        # 1 marla = 30.25 sq yd; a 5-marla plot is conventionally 25 x 45 ft.
        depth_ft = 45 * n / 5
        return mm("25ft"), mm(f"{depth_ft}ft"), f"{n} marla"

    match = re.search(
        r"(\d+(?:\.\d+)?)\s*(m|ft|feet|')?\s*(?:x|by|\*|×)\s*"
        r"(\d+(?:\.\d+)?)\s*(m|ft|feet|')?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    a, unit_a, b, unit_b = match.groups()
    unit = (unit_b or unit_a or "ft").lower()
    unit = {"feet": "ft", "'": "ft"}.get(unit, unit)
    return mm(f"{a}{unit}"), mm(f"{b}{unit}"), f"{a}x{b} {unit}"


def _location(text: str) -> str | None:
    match = re.search(
        r"\b(?:in|at|for)\s+([A-Z][\w'\-]*(?:\s+[A-Z][\w'\-]*){0,3})",
        text,
    )
    return match.group(1).strip() if match else None


def parse_brief(text: str) -> Brief:
    """Read a short brief. What cannot be read is reported, never guessed."""
    if not text or not text.strip():
        raise ProgramError("the brief is empty")

    understood: list[str] = []
    unclear: list[str] = []
    lowered = text.lower()

    kind = next(
        (value for word, value in _BUILDING_WORDS.items() if re.search(rf"\b{word}\b", lowered)),
        None,
    )
    if kind is None:
        kind = "house"
        unclear.append(
            "No building type named, so a house was assumed. Say 'office', "
            f"'apartment', or one of {', '.join(sorted(set(_BUILDING_WORDS.values())))}."
        )
    else:
        understood.append(f"building type: {kind}")

    storeys = (
        _count(lowered, "storey", "storeys", "story", "stories", "floor", "floors", "level", "levels")
        or 1
    )
    if storeys > 1:
        understood.append(f"storeys: {storeys}")

    kwargs: dict[str, int] = {}
    if kind in ("house", "apartment"):
        beds = _count(lowered, "bed", "beds", "bedroom", "bedrooms", "br")
        baths = _count(lowered, "bath", "baths", "bathroom", "bathrooms",
                       "washroom", "washrooms", "toilet", "toilets", "wc")
        if beds:
            kwargs["bedrooms"] = beds
            understood.append(f"bedrooms: {beds}")
        else:
            unclear.append("Bedroom count not stated; the template default was used.")
        if baths:
            kwargs["bathrooms"] = baths
            understood.append(f"bathrooms: {baths}")
        if kind == "house":
            kwargs["storeys"] = storeys
    elif kind == "office":
        seats = _count(lowered, "workstation", "workstations", "desk", "desks",
                       "seat", "seats", "people", "staff")
        if seats:
            kwargs["workstations"] = seats
            understood.append(f"workstations: {seats}")
    elif kind == "school":
        rooms = _count(lowered, "classroom", "classrooms")
        if rooms:
            kwargs["classrooms"] = rooms
            understood.append(f"classrooms: {rooms}")
    elif kind == "clinic":
        rooms = _count(lowered, "consulting room", "consulting rooms", "consult rooms")
        if rooms:
            kwargs["consult_rooms"] = rooms
            understood.append(f"consulting rooms: {rooms}")

    program = template(kind, **kwargs)
    program.source = "brief"
    if kind != "house" and storeys > 1:
        program.storeys = storeys

    plot = _plot(text)
    if plot:
        understood.append(f"plot: {plot[2]}")
    else:
        unclear.append(
            "No plot size found. Give one like '40x60 ft', '12m x 18m', or '5 marla'."
        )

    location = _location(text)
    if location:
        understood.append(f"location: {location}")
    else:
        unclear.append(
            "No location found, so no jurisdiction can be resolved and no code "
            "rules will be applied. Name a city, state or country."
        )

    return Brief(
        program=program,
        plot_width=plot[0] if plot else None,
        plot_depth=plot[1] if plot else None,
        location=location,
        understood=understood,
        unclear=unclear,
    )


def from_json(data: str | dict) -> SpaceProgram:
    """Validate a program object -- typically one a language model produced."""
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise ProgramError(f"the program is not valid JSON: {exc}") from exc
    return SpaceProgram.from_dict(data)
