"""The building model as JSON.

IFC is the right way into most software. Revit is the exception worth
handling separately: opening an IFC there gives you an IFC import, with
generic-model geometry that a Revit user cannot edit like native content.
To get real Revit walls, rooms and levels, something has to run inside
Revit and build them -- and that something needs the model in a form
IronPython can read without an IFC toolkit. This is that form.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..model import Building


def model_to_dict(building: Building) -> dict:
    """Everything an importer needs, in millimetres, with nothing implicit."""
    return {
        "format": "codraft-model",
        "version": 1,
        "units": "mm",
        "name": building.name,
        "use": building.use,
        "jurisdiction": building.jurisdiction,
        "plot": {
            "x": building.plot.rect.x, "y": building.plot.rect.y,
            "width": building.plot.rect.w, "depth": building.plot.rect.h,
            "setbacks": {
                "front": building.plot.setback_front,
                "rear": building.plot.setback_rear,
                "left": building.plot.setback_left,
                "right": building.plot.setback_right,
            },
            "road_side": building.plot.road_side,
        },
        "storeys": [
            {
                "index": storey.index,
                "name": storey.name,
                "elevation": storey.elevation,
                "height": storey.height,
                "spaces": [
                    {
                        "id": s.id, "name": s.name, "function": s.function.value,
                        "x": s.rect.x, "y": s.rect.y, "width": s.rect.w,
                        "depth": s.rect.h, "area_mm2": s.area,
                    }
                    for s in storey.spaces
                ],
                "walls": [
                    {
                        "id": w.id, "kind": w.kind.value,
                        "x0": w.start.x, "y0": w.start.y,
                        "x1": w.end.x, "y1": w.end.y,
                        "thickness": w.thickness, "height": w.height,
                        "separates": list(w.separates),
                    }
                    for w in storey.walls
                ],
                "openings": [
                    {
                        "id": o.id, "wall": o.wall, "kind": o.kind.value,
                        "offset": o.offset, "width": o.width, "height": o.height,
                        "sill": o.sill, "is_egress": o.is_egress,
                        "clear_width": o.clear_width,
                    }
                    for o in storey.openings
                ],
                "stairs": [
                    {
                        "id": st.id, "x": st.rect.x, "y": st.rect.y,
                        "width": st.rect.w, "depth": st.rect.h,
                        "riser": st.riser_height, "going": st.tread_depth,
                        "risers": st.risers, "flights": st.flights,
                        "stair_width": st.width,
                    }
                    for st in storey.stairs
                ],
            }
            for storey in building.storeys
        ],
    }


def write_model_json(building: Building, path: str | Path) -> Path:
    path = Path(path)
    path.write_text(json.dumps(model_to_dict(building), indent=2), encoding="utf-8")
    return path
