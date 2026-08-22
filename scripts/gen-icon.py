#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 build/icon.ico —— 深蓝圆底 + 白色对话气泡（多分辨率 16/32/48/256）。
纯标准库实现：自己画 RGBA 像素 -> 编码 PNG -> 包成 PNG-in-ICO。
无需 Pillow / 任何第三方依赖。
"""
import math
import os
import struct
import zlib

BRAND = (0x4D, 0x6B, 0xFE)  # DeepSeek 蓝
WHITE = (255, 255, 255)


def smoothstep(a, b, x):
    t = (x - a) / (b - a)
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def sdf_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sdf_round_rect(px, py, cx, cy, half_w, half_h, radius):
    qx = abs(px - cx) - (half_w - radius)
    qy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def draw_icon(size):
    """返回 RGBA 字节串，长度 = size*size*4。"""
    buf = bytearray()
    for y in range(size):
        for x in range(size):
            # 归一化到 [-1, 1]
            nx = (x + 0.5) / size * 2 - 1
            ny = (y + 0.5) / size * 2 - 1

            # 蓝色底盘圆（半径 0.96）
            d_disk = sdf_circle(nx, ny, 0.0, 0.0, 0.96)
            disk_a = 1.0 - smoothstep(-0.02, 0.02, d_disk)

            # 白色对话气泡：居中偏上的圆角矩形
            b_cx, b_cy = 0.0, 0.08
            d_bubble = sdf_round_rect(nx, ny, b_cx, b_cy, 0.46, 0.34, 0.20)
            bubble_a = 1.0 - smoothstep(-0.015, 0.015, d_bubble)

            # 气泡底部小尾巴（三角）
            tail_top = -0.26
            tail_bot = tail_top + 0.18
            if tail_top <= ny <= tail_bot:
                half = 0.12 * (1.0 - (ny - tail_top) / 0.18)
                if abs(nx) <= half:
                    bubble_a = max(bubble_a, 1.0)

            # 合成颜色
            R, G, B = BRAND
            if bubble_a > 0:
                a = bubble_a
                R = int(R * (1 - a) + WHITE[0] * a)
                G = int(G * (1 - a) + WHITE[1] * a)
                B = int(B * (1 - a) + WHITE[2] * a)

            alpha = max(disk_a, bubble_a)
            buf.extend(bytes([R, G, B, int(alpha * 255)]))
    return buf


def encode_png(size, rgba):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba[y * size * 4:(y + 1) * size * 4])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data +
                struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', comp)
    png += chunk(b'IEND', b'')
    return png


def pngs_to_ico(pngs):
    """pngs: list of (size, png_bytes) -> ICO 字节。"""
    n = len(pngs)
    entries = b''
    data = b''
    base = 6 + 16 * n
    for size, png in pngs:
        bw = size if size < 256 else 0
        bh = size if size < 256 else 0
        entry = struct.pack('<BBBBHHII', bw, bh, 0, 0, 1, 32,
                            len(png), base + len(data))
        entries += entry
        data += png
    header = b'\x00\x00\x01\x00' + struct.pack('<H', n)
    return header + entries + data


def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'icon.ico')

    sizes = [16, 32, 48, 256]
    pngs = []
    for s in sizes:
        rgba = draw_icon(s)
        pngs.append((s, encode_png(s, rgba)))

    ico = pngs_to_ico(pngs)
    with open(out_path, 'wb') as f:
        f.write(ico)

    print('wrote', out_path, '(%d bytes, sizes=%s)' % (len(ico), sizes))


if __name__ == '__main__':
    main()
