import { readFileSync } from 'fs';
const design = new Function(readFileSync('chat/engine.js','utf8') + '\nreturn design;')();
const states = [['WA','R20'],['WA','R40'],['VIC',null],['NSW',null],['QLD',null]];
const lots = [[10000,28000],[12000,32000],[15000,30000],[18000,35000],[20000,40000],[9000,24000]];
let n=0, refused=0, bad=[], worst=1e9;
for (const [st,z] of states) for (const [w,d] of lots)
  for (const storeys of [1,2,3]) for (const bd of [2,3,4,5]) {
    const a = {state:st, zone:z||'R20', lotW:w, lotD:d, storeys, bedrooms:bd,
               bathrooms:2, garage:2, theatre:bd>3, study:false, alfresco:true, pool:false};
    const o = design(a); n++;
    if (o.error) { refused++; continue; }
    const hab = o.plan.storeys.flat()
      .filter(c => /^(Bed|Master|Living|Dining|Kitchen|Theatre|Study)/.test(c.r.name))
      .map(c => { const r=o.clear(c); return {name:c.r.name, w:Math.min(r.w,r.h), a:r.w*r.h}; });
    for (const r of hab) {
      worst = Math.min(worst, r.a);
      if (r.w < 2100 || r.a < 7e6)
        bad.push(`${st}${z?"/"+z:""} ${w/1000}x${d/1000} ${storeys}fl ${bd}bd :: ${r.name} ${(r.a/1e6).toFixed(1)}m2 min-dim ${r.w}`);
    }
  }
console.log(`cases ${n} | refused ${refused} | undersized habitable rooms ${bad.length}`);
console.log('smallest habitable room overall:', (worst/1e6).toFixed(1), 'm2');
bad.slice(0,15).forEach(x=>console.log('  ', x));
