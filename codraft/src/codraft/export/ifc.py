"""Writing IFC4, in STEP physical file form.

This is the export that makes the rest of them optional. DXF carries lines;
IFC carries a building -- storeys that know they are storeys, walls that
know their thickness, spaces that know their area, and openings that know
which wall they cut. Revit, ArchiCAD, Tekla, Solibri, BlenderBIM and every
IFC viewer read it, which is a better answer to "and all other drawing
software" than an adapter per program could ever be.

The file is written directly. IFC is a text format with a strict but simple
grammar: numbered instances, each naming a type and its attributes. Doing
it here means the exporter has no dependency that can fail to install on
the machine that needs it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..model import Building, Opening, OpeningKind, Storey, Wall
from .. import __version__

_B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def ifc_guid(value: uuid.UUID | None = None) -> str:
    """An IFC globally unique id: a UUID in IFC's own base-64 alphabet.

    IFC does not store UUIDs as hex. It packs the 128 bits into 22
    characters, six bits at a time, starting with a two-bit group -- which
    is why this is written out rather than borrowed from base64.
    """
    number = (value or uuid.uuid4()).int
    digits = []
    for _ in range(21):
        number, remainder = divmod(number, 64)
        digits.append(_B64[remainder])
    digits.append(_B64[number % 4])
    return "".join(reversed(digits))


class _Step:
    """An accumulating STEP instance table."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self._next = 0

    def add(self, entity: str, *attributes) -> str:
        self._next += 1
        ref = f"#{self._next}"
        body = ",".join(_encode(a) for a in attributes)
        self.lines.append(f"{ref}= {entity}({body});")
        return ref


def _encode(value) -> str:
    if value is None:
        return "$"
    if value is _DERIVED:
        return "*"
    if isinstance(value, str):
        if value.startswith("#") or value.startswith(".") or value.startswith("IFC"):
            return value
        return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"
    if isinstance(value, bool):
        return ".T." if value else ".F."
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, (list, tuple)):
        return "(" + ",".join(_encode(v) for v in value) + ")"
    raise TypeError(f"cannot encode {value!r} into a STEP file")


class _Derived:
    pass


_DERIVED = _Derived()


class _Writer:
    """Builds the instance graph for one building."""

    def __init__(self, building: Building) -> None:
        self.b = building
        self.s = _Step()
        self.storey_refs: dict[int, str] = {}
        self.storey_placements: dict[int, str] = {}
        self.products: dict[int, list[str]] = {}
        self._point_cache: dict[tuple, str] = {}

    # -- geometry primitives, cached because a plan reuses them heavily --
    def point(self, *coords: float) -> str:
        key = ("p",) + coords
        if key not in self._point_cache:
            self._point_cache[key] = self.s.add(
                "IFCCARTESIANPOINT", [float(c) for c in coords]
            )
        return self._point_cache[key]

    def direction(self, *coords: float) -> str:
        key = ("d",) + coords
        if key not in self._point_cache:
            self._point_cache[key] = self.s.add(
                "IFCDIRECTION", [float(c) for c in coords]
            )
        return self._point_cache[key]

    def placement3d(self, x=0.0, y=0.0, z=0.0, ref_x=None, ref_y=None) -> str:
        axis = self.direction(0.0, 0.0, 1.0)
        ref = self.direction(ref_x, ref_y, 0.0) if ref_x is not None else None
        return self.s.add("IFCAXIS2PLACEMENT3D", self.point(x, y, z), axis, ref)

    def local_placement(self, relative_to: str | None, placement: str) -> str:
        return self.s.add("IFCLOCALPLACEMENT", relative_to, placement)

    def shape(self, context: str, items: list[str], kind: str = "SweptSolid") -> str:
        rep = self.s.add(
            "IFCSHAPEREPRESENTATION", context, "Body", kind, items
        )
        return self.s.add("IFCPRODUCTDEFINITIONSHAPE", None, None, [rep])


def _wall_axis(wall: Wall) -> tuple[float, float]:
    if wall.vertical:
        return (0.0, 1.0 if wall.end.y >= wall.start.y else -1.0)
    return (1.0 if wall.end.x >= wall.start.x else -1.0, 0.0)


