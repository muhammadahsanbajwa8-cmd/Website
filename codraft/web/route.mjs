/* Which plans are drawn with a room nobody can walk into.
 *
 * The other sweeps here measure how big rooms came out. This one measures
 * whether they can be entered, which matters more: `baseline.route.exists`
 * is the one finding that makes every other finding on the page irrelevant,
 * and the browser engine has no equivalent of the rule engine behind the
 * CLI -- it draws the plan and says nothing.
 *
 * Doors are not modelled in engine.js, but the rule the Python hangs them by
 * is fixed and can be applied to the tiles. A room opens onto a circulation
 * neighbour if it has one; otherwise it opens into a room that ALREADY has a
 * route, taking the widest such wall. One door, not a choice of them. So the
 * question this answers is whether the tiling admits any door assignment
 * that reaches the passage -- and where it does not, no arrangement of doors
 * will save it, because there is no room to open into that leads anywhere.
 *
 * Working outwards from circulation is the whole point. Picking the widest
 * neighbour instead picks a room for being big rather than for leading
 * somewhere, which is how five bedrooms in a row came to open into each
 * other with no way out. `walls.py` had that bug and no longer does.
 *
 * Tiles, not clear rects. Tiles meet exactly edge to edge; clear rects are
 * inset by half a wall each, share no edge with anything, and make every
 * room in the house look stranded.
 *
 *     cd web && node route.mjs
 */
import { readFileSync } from 'fs';

const src = readFileSync(new URL('./engine.js', import.meta.url), 'utf8');
const design = new Function(src + '\nreturn design;')();

const CIRC = new Set(['corridor', 'entry', 'stair', 'lobby']);
// A shared wall shorter than this will not take a door, so it is not a way in.
const DOORABLE = 900;

export function stranded(cells) {
  const R = cells.map(c => ({ fn: c.r.fn, name: c.r.name, ...c.rect }));
  const shared = R.map(() => ({}));
  for (let i = 0; i < R.length; i++)
    for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      let run = 0;
      if (a.x + a.w === b.x || b.x + b.w === a.x)
        run = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      else if (a.y + a.h === b.y || b.y + b.h === a.y)
        run = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (run >= DOORABLE) { shared[i][j] = run; shared[j][i] = run; }
    }

  const circ = new Set(R.map((r, i) => CIRC.has(r.fn) ? i : -1).filter(i => i >= 0));
  if (!circ.size) return [];

  // Outwards from circulation: a room may only open into a room that
  // already has a route, and among those it takes the widest wall.
  //
  // One LAYER at a time. Adding each room to `reached` the moment it is
  // settled makes the answer depend on the order the rooms happen to be in:
  // a bedroom between a bathroom reached earlier in the same pass and a robe
  // reached later in it sees only the bathroom. Both are the same distance
  // from circulation, so both belong to the same layer and the widest wall
  // should decide. Same rule as `_openings_for_storey` in
  // src/codraft/layout/walls.py.
  const door = {};
  const reached = new Set(circ);
  for (;;) {
    const layer = {};
    for (let i = 0; i < R.length; i++) {
      if (reached.has(i)) continue;
      const towards = Object.keys(shared[i]).map(Number).filter(j => reached.has(j));
      if (!towards.length) continue;
      layer[i] = towards.reduce((m, j) => shared[i][j] > shared[i][m] ? j : m, towards[0]);
    }
    const found = Object.keys(layer);
    if (!found.length) break;
    for (const i of found) { door[i] = layer[i]; reached.add(Number(i)); }
  }

  const out = [];
  for (let i = 0; i < R.length; i++) {
    if (circ.has(i)) continue;
    const seen = new Set();
    let at = i;
    while (at in door && !seen.has(at)) { seen.add(at); at = door[at]; }
    if (!circ.has(at)) out.push(R[i].name);
  }
  return out;
}

const states = [['WA','R20'], ['WA','R40'], ['VIC',null], ['NSW',null], ['QLD',null]];
const lots = [[10000,28000], [12000,32000], [15000,30000],
              [18000,35000], [20000,40000], [9000,24000]];

let cases = 0, bad = 0;
const found = [];
for (const [st, z] of states)
  for (const [w, d] of lots)
    for (const storeys of [1, 2, 3])
      for (const bd of [2, 3, 4, 5]) {
        const o = design({ state: st, zone: z || 'R20', lotW: w, lotD: d, storeys,
                           bedrooms: bd, bathrooms: 2, garage: 2, theatre: bd > 3,
                           study: false, alfresco: true, pool: false });
        if (o.error) continue;
        cases++;
        const names = o.plan.storeys.flatMap(cells => stranded(cells));
        if (names.length) {
          bad++;
          found.push(`${st} ${w/1000}x${d/1000} ${storeys}fl ${bd}bd :: ${names.join(', ')}`);
        }
      }

console.log(`cases drawn ${cases} | with a room that has no route to circulation: ${bad}`);
found.forEach(f => console.log('   ', f));
