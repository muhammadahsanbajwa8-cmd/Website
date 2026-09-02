# web — the conversational designer

`design-my-house.html` is a single self-contained page: a chat that asks for the
block and the brief, then draws a plan to the state's planning controls and the
parts of the NCC that can be read off a plan.

`engine.js` is the layout engine of `src/codraft/layout` ported to run in the
page, so the drawing appears without a round trip to a server. It is a port, not
a second implementation — when the solver changes, both change. Integer
millimetres throughout, as in the Python.

**The divergence that was here is fixed, and the guess about it was wrong.**
This file previously recorded that the service core never fired in this
engine and guessed the cause was a disagreement about pairing. It was not.
The two engines were sizing different houses: `target` here returned the
room's MINIMUM area, where the Python aims at the PREFERRED one where a
template gives it. So the page drew a 24 m2 living room and a 11 m2 bedroom
where the CLI drew 32 and 12, and a house 18 m2 smaller from the same brief.
The minimum is the floor a room may not go under, not the size anybody
wants. With `prefer` ported, the two programs now agree to 0.1 m2 and the
core fires on 13 of 66 combinations here instead of none.

Two things followed from the fix and are worth knowing before reading the
numbers below. Fewer plans draw (292 to 279) and more are refused (68 to
81), because the houses are now their proper size and a proper-sized house
does not fit as often -- that is the refusal working, not a regression. And
`feasible.mjs` went from 0 packing losses to 2: both are a 2-bedroom brief
on a 15 x 30 m lot, both were always there, and minimum-sized rooms were
hiding them. The Python loses the same case and declares it.

`audit.mjs` sweeps 360 combinations of state, lot, storeys and bedrooms and
reports habitable rooms that came out under their declared minimum.
`coverage.mjs` runs the same sweep and asserts the property that actually
matters: that every undersized room is NAMED in the plan's notes. A squeezed
room the customer is told about is a stated limitation; the same room in
silence is a lie. That number must stay at zero.

`feasible.mjs` splits the failures into the two kinds that need different
answers -- floors genuinely short of area (the brief does not fit, and saying
so is correct) and floors where the area was there and the packing lost it
(a bug worth chasing). Run all three after any change to the packer:

    cd web && ln -sfn /path/to/node_modules node_modules
    node audit.mjs && node coverage.mjs && node feasible.mjs

The page is built by splicing `engine.js` into the `<script>` block of
`design-my-house.html`, replacing everything from the top of the script down to
the `/* ---- drawing the plan ---- */` marker.

## Where the sweeps stand

    cases drawn 317 | refused 43
    cases with an undersized habitable room: 31
      of those, every undersized room named in the notes: 31
      cases with at least one UNDECLARED undersized room: 0
    with a room that has no route to circulation: 0
    undersized where the floor is genuinely SHORT of area: 31
    undersized where the area was there and the PACKING lost it: 0
    cases over their own site-cover cap: 0
    garages that hold two cars: 174 of 317

The garage column is now kept where the strip across the frontage CANNOT
give the garage the depth a car parks along, even when it does not score
better -- `frontZone` sizes the strip to what a car needs and then caps it
at a third of the floor's depth, and the cap wins. That took garages
holding two cars from 42 of 317 to 174, too narrow 144 -> 103, too shallow
187 -> 59.

It cost undersized habitable rooms 13 -> 31. Every one is named in the
notes, and `feasible.mjs` puts all 31 on floors GENUINELY SHORT of area
rather than floors the packing lost -- which is the kind the plan is right
to report. Packing losses are still 0 and no room lost its route.

A room across the street frontage is now shed LAST, matching the Python.
Shedding one frees no floor: the front strip is a reserved rectangle as deep
as the garage, and what the front rooms do not fill is handed to the portico
or the entry. Front rooms are now shed on 148 of the 317 cases instead of
174, and the portico's total area over the sweep is 3718 m2 against 3788.
The headline numbers below did not move.

The porch mean of 11.7 m2 that reading this against the Python's 9.0
suggested is not a divergence, and the comparison was not a fair one: the
two sweeps run different lots, and this one runs four other states. Over
the SAME six lots at WA R20, the Python draws 67 plans with a porch
averaging 10.2 m2 and a worst of 28.9, and this engine draws 64 with 11.1
and 30.2. The remaining gap is three plans one engine draws and the other
refuses, not a difference in how either sizes a porch.

What both are doing is the same structural thing, and it is not a port
problem: on a 10.5 m frontage the strip is 13 m by 6.7 m for front rooms
that want 8 m of it, and the only rooms that can absorb the rest are the
porch and the hall.

Twenty-four more plans draw than before the WC was widened to hold a pan,
and thirteen of the 317 have an undersized habitable room against six of
293 -- which is what drawing more marginal plans looks like, not a
regression. Every one is still named in the notes.

Nineteen fewer plans draw than before site cover was measured over the
walls, and that is the fix working rather than a regression: 125 of the 311
this engine used to draw were over their cover cap by up to 2.7 percentage
points, and every one of them said it complied.

The packing losses are gone. Every undersized habitable room left is on a
floor genuinely short of area, which is the kind the plan is right to
report rather than pack away. The last two went with the garage column and
with scoring plan forms on the baseline pack's habitable targets.

These moved a long way when `shedExtras` landed -- 279 drawn / 81 refused
became 310 / 50, and undersized habitable rooms 23 cases to 13 while twelve
more plans draw. Two things did it: dropping the extras a floor cannot hold
before squeezing the rooms it must, and asking the "does this fit at all"
question AFTER the extras have gone rather than before. Asked first it
refused briefs the shed can rescue.
