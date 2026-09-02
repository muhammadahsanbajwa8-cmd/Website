"""Which plan FORM draws the habitable rooms that miss their width target?"""
import sys, collections
sys.path.insert(0,"/home/user/Website/codraft/src")
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, Plot
from codraft.program import template
from codraft.codes import design_parameters, resolve, check
D=design_parameters(resolve("AU-WA")); J=resolve("AU-WA")
LOTS=[(9000,22000),(10000,25000),(10500,32000),(12500,28000),(15000,30000),
      (16000,24000),(18000,30000),(20000,35000)]
form=collections.Counter(); fails=collections.Counter(); plans=collections.Counter()
over=collections.Counter(); rows=[]
for w,d in LOTS:
    for b,ba in [(3,1),(3,2),(4,2),(5,2),(5,3)]:
        for st in (1,2):
            p=template("au-house",bedrooms=b,bathrooms=ba,storeys=st); p.build_to(D)
            plot=Plot(rect=Rect(0,0,w,d),road_side="south",setback_front=6000,
                      setback_rear=6000,setback_left=1000,setback_right=1000)
            try: L=solve(p,plot)
            except LayoutError: continue
            wt=" ".join(L.warnings)
            f=("column" if "column of its own" in wt
               else "core" if "middle band with a passage down" in wt
               else "spine")
            plans[f]+=1
            B=build_building(p,plot,L,design=D)
            n=sum(1 for x in check(B,J,L.warnings).findings
                  if x.status=="fail" and x.rule_id=="baseline.habitable.width")
            fails[f]+=n
            if "over. Rooms were scaled down" in wt: over[f]+=1
            if f=="column" and n:
                rows.append((w, d, f"{b}b{ba}ba {st}s", n,
                             "over-subscribed" if "over. Rooms were scaled down" in wt else "has the area",
                             "rescue" if "hold two cars at all" in wt else "scored better"))
print(f"{'form':<8} {'plans':>6} {'width fails':>12} {'per plan':>9} {'over-subscribed':>16}")
for f in ("spine","core","column"):
    n=plans[f]
    print(f"{f:<8} {n:6} {fails[f]:12} {fails[f]/max(1,n):9.2f} {over[f]:16}")

print()
print("column-form plans with a habitable-width fail:")
print(f"{'lot':<14} {'brief':<12} {'fails':>5}  {'floor':<16} why the column")
for w,d,brief,n,st_,why in sorted(rows):
    print(f"{w}x{d:<7} {brief:<12} {n:5}  {st_:<16} {why}")
