"""The command line.

    codraft plan "3 bed 2 bath double storey house on a 40x60 ft plot in Lahore"
    codraft codes where Lahore
    codraft codes list --search africa
    codraft program "small clinic in Nairobi" > program.json

`plan` runs the whole pipeline: read the brief, resolve the jurisdiction,
ask that jurisdiction what it allows on the site, lay the building out
inside those limits, draw it, and check it. The compliance report is
printed whether or not anything failed, because "nothing failed" and
"nothing was checked" have to be told apart.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, codes
from .export import write_dxf, write_ifc, write_model_json, write_svg
from .geom import Rect
from .layout import LayoutError, build_building, solve
from .model import Plot
from .program import (
    PROGRAM_JSON_SCHEMA,
    ProgramError,
    SpaceProgram,
    from_json,
    parse_brief,
)
from .units import UnitError, fmt_area, mm

FORMATS = {
    "dxf": write_dxf,
    "ifc": write_ifc,
    "svg": write_svg,
    # The JSON model is what the pyRevit script reads to build native
    # Revit walls and rooms, rather than importing IFC geometry.
    "json": write_model_json,
}


def _fail(message: str) -> int:
    print(f"codraft: {message}", file=sys.stderr)
    return 1


def _plot_from(args, brief) -> tuple[int, int] | None:
    if args.plot:
        try:
            text = args.plot.lower().replace("×", "x")
            width, _, depth = text.partition("x")
            if not depth:
                return None
            unit = "".join(c for c in depth if c.isalpha()) or "m"
            return mm(width.strip(), unit), mm(depth.strip())
        except UnitError:
            return None
    return brief.plot_size if brief else None


def cmd_plan(args) -> int:
    # -- 1. the brief ----------------------------------------------------
    if args.program:
        try:
            program = from_json(Path(args.program).read_text(encoding="utf-8"))
        except (OSError, ProgramError) as exc:
            return _fail(str(exc))
        brief = None
        location = args.location
    else:
        if not args.brief:
            return _fail("give a brief, or a program with --program")
        try:
            brief = parse_brief(" ".join(args.brief))
        except ProgramError as exc:
            return _fail(str(exc))
        program = brief.program
        location = args.location or brief.location
        if brief.understood:
            print("Read from the brief:")
            for item in brief.understood:
                print(f"  - {item}")
        if brief.unclear:
            print("Not stated, so assumed or skipped:")
            for item in brief.unclear:
                print(f"  - {item}")
        print()

    if args.storeys:
        program.storeys = args.storeys

    # -- 2. the jurisdiction, and what it allows on this site ------------
    try:
        jurisdiction = codes.resolve(location or "")
    except codes.JurisdictionError as exc:
        return _fail(
            f"{exc}\nWithout a jurisdiction nothing can be checked, so codraft "
            "will not draw a plan and imply it was."
        )

    site = {
        key: value
        for key, value in codes.site_parameters(jurisdiction, program.use).items()
        if not key.startswith("$")
    }

    size = _plot_from(args, brief)
    if not size:
        return _fail(
            "no plot size was given. Add one to the brief ('40x60 ft', '12m x 18m', "
            "'5 marla') or pass --plot 12mx18m."
        )

    plot = Plot(
        rect=Rect(0, 0, size[0], size[1]),
        setback_front=int(site.get("setback_front_mm", 0)),
        setback_rear=int(site.get("setback_rear_mm", 0)),
        setback_left=int(site.get("setback_left_mm", 0)),
        setback_right=int(site.get("setback_right_mm", 0)),
        road_side=args.road,
    )
    coverage = site.get("max_coverage_ratio")
    max_footprint = int(plot.area * float(coverage)) if coverage else None

    print(f"Jurisdiction : {jurisdiction.label}")
    if jurisdiction.authority:
        print(f"Authority    : {jurisdiction.authority}")
    print(f"Rule packs   : {', '.join(jurisdiction.rule_packs)}")
    if site:
        controls = ", ".join(f"{k.replace('_mm','')}={v}" for k, v in site.items())
        print(f"Site controls: {controls}")
    print()

    # -- 3. lay it out ----------------------------------------------------
    try:
        layout = solve(program, plot, max_footprint=max_footprint)
    except LayoutError as exc:
        return _fail(str(exc))
    building = build_building(
        program, plot, layout, name=program.name, jurisdiction=jurisdiction.key
    )

    print(f"Plot         : {fmt_area(plot.area)}")
    print(f"Footprint    : {fmt_area(building.footprint)} "
          f"({building.coverage_ratio * 100:.0f}% coverage)")
    print(f"Floor area   : {fmt_area(building.gross_floor_area)} "
          f"(FAR {building.floor_area_ratio:.2f})")
    print()
    for storey in building.storeys:
        print(f"{storey.name}:")
        for space in sorted(storey.spaces, key=lambda s: -s.area):
            print(f"    {space.name:<14} {fmt_area(space.area):>10}  "
                  f"{space.rect.w} x {space.rect.h} mm")
    print()

    if layout.unsatisfied:
        print("Asked for but not achieved:")
        for item in layout.unsatisfied:
            print(f"  - {item}")
        print()

    # -- 4. draw it -------------------------------------------------------
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = args.name or "plan"
    written: list[Path] = []
    for name in args.formats.split(","):
        name = name.strip().lower()
        if name not in FORMATS:
            return _fail(
                f"unknown format {name!r}; choose from {', '.join(sorted(FORMATS))}"
            )
        written.append(FORMATS[name](building, out / f"{stem}.{name}"))
    print("Written:")
    for p in written:
        print(f"  {p}  ({p.stat().st_size:,} bytes)")
    print()

    # -- 5. check it ------------------------------------------------------
    report = codes.check(building, jurisdiction, layout.warnings)
    if args.json:
        (out / f"{stem}-report.json").write_text(
            json.dumps(report.to_dict(), indent=2), encoding="utf-8"
        )
        print(f"  {out / f'{stem}-report.json'}\n")
    text = report.to_text(show_passes=args.show_passes)
    print(text)
    (out / f"{stem}-report.txt").write_text(text + "\n", encoding="utf-8")

    return 1 if report.violations else 0


def cmd_program(args) -> int:
    """Print the structured program, for review or for feeding a model."""
    if args.schema:
        print(json.dumps(
            {"schema": PROGRAM_JSON_SCHEMA,
             "note": "Give this schema to a language model with the brief. "
                     "Feed its JSON back with `codraft plan --program`. Every "
                     "field is validated before anything is drawn."},
            indent=2,
        ))
        return 0
    if not args.brief:
        return _fail("give a brief, or --schema")
    try:
        brief = parse_brief(" ".join(args.brief))
    except ProgramError as exc:
        return _fail(str(exc))
    data = brief.program.to_dict()
    data["read_from_brief"] = brief.understood
    data["not_stated"] = brief.unclear
    if brief.plot_size:
        data["plot_mm"] = list(brief.plot_size)
    if brief.location:
        data["location"] = brief.location
    print(json.dumps(data, indent=2))
    return 0


def cmd_codes_where(args) -> int:
    try:
        j = codes.resolve(" ".join(args.place))
    except codes.JurisdictionError as exc:
        return _fail(str(exc))
    print(f"{j.label}")
    print(f"  key        : {j.key}")
    print(f"  matched on : {j.matched_on}")
    if j.authority:
        print(f"  authority  : {j.authority}")
    if j.codes:
        print("  governing  :")
        for code in j.codes:
            print(f"      - {code}")
    if j.url:
        print(f"  published  : {j.url}")
    print(f"  rule packs : {', '.join(j.rule_packs)}")
    print(f"  confidence : {j.confidence}")
    print(f"  encoded    : {'yes' if j.is_encoded else 'no -- baseline only'}")
    if j.notes:
        print("  notes      :")
        for note in j.notes:
            print(f"      - {note}")
    print()
    print(f"  {j.caveat()}")
    return 0


def cmd_codes_list(args) -> int:
    data = codes.registry()["countries"]
    rows = sorted(data.items(), key=lambda kv: kv[1]["name"])
    if args.search:
        needle = args.search.lower()
        rows = [
            (iso, c) for iso, c in rows
            if needle in c["name"].lower()
            or needle in c["region"].lower()
            or needle == iso.lower()
        ]
    if not rows:
        return _fail(f"nothing in the registry matches {args.search!r}")

    encoded = sum(1 for _, c in rows if len(c["rule_packs"]) > 1)
    print(f"{'ISO':<4} {'Country':<34} {'Regime':<14} {'Conf':<7} Packs")
    print("-" * 88)
    for iso, c in rows:
        packs = ", ".join(p for p in c["rule_packs"] if p != "baseline") or "baseline only"
        print(f"{iso:<4} {c['name']:<34} {c['regime']:<14} {c['confidence']:<7} {packs}")
    print("-" * 88)
    print(f"{len(rows)} shown; {encoded} have a rule pack beyond the practice baseline.")
    print(
        "A country listed here is not a claim that its code is encoded. "
        "'baseline only' means codraft can check the plan for sense, not for law."
    )
    return 0


def cmd_codes_packs(args) -> int:
    for name in codes.available_packs():
        pack = codes.load_pack(name)
        print(f"{name}")
        print(f"  title      : {pack.title}")
        if pack.publisher:
            print(f"  publisher  : {pack.publisher}")
        if pack.url:
            print(f"  published  : {pack.url}")
        print(f"  rules      : {len(pack.rules)}")
        by_confidence: dict[str, int] = {}
        for rule in pack.rules:
            by_confidence[rule.confidence] = by_confidence.get(rule.confidence, 0) + 1
        print("  confidence : "
              + ", ".join(f"{k} {v}" for k, v in sorted(by_confidence.items())))
        if pack.applies_to_uses:
            print(f"  applies to : {', '.join(pack.applies_to_uses)}")
        if pack.disclaimer:
            print(f"  disclaimer : {pack.disclaimer}")
        print()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="codraft",
        description="Draw a floor plan from a brief and check it against the "
                    "building code that governs where it is being built.",
        epilog="No output from codraft is a compliance certificate. A licensed "
               "architect or engineer must review and stamp any drawing used "
               "for construction or submitted for approval.",
    )
    parser.add_argument("--version", action="version", version=f"codraft {__version__}")
    subs = parser.add_subparsers(dest="command", required=True)

    plan = subs.add_parser("plan", help="draw and check a plan from a brief")
    plan.add_argument("brief", nargs="*", help="e.g. '3 bed house on a 40x60 ft plot in Lahore'")
    plan.add_argument("--program", help="a JSON space program instead of a brief")
    plan.add_argument("--location", help="override the location read from the brief")
    plan.add_argument("--plot", help="plot size, e.g. 12mx18m or 40x60ft")
    plan.add_argument("--storeys", type=int, help="override the storey count")
    plan.add_argument("--road", default="south",
                      choices=("south", "north", "east", "west"),
                      help="which side the plot fronts a road (default: south)")
    plan.add_argument("--out", default="out", help="output directory (default: out)")
    plan.add_argument("--name", help="base filename (default: plan)")
    plan.add_argument("--formats", default="dxf,ifc,svg",
                      help="comma separated: dxf, ifc, svg, json (default: dxf,ifc,svg)")
    plan.add_argument("--json", action="store_true", help="also write the report as JSON")
    plan.add_argument("--show-passes", action="store_true",
                      help="list the rules that passed, not just those that failed")
    plan.set_defaults(func=cmd_plan)

    program = subs.add_parser("program", help="show the structured space program")
    program.add_argument("brief", nargs="*")
    program.add_argument("--schema", action="store_true",
                         help="print the JSON schema for a language model to fill in")
    program.set_defaults(func=cmd_program)

    codes_parser = subs.add_parser("codes", help="what governs where")
    code_subs = codes_parser.add_subparsers(dest="codes_command", required=True)

    where = code_subs.add_parser("where", help="resolve a place to a jurisdiction")
    where.add_argument("place", nargs="+")
    where.set_defaults(func=cmd_codes_where)

    listing = code_subs.add_parser("list", help="every country in the registry")
    listing.add_argument("--search", help="filter by country name or region")
    listing.set_defaults(func=cmd_codes_list)

    packs = code_subs.add_parser("packs", help="the rule packs that are encoded")
    packs.set_defaults(func=cmd_codes_packs)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
