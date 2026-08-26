/* codraft's layout engine, ported to run in the page.
   Mirrors src/codraft/layout: footprint sized to the frontage, a front zone
   across the street, then a corridor spine with rooms either side. Integer
   millimetres throughout, as in the Python, so a wall that is 3500 long is
   3500 everywhere. */

// WALL_ALLOW is the WORST case, not the average: a tile gives up half a wall
// on each side and an exterior wall (230) against an interior one (115) takes
// 172 mm. At 115 a linen press asking for 600 got a 715 tile and was drawn at
// 543, under what it asked for, with nothing reporting it.
// UNBUILDABLE is the line below which there is no room at all: a 720 mm door
// leaf will not fit, so nothing can get in.
const COURSE = 86, PLATE = 26, WALL_ALLOW = 172, MIN_DIM = 900;
const UNBUILDABLE = 600, MIN_TILE = UNBUILDABLE + 172;

// Rooms that must touch BOTH the outside and the circulation, and so cannot be
// one half of a pair. Pairing the entry with a store put the store on the
// passage and left the entry opening only into the store, which cut the route
// out of the house.
const NEVER_PAIRED = new Set(["entry", "lobby", "corridor", "stair", "garage"]);

// Where the packer reports a band it could not serve. Reset per layout, read
// back with the plan's other notes -- the same warnings list the Python
// solver carries, minus the plumbing of passing it down four call levels.
let PACK_WARNINGS = [];
const packWarn = note => { if (!PACK_WARNINGS.includes(note)) PACK_WARNINGS.push(note); };

// The widest frontage a two-band corridor plan can use. Band depth is
// (frontage - passage) / 2, and that depth becomes the width of every room
// off the passage -- past about 6.5 m a bedroom arrives as 2.0 x 6.0, which
// is a corridor with a bed in it. A limit of the corridor model, not of
// houses: a genuinely wide house is planned as an L or a U, which this does
// not do, so on a wide lot it builds narrower and deeper instead.
const MAX_FRONTAGE = 14000;

// Rear yard kept clear before that cap gives way. Depth comes straight out
// of the back garden, which is where the outdoor living goes and where a
// pool goes if there is one.
const MIN_REAR_YARD = 7000;
const CONSTRUCTION = {
  double_brick: { ext: 230, int: 90 }, brick_veneer: { ext: 240, int: 90 },
};

const PLANNING = {
  WA: { name: "Western Australia", zoned: true, construction: "double_brick",
        cover: { R20:.5, R25:.5, R30:.55, R40:.6, R60:.7, R80:.75 },
        outdoor: { R20:30, R25:30, R30:24, R40:20, R60:16, R80:12 },
        front: { R20:6000, R25:6000, R30:4000, R40:4000, R60:2000, R80:2000 },
        rear: 1000, side: 1000, code: "R-Codes (SPP 7.3)", livable: false },
  VIC: { name: "Victoria", zoned: false, construction: "brick_veneer",
         cover: { default:.6 }, outdoor: { default:25 }, front: { default:6000 },
         rear: 3000, side: 1000, code: "ResCode Clause 54", livable: true },
  NSW: { name: "New South Wales", zoned: false, construction: "brick_veneer",
         cover: { default:.5 }, outdoor: { default:24 }, front: { default:4500 },
         rear: 3000, side: 900, code: "Codes SEPP Housing Code", livable: false },
  QLD: { name: "Queensland", zoned: false, construction: "brick_veneer",
         cover: { default:.5 }, outdoor: { default:24 }, front: { default:6000 },
         rear: 3000, side: 1500, code: "QDC MP1.1 / MP1.2", livable: true },
};

const ceilingAt = c => c * COURSE + PLATE;
const coursesFor = mm => Math.max(0, Math.ceil((mm - PLATE) / COURSE));
const tileArea = a => a <= 0 ? 0 : Math.pow(Math.round(Math.sqrt(a)) + WALL_ALLOW, 2);
const tileW = w => w ? w + WALL_ALLOW : 0;

/* ---- the brief becomes rooms ---- */
function buildProgram(a) {
  // `prefer` is the size the room wants; `area` is the floor it may not go
  // under. Both come from src/codraft/program/templates.py -- this list is a
  // port of that template, not a second opinion about how big a bedroom is.
  const R = (key, name, fn, area, width, opt = {}) => ({
    key, name, fn, minArea: area * 1e6, minWidth: width,
    ...opt, preferArea: (opt.prefer || 0) * 1e6 });
  const rooms = [];
  const upper = a.storeys > 1;

  rooms.push(R("portico", "Portico", "entry", 4, 1500, { zone: "front", storey: 0 }));
  rooms.push(R("entry", "Entry", "entry", 6, 1500, { zone: "front", storey: 0, solo: true }));
  rooms.push(R("passage", "Passage", "corridor", 12, a.livable ? 1000 : 1000));
  rooms.push(R("living", "Living", "living", 24, 3600, { storey: 0, prefer: 32 }));
  rooms.push(R("dining", "Dining", "dining", 14, 3000, { storey: 0, prefer: 18 }));
  rooms.push(R("kitchen", "Kitchen", "kitchen", 12, 3000, { storey: 0 }));
  rooms.push(R("wip", "WIP", "storage", 4, 1400, { storey: 0 }));
  rooms.push(R("master", "Master Suite", "bedroom", 16, 3400,
               upper ? { storey: 1, prefer: 18 } : { prefer: 18 }));
  rooms.push(R("wir", "WIR", "storage", 5, 1600, upper ? { storey: 1 } : {}));
  rooms.push(R("ensuite", "Ensuite", "bathroom", 6, 1800, upper ? { storey: 1 } : {}));

  for (let i = 2; i <= a.bedrooms; i++)
    rooms.push(R("bed" + i, "Bed " + i, "bedroom", 11, 3000,
                 upper ? { storey: 1, prefer: 12 } : { prefer: 12 }));
  for (let i = 2; i <= a.bathrooms; i++)
    rooms.push(R("bath" + i, i === 2 ? "Bathroom" : "Bath " + i, "bathroom", 6, 1800,
                 upper ? { storey: 1 } : {}));

  rooms.push(R("wc", "WC", "wc", 1.8, 900, { storey: 0 }));
  rooms.push(R("laundry", "Laundry", "utility", 7, 1800, { storey: 0 }));
  rooms.push(R("linen", "Linen", "storage", 1.5, 600));
  if (a.theatre) rooms.push(R("theatre", "Theatre", "living", 14, 3400, { zone: "front", storey: 0 }));
  if (a.study) rooms.push(R("study", "Study", "office", 9, 2700, { storey: 0 }));
  if (a.alfresco) rooms.push(R("alfresco", "Alfresco", "alfresco", 15, 3000, { storey: 0 }));
  if (a.garage) {
    rooms.push(R("garage", a.garage === 1 ? "Garage" : "Double Garage", "garage",
                 a.garage === 1 ? 20 : 36, 3200, { zone: "front", storey: 0, solo: true }));
    rooms.push(R("store", "Store", "storage", 4, 1500, { zone: "front", storey: 0 }));
  }
  // No storey pin: `assignStoreys` replicates circulation onto every floor,
  // and it can only do that for rooms that have not already been pinned to
  // one. Pinned to storey 0, the stair was drawn on the ground floor alone --
  // the floors above had no flight on them at all, and got the stair's 10 m2
  // of floor area to fill with rooms, which is floor that is not there.
  if (a.storeys > 1) rooms.push(R("stair", "Stair", "stair", 10, 2200, {}));
  return rooms;
}

