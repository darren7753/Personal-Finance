"""Draws static/share.png (1200x630), the picture chat apps show when the site link is shared.
Run: uv run --with pillow python tools/make_share_image.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1200, 630
bg = Image.new("RGB", (W, H))
px = bg.load()
c1, c2, c3 = (255, 232, 214), (214, 226, 255), (255, 243, 200)
for y in range(H):
    for x in range(W):
        t = x / W; u = y / H
        a = [c1[i] * (1 - t) + c2[i] * t for i in range(3)]
        px[x, y] = tuple(int(a[i] * (1 - u * .6) + c3[i] * u * .6) for i in range(3))
NUNITO = "secrets/fonts/Nunito.ttf"   # the site's font (variable, git-ignored); see handoff.md
def nunito(size, weight):
    f = ImageFont.truetype(NUNITO, size); f.set_variation_by_axes([weight]); return f
# glass card
card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(card)
d.rounded_rectangle((100, 130, 1100, 500), 56, fill=(40, 50, 120, 60))
card = card.filter(ImageFilter.GaussianBlur(26))
bg = Image.alpha_composite(bg.convert("RGBA"), card)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((100, 110, 1100, 480), 56, fill=(255, 255, 255, 190), outline=(255, 255, 255, 255), width=3)
# app icon
d.rounded_rectangle((170, 205, 370, 405), 50, fill=(255, 243, 218))
fi = nunito(125, 900)   # 200 px square x 0.625 = the favicon proportion
# centre the ink of "df" (d dark, f orange, tight spacing) inside the square, both ways
dl, dt, dr, db = d.textbbox((0, 0), "d", font=fi)
fl, ft, fr, fb = d.textbbox((0, 0), "f", font=fi)
gap = -5
fx = (dr - dl) + gap - (fl - dl) + dl           # x offset of "f" so its ink starts `gap` after d's ink
ink_l, ink_r = dl, fx + fr
ink_t, ink_b = min(dt, ft), max(db, fb)
ox = 170 + (200 - (ink_r - ink_l)) / 2 - ink_l - 2
oy = 205 + (200 - (ink_b - ink_t)) / 2 - ink_t
d.text((ox, oy), "d", font=fi, fill=(27, 32, 51))
d.text((ox + fx - fl + fl, oy), "f", font=fi, fill=(245, 154, 0))
# title
d.text((420, 222), "darren's", font=nunito(76, 900), fill=(27, 32, 51))
x = 420 + d.textlength("darren's ", font=nunito(76, 900))
d.text((x, 222), "finance", font=nunito(76, 900), fill=(245, 154, 0))
d.text((422, 330), "Salary, spending and wealth in one place", font=nunito(32, 700), fill=(90, 98, 130))
bg.convert("RGB").save("static/share.png", optimize=True)
