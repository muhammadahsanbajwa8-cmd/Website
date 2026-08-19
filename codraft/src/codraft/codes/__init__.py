"""Building codes: which apply, what they say, and what can be checked.

The layers are kept apart on purpose. `jurisdiction` answers where you are;
`rules/*.json` hold what the code says; `facts` reads the design; `engine`
decides; `report` explains. Adding a country means writing a JSON file --
not touching any of the code that draws or solves.
"""

from .jurisdiction import Jurisdiction, JurisdictionError, resolve, search, registry
from .engine import (
    RulePack,
    RuleError,
    available_packs,
    load_pack,
    site_parameters,
)
from .facts import derive
from .report import Report, Finding, check

__all__ = [
    "Jurisdiction", "JurisdictionError", "resolve", "search", "registry",
    "RulePack", "RuleError", "available_packs", "load_pack", "site_parameters",
    "derive", "Report", "Finding", "check",
]