def write_ifc(building: Building, path: str | Path, author: str = "codraft") -> Path:
    """Write the whole building as an IFC4 file."""
    path = Path(path)
    w = _Writer(building)
    s = w.s

    # -- ownership ------------------------------------------------------
    person = s.add("IFCPERSON", None, author, None, None, None, None, None, None)
    org = s.add("IFCORGANIZATION", None, "codraft", None, None, None)
    p_and_o = s.add("IFCPERSONANDORGANIZATION", person, org, None)
    app = s.add("IFCAPPLICATION", org, __version__, "codraft", "codraft")
    stamp = int(datetime.now(tz=timezone.utc).timestamp())
    owner = s.add(
        "IFCOWNERHISTORY", p_and_o, app, None, ".ADDED.", stamp, p_and_o, app, stamp
    )

    # -- units and context ----------------------------------------------
    length = s.add("IFCSIUNIT", _DERIVED, ".LENGTHUNIT.", ".MILLI.", ".METRE.")
    area = s.add("IFCSIUNIT", _DERIVED, ".AREAUNIT.", None, ".SQUARE_METRE.")
    volume = s.add("IFCSIUNIT", _DERIVED, ".VOLUMEUNIT.", None, ".CUBIC_METRE.")
    angle = s.add("IFCSIUNIT", _DERIVED, ".PLANEANGLEUNIT.", None, ".RADIAN.")
    units = s.add("IFCUNITASSIGNMENT", [length, area, volume, angle])

    world = w.placement3d()
    context = s.add(
        "IFCGEOMETRICREPRESENTATIONCONTEXT", None, "Model", 3, 1.0e-5, world, None
    )
    body_context = s.add(
        "IFCGEOMETRICREPRESENTATIONSUBCONTEXT", "Body", "Model",
        _DERIVED, _DERIVED, _DERIVED, _DERIVED, context, None, ".MODEL_VIEW.", None,
    )

    project = s.add(
        "IFCPROJECT", ifc_guid(), owner, building.name or "Project", None, None,
        None, None, [context], units,
    )

    # -- spatial structure ----------------------------------------------
    site_placement = w.local_placement(None, w.placement3d())
    site = s.add(
        "IFCSITE", ifc_guid(), owner, "Site", None, None, site_placement, None,
        None, ".ELEMENT.", None, None, None, None, None,
    )
    building_placement = w.local_placement(site_placement, w.placement3d())
    ifc_building = s.add(
        "IFCBUILDING", ifc_guid(), owner, building.name or "Building", None, None,
        building_placement, None, None, ".ELEMENT.", None, None, None,
    )

    storey_refs: list[str] = []
    for storey in building.storeys:
        placement = w.local_placement(
            building_placement, w.placement3d(0.0, 0.0, float(storey.elevation))
        )
        w.storey_placements[storey.index] = placement
        ref = s.add(
            "IFCBUILDINGSTOREY", ifc_guid(), owner, storey.name, None, None,
            placement, None, None, ".ELEMENT.", float(storey.elevation),
        )
        w.storey_refs[storey.index] = ref
        w.products[storey.index] = []
        storey_refs.append(ref)

    # -- the building elements -------------------------------------------
    for storey in building.storeys:
        _write_storey(w, storey, owner, body_context)

    # -- aggregation and containment -------------------------------------
    s.add("IFCRELAGGREGATES", ifc_guid(), owner, None, None, project, [site])
    s.add("IFCRELAGGREGATES", ifc_guid(), owner, None, None, site, [ifc_building])
    if storey_refs:
        s.add(
            "IFCRELAGGREGATES", ifc_guid(), owner, None, None, ifc_building, storey_refs
        )
    for storey in building.storeys:
        products = w.products[storey.index]
        if products:
            s.add(
                "IFCRELCONTAINEDINSPATIALSTRUCTURE", ifc_guid(), owner, None, None,
                products, w.storey_refs[storey.index],
            )

    path.write_text(_wrap(s, path, building, author), encoding="utf-8")
    return path


