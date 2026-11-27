"""Writes static/favicon.svg with the "df" letters drawn as outlines from Nunito Black (weight 900),
so the icon looks the same everywhere (browsers cannot load web fonts inside an SVG icon).
Needs the font in secrets/fonts/Nunito.ttf (see handoff.md).
Run: uv run --with fonttools python tools/make_favicon.py"""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font = instantiateVariableFont(TTFont("secrets/fonts/Nunito.ttf"), {"wght": 900})
gs, cmap = font.getGlyphSet(), font.getBestCmap()
GAP = -40                                   # tight spacing between d and f, in font units
SIZE, BOX = 40, 64                          # same letter size and canvas as the old icon
sc = SIZE / font["head"].unitsPerEm

def bounds(name):
    bp = BoundsPen(gs); gs[name].draw(bp); return bp.bounds
d, f = cmap[ord("d")], cmap[ord("f")]
db, fb = bounds(d), bounds(f)
f_off = db[2] + GAP - fb[0]                 # x shift of f so its ink starts GAP after d's ink
ink_l, ink_r = db[0], f_off + fb[2]
ink_t, ink_b = max(db[3], fb[3]), min(db[1], fb[1])
cx, cy = BOX / 2, BOX / 2
tx = cx - (ink_l + ink_r) / 2 * sc          # centre the ink box in the square, both ways
ty = cy + (ink_t + ink_b) / 2 * sc

def path(name, dx):
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    gs[name].draw(TransformPen(pen, (sc, 0, 0, -sc, tx + dx * sc, ty)))
    return pen.getCommands()

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#fff3da"/>
  <path fill="#1b2033" d="{path(d, 0)}"/>
  <path fill="#f59a00" d="{path(f, f_off - 0)}"/>
</svg>
'''
open("static/favicon.svg", "w", encoding="utf-8").write(svg)
print("ink box (px):", round(ink_l*sc+tx,2), round(BOX-(ink_r*sc+tx),2), round(ty-ink_t*sc,2), round(BOX-(ty-ink_b*sc),2))
