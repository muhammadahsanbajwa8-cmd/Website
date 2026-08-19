"""A brief becomes a structured space program.

This is the one layer where a language model earns its place: turning
"three bedrooms, two baths, a 40 by 60 plot in Lahore" into a list of
spaces with areas and adjacencies. It is also the one layer whose output is
fully validated before anything downstream trusts it -- see `schema.py`.

Nothing here decides a dimension that ends up on a drawing. Requested areas
are requests; the solver in `codraft.layout` decides what is actually
built, and `codraft.codes` decides whether that is allowed.
"""

from .schema import SpaceRequirement, SpaceProgram, ProgramError
from .templates import template, TEMPLATES
from .parse import parse_brief, from_json, PROGRAM_JSON_SCHEMA

__all__ = [
    "SpaceRequirement",
    "SpaceProgram",
    "ProgramError",
    "template",
    "TEMPLATES",
    "parse_brief",
    "from_json",
    "PROGRAM_JSON_SCHEMA",
]
