#!/usr/bin/env python3
# EduTrans logo v2: gradient rounded square + bilingual dual speech bubbles.
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(OUT, exist_ok=True)


def clamp01(x):
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def aa_mask(d, edge=1.0):
    # d < 0 inside, > 0 outside
    return clamp01(0.5 - d / edge)


def rounded_rect_d(x, y, x0, y0, x1, y1, r):
    cx = max(x0 + r - x, x - (x1 - r), 0.0)
    cy = max(y0 + r - y, y - (y1 - r), 0.0)
    d_out = math.sqrt(cx * cx + cy * cy)
    if d_out > 0.0:
        return d_out
    d_in = min(x - x0, x1 - x, y - y0, y1 - y)
    return -d_in


def bubble_alpha(x, y, x0, y0, x1, y1, r):
    return aa_mask(rounded_rect_d(x, y, x0, y0, x1, y1, r))


def mix(c1, c2, t):
    return tuple(int(round(c1[i] * (1 - t) + c2[i] * t)) for i in range(3))


C_INDIGO = (79, 70, 229)
C_BLUE = (37, 99, 235)
C_DEEP = (30, 64, 175)
C_WHITE = (255, 255, 255)
C_BLUEBAR = (37, 99, 235)
C_REDBAR = (239, 68, 68)


def render(size):
    img = []
    s = size / 128.0
    for y in range(size):
        fy = y + 0.5
        row = []
        for x in range(size):
            fx = x + 0.5
            bg_d = rounded_rect_d(fx, fy, 4 * s, 4 * s, 124 * s, 124 * s, 28 * s)
            bg_a = aa_mask(bg_d, 1.8 * s)
            if bg_a <= 0:
                row.append((0, 0, 0, 0))
                continue
            t = clamp01((fx + fy) / (240.0 * s))
            col = mix(C_INDIGO, C_BLUE, clamp01(t * 1.5))
            col = mix(col, C_DEEP, clamp01((t - 0.6) * 2.2))
            # back bubble: translucent white, upper-left
            bb = bubble_alpha(fx, fy, 16 * s, 18 * s, 86 * s, 62 * s, 15 * s)
            bt = bubble_alpha(fx, fy, 28 * s, 62 * s, 44 * s, 76 * s, 6 * s)
            back = max(bb, bt) * 0.34
            col = mix(col, C_WHITE, back)
            # front bubble: solid white, lower-right
            fb = bubble_alpha(fx, fy, 38 * s, 42 * s, 114 * s, 100 * s, 16 * s)
            ft = bubble_alpha(fx, fy, 52 * s, 100 * s, 72 * s, 114 * s, 6 * s)
            front = max(fb, ft)
            if front > 0:
                col = mix(col, C_WHITE, front)

            def bar(x0, y0, x1, y1, color, rr=3.5):
                nonlocal col
                a = bubble_alpha(fx, fy, x0 * s, y0 * s, x1 * s, y1 * s, rr * s)
                if a > 0:
                    col = mix(col, color, a)
            bar(50, 56, 102, 65, C_BLUEBAR)
            bar(50, 71, 94, 80, C_BLUEBAR)
            bar(50, 86, 68, 95, C_REDBAR)
            row.append((col[0], col[1], col[2], int(round(255 * bg_a))))
        img.append(row)
    return img


def chunk(tag, data):
    c = struct.pack('>I', len(data)) + tag + data
    c += struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return c


def write_png(path, size, img):
    raw = b''
    for row in img:
        raw += b'\x00'
        for p in row:
            raw += struct.pack('4B', *p)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    f = open(path, 'wb')
    f.write(b'\x89PNG\r\n\x1a\n')
    f.write(chunk(b'IHDR', ihdr))
    f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
    f.write(chunk(b'IEND', b''))
    f.close()


for sz in (16, 32, 48, 128):
    write_png(os.path.join(OUT, 'icon%d.png' % sz), sz, render(sz))
    print('icon%d.png written' % sz)