const HABITABLE = new Set(["bedroom","living","dining","kitchen","office"]);

// A room that needs daylight needs an external wall. Only one room in a
// shared slice of a band touches the outside, so this decides both what may
// be paired and which half of a pair goes against the wall.
const needsLight = r => HABITABLE.has(r.fn);

// Which wing of the house a room belongs to. A project home is planned in
// zones, not by area: garage and entry across the frontage, living through
// the middle to the alfresco, bedrooms down one side off the passage.
const SLEEP_WING = new Set(["bedroom"]);
const LIVE_WING = new Set(["living","dining","kitchen","alfresco","office"]);
const wing = r => SLEEP_WING.has(r.fn) ? "sleep" : LIVE_WING.has(r.fn) ? "live" : "either";

// An ensuite or a walk-in robe opens off a bedroom, not off the living room.
const BEDSIDE = new Set(["ensuite","wir","bathroom","bath","linen"]);
const WET = new Set(["bathroom","wc","kitchen","utility"]);
const CIRC = new Set(["corridor","entry","stair","lobby"]);
// The tile area to aim for: what was PREFERRED, else what was required.
//
// Without the first half, every room is built to its bare minimum. That is
// what this engine did, and it is why the page drew a house 18 m² smaller
// than the CLI drew from the same brief -- a 24 m² living room where the
// Python gives 32, and a bedroom at 11 where it gives 12. The minimum is the
// floor a room may not go under, not the size anybody wants it.
const target = r => tileArea(Math.max(r.minArea, r.preferArea || 0));

/* ---- rooms onto storeys ---- */
function assignStoreys(rooms, storeys) {
  if (storeys === 1) return rooms.map(r => ({ ...r, at: 0 }));
  const out = [], load = new Array(storeys).fill(0);
  const ground = new Set(["entry","living","dining","kitchen","garage","alfresco","utility"]);
  for (const r of rooms) {
    if (r.storey != null) { out.push({ ...r, at: Math.min(r.storey, storeys - 1) }); continue; }
    if (CIRC.has(r.fn)) continue;                       // replicated below
    if (ground.has(r.fn)) { out.push({ ...r, at: 0 }); load[0] += target(r); continue; }
    let best = 1;
    for (let i = 1; i < storeys; i++) if (load[i] < load[best]) best = i;
    out.push({ ...r, at: best }); load[best] += target(r);
  }
  for (const r of rooms) {
    if (!CIRC.has(r.fn) || r.fn === "entry" || r.storey != null) continue;
    for (let s = 0; s < storeys; s++) out.push({ ...r, key: r.key + "_l" + s, at: s });
  }
  return out;
}

/* ---- outdoor living ---- */
// The largest SINGLE rectangle of open ground outside the street setback.
//
// Not (lot - footprint), which is what this used to report: that sums the
// front setback and both 1 m side ribbons into one figure and ticks it green
// against a control none of them satisfies. Two 20 m² ribbons down opposite
// boundaries are not a 40 m² outdoor living area, and adding them says they
// are. The front is excluded because the control is about the back.
//
// The R-Codes set an area AND a minimum dimension. Only the area is carried
// here, so the dimension is reported as measured-but-unchecked rather than
// folded into a pass -- an area met by a long thin strip does not comply.
function outdoorLiving(lot, foot) {
  // The lot runs from (0, 0) to (lot.w, lot.d) and the street is at y = 0,
  // which is why "front" is not one of the candidates below.
  const strips = {
    rear:  [lot.w, lot.d - (foot.y + foot.h)],
    left:  [foot.x, lot.d],
    right: [lot.w - (foot.x + foot.w), lot.d],
  };
  let bestWhere = "rear", best = strips.rear;
  for (const [where, size] of Object.entries(strips))
    if (size[0] * size[1] > best[0] * best[1]) { bestWhere = where; best = size; }
  const [w, h] = best;
  return { m2: Math.max(0, w) * Math.max(0, h) / 1e6,
           minDim: Math.max(0, Math.min(w, h)), where: bestWhere };
}

/* ---- the service core ---- */
// How badly a layout treats the rooms that need daylight: (how many read as a
// passage, by how much in total). Lower is better. Only lit rooms count -- a
// robe is allowed to be a slot, and counting those would let a layout win by
// rounding out the bathrooms.
function awkward(cells) {
  let count = 0, excess = 0;
  for (const c of cells) {
    if (!c.r || !needsLight(c.r)) continue;
    const short = Math.max(1, Math.min(c.rect.w, c.rect.h));
    const ratio = Math.max(c.rect.w, c.rect.h) / short;
    if (ratio > 2.2) { count += 1; excess += Math.round((ratio - 2.2) * 1000); }
  }
  return [count, excess];
}
const better = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

// Three bands: band / passage / core / passage / band.
//
// A single spine puts every room across one of two bands, so on a wide
// frontage each band is half the frontage deep and every room spans it -- a
// bedroom comes out 7161 × 2127. Pairing cannot help: two rooms that both
// need daylight can never share a slice, and a sleep wing is nothing but
// rooms that need daylight. So the rooms that need no window go in the middle
// with a passage down each side.
//
// The two passages must JOIN. Separated by a core spanning the whole run, the
// far one is reachable only through a bathroom and every room beyond it has no
// route out. The core band carries a LINK at one end instead, which keeps the
// tiling exact and reuses the same stacker.
function coreBands(L, Rr, corridor, envelope, vertical, cw, run, order, storeyIndex) {
  const lit = L.concat(Rr).filter(needsLight);
  const unlit = L.concat(Rr).filter(r => !needsLight(r));
  const litL = L.filter(needsLight), litR = Rr.filter(needsLight);
  if (unlit.length < 3 || !litL.length || !litR.length) return null;

  const usable = (vertical ? envelope.w : envelope.h) - 2 * cw;
  const coreArea = unlit.reduce((t, r) => t + (target(r) || 0), 0);
  let coreDepth = Math.max(MIN_DIM + WALL_ALLOW, Math.ceil(coreArea / Math.max(1, run)));
  coreDepth = Math.min(coreDepth, usable - 2 * (MIN_DIM + WALL_ALLOW));
  if (coreDepth < MIN_DIM + WALL_ALLOW) return null;

  const spare = usable - coreDepth;
  const la = litL.reduce((t, r) => t + (target(r) || 1), 0);
  const ra = litR.reduce((t, r) => t + (target(r) || 1), 0);
  const ld = Math.max(MIN_DIM + WALL_ALLOW,
    Math.min(spare - (MIN_DIM + WALL_ALLOW),
             Math.floor(spare * la / Math.max(1, la + ra))));
  const rd = spare - ld;

  // The link is the corridor requirement again, so it is as wide as a passage
  // has to be and is checked as one.
  const link = { ...corridor, key: String(corridor.key) + "_link" };
  const coreRooms = order(unlit).concat([link]);

  let placed, near, far;
  if (vertical) {
    near = { x: envelope.x + ld, y: envelope.y, w: cw, h: envelope.h };
    const coreBand = { x: near.x + cw, y: envelope.y, w: coreDepth, h: envelope.h };
    far = { x: coreBand.x + coreDepth, y: envelope.y, w: cw, h: envelope.h };
    placed = stack(order(litL), { x: envelope.x, y: envelope.y, w: ld, h: envelope.h }, true, true)
      .concat(stack(coreRooms, coreBand, true))
      .concat(stack(order(litR), { x: far.x + cw, y: envelope.y, w: rd, h: envelope.h }, true, false));
  } else {
    near = { x: envelope.x, y: envelope.y + ld, w: envelope.w, h: cw };
    const coreBand = { x: envelope.x, y: near.y + cw, w: envelope.w, h: coreDepth };
    far = { x: envelope.x, y: coreBand.y + coreDepth, w: envelope.w, h: cw };
    placed = stack(order(litL), { x: envelope.x, y: envelope.y, w: envelope.w, h: ld }, false, true)
      .concat(stack(coreRooms, coreBand, false))
      .concat(stack(order(litR), { x: envelope.x, y: far.y + cw, w: envelope.w, h: rd }, false, false));
  }
  return { placed, near, far };
}

