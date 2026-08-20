import { readFileSync } from 'fs';
const design = new Function(readFileSync('engine.js','utf8') + '\nreturn design;')();
const states=[['WA','R20'],['WA','R40'],['VIC',null],['NSW',null],['QLD',null]];
const lots=[[10000,28000],[12000,32000],[15000,30000],[18000,35000],[20000,40000],[9000,24000]];
let cases=0, refused=0, withBad=0, declared=0, silent=[];
for (const [st,z] of states) for (const [w,d] of lots)
 for (const storeys of [1,2,3]) for (const bd of [2,3,4,5]) {
  const a={state:st,zone:z||'R20',lotW:w,lotD:d,storeys,bedrooms:bd,bathrooms:2,
           garage:2,theatre:bd>3,study:false,alfresco:true,pool:false};
  const o=design(a);
  if(o.error){refused++;continue;}
  cases++;
  const bad=o.plan.storeys.flat().map(c=>{const r=o.clear(c);
    return {n:c.r.name,w:Math.min(r.w,r.h),a:r.w*r.h};})
    .filter(r=>/^(Bed|Master|Living|Dining|Kitchen|Theatre|Study)/.test(r.n))
    .filter(r=>r.w<2100||r.a<7e6);
  if(!bad.length) continue;
  withBad++;
  const note=o.notes.find(n=>n.includes('under the size they should be'))||'';
  const named=bad.filter(r=>note.includes(r.n));
  if(named.length===bad.length) declared++;
  else if(silent.length<6) silent.push(`${st} ${w/1000}x${d/1000} ${storeys}fl ${bd}bd: `+
    bad.filter(r=>!note.includes(r.n)).map(r=>r.n).join(',')+(note?' (note present)':' (NO NOTE)'));
 }
console.log(`cases drawn ${cases} | refused ${refused}`);
console.log(`cases with an undersized habitable room: ${withBad}`);
console.log(`  of those, every undersized room named in the notes: ${declared}`);
console.log(`  cases with at least one UNDECLARED undersized room: ${withBad-declared}`);
silent.forEach(s=>console.log('   ', s));
