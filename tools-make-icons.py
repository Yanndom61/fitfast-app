#!/usr/bin/env python3
"""Generate FitFast PWA icons."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math
import os

OUT = "/workspace/fitfast-app/icons"
BG = (14, 19, 17, 255)
RING_BG = (44, 56, 51, 255)
FAST = (111, 191, 176, 255)
EAT = (232, 160, 74, 255)
CREAM = (243, 239, 230, 255)
INNER = (14, 19, 17, 255)

def clock_to_pil(hours):
    # 0h = 12 o'clock. PIL pieslice: 0° at 3 o'clock, clockwise.
    # 12 o'clock = 270°, each hour = 30°.
    return (hours / 12.0) * 360.0 - 90.0

def rounded_rect_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m

def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        draw.rectangle((0, 0, size, size), fill=BG)
        # keep artwork in the safe 80% central zone
        margin = int(size * 0.12)
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)
        margin = int(size * 0.14)

    cx = cy = size / 2
    outer = size - 2 * margin
    bbox = [margin, margin, margin + outer - 1, margin + outer - 1]

    # Track
    stroke = max(int(size * 0.09), 8)
    draw.ellipse(bbox, outline=RING_BG, width=stroke)

    # Fasting arc (full ring already drawn); gold eating window 11:30–18:30
    start = clock_to_pil(11.5)
    end = clock_to_pil(18.5)
    # PIL goes clockwise from start to end; convert to a span
    # Normalize and draw pieslice then mask to a ring
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    # eating arc
    # pieslice from start to end clockwise
    span_end = end
    if span_end <= start:
        span_end += 360
    rd.pieslice(bbox, start, span_end, fill=EAT)
    # punch inner hole and outer
    inner_pad = stroke
    inner_bbox = [bbox[0] + inner_pad, bbox[1] + inner_pad, bbox[2] - inner_pad, bbox[3] - inner_pad]
    rd.ellipse(inner_bbox, fill=(0, 0, 0, 0))
    # also clear outside the outer ellipse by compositing later via mask
    # Rebuild with proper transparency: use a ring mask
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.pieslice(bbox, start, span_end, fill=255)
    # ring only
    hole = Image.new("L", (size, size), 0)
    hd = ImageDraw.Draw(hole)
    hd.ellipse(bbox, fill=255)
    hd.ellipse(inner_bbox, fill=0)
    final_mask = Image.new("L", (size, size), 0)
    # intersect pieslice mask with ring
    import numpy as np
    a = list(mask.getdata())
    b = list(hole.getdata())
    inter = [min(x, y) for x, y in zip(a, b)]
    final_mask.putdata(inter)
    gold = Image.new("RGBA", (size, size), EAT)
    img = Image.composite(gold, img, final_mask)

    # Soft inner disc
    draw = ImageDraw.Draw(img)
    inset = stroke + max(int(size * 0.02), 2)
    inner_disc = [bbox[0] + inset, bbox[1] + inset, bbox[2] - inset, bbox[3] - inset]
    draw.ellipse(inner_disc, fill=BG)

    # Text 17:7
    text = "17:7"
    # Fit font
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    font_size = int(size * 0.22)
    font = ImageFont.truetype(font_path, font_size)
    # slightly tighter
    bbox_t = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox_t[2] - bbox_t[0], bbox_t[3] - bbox_t[1]
    tx = (size - tw) / 2 - bbox_t[0]
    ty = (size - th) / 2 - bbox_t[1] - int(size * 0.01)
    draw.text((tx, ty), text, font=font, fill=CREAM)

    return img

def main():
    os.makedirs(OUT, exist_ok=True)
    variants = [
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (192, True, "icon-192-maskable.png"),
        (512, True, "icon-512-maskable.png"),
        (180, False, "apple-touch-icon.png"),
        (32, False, "favicon-32.png"),
        (16, False, "favicon-16.png"),
    ]
    for size, maskable, name in variants:
        im = draw_icon(size, maskable=maskable)
        path = os.path.join(OUT, name)
        im.save(path, "PNG")
        print("wrote", path, im.size)

if __name__ == "__main__":
    main()
