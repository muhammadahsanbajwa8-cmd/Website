"""Evaluating rule packs against a building.

Rules are data, not code. A pack is a JSON file of conditions written
against the facts in `facts.py`, each carrying the clause it came from and
how much confidence it deserves. Adding a jurisdiction means writing one of
those files; it never means editing this module, and it never means
changing the geometry or the exporters.

Expressions are evaluated in a sandbox that understands arithmetic,
comparisons and a handful of named functions -- and nothing else. A rule
pack cannot import, call out, or reach anything but the facts it is handed.
"""

from __future__ import annotations

import ast
import json
import operator
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from ..model import Building
from . import facts as facts_module
from .jurisdiction import Jurisdiction

RULES_DIR = Path(__file__).parent / "rules"

SEVERITIES = ("violation", "warning", "advisory")
CONFIDENCES = ("high", "medium", "low", "seed")


class RuleError(ValueError):
    """A rule pack is malformed, or an expression could not be evaluated."""


# ---------------------------------------------------------------------------
# The expression sandbox
# ---------------------------------------------------------------------------
_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_CMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}
_UNARY_OPS = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Not: operator.not_,
}
_FUNCTIONS = {
    "min": min, "max": max, "abs": abs, "len": len, "round": round,
    "any": any, "all": all, "int": int, "float": float, "sum": sum,
    "bool": bool, "str": str, "sorted": sorted,
}