/* ---- fitting rooms along a band ---- */
function apportion(spans, floors, total, warn) {
  const wanted = floors.reduce((a, b) => a + b, 0);
  if (wanted > total && total > 0) {
    // No allocation gives every row its floor, so the question is only who
    // pays. The loop below cannot reach that conclusion: with every row
    // already under its floor there are no donors to take from, so it breaks
    // out having changed nothing and leaves the area-proportional split
    // standing -- which is brutal to a small room. Three bedrooms on a
    // 15 x 28 m lot put the WC at 285 mm and the master at 2554, when the
    // honest answer is that both get about 61 per cent of what they need.
    const sizes = floors.map(f => Math.max(1, Math.floor(f * total / wanted)));
    let big = 0; sizes.forEach((v, i) => { if (v > sizes[big]) big = i; });
    sizes[big] += total - sizes.reduce((a, b) => a + b, 0);
    if (warn) warn(`A band is about ${((wanted - total) / 1000).toFixed(1)} m short of `
      + `what the rooms on it need. Every room on it was reduced to about `
      + `${Math.floor(total * 100 / wanted)} per cent of the length it asked for, so the `
      + `shortfall is shared rather than taken out of the smallest room.`);
    return sizes;
  }
  const sizes = spans.slice();
  for (let pass = 0; pass < sizes.length * 2 + 2; pass++) {
    const deficit = sizes.reduce((s, v, i) => s + Math.max(0, floors[i] - v), 0);
    if (deficit <= 0) break;
    const donors = sizes.map((v, i) => v > floors[i] ? i : -1).filter(i => i >= 0);
    const slack = donors.reduce((s, i) => s + sizes[i] - floors[i], 0);
    if (!donors.length || slack <= 0) break;
    for (const i of donors)
      sizes[i] -= Math.min(sizes[i] - floors[i], Math.floor((sizes[i] - floors[i]) * deficit / slack));
    for (let i = 0; i < sizes.length; i++) sizes[i] = Math.max(sizes[i], floors[i]);
  }
  let over = sizes.reduce((a, b) => a + b, 0) - total;
  if (over > 0) {
    // Take the excess from whatever sits above its own floor, most slack first.
    const order = sizes.map((v, i) => i).sort((a, b) => (sizes[b] - floors[b]) - (sizes[a] - floors[a]));
    for (const i of order) { if (over <= 0) break;
      const give = Math.min(over, Math.max(0, sizes[i] - floors[i])); sizes[i] -= give; over -= give; }
    // Still over means the storey is genuinely over-subscribed. Shrink every row
    // by the same proportion so the shortfall is shared, rather than crushing
    // whichever rows happen to sort last down to nothing.
    if (over > 0) {
      const tot = sizes.reduce((a, b) => a + b, 0);
      const k = Math.max(0, tot - over) / Math.max(1, tot);
      for (let i = 0; i < sizes.length; i++) sizes[i] = Math.max(MIN_DIM, Math.floor(sizes[i] * k));
      let diff = sizes.reduce((a, b) => a + b, 0) - total;
      for (let i = 0; diff > 0 && i < sizes.length; i++) {
        const g = Math.min(diff, Math.max(0, sizes[i] - MIN_DIM)); sizes[i] -= g; diff -= g; }
    }
  } else if (over < 0 && sizes.length) {
    let big = 0; sizes.forEach((v, i) => { if (v > sizes[big]) big = i; });
    sizes[big] += -over;
  }
  return sizes;
}

