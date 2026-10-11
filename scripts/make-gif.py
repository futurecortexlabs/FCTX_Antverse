"""
Assemble report frame sequences into an animated GIF (needs Pillow).

    python scripts/make-gif.py docs/reports/phase-2/seq docs/reports/phase-2/walk.gif [width] [frame_ms]

Frames are the PNGs in the input directory, in name order, cropped to the
centre 16:9 region below the HUD and scaled to `width` (default 800).
"""

import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 800
    frame_ms = int(sys.argv[4]) if len(sys.argv) > 4 else 100
    frames = []
    for p in sorted(src.glob("*.png")):
        im = Image.open(p).convert("RGB")
        w, h = im.size
        # Centre crop at half size: the followed ant sits in the middle, the HUD (top-left) is cut away.
        cw, ch = w // 2, h // 2
        box = ((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2)
        im = im.crop(box).resize((width, width * ch // cw), Image.LANCZOS)
        frames.append(im.quantize(colors=64, method=Image.MEDIANCUT))
    if not frames:
        raise SystemExit(f"no frames in {src}")
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=frame_ms, loop=0, optimize=True)
    print(f"wrote {dst} ({len(frames)} frames, {dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
