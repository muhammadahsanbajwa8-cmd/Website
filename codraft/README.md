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

It writes **dimensioned** DXF for AutoCAD, IFC4 for Revit, ArchiCAD, Tekla and
Solibri, SVG to look at, and a compliance report where every finding cites the
clause it came from. Ask for them and it draws **electrical and plumbing**
layouts from the same plan.

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

# Add services. Say so in the brief, ask for the sheets, or answer the
# question it asks you when the brief does not mention them.
codraft plan "3 bed house with electrical and plumbing in Lahore" --plot 40x60ft
codraft plan "3 bed house in Lahore" --plot 40x60ft --sheets architectural,electrical,plumbing

# Dimensions in feet and inches rather than millimetres
codraft plan "3 bed house in Texas" --plot 50x100ft --units imperial
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
ingest/    an existing PDF drawing is read back into geometry
library/   the builder's range, and whether a design goes on a block
program/   a brief becomes a structured list of spaces to provide
layout/    that list becomes exact geometry, by arithmetic not by guesswork
codes/     that geometry is checked against rules that cite their source
services/  electrical and plumbing layouts are derived from that geometry
annotate   dimension chains are read off the same wall centrelines
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

**Dimensions are the geometry, read along an axis.** They are derived from the
same wall centrelines the solver produced, so they cannot drift from what is
drawn. Each face carries a chain of running dimensions plus an overall, and the
chains are checked to close before they are returned — a chain that does not add
up to its overall is the one arithmetic error a drawing set must never contain,
because it is found by a builder with a tape measure rather than by anyone in
the office.

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
| `au-ncc-housing` | 9 | **high** | ABCB Housing Provisions — room heights, light, ventilation, stairs |
| `au-ncc-livable` | 3 | **high** | NCC 2022 livable housing — doorways, corridors |
| `au-ncc-vol1` | 5 | low | NCC Volume One, deliberately thin — see below |

Facts the engine derives from the model: areas and least dimensions, clear
ceiling heights, glazing ratios, door clear widths, stair riser/going/pitch and
2R+G, occupant load from the pack's own factors, exit counts, site coverage and
FAR — and egress travel distance, walked through the graph of rooms joined by
doorways from the far corner of each room.

Two of those are approximations and say so in every report: clear ceiling
height assumes a slab thickness, and travel distance ignores furniture.

---

## Electrical and plumbing

Two more sheets come off the same plan, drawn with the architecture greyed back
so the services read on top of it:

**Electrical** — ceiling lights on a grid sized to the room, fans in habitable
rooms, a switch beside every door with its leg drawn to what it controls,
socket outlets spread along the wall with the fewest openings, extract fans in
wet rooms, and a distribution board by the entrance with circuits routed back
to it along the circulation spine.

**Plumbing** — WCs, basins, showers, baths, sinks and washing machine points
drawn **at their real sizes**, packed along the wall by the width each one
actually needs, with a single soil-and-vent stack serving the floor and cold,
hot and waste runs drawn orthogonally back to it.

Both check themselves and say what is wrong rather than drawing over it:

```
From the services layout:
  - plumbing: Bathroom leaves about 213 mm of clear floor between the
    fittings. Codes commonly want 600 mm in front of a WC and to use a
    basin. The fittings fit on the walls; a person does not fit between them.
```

That warning is the point. A 3.8 m² bathroom can hold a WC, a basin and a
shower on its walls and still be a room nobody can stand up in, and the
drawing alone will not tell you.

**What these sheets are not.** They are schematic: they say what goes where and
what connects to what, which is a real stage of design work and the ceiling of
what can honestly be produced from a plan. Cable sizes, breaker ratings,
earthing and bonding, load calculations, pipe diameters, falls, flow rates,
vent sizing and trap seals are all absent, because none of them can be read off
a floor plan. A licensed electrical and plumbing engineer does that, and every
sheet says so in its notes block.

## Australia, and why it is the best case

