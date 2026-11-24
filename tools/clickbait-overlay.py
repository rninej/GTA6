from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, os

SRC = "screenshots/clickbait-chase-01.png"
OUT = "screenshots/clickbait-chase-final.png"

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# Cinematic top/bottom grade, then the HUD-style poster text.
shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
sd = ImageDraw.Draw(shade)
for y in range(h):
    top = max(0, 1 - y / (h * 0.36))
    bottom = max(0, (y - h * 0.58) / (h * 0.42))
    a = int(120 * top + 170 * bottom)
    if a:
        sd.line([(0, y), (w, y)], fill=(4, 4, 8, a))
img = Image.alpha_composite(img, shade)

draw = ImageDraw.Draw(img)
def font(size):
    return ImageFont.load_default(size=size)

def text(x, y, s, size, fill=(255, 255, 255, 255), shadow=(0, 0, 0, 220)):
    f = font(size)
    draw.text((x + 3, y + 4), s, font=f, fill=shadow)
    draw.text((x, y), s, font=f, fill=fill)

# Wanted stars, top right.
star_x, star_y, r = w - 54, 48, 17
for i in range(4):
    cx = star_x - i * 44
    pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + math.cos(ang) * rr, star_y + math.sin(ang) * rr))
    draw.polygon(pts, fill=(255, 42, 42, 255), outline=(255, 255, 255, 180))

text(42, 30, "PALMA CITY", 52, (255, 255, 255, 255))
text(44, 96, "4-STAR PURSUIT", 25, (255, 196, 64, 255))
text(44, 128, "STEAL. RUN. SURVIVE.", 19, (230, 236, 245, 235))

text(44, h - 86, "PLAY FREE IN YOUR BROWSER", 25, (255, 255, 255, 255))
text(44, h - 52, "No install. No account.", 18, (220, 228, 240, 235))

img.convert("RGB").save(OUT, quality=94)
print(OUT, img.size, os.path.getsize(OUT))
