"""Site controls read from `rules/states/*.yaml`.

The rule packs carry the checks. These files carry the PLANNING FIGURES a
person has supplied or verified -- setbacks, site coverage, open space -- one
file per state and territory, in the shape the project brief asks for.

They exist so that completing a state is a matter of filling in a file rather
than writing code, and so the four jurisdictions with no pack behind them
(South Australia, Tasmania, the Northern Territory, the ACT) light up the
moment somebody supplies real figures.

Only a value a person stands behind is read. `status: missing` and a value of
`TODO` are ignored, which means a half-filled file yields half the controls
and the caller can see exactly which half is absent -- rather than a plan
drawn as though the missing ones were zero.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

# The brief puts these at the repository root, not inside the package.
RULES = Path(__file__).resolve().parents[3] / "rules" / "states"

# YAML rule id -> the site-control key the solver builds to.
_SITE_KEYS = {
    "setback.front": "setback_front_mm",
    "setback.rear": "setback_rear_mm",
    "setback.side.left": "setback_left_mm",
    "setback.side.right": "setback_right_mm",
    "site.max_coverage": "max_coverage_ratio",
    "site.min_private_open_space": "min_outdoor_living_m2",
    # The second limb of the outdoor living control. It was on the checklist
    # already and mapped to nothing, so filling it in changed nothing --
    # a to-do that cannot be done is worse than no to-do. With this, the
    # figure turns wa.outdoor.living from unchecked into a real check.
    "site.min_open_space_dimension": "min_outdoor_living_dimension_mm",
    "site.max_building_height": "max_height_mm",
}

# Without these a plan means nothing: the solver has no envelope to work in
# and site coverage is a percentage of nothing. Their absence stops a drawing.
_ESSENTIAL = {
    "setback.front", "setback.rear", "setback.side.left", "setback.side.right",
    "site.max_coverage",
}

# These are worth having and worth reporting as absent, but a plan without a
# height limit is still a plan. Refusing to draw over one would be the tool
# being pedantic rather than careful, which is a different thing.
_ADVISORY = {"site.max_building_height", "site.min_private_open_space"}

# A jurisdiction key looks like 'AU-WA-perth'; the state is the middle part.
_USABLE = {"confirmed", "confirm"}


@lru_cache(maxsize=None)
def _load(code: str) -> dict:
    path = RULES / f"{code}.yaml"
    if not path.exists():
        return {}
    try:
        import yaml
    except ImportError:            # pragma: no cover
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


# The registry's subdivision slugs are not consistent -- 'wa', 'sa', 'nt' and
# 'act' are abbreviated while 'victoria', 'queensland' and 'tasmania' are
# spelled out -- so a key cannot be split and trusted. Both forms map here,
# and a test walks every Australian jurisdiction the registry knows to check
# each one lands on a file. Reading parts[1] verbatim quietly sent Melbourne
# and Brisbane to a file that did not exist, and they were refused as though
# nobody had supplied their figures.
_ALIASES = {
    "nsw": "nsw", "newsouthwales": "nsw",
    "vic": "vic", "victoria": "vic",
    "qld": "qld", "queensland": "qld",
    "wa": "wa", "westernaustralia": "wa",
    "sa": "sa", "southaustralia": "sa",
    "tas": "tas", "tasmania": "tas",
    "nt": "nt", "northernterritory": "nt",
    "act": "act", "australiancapitalterritory": "act",
}


def state_of(jurisdiction_key: str) -> str | None:
    """'AU-wa-perth' or 'AU-victoria' -> the state file's code.

    None for anywhere that is not an Australian state or territory.
    """
    parts = (jurisdiction_key or "").split("-")
    if len(parts) < 2 or parts[0].upper() != "AU":
        return None
    slug = "".join(c for c in parts[1].lower() if c.isalnum())
    return _ALIASES.get(slug)


def site_controls(jurisdiction_key: str, zone: str | None = None) -> dict:
    """What this state's file supplies, for the solver to build to."""
    code = state_of(jurisdiction_key)
    if code is None:
        return {}
    out: dict = {}
    for rule in _load(code).get("rules", []):
        key = _SITE_KEYS.get(rule.get("id", ""))
        if key is None or rule.get("status") not in _USABLE:
            continue
        value = rule.get("value")
        if value in (None, "TODO"):
            continue
        if isinstance(value, dict):
            value = (
                (value.get(zone) if zone else None)
                or value.get("default")
            )
        if value is not None:
            out[key] = value
    return out


def missing_essential(jurisdiction_key: str) -> list[str]:
    """The figures whose absence makes a plan meaningless rather than partial."""
    return [k for k in missing_controls(jurisdiction_key) if k in _ESSENTIAL]


def missing_controls(jurisdiction_key: str) -> list[str]:
    """The planning figures this state still has no value for.

    Returned so a caller can say which ones rather than only that some are
    absent -- 'no setbacks and no coverage cap for South Australia' is
    actionable; 'unsupported' is not.
    """
    code = state_of(jurisdiction_key)
    if code is None:
        return []
    data = _load(code)
    if not data:
        return sorted(_SITE_KEYS)
    out = []
    for rule in data.get("rules", []):
        if rule.get("id") not in _SITE_KEYS:
            continue
        if rule.get("status") not in _USABLE or rule.get("value") in (None, "TODO"):
            out.append(rule["id"])
    return out