// `outerLow` says which edge of the band is the outside wall: true when it is
// the low edge (band.x for a vertical band, band.y for a horizontal one),
// false when the passage is on that side instead.
function stack(rooms, band, alongY, outerLow = true, pinned = null) {
  if (!rooms.length) return [];
  const span = alongY ? band.h : band.w, depth = alongY ? band.w : band.h;
  // A room's slice is proportional to its AREA, so a small room in a deep band
  // gets a short slice: a 4.8 m² WC on a 5.5 m band is 880 mm long and 5.5 m
  // deep, which is a corridor. Pairing two such rooms across the depth is what
  // fixes that, and it is what a real plan does.
  const isThin = r => {
    const s = Math.floor((target(r) || 1) / Math.max(1, depth));
    return s > 0 && depth / s > 2.2;
  };
  // Two rooms that both need daylight can never share a slice: one of them
  // would be against the passage with no external wall, which is how a bedroom
  // ends up in the middle of the plan. And a room that must touch BOTH the
  // outside and the circulation cannot be half a pair at all.
  const canPair = (a, b) =>
    !a.solo && !b.solo &&
    !NEVER_PAIRED.has(a.fn) && !NEVER_PAIRED.has(b.fn) &&
    tileW(a.minWidth) + tileW(b.minWidth) <= depth &&
    depth >= 2 * (MIN_DIM + WALL_ALLOW) &&
    !(needsLight(a) && needsLight(b));
  const hasRoomBehind = (thinR, host) =>
    depth - (tileW(thinR.minWidth) || MIN_DIM)
      >= Math.max(tileW(host.minWidth), MIN_DIM + WALL_ALLOW);

  const rows = [];
  const remaining = rooms.slice();
  while (remaining.length) {
    const r = remaining.shift(), t = target(r) || 1;
    if (!isThin(r) || r.solo) { rows.push({ rooms: [r], t }); continue; }
    // Search FORWARD for a partner rather than taking the next room. Ordering
    // is decided by zoning and by which rooms need daylight, so the room next
    // in line is very often solo or lit and cannot pair; refusing to look past
    // it left the small rooms strung out down the band.
    let j = remaining.findIndex(n => isThin(n) && canPair(r, n));
    // No thin partner left. Tuck the small room behind a large one instead,
    // which is what a plan does when it puts a WC in behind a bedroom.
    if (j < 0) j = remaining.findIndex(n => canPair(r, n) && hasRoomBehind(r, n));
    if (j < 0) { rows.push({ rooms: [r], t }); continue; }
    const n = remaining.splice(j, 1)[0];
    rows.push({ rooms: [r, n], t: t + (target(n) || 1) });
  }
  // A forward search cannot help the LAST room: an odd number of small rooms
  // strands whichever sorts last, and the WC sorts last on every sleep wing
  // this packer builds. Sweep back and merge it into a single row that can
  // carry it.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.rooms.length !== 1) continue;
    const r = row.rooms[0];
    if (r.solo || !isThin(r)) continue;
    const host = rows.findIndex((other, j) =>
      j !== i && other.rooms.length === 1 &&
      canPair(r, other.rooms[0]) && hasRoomBehind(r, other.rooms[0]));
    if (host < 0) continue;
    rows[host].rooms.push(r);
    rows[host].t += target(r) || 1;
    rows.splice(i, 1);
  }
  const totals = rows.reduce((s, r) => s + r.t, 0) || 1;
  const spans = rows.map(r => Math.max(1, Math.floor(span * r.t / totals)));
  const floors = rows.map(row => {
    let need = MIN_DIM + WALL_ALLOW;
    for (const r of row.rooms) need = Math.max(need, tileW(r.minWidth));
    const share = Math.floor(depth / Math.max(1, row.rooms.length));
    for (const r of row.rooms) if (r.minArea)
      need = Math.max(need, Math.ceil(tileArea(r.minArea) / Math.max(1, share)));
    return need;
  });
  const sizes = apportion(spans, floors, span, packWarn);

  // A row whose run was settled on another floor. The stair is the only one:
  // a flight has to take the same length of the same band on every floor it
  // passes through, or it arrives under the floor above. What is left is
  // apportioned again over the other rows, so the pin costs them length
  // rather than pushing the row off the end of the band.
  if (pinned) {
    for (let i = 0; i < rows.length; i++) {
      const key = rows[i].rooms.find(r => pinned[r.key] != null);
      if (!key) continue;
      const want = pinned[key.key];
      if (want === sizes[i]) break;
      const rest = rows.map((_, j) => j).filter(j => j !== i);
      const free = span - want;
      // Giving the flight MORE would take another row under its own
      // minimum, so this floor cannot honour the run. Taking length away
      // never can: whatever the flight gives up, the rest of the band gets,
      // so a shrinking pin is always allowed -- including on a band already
      // over-subscribed, where every row is under its floor and this test
      // would otherwise refuse a pin that helps them.
      if (want > sizes[i] && free < rest.reduce((t, j) => t + floors[j], 0)) break;
      sizes[i] = want;
      if (rest.length) {
        const share = apportion(rest.map(j => sizes[j]), rest.map(j => floors[j]),
                                free, packWarn);
        rest.forEach((j, k) => { sizes[j] = share[k]; });
      }
      break;
    }
  }

  const placed = []; let cursor = alongY ? band.y : band.x;
  rows.forEach((row, i) => {
    const s = sizes[i];
    if (row.rooms.length === 1) {
      placed.push({ r: row.rooms[0], rect: alongY
        ? { x: band.x, y: cursor, w: band.w, h: s } : { x: cursor, y: band.y, w: s, h: band.h } });
    } else {
      let [a, b] = row.rooms;
      // The outer slot has the external wall. Give it to whichever of the two
      // needs daylight; grouping has already refused to pair two that do.
      if (needsLight(b) && !needsLight(a)) { const t = a; a = b; b = t; }
      // When the low edge is the passage, the outer room is the second one
      // placed, so swap again to keep it against the wall.
      if (!outerLow) { const t = a; a = b; b = t; }
      const ta = target(a) || 1, tb = target(b) || 1;
      let da = Math.floor(depth * ta / (ta + tb));
      da = Math.max(tileW(a.minWidth) || MIN_DIM, Math.min(depth - (tileW(b.minWidth) || MIN_DIM), da));
      const db = depth - da;
      if (alongY) {
        placed.push({ r: a, rect: { x: band.x, y: cursor, w: da, h: s } });
        placed.push({ r: b, rect: { x: band.x + da, y: cursor, w: db, h: s } });
      } else {
        placed.push({ r: a, rect: { x: cursor, y: band.y, w: s, h: da } });
        placed.push({ r: b, rect: { x: cursor, y: band.y + da, w: s, h: db } });
      }
    }
    cursor += s;
  });
  return placed;
}

/* ---- the frontage, set out around the passage ---- */
// `over` is the x range the passage occupies, when there is one. The entry is
// the only thing joining the street frontage to the rest of the house, so it
// has to sit over that range. Getting this wrong is not cosmetic: every room
// behind the front door then fails the rule that it can be walked out of.
function placeFront(front, strip, over) {
  if (!front.length) return [];
  const entry = front.find(r => r.key === "entry" && r.fn === "entry")
             || front.find(r => r.fn === "entry");
  if (!over || !entry) {
    const ordered = front.slice().sort((a, b) =>
      (a.fn === "garage" ? 0 : 1) - (b.fn === "garage" ? 0 : 1));
    return stack(ordered, strip, false).map(p => ({ ...p, at: 0 }));
  }

  const [lo, hi] = over;
  let others = front.filter(r => r !== entry);
  let slotW = Math.max(tileW(entry.minWidth) || 0, hi - lo, MIN_DIM + WALL_ALLOW);
  if (entry.minArea)
    slotW = Math.max(slotW, Math.ceil(tileArea(entry.minArea) / Math.max(1, strip.h)));

  const leftMin = others.length ? MIN_DIM + WALL_ALLOW : 0;
  let slotX = Math.floor((lo + hi) / 2) - Math.floor(slotW / 2);
  slotX = Math.max(strip.x + leftMin, Math.min(strip.x + strip.w - slotW, slotX));
  if (slotX < strip.x) { slotX = strip.x; slotW = Math.min(slotW, strip.w); }

  let leftW = slotX - strip.x;
  let rightW = (strip.x + strip.w) - (slotX + slotW);

  // The portico is the roofed bit in front of the door. It belongs against the
  // entry, not wherever there was frontage going spare -- put it at the far
  // end and the front door has no covered approach and nothing can reach it.
  let portico = others.find(r => r.fn === "entry" && r !== entry) || null;
  let porticoRect = null;
  if (portico) {
    let want = Math.max(tileW(portico.minWidth) || 0, MIN_DIM + WALL_ALLOW);
    if (portico.minArea)
      want = Math.max(want, Math.ceil(tileArea(portico.minArea) / Math.max(1, strip.h)));
    const onLeft = leftW >= rightW;
    const available = onLeft ? leftW : rightW;
    let take = Math.min(want, Math.max(0, available - (MIN_DIM + WALL_ALLOW)));
    if (take < MIN_DIM + WALL_ALLOW) take = Math.min(want, available);
    if (take > 0) {
      if (onLeft) { porticoRect = { x: slotX - take, y: strip.y, w: take, h: strip.h }; leftW -= take; }
      else { porticoRect = { x: slotX + slotW, y: strip.y, w: take, h: strip.h }; rightW -= take; }
      others = others.filter(r => r !== portico);
    } else portico = null;
  }

  // The garage takes whichever side can hold it; the rest follow on the other,
  // which is how these frontages read -- garage, front door, theatre, store.
  const garage = others.find(r => r.fn === "garage") || null;
  const left = [], right = [];
  if (garage) {
    const gw = tileW(garage.minWidth) || MIN_DIM;
    if (leftW >= gw && leftW >= rightW) left.push(garage);
    else if (rightW >= gw) right.push(garage);
    else if (leftW >= rightW) left.push(garage);
    else right.push(garage);
  }
  let leftArea = left.reduce((t, r) => t + (target(r) || 1), 0);
  let rightArea = right.reduce((t, r) => t + (target(r) || 1), 0);
  for (const r of others.filter(r => r !== garage)
                        .sort((a, b) => (target(b) || 0) - (target(a) || 0))) {
    const leftRoom = leftW * strip.h - leftArea;
    const rightRoom = rightW * strip.h - rightArea;
    if ((leftRoom >= rightRoom && leftW > 0) || rightW <= 0) { left.push(r); leftArea += target(r) || 1; }
    else { right.push(r); rightArea += target(r) || 1; }
  }

  const placed = [{ r: entry, rect: { x: slotX, y: strip.y, w: slotW, h: strip.h } }];
  if (left.length && leftW > 0)
    placed.push(...stack(left, { x: strip.x, y: strip.y, w: leftW, h: strip.h }, false));
  let rightX = slotX + slotW;
  if (porticoRect && porticoRect.x >= slotX + slotW) rightX = porticoRect.x + porticoRect.w;
  if (right.length && rightW > 0)
    placed.push(...stack(right, { x: rightX, y: strip.y, w: rightW, h: strip.h }, false));
  if (portico && porticoRect) placed.push({ r: portico, rect: porticoRect });
  return placed.map(p => ({ ...p, at: 0 }));
}

