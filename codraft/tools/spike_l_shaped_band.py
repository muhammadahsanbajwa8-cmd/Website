"""SPIKE: what would a strip deep only over the garage actually cost?

Not a change. A measurement of the shape the packing notes say is the only
route left, taken before writing any of it.

The strip across the frontage is `envelope.w` wide and as deep as a car.
Everything beside the garage -- the front door, the porch, the store -- needs
about two metres of that six. Packing note 8 says the surplus is in DEPTH,
and reaching it means a strip deep only over the garage. That leaves the band
behind L-shaped rather than rectangular, and `_stack`, the hole sweep and the
wall builder all assume bands are rectangles that tile exactly.

This asks two things the notes assert but do not measure:

  1. HOW MUCH depth is actually recoverable, per plan, if the strip were
     deep only over the garage.
  2. Whether the L that leaves can be cut into RECTANGLES -- because if it
     can, the packer never has to know it was an L. An L is two rectangles.
     The question is whether the two are each usable, or whether one of them
     comes out as a sliver nothing fits in.
"""
import sys, collections
sys.path.insert(0,"/home/user/Website/codraft/src")
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Function, Plot
from codraft.program import template
from codraft.codes import design_parameters, resolve
import codraft.layout.solver as S

D=design_parameters(resolve("AU-WA"))
LOTS=[(9000,22000),(10000,25000),(10500,32000),(12500,28000),(15000,30000),
      (16000,24000),(18000,30000),(20000,35000)]

MIN = S._MIN_TILE
gained=[]; usable=0; sliver=0; nostrip=0; plans=0
for w,d in LOTS:
    for b,ba in [(3,1),(3,2),(4,2),(5,2),(5,3)]:
        for st in (1,2):
            p=template("au-house",bedrooms=b,bathrooms=ba,storeys=st); p.build_to(D)
            plot=Plot(rect=Rect(0,0,w,d),road_side="south",setback_front=6000,
                      setback_rear=6000,setback_left=1000,setback_right=1000)
            try: L=solve(p,plot)
            except LayoutError: continue
            plans+=1
            front=[c for c in L.for_storey(0)
                   if c.requirement is not None and c.requirement.zone=="front"]
            if len(front)<2: nostrip+=1; continue
            # A STRIP is front rooms that all share the same y range. Where
            # the garage runs deeper than its neighbours the plan is already
            # in the column form and there is no strip left to shorten.
            if len({(c.rect.y0, c.rect.y1) for c in front}) != 1:
                nostrip+=1; continue
            top=max(c.rect.y1 for c in front)
            bot=min(c.rect.y0 for c in front)
            depth=top-bot
            g=next((c for c in front if c.function is Function.GARAGE),None)
            if g is None: nostrip+=1; continue
            # What the rooms BESIDE the garage actually need, at their width.
            others=[c for c in front if c is not g]
            if not others: nostrip+=1; continue
            need=0
            for c in others:
                area=S._target(c.requirement) or 0
                need=max(need, -(-area // max(1,c.rect.w)))
            need=max(need, S._ABSOLUTE_MIN_DIM + S._WALL_ALLOWANCE)
            spare=depth-need
            if spare<=0: continue
            B=build_building(p,plot,L,design=D)
            gs=next(x for x in B.all_spaces() if x.function is Function.GARAGE)
            state=("holds two cars" if gs.rect.w>=5400 and gs.rect.h>=6000
                   else "too narrow" if gs.rect.w<5400 and gs.rect.h>=6000
                   else "too shallow" if gs.rect.w>=5400 else "narrow+shallow")
            gained.append((f"{w}x{d} {b}b{ba}ba {st}s", depth, need, spare,
                           g.rect.w, state))
            # The L, cut the only way that keeps the garage whole: one
            # rectangle across the full width behind the shallow part, and
            # one beside the garage. Is the second usable?
            if spare >= MIN: usable+=1
            else: sliver+=1

print(f"{plans} plans; {nostrip} have no strip to shorten; "
      f"{len(gained)} have depth to recover")
print(f"   of those, the recovered band is at least {MIN} mm deep on {usable}, "
      f"a sliver on {sliver}")
if gained:
    tot=sum(g[3] for g in gained)
    print(f"   depth recovered: {tot/1000:.1f} m over {len(gained)} plans, "
          f"mean {tot/len(gained):.0f} mm, worst {max(g[3] for g in gained)} mm")
    import collections as _c
    print("   the garages on those plans:",
          dict(_c.Counter(r[5] for r in gained)))
    print(f"{'case':<22} {'strip':>6} {'need':>6} {'spare':>6} {'garage w':>9}  state")
    for row in sorted(gained,key=lambda r:-r[3])[:12]:
        print(f"{row[0]:<22} {row[1]:6} {row[2]:6} {row[3]:6} {row[4]:9}  {row[5]}")
