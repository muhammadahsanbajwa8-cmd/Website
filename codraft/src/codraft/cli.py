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
from .schedule import (
    format_schedule,
    opening_specification,
    schedule,
)
from .sheet import TitleBlock
from .services import design_electrical, design_plumbing
from .geom import Point, Rect
from .ingest import PdfError, read_pdf
from .library.catalogue import read_catalogue
from .library import DesignLibrary, design_from_building, fit_library
from .ingest.survey import survey_pdf
from .layout import LayoutError, build_building, place_pool, solve
from .model import OpeningKind, Plot, Roof
from .program import (
    PROGRAM_JSON_SCHEMA,
    template,
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

# Which formats can carry a services sheet. IFC and the JSON model describe
# the building, not a drawing of it, so they are written once.
SHEET_FORMATS = {"dxf", "svg"}
SHEETS = ("architectural", "electrical", "plumbing", "elevations")

SERVICES_WORDS = (
    "electrical", "electric", "wiring", "plumbing", "sanitary", "services",
    "mep", "m&e",
)


def _wants_services(brief_text: str, requested: str | None) -> list[str]:
    """Work out which sheets to draw.

    An explicit --sheets wins. Otherwise the brief is read for a mention of
    services, and failing that the question is put to the person running
    the command -- which is the point at which it is cheapest to answer.
    """
    if requested:
        return [s.strip().lower() for s in requested.split(",") if s.strip()]

    lowered = (brief_text or "").lower()
    asked = [w for w in SERVICES_WORDS if w in lowered]
    if asked:
        sheets = ["architectural"]
        if any(w in lowered for w in ("electric", "wiring", "services", "mep", "m&e")):
            sheets.append("electrical")
        if any(w in lowered for w in ("plumb", "sanitary", "services", "mep", "m&e")):
            sheets.append("plumbing")
        return sheets

    if not sys.stdin.isatty():
        return ["architectural"]

    print("Electrical and plumbing layouts can be drawn from this plan too.")
    print("They are schematic -- fittings, points and what connects to what --")
    print("and they do not size a cable or a pipe. Add them? [y/N] ", end="")
    try:
        answer = input().strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return ["architectural"]
    if answer in ("y", "yes"):
        return list(SHEETS)
    return ["architectural"]


def _fail(message: str) -> int:
    print(f"codraft: {message}", file=sys.stderr)
    return 1


def _parse_boundary(text: str) -> list[Point]:
    """Read a surveyed boundary: 'x,y x,y x,y ...' in millimetres.

    Corner coordinates come off a survey plan, which is where they should
    come from. Deriving a lot's shape from anything else means guessing at
    the one document that is definitive about it.
    """
    points: list[Point] = []
    for chunk in text.replace(";", " ").split():
        if "," not in chunk:
            raise UnitError(f"{chunk!r} is not an x,y pair")
        x, _, y = chunk.partition(",")
        points.append(Point(mm(x.strip()), mm(y.strip())))
    if len(points) < 3:
        raise UnitError("a lot boundary needs at least three corners")
    return points


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


    # An Australian house is a different brief from a generic one: a master
    # suite with a walk-in robe, a passage rather than a corridor, an
    # alfresco under the main roof and a double garage across the frontage.
    # Once the jurisdiction is known, use the vocabulary the drawings there
    # actually use.
    if (
        jurisdiction.country == "AU"
        and program.use == "residential"
        and program.source in ("brief", "template")
        and program.get("living") is not None
        and program.get("master") is None
    ):
        bedrooms = sum(
            r.count for r in program.spaces if r.function.value == "bedroom"
        )
        baths = sum(
            r.count for r in program.spaces if r.function.value == "bathroom"
        )
        program = template(
            "au-house", bedrooms=max(2, bedrooms), bathrooms=max(1, baths),
            storeys=program.storeys,
        )
        print("Using the Australian project-home vocabulary.\n")

    site = {
        key: value
        for key, value in codes.site_parameters(
            jurisdiction, program.use, args.zone
        ).items()
        if not key.startswith("$")
    }

    size = _plot_from(args, brief)
    if not size:
        return _fail(
            "no plot size was given. Add one to the brief ('40x60 ft', '12m x 18m', "
            "'5 marla') or pass --plot 12mx18m."
        )

    setbacks = dict(
        setback_front=int(site.get("setback_front_mm", 0)),
        setback_rear=int(site.get("setback_rear_mm", 0)),
        setback_left=int(site.get("setback_left_mm", 0)),
        setback_right=int(site.get("setback_right_mm", 0)),
        road_side=args.road,
    )
    if args.boundary:
        try:
            plot = Plot.from_boundary(_parse_boundary(args.boundary), **setbacks)
        except (UnitError, ValueError) as exc:
            return _fail(str(exc))
        if plot.buildable.area == 0:
            return _fail(
                "no rectangle of a usable size fits inside that boundary once "
                "the setbacks are taken off. Check the corners and the zone."
            )
    else:
        plot = Plot(rect=Rect(0, 0, size[0], size[1]), **setbacks)
    coverage = site.get("max_coverage_ratio")
    max_footprint = int(plot.area * float(coverage)) if coverage else None

    # Targets the jurisdiction's packs ask for, handed to the builder so the
    # plan is drawn trying to comply rather than failed for a default.
    design = codes.design_parameters(jurisdiction, program.use)
    if design.get("corridor_width_mm"):
        corridor = program.get("corridor")
        if corridor is not None:
            corridor.min_width = max(corridor.min_width,
                                     int(design["corridor_width_mm"]))
    if design.get("ceiling_height_mm"):
        # Storey height has to clear the required ceiling plus the structure.
        program.storey_height = max(
            program.storey_height, int(design["ceiling_height_mm"]) + 200
        )
    # Done after the storey height, which is one of its inputs.
    if program.size_stair_for(
        int(design.get("stair_riser_max_mm", 0) or 0),
        int(design.get("stair_going_min_mm", 0) or 0),
    ):
        print("Stair sized to the local riser and going limits.")

    print(f"Jurisdiction : {jurisdiction.label}")
    if jurisdiction.authority:
        print(f"Authority    : {jurisdiction.authority}")
    print(f"Rule packs   : {', '.join(jurisdiction.rule_packs)}")
    if site:
        controls = ", ".join(f"{k.replace('_mm','')}={v}" for k, v in site.items())
        print(f"Site controls: {controls}")
    if design:
        targets = ", ".join(
            f"{k.replace('_mm','')}={v}" for k, v in design.items()
            if not k.startswith("$")
        )
        print(f"Design targets: {targets}")
    print()

    # -- 3. lay it out ----------------------------------------------------
    try:
        layout = solve(program, plot, max_footprint=max_footprint)
    except LayoutError as exc:
        return _fail(str(exc))
    building = build_building(
        program, plot, layout, name=program.name,
        jurisdiction=jurisdiction.key, design=design,
    )
    if args.pool or (brief is not None and brief.pool):
        size = (args.pool_size or "8mx4m").lower().replace("×", "x")
        pl, _, pw = size.partition("x")
        try:
            pool_l, pool_w = mm(pl.strip()), mm(pw.strip())
        except UnitError:
            return _fail("pool size looks like --pool-size 8mx4m")
        pool, pool_warnings = place_pool(plot, layout.envelope, pool_l, pool_w)
        building.pool = pool
        layout.warnings.extend(pool_warnings)
        if pool:
            print(f"Pool         : {pool.rect.w} x {pool.rect.h} mm in the rear "
                  f"yard, {pool.barrier_height_mm} mm barrier at "
                  f"{pool.barrier_offset_mm} mm offset")
        else:
            print("Pool         : will not fit -- see the notes below")
        print()

    building.roof = Roof(
        pitch_degrees=float(design.get("roof_pitch_degrees", 25.0)),
        overhang_mm=int(design.get("roof_overhang_mm", 600)),
        kind=str(design.get("roof_kind", "hip")),
    )

    if plot.boundary:
        print(f"Lot          : {fmt_area(plot.area)} surveyed "
              f"({len(plot.boundary)} corners); its bounding box is "
              f"{fmt_area(plot.rect.area)}")
        print(f"Buildable    : {plot.buildable.w} x {plot.buildable.h} mm, the "
              "largest rectangle clearing every boundary by its setback")
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

    # -- 4. services, if they are wanted ----------------------------------
    brief_text = " ".join(args.brief) if args.brief else ""
    sheets = _wants_services(brief_text, args.sheets)
    for name in sheets:
        if name not in SHEETS:
            return _fail(
                f"unknown sheet {name!r}; choose from {', '.join(SHEETS)}"
            )
    if "architectural" not in sheets:
        sheets.insert(0, "architectural")
    if args.elevations and "elevations" not in sheets:
        sheets.append("elevations")

    services: dict[str, dict[int, object]] = {}
    service_warnings: list[str] = []
    if "electrical" in sheets:
        services["electrical"] = {
            st.index: design_electrical(building, st.index)
            for st in building.storeys
        }
    if "plumbing" in sheets:
        services["plumbing"] = {
            st.index: design_plumbing(building, st.index)
            for st in building.storeys
        }
    for discipline, plans in services.items():
        for plan in plans.values():
            for warning in plan.warnings:
                service_warnings.append(f"{discipline}: {warning}")

    # -- 5. draw it -------------------------------------------------------
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = args.name or "plan"
    written: list[Path] = []

    # One plan to a sheet, which is how a set is issued and what makes the
    # "sheet n of m" in the title block mean anything. Two storeys side by
    # side on one page forces the scale down a step for no reason.
    pages: list[tuple[str, int | None, str]] = []
    for sheet in sheets:
        stem_part = "" if sheet == "architectural" else f"-{sheet}"
        if sheet == "elevations" or len(building.storeys) == 1:
            pages.append((sheet, None, stem_part))
            continue
        for storey in building.storeys:
            slug = storey.name.lower().replace(" ", "-")
            pages.append((sheet, storey.index, f"{stem_part}-{slug}"))

    title_block = TitleBlock(
        project=args.project or building.name or "",
        client=args.client or "",
        address=args.address or "",
        job_number=args.job or "",
        drawn_by=args.drawn_by or "",
    )

    formats = [f.strip().lower() for f in args.formats.split(",") if f.strip()]
    for name in formats:
        if name not in FORMATS:
            return _fail(
                f"unknown format {name!r}; choose from {', '.join(sorted(FORMATS))}"
            )

    for name in formats:
        writer = FORMATS[name]
        if name not in SHEET_FORMATS:
            # IFC and the JSON model describe the building itself, so there
            # is one of each however many sheets are drawn.
            written.append(writer(building, out / f"{stem}.{name}"))
            continue
        for number, (sheet, storey_index, suffix) in enumerate(pages, start=1):
            written.append(
                writer(
                    building,
                    out / f"{stem}{suffix}.{name}",
                    storey_index=storey_index,
                    sheet=sheet,
                    services=services.get(sheet),
                    footprint=layout.envelope,
                    system=args.units,
                    title=title_block,
                    sheet_no=number,
                    sheet_of=len(pages),
                    sheet_size=args.sheet,
                )
            )
    if "elevations" in sheets:
        print(f"Overall height: {building.overall_height} mm to ridge "
              f"({building.roof.pitch_degrees:.0f} degree "
              f"{building.roof.kind} roof)")

    print("Written:")
    for p in written:
        print(f"  {p}  ({p.stat().st_size:,} bytes)")
    print()

    if service_warnings:
        print("From the services layout:")
        for warning in service_warnings:
            print(f"  - {warning}")
        print()

    # -- 5. schedule the openings ----------------------------------------
    # The schedule is what an opening is actually built from: the size, where
    # its head sits in courses, and the specification that goes with it. A
    # plan that draws a rectangle in a wall has described almost none of it.
    rows, schedule_warnings = schedule(building)
    windows = [r for r in rows if r.kind is OpeningKind.WINDOW]
    doors = [r for r in rows if r.kind is OpeningKind.DOOR]
    schedule_text = "\n".join(
        format_schedule(windows, "WINDOW SCHEDULE")
        + [""]
        + format_schedule(doors, "DOOR SCHEDULE")
        + ["", "SPECIFICATION AT EVERY EXTERNAL OPENING", "-" * 72,
           "  NONE OF THIS IS CHECKED. It cannot be read off a plan. These are",
           "  the items to be drawn, priced and built, each against the standard",
           "  that governs it -- listing them is how they stop being forgotten.",
           ""]
        + [f"  {title}\n      [{clause}]\n      {body}\n"
           for title, clause, body in opening_specification()]
    )
    (out / f"{stem}-schedule.txt").write_text(schedule_text + "\n", encoding="utf-8")
    print(schedule_text)
    print(f"  Written: {out / f'{stem}-schedule.txt'}\n")

    # -- 6. check it ------------------------------------------------------
    report = codes.check(
        building, jurisdiction,
        layout.warnings + service_warnings + schedule_warnings,
    )
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


DEFAULT_LIBRARY = "designs"


def _resolve_plot(args, program_use: str = "residential"):
    """Lot, jurisdiction and planning controls, from the arguments."""
    try:
        jurisdiction = codes.resolve(args.location or "")
    except codes.JurisdictionError as exc:
        return None, None, None, str(exc)
    site = {
        k: v
        for k, v in codes.site_parameters(jurisdiction, program_use, args.zone).items()
        if not k.startswith("$")
    }

    text = (args.lot or "").lower().replace("×", "x")
    width, _, depth = text.partition("x")
    if not depth:
        if getattr(args, "boundary", None):
            width, depth = "1m", "1m"   # unused; the boundary decides
        else:
            return None, None, None, (
                "give the lot size as --lot 15mx32m, or the surveyed corners "
                "as --boundary"
            )
    try:
        unit = "".join(c for c in depth if c.isalpha()) or "m"
        size = (mm(width.strip(), unit), mm(depth.strip()))
    except UnitError as exc:
        return None, None, None, str(exc)

    setbacks = dict(
        setback_front=int(site.get("setback_front_mm", 0)),
        setback_rear=int(site.get("setback_rear_mm", 0)),
        setback_left=int(site.get("setback_left_mm", 0)),
        setback_right=int(site.get("setback_right_mm", 0)),
        road_side=args.road,
    )
    if getattr(args, "boundary", None):
        try:
            plot = Plot.from_boundary(_parse_boundary(args.boundary), **setbacks)
        except (UnitError, ValueError) as exc:
            return None, None, None, str(exc)
    else:
        plot = Plot(rect=Rect(0, 0, *size), **setbacks)
    return plot, jurisdiction, site, None


def cmd_library(args) -> int:
    """Seed, list or inspect the builder's range."""
    library = DesignLibrary.load(args.path)

    if args.library_command == "seed":
        # A starter range, so the fitting engine can be used before anyone
        # has extracted a single design from a PDF. These are codraft's own
        # plans, not any builder's -- they get replaced by the real range.
        made = []
        for bedrooms in (3, 4, 5):
            for storeys in (1, 2):
                program = template(
                    "house", bedrooms=bedrooms, bathrooms=2 if bedrooms < 5 else 3,
                    storeys=storeys,
                )
                # A generous notional block, so the design is shaped by the
                # brief rather than squeezed by a lot it will never sit on.
                plot = Plot(rect=Rect(0, 0, 20000, 40000), setback_front=6000,
                            setback_rear=6000, setback_left=1500, setback_right=1500)
                layout = solve(program, plot)
                building = build_building(program, plot, layout)
                name = (
                    f"Starter {bedrooms}B "
                    f"{'Double' if storeys > 1 else 'Single'}"
                )
                design = design_from_building(building, name, source="generated")
                design.notes.append(
                    "Generated by codraft as a starter entry. Replace with the "
                    "builder's own design once its footprint is known."
                )
                library.add(design)
                made.append(design)
        print(f"Seeded {len(made)} designs into {library.path}/")
        for design in made:
            print(f"  {design.id:26} {design.width_mm} x {design.depth_mm} mm  "
                  f"{design.total_m2:.0f} m²")
        print()
        print("These are placeholders. Replace them with the builder's range: "
              "one JSON file per design, needing only a name, a width across "
              "the frontage and a depth to be fittable.")
        return 0

    if args.library_command == "import":
        if not args.file:
            return _fail("`library import` needs --file pointing at a CSV or TSV")
        source = Path(args.file)
        if not source.exists():
            return _fail(f"{source} does not exist")
        report = read_catalogue(source, builder=args.builder)
        for line in report.summary():
            print(line)
        print()
        if not report.imported:
            print("Nothing was imported, so nothing was written.")
            return 1
        if args.dry_run:
            print(f"--dry-run: {len(report.imported)} designs would be written "
                  f"to {library.path}/. Nothing was.")
            return 0
        for design in report.imported:
            library.add(design)
        print(f"Written to {library.path}/:")
        for design in report.imported:
            area = f"{design.total_m2:.0f} m²" if design.total_m2 else "area not given"
            print(f"  {design.id:26} {design.width_mm} x {design.depth_mm} mm  {area}")
        print()
        print("Run `codraft fit --lot 15mx30m --location Perth --zone R20` to "
              "see which of them go on a block.")
        return 0

    if not library.designs:
        return _fail(
            f"no designs in {library.path}/. Run `codraft library seed` for a "
            "starter range, `codraft library import --file range.csv` to read "
            "a spreadsheet, or add one JSON file per design."
        )

    print(f"{len(library)} design(s) in {library.path}/")
    print()
    print(f"{'ID':<26} {'FRONTAGE':>9} {'DEPTH':>8} {'BEDS':>5} "
          f"{'STOREYS':>8} {'TOTAL':>8}")
    print("-" * 72)
    for design in sorted(library.designs, key=lambda d: d.name):
        print(f"{design.id:<26} {design.width_mm:>9} {design.depth_mm:>8} "
              f"{design.bedrooms:>5} {design.storeys:>8} "
              f"{design.total_m2:>7.0f}m²")
    for problem in library.problems:
        print(f"  ! {problem}")
    return 0


def cmd_fit(args) -> int:
    """Which of the builder's designs go on this block."""
    library = DesignLibrary.load(args.library)
    if not library.designs:
        return _fail(
            f"no designs in {args.library}/. Run `codraft library seed` first, "
            "or point --library at the builder's range."
        )

    plot, jurisdiction, site, error = _resolve_plot(args)
    if error:
        return _fail(error)

    if plot.boundary:
        print(f"Lot          : {len(plot.boundary)} corners, "
              f"{plot.area / 1e6:.0f} m² surveyed "
              f"(bounding box {plot.rect.area / 1e6:.0f} m²), "
              f"fronting {plot.road_side}")
    else:
        print(f"Lot          : {plot.rect.w} x {plot.rect.h} mm "
              f"({plot.area / 1e6:.0f} m²), fronting {plot.road_side}")
    print(f"Jurisdiction : {jurisdiction.label}")
    if args.zone:
        print(f"Zone         : {args.zone}")
    if jurisdiction.authority:
        print(f"Authority    : {jurisdiction.authority}")
    if site:
        controls = ", ".join(f"{k.replace('_mm','')}={v}" for k, v in site.items())
        print(f"Planning     : {controls}")
    else:
        print("Planning     : no site controls encoded for this jurisdiction, so "
              "setbacks and cover are UNCHECKED")
    envelope = plot.buildable
    print(f"Buildable    : {envelope.w} x {envelope.h} mm "
          f"({envelope.area / 1e6:.0f} m²) after setbacks")
    print()

    fits = fit_library(
        library.designs,
        plot,
        max_coverage=site.get("max_coverage_ratio"),
        min_outdoor_m2=site.get("min_outdoor_living_m2"),
        bedrooms=args.bedrooms,
        storeys=args.storeys,
    )
    if not fits:
        return _fail("no design in the library matched those filters")

    good = [f for f in fits if f.fits]
    print(f"{len(good)} of {len(fits)} design(s) fit this block.")
    print()
    print(f"{'DESIGN':<26} {'VERDICT':<9} {'COVER':>6} {'SPARE W':>8} "
          f"{'SPARE D':>8}  NOTES")
    print("-" * 96)
    for result in fits:
        design = result.design
        if result.fits:
            print(f"{design.id:<26} {'fits':<9} "
                  f"{result.coverage_ratio * 100:>5.1f}% "
                  f"{result.margin_width_mm:>8} {result.margin_depth_mm:>8}  "
                  f"score {result.score:.0f}")
            for note in result.notes:
                print(f"{'':<26} {'':<9} {'':>6} {'':>8} {'':>8}  - {note}")
        else:
            print(f"{design.id:<26} {'no':<9} {'':>6} {'':>8} {'':>8}  "
                  f"{result.reasons[0] if result.reasons else ''}")
    print()

    if not good:
        print("Nothing in the range goes on this block.")
        if args.generate:
            print("Generating a plan for it instead.\n")
            return _generate_for_lot(args, plot, jurisdiction, site)
        print("Run again with --generate to have codraft design one for the lot.")
        return 1

    print("A fit is a fit on FOOTPRINT AND PLANNING ONLY. It says the design "
          "goes inside the setbacks and stays under the site cover. It says "
          "nothing yet about the NCC -- run `codraft plan` on the chosen "
          "design to check the building itself.")
    return 0


def _generate_for_lot(args, plot, jurisdiction, site) -> int:
    """Fall back to designing something for a block nothing else fits."""
    program = template(
        "house", bedrooms=args.bedrooms or 4,
        bathrooms=2, storeys=args.storeys or 1,
    )
    design_targets = codes.design_parameters(jurisdiction, program.use)
    if design_targets.get("corridor_width_mm"):
        corridor = program.get("corridor")
        if corridor is not None:
            corridor.min_width = max(
                corridor.min_width, int(design_targets["corridor_width_mm"])
            )
    coverage = site.get("max_coverage_ratio")
    try:
        layout = solve(
            program, plot,
            max_footprint=int(plot.area * float(coverage)) if coverage else None,
        )
    except LayoutError as exc:
        return _fail(str(exc))
    building = build_building(
        program, plot, layout, jurisdiction=jurisdiction.key, design=design_targets
    )
    generated = design_from_building(
        building, f"For {plot.rect.w}x{plot.rect.h} lot", source="generated"
    )
    print(f"Designed: {generated.width_mm} x {generated.depth_mm} mm, "
          f"{generated.total_m2:.0f} m², {generated.bedrooms} bed")
    report = codes.check(building, jurisdiction, layout.warnings)
    counts = report.counts
    print(f"Checked : {counts['failed']} failed of {counts['checked']} "
          f"({counts['violations']} violations)")
    if args.save:
        library = DesignLibrary.load(args.library)
        file = library.add(generated)
        print(f"Saved to {file} so it can be offered on the next block like this.")
    return 0


def cmd_survey(args) -> int:
    """Read an existing drawing and report what could be recovered from it."""
    path = Path(args.file)
    if not path.exists():
        return _fail(f"{path} does not exist")
    if path.suffix.lower() != ".pdf":
        return _fail(
            f"survey reads PDF today; {path.suffix or 'that file'} is not "
            "supported yet. Export a PDF, or send DXF or IFC and say so."
        )

    try:
        document = read_pdf(path)
    except PdfError as exc:
        return _fail(str(exc))

    print(f"{path.name}")
    print(f"  pages     : {len(document.pages)}")
    if document.producer:
        print(f"  written by: {document.producer}")
    print()

    surveys = survey_pdf(document)
    measurable = 0

    for survey in surveys:
        print(f"Page {survey.page + 1}  "
              f"({survey.width_pt:.0f} x {survey.height_pt:.0f} pt)")
        print(f"  line work : {survey.segment_count} segments")
        print(f"  text      : {survey.text_count} runs")

        if survey.has_scale:
            measurable += 1
            print(f"  scale     : {survey.scale_ratio} "
                  f"({survey.scale_mm_per_pt:.3f} mm per point), "
                  f"{survey.scale_agreement:.0%} agreement")
            print(f"              {survey.scale_note}")
        else:
            print("  scale     : NOT ESTABLISHED")
            print(f"              {survey.scale_note}")

        read = [d for d in survey.dimensions if d.scale_mm_per_pt]
        if read:
            shown = ", ".join(f"{d.text}" for d in read[:10])
            more = f" (+{len(read) - 10} more)" if len(read) > 10 else ""
            print(f"  dimensions: {len(read)} read -- {shown}{more}")

        if survey.walls:
            thicknesses: dict[int, int] = {}
            for wall in survey.walls:
                key = int(round(wall.thickness_mm / 5) * 5)
                thicknesses[key] = thicknesses.get(key, 0) + 1
            common = sorted(thicknesses.items(), key=lambda kv: -kv[1])[:4]
            summary = ", ".join(f"{t} mm x{n}" for t, n in common)
            print(f"  walls     : {len(survey.walls)} candidates -- {summary}")

        if survey.labels:
            names = ", ".join(sorted({t.text.strip() for t in survey.labels})[:12])
            print(f"  labels    : {names}")

        for warning in survey.warnings:
            print(f"  ! {warning}")
        print()

    print("-" * 72)
    if measurable:
        print(
            f"{measurable} of {len(surveys)} page(s) can be measured, because a "
            "dimension printed on them established the scale. Every length "
            "reported above is derived from those printed numbers -- none of "
            "it was measured off the page and converted by guesswork."
        )
    else:
        print(
            "No page could be measured. codraft will not infer a scale from "
            "paper size: the same plan on A3 could be 1:50 or 1:100 and look "
            "identical, and a wrong scale produces confident, wrong "
            "millimetres. Send a drawing with dimensions on it, or a DXF or "
            "IFC, and this becomes a different job."
        )
    print(
        "\nWhat this is NOT: a building model. Walls here are pairs of "
        "parallel lines, not walls that know what they separate. Turning "
        "this into something the code checker can run over needs the room "
        "boundaries closed and the openings identified."
    )
    return 0 if measurable else 1


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
    plan.add_argument(
        "--boundary",
        help="a surveyed lot boundary as x,y pairs in mm: "
             "'0,0 19783,0 22390,9465 0,12000'. Use this for anything that is "
             "not a rectangle -- splayed corners, battle-axe legs, curved "
             "frontages. The bounding box overstates such a lot badly, and "
             "site cover is a percentage of the lot.",
    )
    plan.add_argument("--storeys", type=int, help="override the storey count")
    plan.add_argument("--road", default="south",
                      choices=("south", "north", "east", "west"),
                      help="which side the plot fronts a road (default: south)")
    plan.add_argument("--out", default="out", help="output directory (default: out)")
    plan.add_argument("--name", help="base filename (default: plan)")
    plan.add_argument(
        "--sheets",
        help="comma separated: architectural, electrical, plumbing. "
             "Omit to read the brief for a mention of services, and to be "
             "asked if it does not mention any.",
    )
    plan.add_argument(
        "--sheet", default="A3",
        help="paper size for the drawn sheets (default: A3). The scale is "
             "then the largest standard one that fits; a drawing that will "
             "not fit at 1:2000 is refused rather than drawn at an odd ratio.",
    )
    plan.add_argument(
        "--project", default="",
        help="project name for the title block",
    )
    plan.add_argument(
        "--client", default="",
        help="client name for the title block. Left blank it is ruled "
             "through on the sheet rather than filled in with a guess.",
    )
    plan.add_argument(
        "--address", default="",
        help="site address for the title block",
    )
    plan.add_argument(
        "--job", default="",
        help="job number for the title block",
    )
    plan.add_argument(
        "--drawn-by", default="", dest="drawn_by",
        help="who drew it, for the title block and the revision row",
    )
    plan.add_argument(
        "--zone",
        help="the lot's density or planning code, e.g. R20 in Perth. Western "
             "Australian controls are keyed by it entirely.",
    )
    plan.add_argument("--units", default="metric", choices=("metric", "imperial"),
                      help="units for dimensions on the drawings (default: metric)")
    plan.add_argument("--formats", default="dxf,ifc,svg",
                      help="comma separated: dxf, ifc, svg, json (default: dxf,ifc,svg)")
    plan.add_argument("--pool", action="store_true",
                      help="put a pool in the rear yard, with its barrier")
    plan.add_argument("--pool-size", help="pool size, e.g. 8mx4m (default 8mx4m)")
    plan.add_argument("--elevations", action="store_true",
                      help="also draw the four elevations")
    plan.add_argument("--json", action="store_true", help="also write the report as JSON")
    plan.add_argument("--show-passes", action="store_true",
                      help="list the rules that passed, not just those that failed")
    plan.set_defaults(func=cmd_plan)

    program = subs.add_parser("program", help="show the structured space program")
    program.add_argument("brief", nargs="*")
    program.add_argument("--schema", action="store_true",
                         help="print the JSON schema for a language model to fill in")
    program.set_defaults(func=cmd_program)

    library = subs.add_parser("library", help="the builder's range of designs")
    library.add_argument("library_command", choices=("list", "seed", "import"),
                         nargs="?", default="list")
    library.add_argument("--path", default=DEFAULT_LIBRARY,
                         help=f"directory of designs (default: {DEFAULT_LIBRARY})")
    library.add_argument("--file", help="CSV or TSV of the builder's range, for "
                                        "`library import`. A name, a frontage "
                                        "width and a depth are the minimum row.")
    library.add_argument("--builder", default="",
                         help="builder name, where the file does not carry one")
    library.add_argument("--dry-run", action="store_true", dest="dry_run",
                         help="read the file and report, without writing anything")
    library.set_defaults(func=cmd_library)

    fit = subs.add_parser(
        "fit", help="which of the builder's designs go on this block"
    )
    fit.add_argument("--lot", help="lot size, e.g. 15mx32m")
    fit.add_argument(
        "--boundary",
        help="surveyed corners as x,y pairs in mm, for a lot that is not a "
             "rectangle",
    )
    fit.add_argument("--location", required=True, help="city, state or country")
    fit.add_argument("--zone", help="density or planning code, e.g. R20")
    fit.add_argument("--road", default="south",
                     choices=("south", "north", "east", "west"),
                     help="which side the lot fronts a road (default: south)")
    fit.add_argument("--library", default=DEFAULT_LIBRARY)
    fit.add_argument("--bedrooms", type=int, help="only designs with this many")
    fit.add_argument("--storeys", type=int, help="only designs with this many")
    fit.add_argument("--generate", action="store_true",
                     help="design one for the block when nothing in the range fits")
    fit.add_argument("--save", action="store_true",
                     help="add a generated design to the library")
    fit.set_defaults(func=cmd_fit)

    survey = subs.add_parser(
        "survey", help="read an existing PDF drawing and report what is in it"
    )
    survey.add_argument("file", help="a PDF plan")
    survey.set_defaults(func=cmd_survey)

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
