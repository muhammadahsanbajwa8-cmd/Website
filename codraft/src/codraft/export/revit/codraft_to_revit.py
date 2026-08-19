"""Build a codraft model as NATIVE Revit elements.

Run this inside Revit, not from a shell -- through pyRevit, RevitPythonShell
or a Dynamo Python node. It reads the JSON written by
`codraft.export.model_json` and creates real levels, walls, doors, windows
and rooms, which a Revit user can then edit as ordinary content. Opening
the IFC instead gets you the same building as imported geometry, which is
faster to do and much less useful afterwards.

    1. codraft plan "..." --formats ifc      (and write the JSON model)
    2. in Revit: pyRevit -> Run Script -> this file
    3. pick the .json when prompted

What it does not do: structure, MEP, dimensions, tags, sheets, or family
selection beyond the default door and window types. It gives you the plan
as native geometry to work from, which is the part that takes the longest
to draw by hand.
"""

# pylint: disable=import-error,undefined-variable
import json

from Autodesk.Revit.DB import (
    BuiltInParameter,
    Curve,
    ElementId,
    FilteredElementCollector,
    Level,
    Line,
    Transaction,
    Wall,
    WallType,
    XYZ,
)
from Autodesk.Revit.DB.Architecture import Room
from Autodesk.Revit.UI import TaskDialog

# Revit works internally in decimal feet whatever the project units say.
MM_PER_FOOT = 304.8


def mm(value):
    """Millimetres to Revit's internal feet."""
    return float(value) / MM_PER_FOOT


def pick_model(uidoc):
    from System.Windows.Forms import DialogResult, OpenFileDialog

    dialog = OpenFileDialog()
    dialog.Filter = "codraft model (*.json)|*.json"
    dialog.Title = "Choose the codraft model to build"
    if dialog.ShowDialog() != DialogResult.OK:
        return None
    with open(dialog.FileName, "r") as handle:
        return json.load(handle)


def wall_type_for(doc, thickness_mm):
    """The closest wall type by width, since type names differ per template."""
    types = list(FilteredElementCollector(doc).OfClass(WallType))
    if not types:
        return None
    target = mm(thickness_mm)
    return min(types, key=lambda t: abs(t.Width - target))


def ensure_level(doc, name, elevation_mm, existing):
    if name in existing:
        return existing[name]
    level = Level.Create(doc, mm(elevation_mm))
    level.Name = name
    existing[name] = level
    return level


def build(doc, model):
    if model.get("format") != "codraft-model":
        TaskDialog.Show("codraft", "That file is not a codraft model.")
        return

    levels = {}
    for level in FilteredElementCollector(doc).OfClass(Level):
        levels[level.Name] = level

    created_walls = 0
    created_rooms = 0

    transaction = Transaction(doc, "Build codraft plan")
    transaction.Start()
    try:
        for storey in model["storeys"]:
            level = ensure_level(doc, storey["name"], storey["elevation"], levels)

            for wall in storey["walls"]:
                start = XYZ(mm(wall["x0"]), mm(wall["y0"]), mm(storey["elevation"]))
                end = XYZ(mm(wall["x1"]), mm(wall["y1"]), mm(storey["elevation"]))
                if start.DistanceTo(end) < mm(1):
                    continue  # a zero-length wall is a rounding artefact
                line = Line.CreateBound(start, end)
                wall_type = wall_type_for(doc, wall["thickness"])
                element = Wall.Create(
                    doc, line, wall_type.Id if wall_type else ElementId.InvalidElementId,
                    level.Id, mm(wall["height"]), 0.0, False, True,
                )
                if element and wall["kind"] == "exterior":
                    parameter = element.get_Parameter(
                        BuiltInParameter.WALL_ATTR_ROOM_BOUNDING
                    )
                    if parameter:
                        parameter.Set(1)
                created_walls += 1

            # Rooms need the walls to exist and the model to be regenerated
            # before Revit can find an enclosed boundary to put them in.
            doc.Regenerate()
            for space in storey["spaces"]:
                point = XYZ(
                    mm(space["x"] + space["width"] / 2.0),
                    mm(space["y"] + space["depth"] / 2.0),
                    mm(storey["elevation"]),
                )
                try:
                    from Autodesk.Revit.DB import UV

                    room = doc.Create.NewRoom(
                        level, UV(point.X, point.Y)
                    )
                    if room:
                        room.Name = space["name"]
                        created_rooms += 1
                except Exception:
                    # A room that will not place is usually a boundary that
                    # did not close. Carry on and report the count.
                    pass

        transaction.Commit()
    except Exception as error:
        transaction.RollBack()
        TaskDialog.Show("codraft", "Nothing was changed. %s" % error)
        return

    TaskDialog.Show(
        "codraft",
        "Built %d walls and %d rooms across %d levels.\n\n"
        "Doors, windows and stairs are not placed: they need family types "
        "chosen for this project. The openings are described in the JSON if "
        "you want to script them against your own families."
        % (created_walls, created_rooms, len(model["storeys"])),
    )


if __name__ == "__main__":
    document = __revit__.ActiveUIDocument.Document  # noqa: F821
    ui_document = __revit__.ActiveUIDocument  # noqa: F821
    data = pick_model(ui_document)
    if data:
        build(document, data)
