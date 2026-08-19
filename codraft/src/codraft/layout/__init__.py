"""Turning a space program into exact geometry.

No language model is involved from here on. Rooms are sized by arithmetic
over integer millimetres, and every dimension that reaches a drawing was
computed, not proposed. When the program will not fit, the solver says so
and says which rooms it could not satisfy -- it does not silently shrink a
bedroom below the size that was asked for.
"""

from .solver import solve, LayoutError, Cell, Layout
from .walls import build_building

__all__ = ["solve", "LayoutError", "Cell", "Layout", "build_building"]
