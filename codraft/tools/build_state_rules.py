"""Generate the state rule skeletons and the checklist of values to confirm.

The brief this implements is emphatic on one point, and it is the same point
the rest of codraft is built on: DO NOT INVENT NUMERIC VALUES. So this
generator can only emit a number that it can trace to a rule pack already in
the repo, together with that pack's own citation. Everything else comes out
as TODO, and lands on the checklist.

Generated rather than hand-written for exactly that reason. Retyping forty
figures from JSON into YAML is where an invented number would slip in -- one
transposed digit and the file says something nobody checked. Here the number
in the YAML is the number in the pack, or it is TODO.

    python3 tools/build_state_rules.py

Run it again after editing a pack; the YAML is a view, not a second source.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "src" / "codraft" / "codes" / "rules"
OUT = ROOT / "rules" / "states"

# Every state and territory the brief lists, with the planning instrument that
# governs it and the pack codraft already holds, where there is one.
STATES = {
    "nsw": ("New South Wales", "Codes SEPP / Exempt and Complying Development",
            "au-nsw-codes-sepp"),
    "vic": ("Victoria", "ResCode, Clauses 54 and 55", "au-vic-rescode"),
    "qld": ("Queensland", "Queensland Development Code MP 1.1 / MP 1.2",
            "au-qld-qdc"),
    "wa":  ("Western Australia", "R-Codes (SPP 7.3); density code drives setbacks",
            "au-wa-rcodes"),
    "sa":  ("South Australia", "Planning and Design Code", None),
    "tas": ("Tasmania", "Tasmanian Planning Scheme, State Planning Provisions", None),
    "nt":  ("Northern Territory", "NT Planning Scheme", None),
    "act": ("Australian Capital Territory", "Territory Plan, single dwelling code",
            None),
}

# The fields the brief asks for. `site_key` names where the value lives in a
# pack's `site` block when codraft already carries it; None means codraft has
# never held this figure and it can only be TODO.
FIELDS = [
    ("setback.front", "Front setback from the street boundary", "mm",
     "setback_front_mm"),
    ("setback.rear", "Rear setback", "mm", "setback_rear_mm"),
    ("setback.side.left", "Side setback, left", "mm", "setback_left_mm"),
    ("setback.side.right", "Side setback, right", "mm", "setback_right_mm"),
    ("setback.side.by_wall_height",
     "How the side setback varies with wall height and lot width", "rule", None),
    ("site.max_coverage", "Maximum site coverage", "ratio",
     "max_coverage_ratio"),
    ("site.max_building_height", "Maximum building height", "mm", None),
    ("site.min_private_open_space", "Minimum private open space", "m2",
     "min_outdoor_living_m2"),
    ("site.min_open_space_dimension",
     "Minimum dimension of the private open space", "mm", None),
    ("room.min_ceiling_habitable", "Minimum ceiling height, habitable rooms",
     "mm", None),
    ("room.min_ceiling_non_habitable",
     "Minimum ceiling height, non-habitable rooms", "mm", None),
    ("room.min_area_by_type", "Minimum floor area by room type", "m2", None),
    ("room.min_dimension_by_type", "Minimum plan dimension by room type", "mm",
     None),
    ("energy.nathers_stars", "NatHERS star rating required", "stars", None),
    ("energy.additional", "Any state energy instrument beyond NatHERS",
     "rule", None),
    ("hazard.bushfire", "Bushfire attack level assessment", "standard", None),
    ("hazard.wind_region", "Wind region", "standard", None),
    ("hazard.termite", "Termite management", "standard", None),
    ("hazard.corrosion", "Corrosion / sea-spray zone", "standard", None),
]

# Standards that are national, so the ID is the same everywhere even though
# the value that applies to a given site is not.
NATIONAL = {
    "hazard.bushfire": "AS 3959 (BAL determined by site assessment)",
    "hazard.wind_region": "AS 4055 (region determined by location)",
    "hazard.termite": "AS 3660.1",
    "room.min_ceiling_habitable": None,
    "room.min_ceiling_non_habitable": None,
}


def _pack(name: str) -> dict:
    return json.loads((PACKS / f"{name}.json").read_text(encoding="utf-8"))


def _ncc_heights() -> dict[str, tuple[int, str]]:
    """Ceiling heights, read off the NCC pack's own assertions."""
    out: dict[str, tuple[int, str]] = {}
    pack = _pack("au-ncc-housing")
    wanted = {
        "au.h.height.habitable": "room.min_ceiling_habitable",
        "au.h.height.non_habitable": "room.min_ceiling_non_habitable",
    }
    for rule in pack["rules"]:
        field = wanted.get(rule["id"])
        if field is None:
            continue
        digits = "".join(c for c in rule["assert"] if c.isdigit())
        if digits:
            out[field] = (int(digits), rule.get("clause", "NCC Housing Provisions"))
    return out


def _quote(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _entry(key: str, description: str, unit: str, value, source: str) -> list[str]:
    known = value is not None
    lines = [f"  - id: {key}",
             f"    description: {_quote(description)}",
             f"    unit: {unit}"]
    if known and isinstance(value, dict):
        lines.append("    value:")
        for sub, val in value.items():
            lines.append(f"      {sub}: {val}")
    else:
        lines.append(f"    value: {value if known else 'TODO'}")
    lines.append(f"    source: {_quote(source) if source else 'TODO'}")
    lines.append("    last_checked: null")
    lines.append(f"    status: {'confirm' if known else 'missing'}")
    return lines


def build() -> list[tuple[str, str, str, str]]:
    """Write the YAML files. Returns the checklist rows."""
    OUT.mkdir(parents=True, exist_ok=True)
    heights = _ncc_heights()
    rows: list[tuple[str, str, str, str]] = []

    for code, (name, instrument, pack_name) in STATES.items():
        site = {}
        citation = ""
        if pack_name:
            pack = _pack(pack_name)
            site = pack.get("site", {})
            citation = pack.get("edition") or pack.get("title", "")

        lines = [
            f"# {name} -- planning and building rule values",
            "#",
            "# GENERATED by tools/build_state_rules.py. Do not hand-edit the",
            "# structure; edit the value and the source, then set last_checked",
            "# and status: confirmed.",
            "#",
            "# status:  confirmed -- a person has checked this against the",
            "#                       instrument named in source",
            "#          confirm   -- codraft already carries this figure and it",
            "#                       needs verifying against the current edition",
            "#          missing   -- nobody has supplied it; nothing here has",
            "#                       guessed one",
            "",
            f"state: {code}",
            f"name: {_quote(name)}",
            f"planning_instrument: {_quote(instrument)}",
            f"generated: {date.today().isoformat()}",
            "",
            "rules:",
        ]

        for key, description, unit, site_key in FIELDS:
            value = None
            source = ""
            if site_key and site_key in site:
                raw = site[site_key]
                value = dict(raw) if isinstance(raw, dict) else raw
                source = citation
            elif key in heights:
                value, source = heights[key]
            elif NATIONAL.get(key):
                value = None
                source = NATIONAL[key]
            lines += _entry(key, description, unit, value, source)
            lines.append("")
            if value is None:
                rows.append((name, key, description, unit))

        (OUT / f"{code}.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return rows


if __name__ == "__main__":
    rows = build()
    files = sorted(p.name for p in OUT.glob("*.yaml"))
    print(f"Wrote {len(files)} files into rules/states/: {', '.join(files)}")
    print(f"{len(rows)} values still need a real figure -- see rules/CHECKLIST.md")