/* ---- one storey ---- */
// `below` is what the ground floor settled, for the floors stacked on it: the
// shape it packed, where the spine sits in it, which side of the spine the
// flight is on, and how much of that band's run it takes. All four have to
// agree before a stair can arrive where it left from. Matching only the shape
// was tried and moved nothing -- the band split is decided by each floor's own
// room areas, so it lands somewhere else regardless.
function layoutStorey(rooms, env, storeyIndex, below = null, stairRun = null) {
  if (!rooms.length) return [];
  let cells = [], spineX = null, envelope = env, strip = null, frontRooms = [];

  if (storeyIndex === 0) {
    let front = rooms.filter(r => r.zone === "front");
    const garage = front.find(r => r.fn === "garage");
    if (garage && front.length >= 2) {
      // The frontage carries these rooms side by side, so it can only take as
      // many as its width allows at a usable size. A theatre across the front
      // is right on a 16 m frontage; on a 10 m one, behind the garage and the
      // front door, it comes out 1.5 m wide. Send it to the passage instead.
      const evicted = [];
      while (front.length > 2) {
        const need = front.reduce((t, r) => t + (tileW(r.minWidth) || MIN_DIM), 0);
        if (need <= env.w) break;
        const movable = front.filter(r => r.fn !== "garage" && r.fn !== "entry");
        if (!movable.length) break;
        let loose = movable[0];
        for (const r of movable)
          if ((r.priority ?? 5) > (loose.priority ?? 5) ||
              ((r.priority ?? 5) === (loose.priority ?? 5) &&
               (target(r) || 0) > (target(loose) || 0))) loose = r;
        front = front.filter(r => r !== loose);
        evicted.push(loose);
      }
      for (const r of evicted) r.zone = "";
      const widthShare = Math.max(tileW(garage.minWidth), 5600);
      let depth = Math.max(6000 + WALL_ALLOW, Math.ceil(target(garage) / widthShare));
      depth = Math.min(depth, Math.floor(env.h / 3));
      const frontArea = front.reduce((s, r) => s + (target(r) || 0), 0);
      if (frontArea < env.w * depth * 0.75)
        depth = Math.min(Math.max(6000 + WALL_ALLOW, Math.ceil(frontArea / env.w)), Math.floor(env.h / 3));
      if (depth >= 5000 && env.h - depth >= MIN_DIM * 3) {
        // Size the strip only. Where the entry goes depends on where the
        // passage behind it lands, and that is not known yet -- lay the
        // frontage out first and the passage runs into the back of the
        // garage, leaving every room behind the front door with no way out.
        strip = { x: env.x, y: env.y, w: env.w, h: depth };
        frontRooms = front;
        spineX = strip.x + Math.floor(strip.w / 2);
        envelope = { x: env.x, y: env.y + depth, w: env.w, h: env.h - depth };
        rooms = rooms.filter(r => r.zone !== "front");
      }
    }
  }
  if (below) { envelope = below.envelope; spineX = below.spineX; }

  if (!rooms.length) return strip ? placeFront(frontRooms, strip, null) : [];

  const corridor = rooms.find(r => r.fn === "corridor");
  const others = rooms.filter(r => r !== corridor);
  if (!corridor || others.length <= 2)
    return (strip ? placeFront(frontRooms, strip, null) : [])
      .concat(stack(rooms, envelope, envelope.h >= envelope.w).map(p => ({ ...p, at: storeyIndex })));

  let vertical = envelope.h >= envelope.w;
  if (spineX != null) vertical = true;
  let cw = Math.max(corridor.minWidth, 1000) + WALL_ALLOW;
  const cross = vertical ? envelope.w : envelope.h;
  if (cw >= cross - 2 * MIN_DIM) cw = Math.max(1000, Math.floor((cross - 2 * MIN_DIM) / 3));

  // Rooms go to a wing before they go to a band. Bedrooms take one side of
  // the passage and the living rooms the other, which is how these houses are
  // actually planned; splitting by area instead mixes them and a bedroom ends
  // up behind a kitchen with no external wall.
  const L = [], Rr = []; let la = 0, ra = 0;
  const byArea = rs => rs.slice().sort((a, b) => target(b) - target(a));
  const sleep = others.filter(r => wing(r) === "sleep");
  const live = others.filter(r => wing(r) === "live");
  let spare = others.filter(r => wing(r) === "either");

  if (!sleep.length || !live.length) {
    // Nothing to zone -- an upper floor of bedrooms, say. Balance by area.
    for (const r of byArea(others)) {
      if (la <= ra) { L.push(r); la += target(r) || 1; }
      else { Rr.push(r); ra += target(r) || 1; }
    }
  } else {
    L.push(...sleep); la = sleep.reduce((t, r) => t + (target(r) || 1), 0);
    Rr.push(...live);  ra = live.reduce((t, r) => t + (target(r) || 1), 0);
    // The ensuite and the robe follow the bedrooms, because they open off one.
    const follows = spare.filter(r => BEDSIDE.has(String(r.key).replace(/[0-9_].*$/, "")));
    spare = spare.filter(r => !follows.includes(r));
    for (const r of follows) { L.push(r); la += target(r) || 1; }
    for (const r of byArea(spare)) {
      if (la <= ra) { L.push(r); la += target(r) || 1; }
      else { Rr.push(r); ra += target(r) || 1; }
    }
  }
  // The flight goes on the side the ground floor put it.
  if (below) {
    const want = below.stairLeft ? L : Rr, other = below.stairLeft ? Rr : L;
    for (const r of other.filter(r => r.fn === "stair")) {
      other.splice(other.indexOf(r), 1);
      want.unshift(r);
    }
  }
  const usable = cross - cw;
  const run = vertical ? envelope.h : envelope.w;

  // How deep a band has to be before the rooms on that side are usable: deep
  // enough to hold their area along the run, and never narrower than the widest
  // room's minimum. Without this the spine can be pulled hard to one side and
  // leave seven rooms fighting over 1.8 m.
  const bandDepth = rs => {
    if (!rs.length) return 0;
    const area = rs.reduce((t, r) => t + (target(r) || 0), 0);
    let d = Math.ceil(area / Math.max(1, run));
    for (const r of rs) d = Math.max(d, tileW(r.minWidth) || 0);
    return Math.max(MIN_DIM + WALL_ALLOW, d);
  };

  const minL = bandDepth(L), minR = bandDepth(Rr);
  const balanced = Math.floor(usable * la / Math.max(1, la + ra));

  let ld;
  if (minL + minR <= usable) {
    // Both sides can be served. Start from the area-balanced split, then slide
    // the spine towards the front door if that still leaves both bands workable.
    ld = balanced;
    if (spineX != null && vertical) ld = spineX - envelope.x - Math.floor(cw / 2);
    ld = Math.max(minL, Math.min(usable - minR, ld));
  } else {
    // The storey is over-subscribed: no split gives both sides what they need.
    // Divide in proportion to what each side needs so the shortfall is shared,
    // instead of letting the door position hand one band everything.
    ld = Math.round(usable * minL / Math.max(1, minL + minR));
  }
  ld = Math.max(MIN_DIM, Math.min(usable - MIN_DIM, ld));
  const rd = usable - ld;

  // Rooms pair across the band with their NEIGHBOUR in this list, and two
  // rooms that both need daylight may not pair -- the inner one would have no
  // window. Left in program order the bedrooms sit together, none of them can
  // pair, every bedroom takes a full slice of the band's length and a floor
  // with four of them runs out of house. Interleaving them with the robes and
  // ensuites means each bedroom pairs with the service room that opens off
  // it: bedroom against the outside wall, robe inboard.
  //
  // The entry, stair and living room keep their place at the road end -- move
  // the stair away from the entry and the floor above has no route out.
  const rank = r => ({entry:0, stair:1, living:2}[r.fn] ?? 5);
  const interleave = rs => {
    const lit = rs.filter(needsLight), unlit = rs.filter(r => !needsLight(r));
    if (!lit.length || !unlit.length) return rs;
    const out = [];
    while (lit.length || unlit.length) {
      if (lit.length) out.push(lit.shift());
      if (unlit.length) out.push(unlit.shift());
    }
    return out;
  };
  const order = rs => {
    const sorted = rs.slice().sort((a, b) => rank(a) - rank(b));
    return sorted.filter(r => rank(r) < 5)
      .concat(interleave(sorted.filter(r => rank(r) >= 5)));
  };
  // The run the flight takes on this floor: the common one `design` settled
  // across every floor, else the floor below's. A stair pinned on the ground
  // floor is how the upper ones get a run they can actually afford.
  const runTarget = stairRun != null ? stairRun : (below ? below.stairSpan : null);
  let pin = null;
  if (runTarget) {
    pin = {};
    for (const r of others) if (r.fn === "stair") pin[r.key] = runTarget;
  }
  let placed = [], corridorRect;
  if (vertical) {
    corridorRect = { x: envelope.x + ld, y: envelope.y, w: cw, h: envelope.h };
    // The left band's outside wall is its low edge; the right band's is its
    // high edge, because the passage is on its low side.
    placed = stack(order(L), { x: envelope.x, y: envelope.y, w: ld, h: envelope.h }, true, true, pin)
      .concat(stack(order(Rr), { x: corridorRect.x + cw, y: envelope.y, w: rd, h: envelope.h }, true, false, pin));
  } else {
    corridorRect = { x: envelope.x, y: envelope.y + ld, w: envelope.w, h: cw };
    placed = stack(order(L), { x: envelope.x, y: envelope.y, w: envelope.w, h: ld }, false, true)
      .concat(stack(order(Rr), { x: envelope.x, y: corridorRect.y + cw, w: envelope.w, h: rd }, false, false));
  }

  // A core, where it beats the single spine -- measured by building both, not
  // by a rule of thumb about frontage. A core is right on a 20 × 32 m lot
  // (five awkward rooms down to none) and wrong on a 26 × 28 (none up to
  // five). The spine stays the default and has to be plainly failing first:
  // scored on an estimate instead, a 15 × 30 m block chose the core and came
  // out with a double garage 4897 mm wide, which is not a double garage.
  let passages = [{ r: corridor, rect: corridorRect, at: storeyIndex }];
  const plain = awkward(placed);
  if (plain[0] >= 3) {
    const core = coreBands(L, Rr, corridor, envelope, vertical, cw, run, order, storeyIndex);
    if (core && better(awkward(core.placed), plain)) {
      placed = core.placed;
      corridorRect = core.near;
      passages = [{ r: corridor, rect: core.near, at: storeyIndex },
                  { r: { ...corridor, key: String(corridor.key) + "_far" },
                    rect: core.far, at: storeyIndex }];
    }
  }

  // Now the passage is fixed, set the frontage out around it, with the front
  // door over the passage rather than wherever it happened to land.
  cells = strip
    ? placeFront(frontRooms, strip, vertical ? [corridorRect.x, corridorRect.x + cw] : null)
    : [];
  return cells.concat(placed.map(p => ({ ...p, at: storeyIndex })), passages);
}