class _MissingFact(Exception):
    """A rule referred to a fact that this model does not carry."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


def _eval(node: ast.AST, names: dict):
    if isinstance(node, ast.Expression):
        return _eval(node.body, names)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in names:
            return names[node.id]
        if node.id in _FUNCTIONS:
            return _FUNCTIONS[node.id]
        raise _MissingFact(node.id)
    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise RuleError(f"operator {type(node.op).__name__} is not allowed")
        return op(_eval(node.left, names), _eval(node.right, names))
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise RuleError(f"operator {type(node.op).__name__} is not allowed")
        return op(_eval(node.operand, names))
    if isinstance(node, ast.BoolOp):
        values = [_eval(v, names) for v in node.values]
        return all(values) if isinstance(node.op, ast.And) else any(values)
    if isinstance(node, ast.Compare):
        left = _eval(node.left, names)
        for op_node, right_node in zip(node.ops, node.comparators):
            op = _CMP_OPS.get(type(op_node))
            if op is None:
                raise RuleError(f"comparison {type(op_node).__name__} is not allowed")
            right = _eval(right_node, names)
            if not op(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        return (
            _eval(node.body, names) if _eval(node.test, names) else _eval(node.orelse, names)
        )
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return [_eval(e, names) for e in node.elts]
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCTIONS:
            raise RuleError(
                "only these functions may be called in a rule: "
                + ", ".join(sorted(_FUNCTIONS))
            )
        return _FUNCTIONS[node.func.id](*[_eval(a, names) for a in node.args])
    raise RuleError(f"{type(node).__name__} is not allowed in a rule expression")


def evaluate_expression(expression: str, names: dict):
    """Evaluate one rule expression against a namespace of facts."""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise RuleError(f"{expression!r} is not a valid expression: {exc}") from exc
    return _eval(tree, names)


# ---------------------------------------------------------------------------
# Packs and rules
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Rule:
    id: str
    title: str
    scope: str
    assertion: str
    clause: str = ""
    severity: str = "violation"
    confidence: str = "seed"
    applies_when: str = "True"
    message: str = ""
    reference: str = ""
    note: str = ""

    @classmethod
    def from_dict(cls, data: dict, pack: str) -> "Rule":
        for required in ("id", "scope", "assert"):
            if required not in data:
                raise RuleError(f"{pack}: a rule is missing {required!r}")
        severity = data.get("severity", "violation")
        if severity not in SEVERITIES:
            raise RuleError(
                f"{pack}:{data['id']}: severity {severity!r} is not one of "
                + ", ".join(SEVERITIES)
            )
        confidence = data.get("confidence", "seed")
        if confidence not in CONFIDENCES:
            raise RuleError(
                f"{pack}:{data['id']}: confidence {confidence!r} is not one of "
                + ", ".join(CONFIDENCES)
            )
        return cls(
            id=data["id"],
            title=data.get("title", data["id"]),
            scope=data["scope"],
            assertion=data["assert"],
            clause=data.get("clause", ""),
            severity=severity,
            confidence=confidence,
            applies_when=data.get("applies_when", "True"),
            message=data.get("message", ""),
            reference=data.get("reference", ""),
            note=data.get("note", ""),
        )


@dataclass(slots=True)
class RulePack:
    name: str
    title: str
    rules: list[Rule] = field(default_factory=list)
    publisher: str = ""
    url: str = ""
    edition: str = ""
    parameters: dict = field(default_factory=dict)
    site: dict = field(default_factory=dict)
    design: dict = field(default_factory=dict)
    disclaimer: str = ""
    applies_to_uses: list[str] = field(default_factory=list)

    def applies(self, use: str) -> bool:
        return not self.applies_to_uses or use in self.applies_to_uses


@lru_cache(maxsize=None)
def load_pack(name: str) -> RulePack:
    """Read one pack from disk."""
    path = RULES_DIR / f"{name}.json"
    if not path.exists():
        raise RuleError(
            f"no rule pack named {name!r} in {RULES_DIR}. "
            f"Available: {', '.join(sorted(available_packs())) or 'none'}"
        )
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    return RulePack(
        name=name,
        title=data.get("title", name),
        publisher=data.get("publisher", ""),
        url=data.get("url", ""),
        edition=data.get("edition", ""),
        parameters=data.get("parameters", {}),
        site=data.get("site", {}),
        design=data.get("design", {}),
        disclaimer=data.get("disclaimer", ""),
        applies_to_uses=list(data.get("applies_to_uses", ())),
        rules=[Rule.from_dict(r, name) for r in data.get("rules", ())],
    )


def available_packs() -> list[str]:
    return sorted(p.stem for p in RULES_DIR.glob("*.json"))


def merged_parameters(packs: list[RulePack]) -> dict:
    """Fold pack parameters together, later packs winning.

    Packs are listed most general first -- baseline, then the jurisdiction's
    own -- so a local occupant load factor overrides a generic one rather
    than the other way round.
    """
    merged: dict = {}
    for pack in packs:
        for key, value in pack.parameters.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = {**merged[key], **value}
            else:
                merged[key] = value
    return merged


def design_parameters(jurisdiction: Jurisdiction, use: str = "residential") -> dict:
    """Targets the builder should aim at, taken from the packs that apply.

    Without this the drawing is built to one set of defaults and then failed
    against another jurisdiction's rules -- an 810 mm bathroom door is
    ordinary in Lahore and a violation in Melbourne. Handing the targets to
    the builder means the plan is drawn trying to comply, and the rule
    engine still checks whether it managed to.

    Later packs win, and packs are ordered general to local, so a local
    figure overrides a model-code one.
    """
    design: dict = {}
    for name in jurisdiction.rule_packs:
        try:
            pack = load_pack(name)
        except RuleError:
            continue
        if not pack.applies(use):
            continue
        design.update({k: v for k, v in pack.design.items() if not k.startswith("$")})
    return design


def site_parameters(
    jurisdiction: Jurisdiction, use: str = "residential", zone: str | None = None
) -> dict:
    """Planning controls the solver can build to: setbacks, coverage, height.

    These are the rules it is better to design within than to be failed by,
    so they are handed to the solver before layout as well as checked after.

    `zone` is the density or land-use code the lot carries -- R20 in Perth,
    a residential zone elsewhere. Western Australia's controls are keyed by
    it entirely: R20 and R60 are different buildings on the same lot, and
    answering without it is answering a different question.
    """
    site: dict = {}
    for name in jurisdiction.rule_packs:
        try:
            pack = load_pack(name)
        except RuleError:
            continue
        if not pack.applies(use):
            continue
        for key, value in pack.site.items():
            if isinstance(value, dict):
                # Keyed by zone first, then locality, then a default.
                local = (
                    (value.get(zone) if zone else None)
                    or value.get(jurisdiction.locality or "")
                    or value.get("default")
                )
                if local is not None:
                    site[key] = local
            else:
                site[key] = value
    return site
