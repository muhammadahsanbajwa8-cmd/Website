/* codraft's layout engine, ported to run in the page.
   Mirrors src/codraft/layout: footprint sized to the frontage, a front zone
   across the street, then a corridor spine with rooms either side. Integer
   millimetres throughout, as in the Python, so a wall that is 3500 long is
   3500 everywhere. */

const COURSE = 86, PLATE = 26, WALL_ALLOW = 115, MIN_DIM = 900, MAX_FRONTAGE = 16000;
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
  const R = (key, name, fn, area, width, opt = {}) => ({
    key, name, fn, minArea: area * 1e6, minWidth: width, ...opt });
  const rooms = [];
  const upper = a.storeys > 1;

  rooms.push(R("portico", "Portico", "entry", 4, 1500, { zone: "front", storey: 0 }));
  rooms.push(R("entry", "Entry", "entry", 6, 1500, { zone: "front", storey: 0, solo: true }));
  rooms.push(R("passage", "Passage", "corridor", 12, a.livable ? 1000 : 1000));
  rooms.push(R("living", "Living", "living", 24, 3600, { storey: 0 }));
  rooms.push(R("dining", "Dining", "dining", 14, 3000, { storey: 0 }));
  rooms.push(R("kitchen", "Kitchen", "kitchen", 12, 3000, { storey: 0 }));
  rooms.push(R("wip", "WIP", "storage", 4, 1400, { storey: 0 }));
  rooms.push(R("master", "Master Suite", "bedroom", 16, 3400,
               upper ? { storey: 1 } : {}));
  rooms.push(R("wir", "WIR", "storage", 5, 1600, upper ? { storey: 1 } : {}));
  rooms.push(R("ensuite", "Ensuite", "bathroom", 6, 1800, upper ? { storey: 1 } : {}));

  for (let i = 2; i <= a.bedrooms; i++)
    rooms.push(R("bed" + i, "Bed " + i, "bedroom", 11, 3000, upper ? { storey: 1 } : {}));
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
  if (a.storeys > 1) rooms.push(R("stair", "Stair", "stair", 10, 2200, { storey: 0 }));
  return rooms;
}

const HABITABLE = new Set(["bedroom","living","dining","kitchen","office"]);
const WET = new Set(["bathroom","wc","kitchen","utility"]);
const CIRC = new Set(["corridor","entry","stair","lobby"]);
const target = r => tileArea(r.minArea);

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

