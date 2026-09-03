"""Does any text on a sheet land on top of other text?

The sheets have been swept for structure -- every floor tiles, every eaves
has a storey under it, every sheet is at 1:100. Nothing has ever checked
that the words can be READ. A room label that fits its room can still be
printed across a dimension figure, and the result is a drawing where a
number cannot be trusted because you cannot tell which digits belong to it.

Measured with the drawing module's OWN width estimator and font sizes, so
this counts collisions the way the placement code would have to see them,
not the way some other guess would.
"""
import sys, collections
sys.path.insert(0, "/home/user/Website/codraft/src")
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.codes import design_parameters, resolve
from codraft.export.svg import (build_sheet, elevation_sheets, CHAR_WIDTH,
                                STYLE)
import re

SIZES = {}
for m in re.finditer(r"\.([a-z-]+)\s*\{[^}]*font:[^;]*?(\d+)px", STYLE):
    SIZES.setdefault(m.group(1), int(m.group(2)))

def box(op):
    _kind, cls, x, y, dy, rot, value = op
    size = SIZES.get(cls, 250)
    w = len(value) * size * CHAR_WIDTH
    h = size
    # The transform is translate(x,y) scale(1,-1) rotate(r), applied to the
    # point right-to-left, so a text offset of (0, dy) lands at (x, y - dy)
    # upright and at (x + dy, y) turned. Reading dy as a y shift on a turned
    # label put every stacked room label on top of itself: 151 phantom
    # collisions, all of them the name over its own area figure.
    if rot:
        cx, cy = x + dy, y
        w, h = h, w
    else:
        cx, cy = x, y - dy
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cls, value)

def overlap(a, b):
    ox = min(a[2], b[2]) - max(a[0], b[0])
    oy = min(a[3], b[3]) - max(a[1], b[1])
    return ox > 0 and oy > 0

D = design_parameters(resolve("AU-WA"))
LOTS=[(9000,22000),(10000,25000),(10500,32000),(12500,28000),(15000,30000),
      (16000,24000),(18000,30000),(20000,35000)]
sheets = clashes = 0
pairs = collections.Counter(); examples = collections.defaultdict(list)
for w,d in LOTS:
    for b,ba in [(3,1),(3,2),(4,2),(5,2),(5,3)]:
        for st in (1,2):
            p=template("au-house",bedrooms=b,bathrooms=ba,storeys=st); p.build_to(D)
            plot=Plot(rect=Rect(0,0,w,d),road_side="south",setback_front=6000,
                      setback_rear=6000,setback_left=1000,setback_right=1000)
            try: L=solve(p,plot)
            except LayoutError: continue
            B=build_building(p,plot,L,design=D)
            pages=[("site",None)]+[("architectural",s.index) for s in B.storeys]
            pages+=[("elevations",i) for i in range(elevation_sheets(B))]
            pages+=[("sections",None)]
            for sheet,idx in pages:
                canvas,*_ = build_sheet(B,idx,sheet,None,L.envelope,"metric")
                texts=[box(o) for o in canvas.ops if o[0]=="text"]
                sheets+=1
                for i,x in enumerate(texts):
                    for y in texts[i+1:]:
                        if overlap(x,y):
                            clashes+=1
                            key=tuple(sorted((x[4],y[4])))
                            pairs[key]+=1
                            if len(examples[key])<2:
                                examples[key].append(
                                    f"{w}x{d} {b}b{ba}ba {st}s {sheet}: "
                                    f"{x[5]!r} / {y[5]!r}")
print(f"{sheets} sheets; {clashes} pairs of text overlap")
for k,v in pairs.most_common(10):
    print(f"   {v:5}  {k[0]} x {k[1]}")
    for e in examples[k]: print(f"            {e}")
