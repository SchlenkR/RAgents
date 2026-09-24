# Erzeugt aus dem gewählten Entwurf die Logo-SVGs und das VS-Code-Icon: python3 build.py (braucht potracer, pillow, numpy, rsvg-convert)
import subprocess
from pathlib import Path

import numpy as np
import potrace
from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parents[2]
source = root / "docs/logo-drafts/drafts/terminator-icons/09-brille-outline-dark.png"
logo = root / "docs/logo"
vscode = root / "apps/vscode/media"


def trace(dilate: int) -> str:
    mask = np.array(Image.open(source).convert("L")) > 140
    ys, xs = np.where(mask)
    pad = 40
    crop = Image.fromarray((mask * 255).astype("uint8")).crop((xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad))
    side = max(crop.size)
    square = Image.new("L", (side, side), 0)
    square.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    thick = square.filter(ImageFilter.MaxFilter(dilate)) if dilate else square
    curves = potrace.Bitmap(np.array(thick) <= 127).trace(turdsize=12, alphamax=1.0, opttolerance=0.3)
    d = "".join(curve_path(curve) for curve in curves)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}"><path fill="currentColor" fill-rule="evenodd" d="{d}"/></svg>\n'


def curve_path(curve) -> str:
    start = f"M{curve.start_point.x:.1f} {curve.start_point.y:.1f}"
    segments = "".join(
        f"L{s.c.x:.1f} {s.c.y:.1f}L{s.end_point.x:.1f} {s.end_point.y:.1f}"
        if s.is_corner
        else f"C{s.c1.x:.1f} {s.c1.y:.1f} {s.c2.x:.1f} {s.c2.y:.1f} {s.end_point.x:.1f} {s.end_point.y:.1f}"
        for s in curve
    )
    return start + segments + "Z"


def tile(svg: str, size: int, out: Path) -> None:
    glyph = int(size * 0.8)
    rendered = out.with_suffix(".glyph.png")
    subprocess.run(["rsvg-convert", "-w", str(glyph), "-h", str(glyph), "-o", rendered], input=svg.replace("currentColor", "#fff").encode(), check=True)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=(34, 51, 71, 255))
    image.alpha_composite(Image.open(rendered).convert("RGBA"), ((size - glyph) // 2, (size - glyph) // 2))
    rendered.unlink()
    image.save(out)


fine = trace(0)
bold = trace(9)
(logo / "skull-line.svg").write_text(fine)
(logo / "skull-line-bold.svg").write_text(bold)
(vscode / "ragents.svg").write_text(bold)
tile(fine, 256, vscode / "icon.png")
print("skull-line.svg, skull-line-bold.svg, apps/vscode/media/ragents.svg, apps/vscode/media/icon.png")