Australia publishes its building code **free to the public** at
[ncc.abcb.gov.au](https://ncc.abcb.gov.au/). That is rare — most national codes
are copyrighted documents behind a paywall or not online at all — and it is the
reason the NCC packs cite real clauses at `high` confidence while Pakistan's sit
at `seed`.

Four things the registry is explicit about, because they change the answer:

- **Which edition.** NCC 2022 Amendment 2 is adopted from 29 July 2025. NCC 2025
  was published 1 May 2026 and is being adopted progressively. Confirm which one
  your state is on.
- **Which volume.** Volume Two plus the **ABCB Housing Provisions** covers Class
  1 and 10 — since NCC 2022 the dimensions live in the Housing Provisions, not
  in Volume Two itself. Volume One covers Class 2–9. Volume Three is the
  Plumbing Code, named in the registry but **not encoded**.
- **Which state.** Every state adopts with variations. NSW and WA deferred the
  livable housing provisions, so `codraft codes where Sydney` drops that pack
  while Melbourne keeps it.
- **Setbacks are not in the NCC.** They come from the council's planning scheme
  — ResCode in Victoria, the R-Codes in WA. So the Australian regime supplies
  **no site controls at all**, and says so rather than inventing them.

Volume One is thin on purpose. Its egress numbers turn on classification,
sprinklers, rise in storeys and effective height — none of which a floor plan
establishes. Only what survives without them is encoded, and nothing in that
pack claims `high` confidence.

## Packs shape the plan, not just judge it

A rule pack carries **design targets** as well as rules, and the builder gets
them before it draws:

```json
"design": {
  "door_clear_width_mm": 820,
  "glazing_ratio": 0.10,
  "stair_going_max_mm": 355
}
```

This exists because the first NCC run produced nine violations, every one of
them a default tuned for somewhere else — an 810 mm bathroom door is ordinary
in Lahore and illegal in Melbourne. Handing the targets to the builder means the
plan is drawn *trying* to comply, and the engine still checks whether it
managed. Nine became zero, and the same brief now produces a materially
different building in each place.

## Australia, end to end

Ask for a house in Australia and you get an Australian house: the vocabulary the
permit sets use, the construction the state builds in, and the lot shape the
survey actually shows.

```
$ codraft plan "4 bed 2 bath house in Perth" --plot 17mx32m --zone R20

Using the Australian project-home vocabulary.
Design targets: glazing_ratio=0.1, ventilation_ratio=0.05,
                stair_going_max=355, construction=double_brick

    Double Garage     45.4 m²    Master Suite   18.2 m²    Alfresco   16.0 m²
    Theatre           20.1 m²    WIP             7.1 m²    Portico     5.2 m²
```

**Vocabulary.** Master Suite, WIR, Ensuite, WIP, Passage, Alfresco, Portico,
Theatre, Double Garage, Store, Linen — taken from real permit sets, not
translated from somewhere else.

**Construction.** Perth builds double brick (110 mm internal leaf, 250 mm
external); the eastern states build brick veneer (90 / 240). Taking one for the
other puts every room out by 30–40 mm, which is enough to fail a minimum the
design would otherwise have met. The state's pack declares which, as regional
practice rather than as code.

**Zones, not areas.** A project home is not planned by fitting rooms to a
balance sheet of floor area — it is planned in zones, and the solver plans in
the same ones:

- **the front zone** across the street frontage: garage, portico, entry,
  theatre, store. The template says which rooms those are explicitly, because a
  theatre and a living room are the same *function* and only one belongs there.
- **the living zone** through the middle to the alfresco: living, dining,
  kitchen, walk-in pantry.
- **the bedroom wing** down one side, off the passage, with the ensuite and the
  walk-in robe following the bedrooms because they open off one.

The service rooms — bathroom, laundry, WC, linen — have no wing of their own and
go wherever the balance needs them.

Two properties fall out of zoning, and both are code matters rather than taste:
every habitable room reaches an external wall, so it can have a window; and
every room reaches the front door, so it can be walked out of. Splitting the
passage's two bands by area instead mixes the zones, and a bedroom ends up
behind a kitchen with no external wall — which is a violation of the NCC light
and ventilation rules, not an infelicity. `tests/test_zoning.py` asserts both
properties directly, because both are easy to break again by tuning the packer.

Two details carry more weight than they look:

*The front door has to sit over the passage.* The passage is laid out first and
the frontage set out around it, rather than the other way round. Put the entry
wherever there happened to be frontage going spare and the passage runs into the
back of the garage: every room behind the front door then fails the rule that it
can be walked out of. On a 12 × 28 m block that was eighteen violations on one
floor.

*Only one room in a pair touches the outside.* Where two small rooms share a
slice of a band, one of them is against the passage and has no external wall. So
two rooms that both need daylight are never paired, and where one of a pair needs
a window it takes the outer half — which half that is depends on which side of
the passage the band sits, since the outside is the low edge on one side and the
high edge on the other.

*Which forces the band to be interleaved.* Rooms pair with their neighbour in
the band's list. Left in program order the bedrooms sit together, none of them
can pair, every bedroom takes a full slice of the band's length, and a floor
with four of them runs out of house. So each room needing a window is sat next
to one that does not: bedroom against the outside wall, robe or ensuite inboard,
which is how these plans are drawn anyway. The entry, stair and living room keep
their place at the road end — move the stair away from the entry and the floor
above has no route out.

**What zoning cost, and what is still open.** Sweeping 360 combinations of
state, lot, storeys and bedrooms (`web/audit.mjs`), habitable rooms with no
external wall went to **zero** — that was the point. Rooms coming out under a
usable proportion went the other way, from 66 before zoning to 89 after, because
the correctness fix removes a degree of freedom: bedrooms could previously pair
with each other, which packed them tightly at the cost of leaving one windowless.
Interleaving recovers most of it (170 → 89) and the smallest habitable room in
the sweep is 5.1 m², against 6.0 before and 3.4 immediately after zoning.

The rest is a real limit rather than a tuning problem. On a 16 m-wide house a
single spine leaves 7.4 m bands, and a bedroom spanning one is 12 m² at 1.7 m
across — a corridor with a bed in it. A band is only ever two rooms deep, so a
one-corridor house wants to be about 12 m wide, and capping the frontage there
does measurably improve proportions. It also starves the double garage and
shrinks the rear yard below what a pool and its barrier need, which are real
requirements where the proportions are a preference. So the cap stays at 16 m
and the solver reports the band instead:

> The band on one side of the passage is 8706 mm deep and its rooms want about
> 4112 mm. They span it anyway, so they come out long and narrow. This is the
> limit of a single spine: a house this wide wants a second passage or an
> L-shaped plan.

Drawing that second passage is the next structural piece.

**Openings are the most worked-over part of a house**, and a plan that draws a
rectangle in a wall has described almost none of it. `codraft plan` writes a
door and window schedule beside the drawings:

```
WINDOW SCHEDULE
  MARK  CODE   SIZE (W x H)     SET OUT                                NO  LOCATION
  W01   1216   1690 x 1290      head 25c (2150 mm), sill 10c (860 mm)   2  Living
  W06   0608   820 x 602        head 25c (2150 mm), sill 18c (1548 mm)  1  WC
```

Heads and sills are given in **courses first**, because that is how the wall is
built — one course is 86 mm, and a head called up at 2100 gets laid at either
2064 or 2150 depending on which way the bricklayer rounds. Giving the course is
giving the answer; giving 2100 hands the trade a decision it should not have to
make. The size code reads height then width in units of 100 mm, the commoner
Australian convention — but suppliers differ, so the schedule carries the
millimetre sizes and says which way round the code reads. A schedule a supplier
can misread is worse than no schedule.

Windows are drawn as **units somebody can manufacture**, capped at 2400 mm with
a masonry pier between them. The first schedule this code produced had a 5206 mm
window in a bedroom; that is not a window, it is two with a pier between them,
and the pier is what the lintels bear on.

**What the schedule will not do** is the part that matters most about being
honest with a builder:

| | |
|---|---|
| Sizes and setting out | Derived. Every head and sill lands on a whole course. |
| Lintels | **Identified, never sized.** Which openings need one is geometry — any opening in a loadbearing wall does. What size it is depends on span, load and wind classification, which is engineering. |
| Flashing, DPC, insulation, sealing | **Specification, not geometry.** Listed against the standard that governs each — NCC Housing Provisions Part 7.3, AS 3700, AS 2047, AS 1288, AS 3660.1 — and labelled as items to be drawn, priced and built. Nothing here is verified, because none of it can be verified from a plan. |
| R-values | Not stated. They are set by climate zone and by which NCC edition the state has adopted. A test asserts no spec line contains one. |
| Columns and reinforcement | Not attempted at all. |

**Visual privacy, and the neighbours.** The `au-wa-privacy` pack checks major
openings against the R-Codes overlooking setbacks — 4.5 m from a bedroom or
study, 6 m from other habitable rooms, 7.5 m from an unenclosed balcony — but
only where the floor is more than 0.5 m above natural ground, so a
slab-on-ground single storey never triggers it and a first floor does.

The pack is deliberately reported as a **warning and never a violation**,
because the R-Codes swing a *cone of vision* — a 45° arc from each opening —
and what is checked here is the perpendicular distance to the boundary. That is
the cone at its worst case: a pass is meaningful, but a fail may still comply
once the cone is drawn across a corner of the lot rather than across the
neighbour. So a fail is a prompt to draw the cone, not a finding. Where the
distance cannot be worked out — a boundary not orthogonal to the wall — it is
left unknown and reported, rather than assumed to be zero.


**Irregular lots.** A Perth subdivision is full of splayed corners, battle-axe
legs and frontages surveyed as chords:

```
$ codraft fit --boundary "0,0 19783,0 22390,9465 9465,18000 0,12000" \
              --location Perth --zone R20

Lot          : 5 corners, 307 m² surveyed (bounding box 403 m²)
Buildable    : 16750 x 5500 mm (92 m²) after setbacks
```

307 m² against a 403 m² bounding box — a 31% overstatement, landing straight in
site cover, which is a percentage *of the lot*. The buildable area is the
largest rectangle clearing every boundary by its own setback, found by
rasterising rather than by offsetting the polygon, because offsetting goes wrong
on exactly the reflex corners battle-axe lots are made of. Which edge is the
frontage is decided by geometry, not by asking.

## Set out in brick courses, and elevations to match

Nothing vertical on a Perth permit set is given in millimetres first. Ceilings
are "28c", a window head is "25c", and the elevation carries
`CL 2435 (28c + PLATE)` — the millimetre figure is the derived one. A
bricklayer builds to courses, so a ceiling asked for at 2400 gets laid at 28
courses and finishes at 2434, and a tool that hands back 2400 is asking for a
dimension nobody will lay. Requirements always round **up**: 27 courses is 2348,
which fails the NCC by 52 mm through arithmetic rather than design.

`--elevations` draws all four, numbered from the street, with the levels called
up in courses beside them.

The whole vertical chain is validated against a real set — Redink's "The Trio",
28c ceilings at CL 2435, a 25° roof over an 11,690 span, overall height 5134:

```
28c = 2408 mm of brickwork, + 2726 rise = 5134 mm
the sheet states                          5134 mm
```

The roof springs from the top of the brickwork, not from the plate above it.
That is a 26 mm distinction, and it is the difference between reproducing a
real sheet exactly and being a plate out.

## Fit the builder's range first, generate second

A volume builder does not want a house invented for every enquiry. They sell a
catalogue — "The Murray", "The Hamilton" — and the real question on a block is
which of their designs will go on it.

```
$ codraft fit --lot 20mx36m --location Perth --zone R20

Planning     : max_coverage_ratio=0.5, min_outdoor_living_m2=30, setback_front=6000
Buildable    : 18000 x 29000 mm (522 m²) after setbacks

DESIGN                     VERDICT    COVER  SPARE W  SPARE D
the-murray                 fits       36.1%     4410     3810   score 72
starter-4b-single          fits       17.4%     9085    14168   score 35
starter-3b-single          no                                   407 mm too wide:
                                                                it needs 8407 mm and
                                                                the setbacks leave 8000
```

A "no" carries the number, because 407 mm over is a conversation with the
council and four metres over is a different design. `--generate` falls back to
designing one for the block when nothing in the range goes, and `--save` keeps
it for the next block like it.

A library is one JSON file per design in a directory — versionable, diffable,
reviewable, which matters when the thing being edited is what the company
sells. A design needs only a name, a width across the frontage and a depth to
be fittable; the full model is optional and only needed to draw and code-check
it. `codraft library seed` writes a starter range so the engine works before a
single design has been extracted.

**A fit is a fit on footprint and planning only.** It says the design goes
inside the setbacks and under the site cover. It says nothing about the NCC —
that is `codraft plan` on the chosen design.

## Planning is a different instrument from the building code

Setbacks, site cover and open space are not in the NCC. They come from state
planning codes, and codraft keeps them in separate packs that say so:

| Pack | Instrument |
|---|---|
| `au-wa-rcodes` | R-Codes (SPP 7.3) — **keyed by R-code**, so pass `--zone R20` |
| `au-vic-rescode` | ResCode Clause 54, as amended by VC282 (8 Sep 2025) |
| `au-nsw-codes-sepp` | Codes SEPP Housing Code — the complying-development pathway only |
| `au-qld-qdc` | QDC MP1.1 / MP1.2 — a new Queensland Housing Code was proposed for 1 Sep 2026 |

South Australia, Tasmania, the ACT and the NT have no pack, and borrow nobody
else's — there is a test for that.

## Reading drawings that already exist

`codraft survey` reads a PDF plan and reports what can be recovered from it:

```
$ codraft survey plan.pdf

Page 1  (612 x 792 pt)
  line work : 963 segments
  text      : 92 runs
  scale     : 1:202 (71.275 mm per point), 100% agreement
              Scale taken from 9 printed dimensions that agree to within 2%.
  dimensions: 9 read -- 3653, 1115, 3486, 3607, 2003, 1529, 8254
  walls     : 87 candidates -- 230 mm x36, 115 mm x30
  labels    : Bathroom, Bedroom, Corridor, Kitchen, Living, Stair, Store
```

The PDF reader is pure standard library — `zlib` is all PDF compression actually
needs. It recovers page geometry, every line segment, and text (including
ToUnicode maps, so subset-embedded fonts still yield readable dimensions).

**The rule that governs the whole thing: transcribe, never estimate.** Scale is
derived by matching a *printed* dimension string to the line it annotates and
dividing. It is never inferred from paper size — the same plan on A3 could be
1:50 or 1:100 and look identical, and a wrong scale produces confident, wrong
millimetres. A drawing with no dimensions on it gets **no measurements at all**,
and a message explaining why.

That is also the honest answer for a scanned drawing: a scan is identified as
one, and if it carries printed dimensions those can be read; if it does not,
there is nothing to measure and the tool says so instead of measuring pixels.

What a survey is *not*: a building model. Walls at this stage are pairs of
parallel lines, not walls that know what they separate. Getting from there to
something the code checker can run over needs room boundaries closed and
openings identified.

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

125 tests. The ones worth knowing about: the solver's tiles must fill the
footprint exactly and never overlap (walls are derived from those adjacencies,
so a gap becomes a wall with nothing behind it); every dimension chain must add
up to its overall; no room may ever be left without a route to an exit; every
services fixture must land inside the room it serves and every run must be
orthogonal; a bathroom too small for its fittings must produce a warning rather
than a drawing with a basin inside a bath; the rule sandbox must refuse six
different escape attempts; every reference in the IFC must resolve to a defined
instance; a Melbourne house must clear all 132 NCC checks; a PDF with geometry
but no dimensions must yield no measurements at all rather than a guessed
scale; and `Somalia` must not resolve to Mali, which it did until word-boundary
matching replaced substring matching.

---

## What it does not do

Plan generation is one slice of a permit set. There is no structural sizing, no
engineered MEP (the services sheets are schematic — see above), no site survey,
no soil or utility data, no fire strategy beyond egress geometry, no energy
modelling, no accessibility review beyond door widths, and no cost. Rooms are
rectangles on an orthogonal grid; there are no curved walls, splayed corners or
double-height spaces.

It is a co-pilot that takes a competent professional from a brief to a checked,
dimensioned starting point in seconds. It is not a replacement for the stamp,
and it is not trying to be.

## Licence

MIT.
