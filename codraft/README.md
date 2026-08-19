# codraft

Draw a floor plan from a brief, and check it against the building code that
governs where it is being built.

```
$ codraft plan "3 bed 2 bath double storey house on a 40x60 ft plot in Lahore"

Jurisdiction : Lahore, Punjab, Pakistan
Authority    : Lahore Development Authority (LDA)
Rule packs   : baseline, pk-bylaws
Site controls: max_coverage_ratio=0.65, setback_front=3048, setback_rear=1524

Plot         : 223.0 m²
Footprint    : 69.4 m² (31% coverage)
Floor area   : 138.3 m² (FAR 0.62)

Written:
  out/plan.dxf   out/plan.ifc   out/plan.svg

Result: 1 failed of 99 checked (0 violations, 1 warnings); 0 could not be checked
```

It writes DXF for AutoCAD, IFC4 for Revit, ArchiCAD, Tekla and Solibri, SVG to
look at, and a compliance report where every finding cites the clause it came
from.

---

## What this is, and what it deliberately is not

There is no dataset of the world's building codes. No API, no open corpus.
Most national codes are copyrighted prose, many are not in English, and a
good number are not online in any form. Anything claiming to have "trained on
every country's building code" has not done that, and the numbers it gives you
for a bedroom in Karachi will be invented.

So codraft is built the other way round. It is **global in structure and
honest about its coverage**:

- Every country resolves — 203 of them, down to state, province, emirate or
  city where that changes the answer, plus a few hundred major cities by name.
- Each jurisdiction declares which code family governs it, who the authority
  having jurisdiction is, and where the official document is published.
- Where rules are **encoded**, you get a checked pass or fail with the clause.
- Where they are **not**, you get the governing code and the authority to ask,
  and the report says in plain words that nothing was checked against local law.

Every rule carries a confidence level, and the report prints it next to the
finding:

| confidence | means |
|---|---|
| `high` | read from the published code |
| `medium` | read from published guidance |
| `low` | commonly cited, not verified against the document |
| `seed` | indicative only — must be verified before use |

25 countries currently reach a rule pack beyond the practice baseline. The
other 178 get the baseline, the authority to contact, and no pretence.

**No output from codraft is a compliance certificate.** Absence of a finding is
not compliance — it may mean nothing was checked. A licensed architect or
engineer must review and stamp any drawing used for construction or submitted
for approval.

---

## Install

Python 3.11 or newer. No dependencies — not "few", none. DXF and IFC are text
formats and are written directly, so there is nothing to install that can fail
to install on the machine that needs it.

```bash
git clone <this repo> && cd codraft
pip install -e .
```

Or run it straight out of the tree:

```bash
PYTHONPATH=src python3 -m codraft.cli plan "..."
```

---

## Using it

```bash
# Draw and check
codraft plan "3 bed 2 bath double storey house on a 40x60 ft plot in Lahore"
codraft plan "small office for 30 people on a 30m x 40m plot in Dubai"
codraft plan "5 marla house in Karachi" --road north
codraft plan "clinic with 4 consulting rooms" --plot 25mx30m --location Nairobi

# Ask what governs somewhere, without drawing anything
codraft codes where Lahore
codraft codes where "Sao Paulo"
codraft codes list --search africa
codraft codes packs

# See the structured program a brief produced
codraft program "3 bed house in Lahore"
```

`plan` exits non-zero if any **violation** was found, so it drops straight into
a build pipeline.

Briefs understand plot sizes as `40x60 ft`, `12m x 18m`, `5 marla` and
`1 kanal`, and read bedroom, bathroom, storey, workstation and classroom
counts. Whatever it could not read, it tells you rather than assuming:

```
Not stated, so assumed or skipped:
  - No location found, so no jurisdiction can be resolved and no code rules
    will be applied. Name a city, state or country.
```

---

## How it is put together

The layers are kept strictly apart, which is the whole design:

```
program/   a brief becomes a structured list of spaces to provide
layout/    that list becomes exact geometry, by arithmetic not by guesswork
codes/     that geometry is checked against rules that cite their source
export/    the result is written as DXF, IFC, SVG and JSON
```

**Language models belong in `program/` only.** They are good at turning a messy
paragraph into a structured request, and bad at keeping a wall 3.2 m long
across four sentences. So they never decide a dimension. Feed a model the
schema from `codraft program --schema`, hand its JSON back with
`codraft plan --program`, and every field is validated before anything is
drawn. Dimensions are decided by the solver; compliance is decided by encoded
rules; neither asks a model what a corridor should measure.

