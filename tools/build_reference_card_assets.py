"""Build Godot card assets from the supplied product-photo reference palette."""

from base64 import b64encode
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "docs" / "OIP-C.webp"
OUTPUT = ROOT / "assets" / "cards"
FONT = ROOT / "assets" / "fonts" / "WenYueWuLongHongRuYiFaKai" / "WenYue-WLHRuYiFaKai-JF-2.otf"
SMALL = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
BIG = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾"]
RED_VALUES = {2, 7, 10}


def sampled_paper() -> tuple[int, int, int]:
    # The reference is compressed and its exposed card faces are shadowed. This
    # keeps its warm, aged stock appearance without carrying over table-green.
    return (247, 242, 222)


def make_card(label: str, is_red: bool, target: Path, paper: tuple[int, int, int]) -> None:
    scale = 4
    size = (180 * scale, 720 * scale)
    card = Image.new("RGB", size, paper)
    draw = ImageDraw.Draw(card)
    ink = (168, 29, 27) if is_red else (20, 17, 13)
    draw.rounded_rectangle((7, 7, size[0] - 8, size[1] - 8), radius=36, outline=(198, 180, 143), width=10)
    draw.rounded_rectangle((28, 28, size[0] - 29, size[1] - 29), radius=22, outline=(228, 214, 180), width=5)
    # Fine, low-contrast fibers keep the flat game asset close to the printed stock in the reference.
    for y in range(48, size[1] - 48, 23):
        draw.line((45, y, size[0] - 45, y), fill=(238, 231, 209), width=1)
    font = ImageFont.truetype(str(FONT), 320 * scale)
    def glyph_for(text: str) -> Image.Image:
        # Render into a generous scratch canvas first. Some brush glyphs have
        # overhangs outside Pillow's nominal text bbox; drawing directly into
        # the crop can therefore lose the right half of the character.
        scratch = Image.new("RGBA", (700 * scale, 700 * scale), (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(scratch)
        layer_draw.text((80 * scale, 80 * scale), text, font=font, fill=ink + (255,))
        alpha_box = scratch.getchannel("A").getbbox()
        if alpha_box is None:
            raise RuntimeError(f"Font did not render glyph: {text}")
        glyph = scratch.crop(alpha_box)
        # Fit both constraints: nearly full card width, but never taller than
        # the available half-card region. This prevents tall brush glyphs from
        # being clipped at either edge.
        target_width = int(164 * 0.85) * scale
        target_height = int(310 * 0.85) * scale
        fit = min(target_width / max(1, glyph.width), target_height / max(1, glyph.height))
        return glyph.resize((max(1, int(glyph.width * fit)), max(1, int(glyph.height * fit))), Image.Resampling.LANCZOS)
    top = glyph_for(label)
    center_x = size[0] // 2
    top_center_y = 88 * scale
    bottom_center_y = 632 * scale
    card.paste(top, (center_x - top.width // 2, top_center_y - top.height // 2), top)
    bottom = top.rotate(180, expand=True)
    card.paste(bottom, (center_x - bottom.width // 2, bottom_center_y - bottom.height // 2), bottom)
    card.convert("RGB").resize((180, 720), Image.Resampling.LANCZOS).save(target, "PNG", optimize=True)


def make_svg(png_path: Path) -> None:
    encoded = b64encode(png_path.read_bytes()).decode("ascii")
    png_path.with_suffix(".svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="720" viewBox="0 0 180 720">'
        '<image width="180" height="720" href="data:image/png;base64,' + encoded + '"/></svg>\n', encoding="utf-8"
    )


def main() -> None:
    if not REFERENCE.exists() or not FONT.exists():
        raise SystemExit("Missing reference image or brush font.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    paper = sampled_paper()
    for prefix, labels in (("small", SMALL), ("big", BIG)):
        for value, label in enumerate(labels, start=1):
            png = OUTPUT / f"{prefix}_{value:02d}.png"
            make_card(label, value in RED_VALUES, png, paper)
            make_svg(png)


if __name__ == "__main__":
    main()
