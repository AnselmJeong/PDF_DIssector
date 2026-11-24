"""Draw the app icon (a document with a magnifier over a highlighted line) into app/icon.iconset.

Run with the engine's Python (Pillow): ../engine/.venv/bin/python scripts/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icon.iconset"
S = 1024


def draw():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # macOS squircle-ish background
    d.rounded_rectangle((60, 60, S - 60, S - 60), radius=210, fill=(36, 74, 140, 255))
    # paper
    d.rounded_rectangle((250, 170, 720, 820), radius=40, fill=(250, 248, 242, 255))
    for k, y in enumerate(range(270, 760, 62)):
        w = 380 if k % 3 != 2 else 260
        color = (255, 214, 92, 255) if k == 3 else (190, 196, 210, 255)
        if k == 3:
            d.rounded_rectangle((300, y - 18, 300 + w + 20, y + 22), radius=10, fill=color)
        else:
            d.rounded_rectangle((310, y - 8, 310 + w, y + 10), radius=9, fill=color)
    # magnifier
    cx, cy, r = 640, 600, 165
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(20, 30, 50, 255), width=46)
    d.ellipse((cx - r + 30, cy - r + 30, cx + r - 30, cy + r - 30), fill=(210, 230, 255, 120))
    d.line((cx + 115, cy + 115, cx + 290, cy + 290), fill=(20, 30, 50, 255), width=70)
    return im


def main():
    OUT.mkdir(exist_ok=True)
    base = draw()
    for size in (16, 32, 128, 256, 512):
        base.resize((size, size), Image.LANCZOS).save(OUT / f"icon_{size}x{size}.png")
        base.resize((size * 2, size * 2), Image.LANCZOS).save(OUT / f"icon_{size}x{size}@2x.png")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
