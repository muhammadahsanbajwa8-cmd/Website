"""Running the rules, and saying honestly what came of it.

A compliance report that lists only failures is misleading, because the
reader cannot tell the difference between "checked and fine" and "never
looked at". This one carries three things: what failed, what passed, and
what could not be checked and why. The last of those is the most important
column on the page.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import Building
from . import facts as facts_module
from .engine import (
    Rule,
    RulePack,
    RuleError,
    _MissingFact,
    evaluate_expression,
    load_pack,
    merged_parameters,
)
from .jurisdiction import Jurisdiction

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_UNCHECKED = "unchecked"
STATUS_NOT_APPLICABLE = "not_applicable"

_SEVERITY_ORDER = {"violation": 0, "warning": 1, "advisory": 2}
_CONFIDENCE_LABEL = {
    "high": "read from the published code",
    "medium": "read from published guidance",
    "low": "commonly cited, not verified against the document",
    "seed": "indicative only -- must be verified before use",
}


@dataclass(slots=True)
class Finding:
    rule_id: str
    title: str
    status: str
    severity: str
    confidence: str
    subject: str
    message: str
    clause: str = ""
    pack: str = ""
    note: str = ""
    reason: str = ""   # why it was unchecked, when it was

    @property
    def is_failure(self) -> bool:
        return self.status == STATUS_FAIL


@dataclass(slots=True)
class Report:
    building: str
    jurisdiction: Jurisdiction
    findings: list[Finding] = field(default_factory=list)
    packs: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    disclaimers: list[str] = field(default_factory=list)
    design_warnings: list[str] = field(default_factory=list)
    # What the brief asked for, room by room, that the drawing did not give
    # it. Kept apart from the layout's notes because it is a different kind
    # of statement: a note explains a decision, this records a shortfall.
    unsatisfied: list[str] = field(default_factory=list)

    # -- slices ----------------------------------------------------------
    @property
    def failures(self) -> list[Finding]:
        return sorted(
            (f for f in self.findings if f.status == STATUS_FAIL),
            key=lambda f: (_SEVERITY_ORDER.get(f.severity, 9), f.rule_id),
        )

    @property
    def passes(self) -> list[Finding]:
        return [f for f in self.findings if f.status == STATUS_PASS]

    @property
    def unchecked(self) -> list[Finding]:
        return [f for f in self.findings if f.status == STATUS_UNCHECKED]

    @property
    def violations(self) -> list[Finding]:
        return [f for f in self.failures if f.severity == "violation"]

    @property
    def counts(self) -> dict[str, int]:
        return {
            "checked": len(self.passes) + len(self.failures),
            "passed": len(self.passes),
            "failed": len(self.failures),
            "violations": len(self.violations),
            "warnings": sum(1 for f in self.failures if f.severity == "warning"),
            "advisories": sum(1 for f in self.failures if f.severity == "advisory"),
            "unchecked": len(self.unchecked),
        }

    def to_dict(self) -> dict:
        return {
            "building": self.building,
            "jurisdiction": {
                "key": self.jurisdiction.key,
                "label": self.jurisdiction.label,
                "authority": self.jurisdiction.authority,
                "codes": self.jurisdiction.codes,
                "confidence": self.jurisdiction.confidence,
            },
            "packs": self.packs,
            "counts": self.counts,
            "findings": [
                {
                    "rule": f.rule_id,
                    "title": f.title,
                    "status": f.status,
                    "severity": f.severity,
                    "confidence": f.confidence,
                    "subject": f.subject,
                    "clause": f.clause,
                    "message": f.message,
                    "note": f.note,
                    "reason": f.reason,
                }
                for f in self.findings
            ],
            "assumptions": self.assumptions,
            "disclaimers": self.disclaimers,
            "design_warnings": self.design_warnings,
            "unsatisfied": self.unsatisfied,
            "caveat": self.jurisdiction.caveat(),
        }

    def to_text(self, show_passes: bool = False) -> str:
        j = self.jurisdiction
        out: list[str] = []
        out.append(f"Compliance report -- {self.building}")
        out.append("=" * 72)
        out.append(f"Jurisdiction : {j.label or 'not resolved'}")
        if j.authority:
            out.append(f"Authority    : {j.authority}")
        if j.codes:
            out.append(f"Governing    : {'; '.join(j.codes)}")
        out.append(f"Rule packs   : {', '.join(self.packs) or 'none'}")
        counts = self.counts
        out.append(
            f"Result       : {counts['failed']} failed of {counts['checked']} checked "
            f"({counts['violations']} violations, {counts['warnings']} warnings, "
            f"{counts['advisories']} advisories); {counts['unchecked']} could not be checked"
        )
        out.append("")

        if self.failures:
            out.append("FINDINGS")
            out.append("-" * 72)
            for f in self.failures:
                marker = {"violation": "!!", "warning": " !", "advisory": " ~"}.get(
                    f.severity, "  "
                )
                out.append(f"{marker} [{f.severity}] {f.title} -- {f.subject}")
                out.append(f"     {f.message}")
                if f.clause:
                    out.append(f"     Source: {f.clause}")
                out.append(
                    f"     Confidence: {f.confidence} "
                    f"({_CONFIDENCE_LABEL.get(f.confidence, 'unknown')})"
                )
                if f.note:
                    out.append(f"     Note: {f.note}")
                out.append("")
        else:
            out.append("No rule in the applied packs was failed.")
            out.append("")

        if self.unchecked:
            out.append("COULD NOT BE CHECKED")
            out.append("-" * 72)
            for f in self.unchecked:
                out.append(f"  - {f.title} ({f.rule_id}): {f.reason}")
            out.append("")

        if show_passes and self.passes:
            out.append("PASSED")
            out.append("-" * 72)
            for f in self.passes:
                out.append(f"  - {f.title} -- {f.subject} [{f.clause or f.pack}]")
            out.append("")

        if self.design_warnings:
            out.append("NOTES FROM THE LAYOUT")
            out.append("-" * 72)
            for w in self.design_warnings:
                out.append(f"  - {w}")
            out.append("")

        if self.unsatisfied:
            # Whoever is handed this file has to be able to see that a room
            # is smaller than it was asked to be. It used to be printed to
            # the terminal and nowhere else, so it reached the person who ran
            # the command and not the person given the drawing -- and a
            # squeezed room somebody is told about is a stated limitation
            # where the same room in silence is a lie.
            out.append("ASKED FOR BUT NOT ACHIEVED")
            out.append("-" * 72)
            for item in self.unsatisfied:
                out.append(f"  - {item}")
            out.append("")

        if self.assumptions:
            out.append("ASSUMPTIONS THIS REPORT RESTS ON")
            out.append("-" * 72)
            for a in self.assumptions:
                out.append(f"  - {a}")
            out.append("")

        out.append("WHAT THIS REPORT IS NOT")
        out.append("-" * 72)
        out.append(f"  {j.caveat()}")
        for d in self.disclaimers:
            out.append(f"  {d}")
        for note in j.notes:
            out.append(f"  {note}")
        out.append(
            "  This is not a compliance certificate and not legal advice. A "
            "licensed architect or engineer must review and stamp any drawing "
            "used for construction or submitted for approval."
        )
        return "\n".join(out)


def _format(template: str, values: dict) -> str:
    """Fill a rule's message from the facts, leaving unknown fields visible."""
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        return template


