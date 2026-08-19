"""Electrical and plumbing layouts, derived from the architectural plan.

These are schematic services drawings: they say what goes where and what
connects to what, at the level a designer sets out before an engineer sizes
anything. That is a real and useful stage of work, and it is also the
ceiling of what can be honestly produced from a plan alone.

What is NOT here, and cannot be inferred from geometry: cable sizes,
breaker ratings, earthing and bonding, load calculations, diversity, pipe
diameters, flow rates, pressure, fall on drainage runs, venting sizes, or
gas. Those need a licensed electrical and plumbing engineer, and every
drawing this module produces says so on its face.
"""

from .model import Fixture, Run, ServicesPlan
from .electrical import design_electrical
from .plumbing import design_plumbing

__all__ = [
    "Fixture", "Run", "ServicesPlan", "design_electrical", "design_plumbing",
]