// The run every floor can give the flight, so they can all take the same.
//
// Pinning the upper floors to the GROUND floor's run is the wrong way round.
// The ground floor takes its run from its own apportionment and it is
// usually the most generous, so an upper floor with slightly less to spare
// refuses the pin and lands somewhere else over slack neither floor wanted.
//
// Each upper floor is probed in the STACKED geometry with the run left free
// -- that is what it can actually spare there. Probing an unstacked floor is
// meaningless: it puts the flight in a different band of a different width,
// so its run is not a figure the stacked floor could honour.
function commonStairRun(placedRooms, foot, storeys) {
  if (storeys < 2) return null;
  const flightOn = (s, below) => {
    const mine = placedRooms.filter(r => r.at === s);
    if (!mine.length) return null;
    return layoutStorey(mine, foot, s, below).find(c => c.r.fn === "stair") || null;
  };
  const groundCells = placedRooms.filter(r => r.at === 0).length
    ? layoutStorey(placedRooms.filter(r => r.at === 0), foot, 0, null) : [];
  const ground = groundCells.find(c => c.r.fn === "stair");
  const base = groundFloor(groundCells, foot);
  if (!ground || !base) return null;
  const loose = { ...base, stairSpan: 0 };
  const runs = [ground.rect.h];
  for (let s = 1; s < storeys; s++) {
    const f = flightOn(s, loose);
    if (!f) return null;
    runs.push(f.rect.h);
  }
  // Above what a stair of that width actually needs; below it the flight
  // stops being a flight and that floor genuinely cannot stack.
  const needs = ground.r.minArea
    ? Math.ceil(tileArea(ground.r.minArea) / Math.max(1, ground.rect.w)) : 0;
  return Math.max(Math.min(...runs), needs) || null;
}