def _subject(scope: str, item: dict) -> str:
    for key in ("name", "id", "index"):
        if key in item:
            return f"{scope} {item[key]}"
    return scope


def check(
    building: Building,
    jurisdiction: Jurisdiction,
    design_warnings: list[str] | None = None,
    site: dict | None = None,
    unsatisfied: list[str] | None = None,
) -> Report:
    """Run every pack that applies, and collect what each rule decided.

    `unsatisfied` is what the layout could not give the brief, room by room.
    It is not a compliance question and no rule reads it; it is here because
    this file is the one the customer is handed, and a room drawn smaller
    than it was asked to be has to be visible in it.

    `site` is the planning controls resolved for this lot's density code.
    Without them a rule keyed by density -- outdoor living area is one --
    has no figure to check against and reports unchecked, which is correct
    but is not the answer anybody wanted.
    """
    packs: list[RulePack] = []
    for name in jurisdiction.rule_packs:
        try:
            pack = load_pack(name)
        except RuleError:
            continue
        if pack.applies(building.use):
            packs.append(pack)

    parameters = merged_parameters(packs)
    fact_set = facts_module.derive(building, parameters, site)

    report = Report(
        building=building.name,
        jurisdiction=jurisdiction,
        packs=[p.name for p in packs],
        assumptions=list(fact_set.assumptions),
        disclaimers=[p.disclaimer for p in packs if p.disclaimer],
        design_warnings=list(design_warnings or ()),
        unsatisfied=list(unsatisfied or ()),
    )

    for pack in packs:
        for rule in pack.rules:
            try:
                items = fact_set.scope(rule.scope)
            except KeyError as exc:
                report.findings.append(
                    Finding(
                        rule_id=rule.id, title=rule.title, status=STATUS_UNCHECKED,
                        severity=rule.severity, confidence=rule.confidence,
                        subject="-", message="", clause=rule.clause, pack=pack.name,
                        reason=str(exc),
                    )
                )
                continue

            for item in items:
                report.findings.append(_apply(rule, pack, item))

    return report


