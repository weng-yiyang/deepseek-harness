#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 LobeHub @lobehub/icons CDN 下载 DeepSeek 品牌图标，
生成 build/icon.ico（多分辨率 16/32/48/256）。

依赖：pip install pillow
来源：https://lobehub.com/icons → static-png CDN（DeepSeek 蓝鲸吉祥物）
"""
import os
import struct
import sys
import urllib.request
import zlib

try:
    from PIL import Image
except ImportError:
    print('[ERROR] 需要 Pillow：python -m pip install pillow')
    sys.exit(1)

# ── 配置 ───────────────────────────────────────────────
ICON_ID = 'deepseek'
VARIANT = 'color'          # 'color' = 品牌蓝鲸 / '' = 黑色剪影
MODE = 'light'
SIZES = [16, 32, 48, 256]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'build')
OUT_FILE = 'icon.ico'

CDN_URL = (
    f'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master'
    f'/packages/static-png/{MODE}/{ICON_ID}'
)
if VARIANT:
    CDN_URL += f'-{VARIANT}'
CDN_URL += '.png'


# ── PNG 编码（纯标准库，不依赖 Pillow 写 PNG）──────────
def encode_png(size, rgba):
    """RGBA bytes -> PNG bytes."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter None
        raw.extend(rgba[y * size * 4:(y + 1) * size * 4])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data +
                struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b'')


# ── ICO 打包（多张 PNG 合并为 ICO 文件）──────────────────
def pngs_to_ico(pngs):
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


# ── 主流程 ─────────────────────────────────────────────
def main():
    out_dir = os.path.abspath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, OUT_FILE)

    # 1) 下载或使用缓存
    tmp_png = os.path.join(out_dir, '_lobesrc', f'{ICON_ID}-{VARIANT}.png')
    os.makedirs(os.path.dirname(tmp_png), exist_ok=True)

    if not (os.path.exists(tmp_png) and os.path.getsize(tmp_png) > 0):
        print(f'[1/4] 下载 {ICON_ID}-{VARIANT}.png ...')
        req = urllib.request.Request(CDN_URL, headers={'User-Agent': 'dsh-desktop/0.1'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        with open(tmp_png, 'wb') as f:
            f.write(data)
        print(f'      已保存 ({len(data)} bytes)')
    else:
        print(f'[1/4] 使用缓存: {tmp_png}')

    # 2) 用 Pillow 打开并缩放各尺寸
    img = Image.open(tmp_png).convert('RGBA')
    w, h = img.size
    print(f'[2/4] 原始: {w}x{h} RGBA')

    pngs = []
    for s in SIZES:
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        rgba = resized.tobytes()  # raw RGBA bytes
        png_bytes = encode_png(s, rgba)
        pngs.append((s, png_bytes))
        print(f'      {s}x{s} -> {len(png_bytes)} bytes')

    # 3) 打包成 ICO
    ico = pngs_to_ico(pngs)
    with open(out_path, 'wb') as f:
        f.write(ico)
    print(f'[3/4] 已写入: {out_path} ({len(ico)} bytes, {len(SIZES)} 尺寸)')

    # 4) 验证
    with open(out_path, 'rb') as f:
        hdr = f.read(6)
    count = struct.unpack_from('<H', hdr, 4)[0]
    print(f'[4/4] 验证通过: ICO 含 {count} 张图片')


if __name__ == '__main__':
    main()
