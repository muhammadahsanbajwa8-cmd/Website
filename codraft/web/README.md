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
