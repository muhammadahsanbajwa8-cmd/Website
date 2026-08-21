# web — the conversational designer

`design-my-house.html` is a single self-contained page: a chat that asks for the
block and the brief, then draws a plan to the state's planning controls and the
parts of the NCC that can be read off a plan.

`engine.js` is the layout engine of `src/codraft/layout` ported to run in the
page, so the drawing appears without a round trip to a server. It is a port, not
a second implementation — when the solver changes, both change. Integer
millimetres throughout, as in the Python.

**One known divergence, measured rather than assumed.** The service core —
three bands with a passage down each side of the rooms that need no window —
is ported and present here, and across 66 lot-and-program combinations it
never fires: this packer's single spine never leaves three lit rooms reading
as passages, where the Python's does on 8 of 68. So the same brief can come
back with a different plan form depending on which engine drew it. That is
the failure mode this file exists to prevent, and it is not resolved. The
likely cause is that the two disagree about pairing — this one interleaves
each bedroom with the robe or ensuite that opens off it — but that has not
been confirmed, and until it is, neither engine's result should be taken as
what the other would produce.

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
