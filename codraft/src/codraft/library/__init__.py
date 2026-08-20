"""A builder's range of designs, and fitting them to a lot.

This is the part that matches how volume building actually works. A builder
does not want a house invented from nothing for every enquiry; they sell a
catalogue -- "The Murray", "The Hamilton" -- and the real question on any
given block is which of their designs will go on it, at what setbacks, and
whether the result complies.

That question is also far more tractable than generation. Fitting a known,
costed, buildable design to a rectangle is arithmetic. Inventing a saleable
house from a brief is not, and a builder would have to re-price it anyway.

So the order is: fit first, generate only when nothing in the range will go.
"""

from .design import Design, RoomEntry, design_from_building
from .store import DesignLibrary
from .fit import Fit, fit_design, fit_library

__all__ = [
    "Design", "RoomEntry", "design_from_building",
    "DesignLibrary", "Fit", "fit_design", "fit_library",
]
