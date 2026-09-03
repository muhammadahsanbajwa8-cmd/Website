"""Does any label stick out past the box the sheet was sized to hold?

`_Canvas.saw` records what the drawing covers, and the sheet's scale is
chosen from it. It measures text at a flat 90 units either side per
character; the real width is the font size times CHAR_WIDTH, which is 174
per character at 300px and 244 at 420. Anything set in a large face can
therefore be wider than the box that was sized to hold it, and what runs off
the right is the title block.
"""
import sys, collections
sys.path.insert(0,"/home/user/Website/codraft/src")
from codraft.geom import Rect
from codraft.layout import LayoutError, build_building, solve
from codraft.model import Plot
from codraft.program import template
from codraft.codes import design_parameters, resolve
from codraft.export.svg import build_sheet, elevation_sheets, _text_boxes

D=design_parameters(resolve("AU-WA"))
LOTS=[(9000,22000),(10000,25000),(10500,32000),(12500,28000),(15000,30000),
      (16000,24000),(18000,30000),(20000,35000)]
sheets=out=0
worst=collections.Counter(); ex=collections.defaultdict(list)
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
                c,origin,cw,ch,_=build_sheet(B,idx,sheet,None,L.envelope,"metric")
                sheets+=1
                ox,oy=origin
                # The content box in canvas coordinates.
                x0,y0 = c.minx, c.miny
                x1,y1 = c.maxx, c.maxy
                for bx in _text_boxes(c):
                    over = max(x0-bx[0], bx[2]-x1, y0-bx[1], bx[3]-y1)
                    if over > 1:
                        out+=1
                        worst[sheet]+=1
                        if len(ex[sheet])<2:
                            ex[sheet].append(f"{w}x{d} {b}b{ba}ba {st}s over by {over:.0f} mm")
print(f"{sheets} sheets; {out} labels reach past the box the sheet was sized to")
for k,v in worst.most_common():
    print(f"   {v:5}  {k}")
    for e in ex[k]: print(f"            {e}")
