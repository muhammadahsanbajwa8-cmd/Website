"""Working out whose rules apply.

"Lahore" is not the same question as "Pakistan". Setbacks, coverage and
height are usually set by a city's development authority, egress and fire by
a national or model code, and structural design by a third document again.
Resolution walks down as far as the registry can take it and reports where
it stopped, because a plan checked against the wrong tier of government is
not checked at all.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

REGISTRY_PATH = Path(__file__).parent / "registry" / "countries.json"

CONFIDENCE_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


class JurisdictionError(ValueError):
    """A place could not be resolved to a jurisdiction."""


@lru_cache(maxsize=1)
def registry() -> dict:
    """The registry, read once."""
    with REGISTRY_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@dataclass(slots=True)
class Jurisdiction:
    """A resolved place, and how much can honestly be said about it."""

    country: str                      # ISO 3166-1 alpha-2
    country_name: str
    subdivision: str | None = None    # slug, e.g. 'punjab'
    subdivision_name: str | None = None
    locality: str | None = None       # slug, e.g. 'lahore'
    locality_name: str | None = None
    authority: str = ""
    codes: list[str] = field(default_factory=list)
    rule_packs: list[str] = field(default_factory=list)
    confidence: str = "none"
    url: str = ""
    notes: list[str] = field(default_factory=list)
    matched_on: str = ""              # what in the query produced this

    @property
    def key(self) -> str:
        return "-".join(
            part for part in (self.country, self.subdivision, self.locality) if part
        )

    @property
    def label(self) -> str:
        parts = [self.locality_name, self.subdivision_name, self.country_name]
        return ", ".join(p for p in parts if p)

    @property
    def is_encoded(self) -> bool:
        """Whether any pack beyond the practice baseline applies here."""
        return any(pack != "baseline" for pack in self.rule_packs)

    def caveat(self) -> str:
        """The sentence that has to accompany every report from this place."""
        if not self.is_encoded:
            return (
                f"No rule pack is encoded for {self.label}. Only the practice "
                "baseline was applied, which is not the law anywhere. "
                + (f"The authority having jurisdiction is {self.authority}. "
                   if self.authority else
                   "The authority having jurisdiction has not been identified. ")
                + "Every dimension must be checked against the governing code."
            )
        return (
            f"Findings for {self.label} come from an encoded subset of the "
            f"governing code, at '{self.confidence}' confidence. Absence of a "
            "finding is not a statement of compliance."
        )


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _slug_words(slug: str) -> str:
    return _normalise(slug.replace("-", " "))


def _mentions(needle: str, haystack: str) -> bool:
    """Whether a place name appears in a query as whole words.

    Substring matching is not good enough here: 'Mali' sits inside
    'Somalia', and 'Oman' inside 'Romania'. Resolving a plan to the wrong
    country is the worst failure this module has, so the match is anchored
    on word boundaries.
    """
    if not needle:
        return False
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack) is not None


def _merge_packs(*groups: list[str] | None) -> list[str]:
    """Union the packs, keeping the order they were declared in."""
    out: list[str] = []
    for group in groups:
        for pack in group or ():
            if pack not in out:
                out.append(pack)
    return out


def resolve(place: str) -> Jurisdiction:
    """Resolve a free-text place. Raises rather than guessing a country."""
    if not place or not place.strip():
        raise JurisdictionError(
            "No place was given, so no jurisdiction can be resolved and no "
            "code rules can be applied."
        )

    data = registry()
    countries = data["countries"]
    query = _normalise(place)

    # An explicit ISO code wins -- 'PK' is unambiguous in a way 'Georgia' is not.
    upper = place.strip().upper()
    if upper in countries:
        return _build(upper, countries[upper], matched_on=upper)

    # Localities first: the most specific match is the most useful one.
    for iso, country in countries.items():
        for sub in country.get("subdivisions", ()):
            for loc in sub.get("localities", ()):
                if _mentions(_slug_words(loc["slug"]), query) or _mentions(
                    _normalise(loc["name"]), query
                ):
                    return _build(iso, country, sub, loc, matched_on=loc["name"])

    for iso, country in countries.items():
        for sub in country.get("subdivisions", ()):
            if _mentions(_slug_words(sub["slug"]), query) or _mentions(
                _normalise(sub["name"]), query
            ):
                return _build(iso, country, sub, matched_on=sub["name"])

    # A city the registry knows geographically but has no local entry for.
    # Resolving it to its country beats refusing the query, as long as the
    # answer says outright that the local authority is not identified.
    for city, iso in data.get("city_aliases", {}).items():
        if _mentions(_normalise(city), query) and iso in countries:
            resolved = _build(iso, countries[iso], matched_on=city.title())
            resolved.locality_name = city.title()
            resolved.notes.insert(
                0,
                f"{city.title()} was recognised as a city in "
                f"{countries[iso]['name']}, but codraft has no entry for its "
                "building authority. Planning controls -- setbacks, coverage, "
                "height -- are almost always set locally, so confirm them with "
                "the authority for this city before relying on anything here.",
            )
            return resolved

    matches = [
        (iso, country)
        for iso, country in countries.items()
        if _mentions(_normalise(country["name"]), query)
    ]
    if len(matches) == 1:
        iso, country = matches[0]
        return _build(iso, country, matched_on=country["name"])
    if len(matches) > 1:
        names = ", ".join(sorted(c["name"] for _, c in matches))
        raise JurisdictionError(
            f"{place!r} matches more than one country ({names}). "
            "Give an ISO code or add the country name."
        )

    raise JurisdictionError(
        f"{place!r} could not be matched to a country. Use an ISO 3166 code "
        "such as 'PK', or a country name. Run `codraft codes list` to see "
        "everything the registry knows."
    )


def _build(
    iso: str,
    country: dict,
    sub: dict | None = None,
    loc: dict | None = None,
    matched_on: str = "",
) -> Jurisdiction:
    """Fold country, subdivision and locality into one answer."""
    notes: list[str] = []
    regime = registry()["regimes"].get(country["regime"], {})
    if regime.get("note"):
        notes.append(regime["note"])
    if country.get("note"):
        notes.append(country["note"])
    if sub and sub.get("note"):
        notes.append(sub["note"])
    if loc and loc.get("note"):
        notes.append(loc["note"])

    authority = ""
    for level in (loc, sub, country):
        if level and level.get("authority"):
            authority = level["authority"]
            break

    if country.get("subdivisions") and sub is None:
        notes.append(
            f"{country['name']} devolves building control to its "
            "states, provinces or emirates, and they differ. Naming one "
            "gives a materially better answer than the country alone."
        )
    if sub and sub.get("localities") and loc is None:
        notes.append(
            f"Setbacks and coverage in {sub['name']} are usually set per city. "
            "Name the city for a closer answer."
        )

    return Jurisdiction(
        country=iso,
        country_name=country["name"],
        subdivision=sub["slug"] if sub else None,
        subdivision_name=sub["name"] if sub else None,
        locality=loc["slug"] if loc else None,
        locality_name=loc["name"] if loc else None,
        authority=authority,
        codes=list(country.get("codes", ())),
        rule_packs=_resolve_packs(country, sub, loc),
        confidence=country.get("confidence", "none"),
        url=country.get("url", ""),
        notes=notes,
        matched_on=matched_on,
    )


def _resolve_packs(country: dict, sub: dict | None, loc: dict | None) -> list[str]:
    """Which packs apply, letting the most local declaration win outright.

    Scotland is the case that forces this. It sits under GB, whose packs
    include the Approved Documents -- which do not apply in Scotland at all.
    A subdivision that names its own packs is making a correction, not an
    addition, so it replaces what it inherited rather than adding to it.
    """
    packs = list(country.get("rule_packs", ()))
    if sub and sub.get("rule_packs"):
        packs = list(sub["rule_packs"])
    if loc and loc.get("rule_packs"):
        packs = list(loc["rule_packs"])
    return _merge_packs(packs)


def search(term: str, limit: int = 20) -> list[tuple[str, str]]:
    """Find countries by partial name, for a helpful error or a CLI listing."""
    needle = _normalise(term)
    hits = [
        (iso, country["name"])
        for iso, country in registry()["countries"].items()
        if needle in _normalise(country["name"]) or needle == iso.lower()
    ]
    return sorted(hits, key=lambda pair: pair[1])[:limit]