/* ---- fitting rooms along a band ---- */
function apportion(spans, floors, total) {
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

function stack(rooms, band, alongY) {
  if (!rooms.length) return [];
  const span = alongY ? band.h : band.w, depth = alongY ? band.w : band.h;
  const rows = [];
  for (let i = 0; i < rooms.length;) {
    const r = rooms[i], t = target(r) || 1, s = Math.floor(t / Math.max(1, depth));
    const thin = s > 0 && depth / s > 2.2;
    if (thin && !r.solo && i + 1 < rooms.length) {
      const n = rooms[i + 1], nt = target(n) || 1, ns = Math.floor(nt / Math.max(1, depth));
      if (!n.solo && ns > 0 && depth / ns > 2.2 &&
          tileW(r.minWidth) + tileW(n.minWidth) <= depth && depth >= 2 * (MIN_DIM + WALL_ALLOW)) {
        rows.push({ rooms: [r, n], t: t + nt }); i += 2; continue;
      }
    }
    rows.push({ rooms: [r], t }); i += 1;
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
  const sizes = apportion(spans, floors, span);
  const placed = []; let cursor = alongY ? band.y : band.x;
  rows.forEach((row, i) => {
    const s = sizes[i];
    if (row.rooms.length === 1) {
      placed.push({ r: row.rooms[0], rect: alongY
        ? { x: band.x, y: cursor, w: band.w, h: s } : { x: cursor, y: band.y, w: s, h: band.h } });
    } else {
      const [a, b] = row.rooms, ta = target(a) || 1, tb = target(b) || 1;
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

/* ---- one storey ---- */
function layoutStorey(rooms, env, storeyIndex) {
  if (!rooms.length) return [];
  let cells = [], spineX = null, envelope = env;

  if (storeyIndex === 0) {
    const front = rooms.filter(r => r.zone === "front");
    const garage = front.find(r => r.fn === "garage");
    if (garage && front.length >= 2) {
      const widthShare = Math.max(tileW(garage.minWidth), 5600);
      let depth = Math.max(6000 + WALL_ALLOW, Math.ceil(target(garage) / widthShare));
      depth = Math.min(depth, Math.floor(env.h / 3));
      const frontArea = front.reduce((s, r) => s + (target(r) || 0), 0);
      if (frontArea < env.w * depth * 0.75)
        depth = Math.min(Math.max(6000 + WALL_ALLOW, Math.ceil(frontArea / env.w)), Math.floor(env.h / 3));
      if (depth >= 5000 && env.h - depth >= MIN_DIM * 3) {
        const strip = { x: env.x, y: env.y, w: env.w, h: depth };
        front.sort((a, b) => (a.fn === "garage" ? 0 : 1) - (b.fn === "garage" ? 0 : 1));
        cells = stack(front, strip, false).map(p => ({ ...p, at: 0 }));
        const entry = cells.find(c => c.r.key === "entry") || cells.find(c => c.r.fn === "entry");
        if (entry) spineX = entry.rect.x + Math.floor(entry.rect.w / 2);
        envelope = { x: env.x, y: env.y + depth, w: env.w, h: env.h - depth };
        rooms = rooms.filter(r => r.zone !== "front");
      }
    }
  }
  if (!rooms.length) return cells;

  const corridor = rooms.find(r => r.fn === "corridor");
  const others = rooms.filter(r => r !== corridor);
  if (!corridor || others.length <= 2)
    return cells.concat(stack(rooms, envelope, envelope.h >= envelope.w).map(p => ({ ...p, at: storeyIndex })));

  let vertical = envelope.h >= envelope.w;
  if (spineX != null) vertical = true;
  let cw = Math.max(corridor.minWidth, 1000) + WALL_ALLOW;
  const cross = vertical ? envelope.w : envelope.h;
  if (cw >= cross - 2 * MIN_DIM) cw = Math.max(1000, Math.floor((cross - 2 * MIN_DIM) / 3));

  // balance the two bands, then pull the spine to the entry if there is one
  const sorted = others.slice().sort((a, b) => target(b) - target(a));
  const L = [], Rr = []; let la = 0, ra = 0;
  for (const r of sorted) { if (la <= ra) { L.push(r); la += target(r) || 1; } else { Rr.push(r); ra += target(r) || 1; } }
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

  const order = rs => rs.slice().sort((a, b) =>
    ({entry:0, stair:1, living:2}[a.fn] ?? 5) - ({entry:0, stair:1, living:2}[b.fn] ?? 5));
  let placed = [], corridorRect;
  if (vertical) {
    corridorRect = { x: envelope.x + ld, y: envelope.y, w: cw, h: envelope.h };
    placed = stack(order(L), { x: envelope.x, y: envelope.y, w: ld, h: envelope.h }, true)
      .concat(stack(order(Rr), { x: corridorRect.x + cw, y: envelope.y, w: rd, h: envelope.h }, true));
  } else {
    corridorRect = { x: envelope.x, y: envelope.y + ld, w: envelope.w, h: cw };
    placed = stack(order(L), { x: envelope.x, y: envelope.y, w: envelope.w, h: ld }, false)
      .concat(stack(order(Rr), { x: envelope.x, y: corridorRect.y + cw, w: envelope.w, h: rd }, false));
  }
  return cells.concat(placed.map(p => ({ ...p, at: storeyIndex })),
                      [{ r: corridor, rect: corridorRect, at: storeyIndex }]);
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
  if (fd > env.h) { fd = env.h; fw = Math.min(env.w, Math.ceil(needed / Math.max(1, fd))); }
  fw = Math.max(MIN_DIM * 2, Math.min(env.w, fw));
  fd = Math.max(MIN_DIM * 2, Math.min(env.h, fd));
  const foot = { x: env.x + Math.floor((env.w - fw) / 2), y: env.y, w: fw, h: fd };

  const storeys = [];
  for (let s = 0; s < a.storeys; s++)
    storeys.push(layoutStorey(placedRooms.filter(r => r.at === s), foot, s));

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
  if (tight.length)
    notes.push(`These rooms came out under the size they should be — `
      + `${tight.join("; ")}. The block will take the house, but not this room list at `
      + `full size on ${a.storeys} floor${a.storeys>1?"s":""}. Drop a room, add a floor, or accept them tight.`);

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

  return { plan: { storeys, foot, env, lot, setbacks, pool, poolNote },
           stats: { gfa, cover, maxCover, areas, ceiling, walls, construction: P.construction,
                    code: P.code, state: P.name, zone: P.zoned ? a.zone : null,
                    outdoor: (lot.area - areas[0]) / 1e6, minOutdoor: pick(P.outdoor) },
           clear, notes };
}
