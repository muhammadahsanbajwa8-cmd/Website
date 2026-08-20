# web — the conversational designer

`design-my-house.html` is a single self-contained page: a chat that asks for the
block and the brief, then draws a plan to the state's planning controls and the
parts of the NCC that can be read off a plan.

`engine.js` is the layout engine of `src/codraft/layout` ported to run in the
page, so the drawing appears without a round trip to a server. It is a port, not
a second implementation — when the solver changes, both change. Integer
millimetres throughout, as in the Python.

`audit.mjs` sweeps 360 combinations of state, lot, storeys and bedrooms and
reports habitable rooms that came out under their declared minimum. Run it after
any change to the packer:

    cd web && ln -sfn /path/to/node_modules node_modules && node audit.mjs

The page is built by splicing `engine.js` into the `<script>` block of
`design-my-house.html`, replacing everything from the top of the script down to
the `/* ---- drawing the plan ---- */` marker.
