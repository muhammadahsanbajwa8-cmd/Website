# rules/ — planning and building values, by jurisdiction

`states/*.yaml` is one file per Australian state and territory, carrying the
fields the project brief asks for: setbacks, site coverage, height, private
open space, minimum room dimensions and ceiling heights, energy, and the
hazard standards.

## The rule these files exist to enforce

**No figure appears here without a source.** Where a value is present it came
from a rule pack in `src/codraft/codes/rules/` that cites its own instrument,
and it is marked `status: confirm` — present, but not yet checked by a person
against the current edition. Where no value exists it says `TODO` and is
marked `status: missing`. Nothing has been guessed.

`tests/test_state_rules.py` enforces it, including the case that matters most:
South Australia, Tasmania, the Northern Territory and the ACT have no pack
behind them, so any planning figure appearing in those four files was invented
somewhere and the test fails.

| status | meaning |
|---|---|
| `confirmed` | a person read it off the instrument, and `last_checked` says when |
| `confirm` | codraft carries the figure with a citation; the edition needs verifying |
| `missing` | nobody has supplied it, and nothing here has guessed one |

## Regenerating

Both files are **views**, not sources. Edit the pack, then:

```
python3 tools/build_state_rules.py     # rules/states/*.yaml
python3 tools/build_checklist.py       # rules/CHECKLIST.md
```

A test asserts that regenerating changes nothing, so a value hand-edited into
the YAML instead of into the pack fails the build rather than being silently
dropped at the next regeneration.

## These files drive the engine

`codraft.codes.states` reads them, and whatever they supply wins over the rule
packs — so a figure verified here overrides one inherited from a pack, and a
state with no pack behind it starts working the moment its file is filled in.

Only a value somebody stands behind is read: `status: missing` and `TODO` are
ignored. A half-filled file yields half the controls, and the missing half is
named rather than silently treated as zero.

**Where the essentials are missing, `codraft plan` refuses.** Setbacks and site
coverage are what give the solver an envelope; without them it fills the lot
and reports a coverage percentage that no rule was ever applied to. Adelaide
came out at 56% with no setbacks at all before this existed. The refusal names
the missing figures and points here. `--no-site-controls` overrides it and
stamps the result as a massing study.

A missing *height limit* is reported and does not refuse. That would be
pedantry rather than care.

## What to fill in first

`CHECKLIST.md` lists every outstanding value, grouped by jurisdiction. The
brief says to build the states you sell in first — those are the files to
complete before the others.