**Everything is integer millimetres.** A wall that is 3500 long is 3500 in the
DXF, in the IFC and in the report. Imperial input converts through `Decimal`, so
32 in is exactly 813 mm rather than 812.9999999999999.

**The layout is a corridor spine, not a sliced rectangle.** Rooms hang off both
sides of the circulation. That is how small buildings are actually planned, and
it is what makes the result checkable: every room touches circulation, so it has
a door onto an egress route, and touches the perimeter, so it has a window.
Half the world's residential code is about those two facts.

**Rules are data.** A pack is a JSON file of conditions written against derived
facts, each carrying its clause, severity and confidence:

```json
{
  "id": "ibc.corridor.width",
  "clause": "IBC 2021 §1020.3",
  "scope": "space",
  "applies_when": "function == 'corridor'",
  "assert": "width_mm >= (1118 if occupants >= 50 else 914)",
  "confidence": "high",
  "message": "{name} is {width_mm} mm wide serving {occupants} occupants..."
}
```

Expressions run in a sandbox that understands arithmetic, comparisons and a
dozen named functions, and nothing else — no imports, no attribute access, no
calls out. Adding a jurisdiction means writing one of these files. It never
means touching the code that draws or solves.

---

## What is encoded today

| pack | rules | confidence | covers |
|---|---|---|---|
| `baseline` | 13 | mixed | practice checks applied everywhere, **not law anywhere** |
| `ibc-2021` | 9 | high | IBC egress geometry, occupant load, exit counts |
| `irc-2021` | 11 | high | IRC room sizes, light, egress, stairs |
| `uk-approved-documents` | 7 | medium | Approved Documents K, M, F — **England only** |
| `pk-bylaws` | 10 | seed | figures recurring across LDA/CDA/SBCA residential by-laws |
| `in-nbc-2016` | 9 | low | NBC 2016 Part 3 room requirements |

Facts the engine derives from the model: areas and least dimensions, clear
ceiling heights, glazing ratios, door clear widths, stair riser/going/pitch and
2R+G, occupant load from the pack's own factors, exit counts, site coverage and
FAR — and egress travel distance, walked through the graph of rooms joined by
doorways from the far corner of each room.

Two of those are approximations and say so in every report: clear ceiling
height assumes a slab thickness, and travel distance ignores furniture.

---

## Getting it into Revit

Two routes, and they are not equivalent:

- **Open the IFC.** Fast, and gives you the building as imported geometry.
- **Run the pyRevit script.** `src/codraft/export/revit/codraft_to_revit.py`
  reads the JSON model (`--formats json`) inside Revit and builds **native**
  levels, walls and rooms you can edit as ordinary content. It does not place
  doors, windows or stairs, because those need family types chosen for your
  project — the openings are all in the JSON if you want to script them
  against your own families.

---

## Adding a jurisdiction

1. Write `src/codraft/codes/rules/<name>.json`. Cite a clause on every rule and
   set `confidence` honestly — `seed` is the right answer far more often than
   it is comfortable.
2. Point the country or subdivision at it in
   `src/codraft/codes/build_registry.py`, then run that file to regenerate the
   registry.
3. `python3 -m unittest discover -s tests -t .` — the suite checks every pack
   loads, every rule expression parses, every rule cites a clause, and every
   country falls back to the baseline.

A subdivision that names its own `rule_packs` **replaces** what it inherited
rather than adding to it. Scotland is why: it sits under GB, whose packs include
the Approved Documents, which do not apply in Scotland at all.

---

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

39 tests. The ones worth knowing about: the solver's tiles must fill the
footprint exactly and never overlap (walls are derived from those adjacencies,
so a gap becomes a wall with nothing behind it); no room may ever be left
without a route to an exit; the rule sandbox must refuse six different escape
attempts; every reference in the IFC must resolve to a defined instance; and
`Somalia` must not resolve to Mali, which it did until word-boundary matching
replaced substring matching.

---

## What it does not do

Plan generation is one slice of a permit set. There is no structural sizing, no
MEP, no site survey, no soil or utility data, no fire strategy beyond egress
geometry, no energy modelling, no accessibility review beyond door widths, and
no cost. Rooms are rectangles on an orthogonal grid; there are no curved walls,
splayed corners or double-height spaces.

It is a co-pilot that takes a competent professional from a brief to a checked,
dimensioned starting point in seconds. It is not a replacement for the stamp,
and it is not trying to be.

## Licence

MIT.
