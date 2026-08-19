"""Writing the model out in the formats other software reads.

DXF and IFC are written directly, in the standard library, because both are
text formats and a dependency that can fail to install is worse than a few
hundred lines that cannot. DXF R12 is the dialect every CAD program still
reads without complaint; IFC4 is what Revit, ArchiCAD, Tekla and Solibri
open natively.

Nothing here decides anything. An exporter that adjusted a dimension to
make a drawing look right would be putting a number on a drawing that the
compliance report never saw.
"""

from .dxf import write_dxf
from .svg import write_svg
from .ifc import write_ifc
from .model_json import write_model_json, model_to_dict

__all__ = [
    "write_dxf", "write_svg", "write_ifc",
    "write_model_json", "model_to_dict",
]