def _write_storey(w: _Writer, storey: Storey, owner: str, context: str) -> None:
    s = w.s
    storey_placement = w.storey_placements[storey.index]
    products = w.products[storey.index]

    # -- spaces ----------------------------------------------------------
    for space in storey.spaces:
        rect = space.rect
        polyline = s.add(
            "IFCPOLYLINE",
            [
                w.point(float(rect.x0), float(rect.y0)),
                w.point(float(rect.x1), float(rect.y0)),
                w.point(float(rect.x1), float(rect.y1)),
                w.point(float(rect.x0), float(rect.y1)),
                w.point(float(rect.x0), float(rect.y0)),
            ],
        )
        profile = s.add("IFCARBITRARYCLOSEDPROFILEDEF", ".AREA.", space.name, polyline)
        solid = s.add(
            "IFCEXTRUDEDAREASOLID", profile, w.placement3d(),
            w.direction(0.0, 0.0, 1.0), float(storey.height),
        )
        placement = w.local_placement(storey_placement, w.placement3d())
        products.append(
            s.add(
                "IFCSPACE", ifc_guid(), owner, space.name, space.function.value, None,
                placement, w.shape(context, [solid]), space.id, ".ELEMENT.",
                ".INTERNAL.", None,
            )
        )

    # -- walls, and the openings that cut them ---------------------------
    for wall in storey.walls:
        ux, uy = _wall_axis(wall)
        wall_placement = w.local_placement(
            storey_placement,
            w.placement3d(float(wall.start.x), float(wall.start.y), 0.0, ux, uy),
        )
        profile_position = s.add(
            "IFCAXIS2PLACEMENT2D", w.point(wall.length / 2.0, 0.0), None
        )
        profile = s.add(
            "IFCRECTANGLEPROFILEDEF", ".AREA.", None, profile_position,
            float(wall.length), float(wall.thickness),
        )
        solid = s.add(
            "IFCEXTRUDEDAREASOLID", profile, w.placement3d(),
            w.direction(0.0, 0.0, 1.0), float(wall.height),
        )
        wall_ref = s.add(
            "IFCWALLSTANDARDCASE", ifc_guid(), owner,
            f"{wall.kind.value.title()} wall {wall.id}", None, None,
            wall_placement, w.shape(context, [solid]), wall.id, None,
        )
        products.append(wall_ref)

        for opening in storey.openings_on(wall.id):
            _write_opening(w, opening, wall, wall_ref, wall_placement, owner, context,
                           products)


def _write_opening(
    w: _Writer, opening: Opening, wall: Wall, wall_ref: str, wall_placement: str,
    owner: str, context: str, products: list[str],
) -> None:
    s = w.s
    # The void is cut a little deeper than the wall so the boolean is clean
    # in every viewer rather than leaving a coincident-face artefact.
    depth = wall.thickness + 20
    position = s.add(
        "IFCAXIS2PLACEMENT2D",
        w.point(opening.offset + opening.width / 2.0, 0.0),
        None,
    )
    profile = s.add(
        "IFCRECTANGLEPROFILEDEF", ".AREA.", None, position,
        float(opening.width), float(depth),
    )
    solid = s.add(
        "IFCEXTRUDEDAREASOLID", profile,
        w.placement3d(0.0, 0.0, float(opening.sill)),
        w.direction(0.0, 0.0, 1.0), float(opening.height),
    )
    placement = w.local_placement(wall_placement, w.placement3d())
    void = s.add(
        "IFCOPENINGELEMENT", ifc_guid(), owner, f"Opening {opening.id}", None, None,
        placement, w.shape(context, [solid], kind="SweptSolid"), opening.id, ".OPENING.",
    )
    s.add("IFCRELVOIDSELEMENT", ifc_guid(), owner, None, None, wall_ref, void)

    if opening.kind is OpeningKind.OPENING:
        return  # an unframed gap has nothing to fill it

    entity = "IFCDOOR" if opening.kind is OpeningKind.DOOR else "IFCWINDOW"
    filler_solid = s.add(
        "IFCEXTRUDEDAREASOLID",
        s.add(
            "IFCRECTANGLEPROFILEDEF", ".AREA.", None,
            s.add(
                "IFCAXIS2PLACEMENT2D",
                w.point(opening.offset + opening.width / 2.0, 0.0), None,
            ),
            float(opening.width), float(wall.thickness),
        ),
        w.placement3d(0.0, 0.0, float(opening.sill)),
        w.direction(0.0, 0.0, 1.0), float(opening.height),
    )
    filler = s.add(
        entity, ifc_guid(), owner,
        f"{opening.kind.value.title()} {opening.id}", None, None,
        w.local_placement(wall_placement, w.placement3d()),
        w.shape(context, [filler_solid]), opening.id,
        float(opening.height), float(opening.width), None, None, None,
    )
    s.add("IFCRELFILLSELEMENT", ifc_guid(), owner, None, None, void, filler)
    products.append(filler)


def _wrap(s: _Step, path: Path, building: Building, author: str) -> str:
    """The STEP header and the ISO envelope around the instance table."""
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    header = [
        "ISO-10303-21;",
        "HEADER;",
        f"FILE_DESCRIPTION((''ViewDefinition [CoordinationView]''),'2;1');".replace(
            "''", "'"
        ),
        f"FILE_NAME('{path.name}','{now}',('{author}'),('codraft'),"
        f"'codraft {__version__}','codraft','');",
        "FILE_SCHEMA(('IFC4'));",
        "ENDSEC;",
        "DATA;",
    ]
    return "\n".join(header + s.lines + ["ENDSEC;", "END-ISO-10303-21;", ""])
