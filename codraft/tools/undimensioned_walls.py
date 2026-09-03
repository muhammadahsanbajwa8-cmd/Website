"""How many wall positions does the dimension chain leave out, and silently?

`_collapse` keeps a figure legible by dropping ordinates closer together
than MIN_CHAIN_STEP. That is the right trade -- an unreadable figure helps
nobody -- but the wall is then not dimensioned, and a builder setting out
from the chain has no figure for it. Nothing on the drawing says so.
"""
import sys, collections
sys.path.insert(0,"/home/user/Website/codraft/src")
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.codes import design_parameters, resolve
from codraft.annotate import _ordinates, _collapse, MIN_CHAIN_STEP

D=design_parameters(resolve("AU-WA"))
LOTS=[(9000,22000),(10000,25000),(10500,32000),(12500,28000),(15000,30000),
      (16000,24000),(18000,30000),(20000,35000)]

def raw(storey, foot, vertical):
    lo, hi = (foot.x0, foot.x1) if vertical else (foot.y0, foot.y1)
    out=set()
    for wall in storey.walls:
        if wall.vertical != vertical: continue
        pos = wall.start.x if vertical else wall.start.y
        if lo < pos < hi: out.add(pos)
    return sorted(out), lo, hi

plans=0; walls=0; dropped=0; worst=[]
for w,d in LOTS:
    for b,ba in [(3,1),(3,2),(4,2),(5,2),(5,3)]:
        for st in (1,2):
            p=template("au-house",bedrooms=b,bathrooms=ba,storeys=st); p.build_to(D)
            plot=Plot(rect=Rect(0,0,w,d),road_side="south",setback_front=6000,
                      setback_rear=6000,setback_left=1000,setback_right=1000)
            try: L=solve(p,plot)
            except LayoutError: continue
            B=build_building(p,plot,L,design=D)
            plans+=1
            for s_ in B.storeys:
                for vertical in (True, False):
                    positions, lo, hi = raw(s_, L.envelope, vertical)
                    kept = set(_collapse(positions, lo, hi))
                    walls += len(positions)
                    miss = [x for x in positions if x not in kept]
                    dropped += len(miss)
                    if miss:
                        worst.append((len(miss), f"{w}x{d} {b}b{ba}ba {st}s",
                                      "x" if vertical else "y", len(positions)))
print(f"MIN_CHAIN_STEP = {MIN_CHAIN_STEP} mm")
print(f"{plans} plans; {walls} wall positions offered to the chains, "
      f"{dropped} left out ({100*dropped/max(1,walls):.0f}%)")
worst.sort(reverse=True)
for n,lab,axis,tot in worst[:8]:
    print(f"   {n} of {tot} dropped on {axis}   {lab}")
