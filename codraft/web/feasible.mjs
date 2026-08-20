import { readFileSync } from 'fs';
const src = readFileSync('engine.js','utf8');
const design = new Function(src + '\nreturn design;')();
const target = new Function(src + '\nreturn target;')();
const states=[['WA','R20'],['WA','R40'],['VIC',null],['NSW',null],['QLD',null]];
const lots=[[10000,28000],[12000,32000],[15000,30000],[18000,35000],[20000,40000],[9000,24000]];
let short=0, badPack=0, examples=[];
for (const [st,z] of states) for (const [w,d] of lots)
 for (const storeys of [1,2,3]) for (const bd of [2,3,4,5]) {
  const a={state:st,zone:z||'R20',lotW:w,lotD:d,storeys,bedrooms:bd,bathrooms:2,
           garage:2,theatre:bd>3,study:false,alfresco:true,pool:false};
  const o=design(a);
  if(o.error) continue;
  const bad=o.plan.storeys.flat().map(c=>{const r=o.clear(c);
    return {n:c.r.name,w:Math.min(r.w,r.h),a:r.w*r.h};})
    .filter(r=>/^(Bed|Master|Living|Dining|Kitchen|Theatre|Study)/.test(r.n))
    .filter(r=>r.w<2100||r.a<7e6);
  if(!bad.length) continue;
  // Per storey: does the footprint hold the sum of what its rooms asked for?
  let anyShort=false;
  o.plan.storeys.forEach((cells,i)=>{
    const want=cells.reduce((t,c)=>t+(target(c.r)||0),0);
    const have=o.plan.foot.w*o.plan.foot.h;
    if(want>have) anyShort=true;
  });
  if(anyShort) short++; else {
    badPack++;
    if(examples.length<6){
      const cells=o.plan.storeys[0];
      const want=cells.reduce((t,c)=>t+(target(c.r)||0),0);
      examples.push(`${st} ${w/1000}x${d/1000} ${storeys}fl ${bd}bd: wants `+
        (want/1e6).toFixed(0)+' m2, footprint '+(o.plan.foot.w*o.plan.foot.h/1e6).toFixed(0)+
        ' m2 -- '+bad.map(r=>r.n+' '+(r.a/1e6).toFixed(1)).join(', '));
    }
  }
 }
console.log(`cases with an undersized room where the floor is genuinely SHORT of area: ${short}`);
console.log(`cases where the area is there and the PACKING lost it:                    ${badPack}`);
examples.forEach(e=>console.log('   ', e));