def _apply(rule: Rule, pack: RulePack, item: dict) -> Finding:
    """Decide one rule against one thing."""
    subject = _subject(rule.scope, item)
    base = dict(
        rule_id=rule.id, title=rule.title, severity=rule.severity,
        confidence=rule.confidence, subject=subject, clause=rule.clause,
        pack=pack.name, note=rule.note,
    )

    try:
        applies = bool(evaluate_expression(rule.applies_when, item))
    except _MissingFact as missing:
        return Finding(
            **base, status=STATUS_UNCHECKED, message="",
            reason=f"the model carries no fact called {missing.name!r}, which the "
                   "rule's condition needs",
        )
    except RuleError as exc:
        return Finding(**base, status=STATUS_UNCHECKED, message="", reason=str(exc))

    if not applies:
        return Finding(**base, status=STATUS_NOT_APPLICABLE, message="")

    try:
        passed = bool(evaluate_expression(rule.assertion, item))
    except _MissingFact as missing:
        return Finding(
            **base, status=STATUS_UNCHECKED, message="",
            reason=f"the model carries no fact called {missing.name!r}, so this "
                   "rule was not decided either way",
        )
    except ZeroDivisionError:
        return Finding(
            **base, status=STATUS_UNCHECKED, message="",
            reason="the rule divided by a quantity that is zero in this model",
        )
    except RuleError as exc:
        return Finding(**base, status=STATUS_UNCHECKED, message="", reason=str(exc))

    if passed:
        return Finding(**base, status=STATUS_PASS, message=_format(rule.message, item))

    # It failed -- but a failure only means something if the rule could only
    # have been satisfied the way it was tested. Where the code allows another
    # route the model cannot see, the failure is not evidence of
    # non-compliance, and reporting one would be asserting more than has been
    # established. A PASS above is still a pass: that route was visible and
    # sufficient on its own.
    if rule.inconclusive_when:
        try:
            if bool(evaluate_expression(rule.inconclusive_when, item)):
                return Finding(
                    **base, status=STATUS_UNCHECKED, message="",
                    reason=_format(rule.inconclusive_reason, item),
                )
        except (_MissingFact, RuleError, ZeroDivisionError) as exc:
            return Finding(
                **base, status=STATUS_UNCHECKED, message="",
                reason=f"this rule failed, and whether that failure is "
                       f"conclusive could not be determined: {exc}",
            )
    return Finding(**base, status=STATUS_FAIL, message=_format(rule.message, item))