// What the ground floor settled, read back off its cells. Taken from the
// cells rather than returned out of the packer because the packer decides
// each part somewhere different -- the envelope once the front zone is
// carved, the spine once the bands are balanced, the side and the run of the
// flight once the rows are apportioned. The passage carries the first two: it
// spans the envelope, so its extent IS the envelope along the run, and its
// centre is the spine.
function groundFloor(cells, foot) {
  const passage = cells.find(c => c.r.fn === "corridor");
  const stair = cells.find(c => c.r.fn === "stair");
  if (!passage || !stair) return null;
  if (passage.rect.h < passage.rect.w) return null;   // spine runs across
  return {
    envelope: { x: foot.x, y: passage.rect.y, w: foot.w, h: passage.rect.h },
    spineX: passage.rect.x + Math.floor(passage.rect.w / 2),
    stairLeft: stair.rect.x < passage.rect.x,
    stairSpan: stair.rect.h,
  };
}

/* ---- the whole design ---- */
function design(a) {
  const P = PLANNING[a.state];
  const zone = P.zoned ? a.zone : "default";
  const pick = t => t[zone] != null ? t[zone] : t.default;
  const setbacks = { front: pick(P.front), rear: P.rear, side: P.side };
  const lot = { w: a.lotW, d: a.lotD, area: a.lotW * a.lotD };
  const env = { x: setbacks.side, y: setbacks.front,
                w: lot.w - setbacks.side * 2, h: lot.d - setbacks.front - setbacks.rear };
  if (env.w < MIN_DIM * 2 || env.h < MIN_DIM * 2)
    return { error: "The setbacks leave almost nothing to build on. Check the block size." };

  a.livable = P.livable;
  const rooms = buildProgram(a);
  const placedRooms = assignStoreys(rooms, a.storeys);
  const maxCover = pick(P.cover);
  const perStorey = [];
  for (let s = 0; s < a.storeys; s++)
    perStorey.push(placedRooms.filter(r => r.at === s).reduce((t, r) => t + (target(r) || 0), 0));
  let needed = Math.round(Math.max(...perStorey) * 1.14);
  const wanted = needed;                       // what the brief asks for, per storey
  const cap = Math.floor(lot.area * maxCover); // planning cover cap
  const envArea = env.w * env.h;               // what the setbacks physically leave
  const notes = [];

  // Two different things can hold the house back, and they are not the same
  // constraint: the cover cap is a planning rule, the envelope is the block
  // itself once the setbacks are taken off. Name whichever one actually binds.
  const limit = Math.min(cap, envArea);
  if (wanted > limit) {
    needed = limit;
    if (envArea < cap)
      notes.push(`The rooms asked for need about ${(wanted/1e6).toFixed(0)} m² a floor. `
        + `After the ${P.code} setbacks — ${setbacks.front/1000} m front, ${setbacks.rear/1000} m rear, `
        + `${setbacks.side/1000} m each side — this block leaves ${(envArea/1e6).toFixed(0)} m² to build on. `
        + `That, not the cover cap, is what limits it.`);
    else
      notes.push(`The rooms asked for need about ${(wanted/1e6).toFixed(0)} m² a floor, and ${P.code} `
        + `caps site cover at ${(maxCover*100).toFixed(0)}% — ${(cap/1e6).toFixed(0)} m². Built to the cap.`);
  }

  // If the shortfall is severe, a drawing would be a lie: the rooms would come
  // out at a size nobody can use. Say so instead of drawing it.
  const briefTotal = perStorey.reduce((t, x) => t + x, 0) * 1.14;
  const capacity = Math.min(cap, envArea) * a.storeys;
  if (capacity < briefTotal * 0.7) {
    const floorsNeeded = Math.ceil(briefTotal / Math.max(1, Math.min(cap, envArea)));
    return { error: `That brief doesn't fit this block. The rooms come to about `
      + `${(briefTotal/1e6).toFixed(0)} m², and ${a.lotW/1000} × ${a.lotD/1000} m in ${P.name} gives `
      + `${(capacity/1e6).toFixed(0)} m² over ${a.storeys} floor${a.storeys>1?"s":""} once the setbacks `
      + `and the ${(maxCover*100).toFixed(0)}% cover cap are taken off. `
      + `It would take about ${floorsNeeded} floors, a shorter list of rooms, or a wider block. `
      + `I'd rather tell you than draw rooms you can't use.` };
  }

  let fw = Math.min(env.w, MAX_FRONTAGE);
  let fd = Math.ceil(needed / Math.max(1, fw));

  // The frontage cap is a preference and the rear yard outranks it: rooms
  // that are slightly wide beat a house with no garden behind it.
  if (fd > env.h - MIN_REAR_YARD && env.w > fw) {
    let widened = false;
    for (let candidate = fw; candidate <= env.w; candidate += 250) {
      if (Math.ceil(needed / candidate) <= env.h - MIN_REAR_YARD) {
        fw = candidate; fd = Math.ceil(needed / candidate); widened = true; break;
      }
    }
    if (!widened) { fw = env.w; fd = Math.ceil(needed / Math.max(1, fw)); }
  }
  if (fd > env.h) { fd = env.h; fw = Math.min(env.w, Math.ceil(needed / Math.max(1, fd))); }
  fw = Math.max(MIN_DIM * 2, Math.min(env.w, fw));
  fd = Math.max(MIN_DIM * 2, Math.min(env.h, fd));
  const foot = { x: env.x + Math.floor((env.w - fw) / 2), y: env.y, w: fw, h: fd };

  PACK_WARNINGS = [];
  const storeys = [];
  const commonRun = commonStairRun(placedRooms, foot, a.storeys);
  let below = null;
  for (let s = 0; s < a.storeys; s++) {
    const mine = placedRooms.filter(r => r.at === s);
    let cells = layoutStorey(mine, foot, s, below, commonRun);
    // Holding a floor to the one below costs it the area over the garage and
    // a spine placed for the rooms downstairs. Usually it can carry that.
    // Where it cannot the rooms come out too small to take a door and the
    // whole plan is refused below -- a two-storey house nobody can have, in
    // exchange for a stair that lines up on the drawing they no longer get.
    // So lay it out both ways and keep the stacked one only where it forces
    // nothing under that limit.
    const worst = cs => Math.min(...cs.map(c => Math.min(c.rect.w, c.rect.h)));
    if (below && cells.length && worst(cells) < MIN_TILE) {
      const loose = layoutStorey(mine, foot, s, null, commonRun);
      if (loose.length && worst(loose) > worst(cells)) cells = loose;
    }
    storeys.push(cells);
    if (s === 0) below = groundFloor(cells, foot);
  }

  // The area test above catches a brief that is far too big for the block.
  // It does not catch a brief that fits by area and cannot be PACKED: the
  // rooms come out as slivers instead, and a plan of slivers is not a smaller
  // version of a good plan. Under 600 mm clear a 720 mm door leaf will not
  // fit, so nothing can get in.
  const slivers = [];
  for (const cells of storeys) for (const c of cells) {
    const short = Math.min(c.rect.w, c.rect.h);
    if (short < MIN_TILE) slivers.push({ name: c.r.name, rect: c.rect, short });
  }
  if (slivers.length) {
    slivers.sort((x, y) => x.short - y.short);
    const worst = slivers.slice(0, 3)
      .map(v => `${v.name} at ${v.rect.w} × ${v.rect.h} mm`).join(", ");
    const more = slivers.length > 3 ? ` and ${slivers.length - 3} more` : "";
    const floorsNeeded = Math.ceil(briefTotal / Math.max(1, Math.min(cap, envArea)));
    return { error: `That brief doesn't fit this block. Packing it forces `
      + `${slivers.length} room${slivers.length === 1 ? "" : "s"} under `
      + `${UNBUILDABLE} mm across, which won't take a door: ${worst}${more}. `
      + `It would take about ${floorsNeeded} floor${floorsNeeded > 1 ? "s" : ""}, `
      + `a shorter list of rooms, or a wider block. `
      + `I'd rather tell you than draw rooms you can't use.` };
  }

  const ceiling = ceilingAt(28);
  const walls = CONSTRUCTION[P.construction];
  const clear = c => ({ x: c.rect.x + walls.int / 2, y: c.rect.y + walls.int / 2,
                        w: Math.max(0, c.rect.w - walls.int), h: Math.max(0, c.rect.h - walls.int) });
  const areas = storeys.map(cells => cells.reduce((t, c) => { const r = clear(c); return t + r.w * r.h; }, 0));
  const gfa = areas.reduce((a, b) => a + b, 0);
  const cover = areas[0] / lot.area;

  // Rooms the packer could not give their declared minimum. Say which ones
  // rather than presenting a squeezed plan as though it were compliant.
  const tight = [];
  for (const cells of storeys) for (const c of cells) {
    if (!HABITABLE.has(c.r.fn)) continue;
    const r = clear(c), narrow = Math.min(r.w, r.h);
    if (narrow + WALL_ALLOW < (c.r.minWidth || 0) - 50 || r.w * r.h < c.r.minArea - 5e5)
      tight.push(`${c.r.name} ${(r.w*r.h/1e6).toFixed(1)} m² at ${narrow} mm wide`);
  }
  // A flight has to arrive in the same place it leaves from. Upper floors are
  // stacked on the ground floor to make that happen -- same envelope, same
  // spine, same side of it, same run of the band.
  //
  // Not all of them can be, and the reasons were counted rather than
  // guessed. Of 45 upper floors in the sweep, 30 reach the corridor-spine
  // layout: 16 take the pin and 14 have a band too short to give the flight
  // its run. The other 15 have too few rooms to be worth a corridor at all,
  // so they are sliced across the whole envelope with no bands to pin into.
  // The service core is not involved in any of them.
  //
  // Those are still drawn, because a two-storey house nobody can have is
  // worse than one whose stair is wrong and says so. This is where it says
  // so. The Python solver reports the same thing in the same terms.
  const flights = storeys.map(cells => cells.filter(c => c.r.fn === "stair"));
  for (let s = 0; s + 1 < flights.length; s++)
    for (const below of flights[s]) {
      const b = below.rect;
      if (flights[s + 1].some(a => a.rect.x === b.x && a.rect.y === b.y
                                && a.rect.w === b.w && a.rect.h === b.h)) continue;
      const above = flights[s + 1]
        .map(c => `${c.rect.w}×${c.rect.h} at ${c.rect.x},${c.rect.y}`).join(", ");
      notes.push(`The stair doesn't line up between floor ${s} and floor ${s + 1}: `
        + `${b.w}×${b.h} at ${b.x},${b.y} below and ${above || "nothing"} above. `
        + `A flight has to arrive in the same place it leaves from, so this `
        + `can't be built as drawn — each floor is packed on its own and `
        + `nothing yet holds the stair still between them.`);
    }

  notes.push(...PACK_WARNINGS);
  if (tight.length)
    notes.push(`These rooms came out under the size they should be — `
      + `${tight.join("; ")}. The block will take the house, but not this room list at `
      + `full size on ${a.storeys} floor${a.storeys>1?"s":""}. Drop a room, add a floor, or accept them tight.`);

  // The driveway, from the street boundary to the garage door. A garage with
  // no driveway is an oversight rather than a design decision, so it is placed
  // wherever there is a garage. Its width comes from the garage opening: any
  // narrower and you clip your mirrors, any wider and it is paving nobody
  // drives on.
  let drive = null;
  const garageCell = storeys[0] && storeys[0].find(c => c.r.fn === "garage");
  if (garageCell) {
    const g = clear(garageCell);
    const length = Math.max(0, foot.y - 0);
    if (length > 0) drive = { x: g.x, y: 0, w: g.w, h: length };
  }

  // pool in the rear yard
  let pool = null, poolNote = null;
  if (a.pool) {
    const yard = { x: 0, y: foot.y + foot.h, w: lot.w, h: Math.max(0, lot.d - (foot.y + foot.h)) };
    const [pl, pw] = a.poolSize || [8000, 4000];
    const ring = 2000, ncz = 900;
    const needL = pl + ring + ncz, needW = pw + ring + ncz;
    if (needW <= yard.w && needL <= yard.h) pool = { x: Math.floor(yard.x + (yard.w - pw)/2), y: Math.floor(yard.y + (yard.h - pl)/2), w: pw, h: pl };
    else if (needL <= yard.w && needW <= yard.h) pool = { x: Math.floor(yard.x + (yard.w - pl)/2), y: Math.floor(yard.y + (yard.h - pw)/2), w: pl, h: pw };
    else poolNote = `A ${pl/1000}×${pw/1000} m pool needs about ${needL} × ${needW} mm of clear yard once the 1200 mm barrier and its 900 mm non-climbable zone are allowed for. The rear yard is ${yard.w} × ${yard.h} mm. A plunge pool, or the house brought forward.`;
  }

  const od = outdoorLiving(lot, foot);
  return { plan: { storeys, foot, env, lot, setbacks, pool, poolNote, drive },
           stats: { gfa, cover, maxCover, areas, ceiling, walls, construction: P.construction,
                    code: P.code, state: P.name, zone: P.zoned ? a.zone : null,
                    outdoor: od.m2, outdoorMinDim: od.minDim, outdoorWhere: od.where,
                    minOutdoor: pick(P.outdoor) },
           clear, notes };
}
