#!/usr/bin/env python3
"""Compose Pixel Camera highlight: 800×480 UI centered on an Apple-style stage."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
OUT_W, OUT_H = 2360, 1440
UI_W, UI_H = 800, 480
# UI occupies ~62% of frame height — generous stage margin on all sides.
UI_SCALE_H = int(OUT_H * 0.62)


def font(size: int) -> ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def stage_background() -> Image.Image:
    """Quiet Apple-style stage: subtle cool blue-slate bloom into true black.

    Matched to a restrained product-film reference — barely-there center lift
    (~RGB 21,25,35), pure black margins, no warm wash, no neon.
    """
    w, h = OUT_W, OUT_H
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    cx, cy = w * 0.50, h * 0.48
    rx, ry = w * 0.48, h * 0.46
    r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    t = np.clip(r, 0.0, 1.0) ** 1.7

    # Sampled from the reference: cool periwinkle-slate → black.
    center = np.array([21.0, 25.0, 35.0], dtype=np.float32)
    mid = np.array([12.0, 14.0, 20.0], dtype=np.float32)
    edge = np.array([0.0, 0.0, 0.0], dtype=np.float32)

    mid_t = np.clip(t * 1.15, 0.0, 1.0)
    rgb = center * (1.0 - mid_t)[..., None] + mid * mid_t[..., None]
    outer = np.clip((t - 0.55) / 0.45, 0.0, 1.0) ** 1.4
    rgb = rgb * (1.0 - outer)[..., None] + edge * outer[..., None]

    # Whisper of grain only — keep the field quiet.
    rng = np.random.default_rng(42)
    noise = rng.normal(0.0, 1.1, size=(h, w, 1)).astype(np.float32)
    rgb = np.clip(rgb + noise, 0, 255)

    return Image.fromarray(rgb.astype(np.uint8))


def title_card(
    path: Path,
    lines: list[tuple[str, int, tuple[int, int, int]]],
    bg: Image.Image,
) -> None:
    img = bg.copy()
    draw = ImageDraw.Draw(img)
    rendered: list[tuple[str, ImageFont.ImageFont, tuple[int, int, int], int, int]] = []
    total_h = 0
    LINE_GAP = 52  # breathing room between title + subtitle
    for text, size, color in lines:
        f = font(size)
        bbox = draw.textbbox((0, 0), text, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        rendered.append((text, f, color, tw, th))
        total_h += th + LINE_GAP
    total_h -= LINE_GAP
    y = (OUT_H - total_h) // 2
    for text, f, color, tw, th in rendered:
        # Soft shadow under type for depth on the lit stage.
        draw.text(((OUT_W - tw) // 2 + 1, y + 2), text, font=f, fill=(0, 0, 0))
        draw.text(((OUT_W - tw) // 2, y), text, font=f, fill=color)
        y += th + LINE_GAP
    img.save(path)
    print("wrote", path)


def make_shadow(ui_w: int, ui_h: int) -> Image.Image:
    """Soft contact + ambient shadow under the UI plate."""
    pad = 110
    canvas = Image.new("RGBA", (ui_w + pad * 2, ui_h + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (pad + 4, pad + 36, pad + ui_w - 4, pad + ui_h + 28),
        radius=22,
        fill=(0, 0, 0, 200),
    )
    canvas = canvas.filter(ImageFilter.GaussianBlur(radius=48))
    return canvas


def stage_with_shadow(bg: Image.Image, ui_w: int, ui_h: int) -> Image.Image:
    """Background + pre-baked shadow plate (shared across all frames)."""
    stage = bg.convert("RGBA")
    shadow = make_shadow(ui_w, ui_h)
    ox = (OUT_W - ui_w) // 2
    oy = (OUT_H - ui_h) // 2
    stage.alpha_composite(shadow, (ox - 110, oy - 110))
    return stage


def composite_ui_plate(
    frame_rgb: Image.Image,
    stage_base: Image.Image,
    ui_w: int,
    ui_h: int,
) -> Image.Image:
    """Place a UI frame onto the pre-baked stage with rounded corners."""
    ui = frame_rgb.convert("RGBA").resize((ui_w, ui_h), Image.Resampling.LANCZOS)

    # Slight screen-like rounding at the staged size (~22px ≈ 12px at 800×480).
    corner_r = max(18, int(ui_h * 0.028))
    mask = Image.new("L", (ui_w, ui_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, ui_w - 1, ui_h - 1), radius=corner_r, fill=255)
    ui.putalpha(mask)

    # 1px hairline rim so the plate separates cleanly from the lit stage.
    rim = Image.new("RGBA", (ui_w, ui_h), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(
        (0, 0, ui_w - 1, ui_h - 1),
        radius=corner_r,
        outline=(255, 255, 255, 28),
        width=1,
    )
    ui = Image.alpha_composite(ui, rim)

    stage = stage_base.copy()
    ox = (OUT_W - ui_w) // 2
    oy = (OUT_H - ui_h) // 2
    stage.alpha_composite(ui, (ox, oy))
    return stage.convert("RGB")


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd[:8]), "..." if len(cmd) > 8 else "")
    subprocess.run(cmd, check=True)


def main() -> int:
    raw = ROOT / "pixel-ui-highlight-raw.webm"
    if not raw.exists():
        print("Missing", raw, file=sys.stderr)
        return 1

    bg = stage_background()
    bg_path = ROOT / "stage-bg.png"
    bg.save(bg_path, "PNG")
    print("wrote", bg_path)

    title_card(
        ROOT / "title-open.png",
        [
            ("Pixel Camera", 96, (245, 245, 247)),
            ("Raspberry Pi camera control", 36, (168, 172, 180)),
        ],
        bg,
    )
    title_card(
        ROOT / "title-feat.png",
        [("Live viewfinder. Manual control.", 52, (245, 245, 247))],
        bg,
    )
    title_card(
        ROOT / "title-close.png",
        [("Pixel Camera", 88, (245, 245, 247))],
        bg,
    )

    # Extract PNG sequence from the raw recording, composite each onto stage.
    frames_dir = ROOT / "stage-frames"
    if frames_dir.exists():
        for p in frames_dir.glob("*.png"):
            p.unlink()
    else:
        frames_dir.mkdir()

    run(
        [
            "ffmpeg", "-y", "-i", str(raw),
            "-vf", "fps=30",
            str(frames_dir / "f_%05d.png"),
        ]
    )

    frame_paths = sorted(frames_dir.glob("f_*.png"))
    if not frame_paths:
        print("No frames extracted", file=sys.stderr)
        return 1

    staged_dir = ROOT / "staged-frames"
    if staged_dir.exists():
        for p in staged_dir.glob("*.png"):
            p.unlink()
    else:
        staged_dir.mkdir()

    ui_w = int(UI_W * (UI_SCALE_H / UI_H))
    ui_h = UI_SCALE_H
    # Force even dims for yuv420p friendliness.
    ui_w -= ui_w % 2
    ui_h -= ui_h % 2
    stage_base = stage_with_shadow(bg, ui_w, ui_h)

    print(f"compositing {len(frame_paths)} frames onto stage…")
    for i, fp in enumerate(frame_paths):
        plate = composite_ui_plate(Image.open(fp), stage_base, ui_w, ui_h)
        plate.save(staged_dir / f"s_{i + 1:05d}.png")
        if (i + 1) % 60 == 0:
            print(f"  {i + 1}/{len(frame_paths)}")

    run(
        [
            "ffmpeg", "-y",
            "-framerate", "30",
            "-i", str(staged_dir / "s_%05d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-crf", "16", "-preset", "slow",
            "-an", str(ROOT / "ui.mp4"),
        ]
    )

    for name, dur in (("open", "2.8"), ("inter", "2.2"), ("close", "2.8")):
        src = ROOT / (
            f"title-{'open' if name == 'open' else 'feat' if name == 'inter' else 'close'}.png"
        )
        run(
            [
                "ffmpeg", "-y", "-loop", "1", "-i", str(src),
                "-t", dur, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
                str(ROOT / f"{name}.mp4"),
            ]
        )

    probe = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", str(ROOT / "ui.mp4"),
        ],
        text=True,
    ).strip()
    ui_dur = float(probe)
    off01 = 2.8 - 0.6
    off012 = off01 + 2.2 - 0.6
    off0123 = off012 + ui_dur - 0.6

    out = ROOT / "pixel-ui-highlight.mp4"
    run(
        [
            "ffmpeg", "-y",
            "-i", str(ROOT / "open.mp4"),
            "-i", str(ROOT / "inter.mp4"),
            "-i", str(ROOT / "ui.mp4"),
            "-i", str(ROOT / "close.mp4"),
            "-filter_complex",
            (
                f"[0:v][1:v]xfade=transition=fade:duration=0.6:offset={off01}[v01];"
                f"[v01][2:v]xfade=transition=fade:duration=0.6:offset={off012}[v012];"
                f"[v012][3:v]xfade=transition=fade:duration=0.6:offset={off0123}[vout]"
            ),
            "-map", "[vout]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow",
            "-movflags", "+faststart",
            str(out),
        ]
    )

    info = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "default=noprint_wrappers=1", str(out),
        ],
        text=True,
    )
    # Quick proof frame for visual QA.
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", "8", "-i", str(out),
            "-frames:v", "1", "-update", "1", str(ROOT / "check-stage.png"),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(out)
    print(info)
    print(f"(UI logical size {UI_W}x{UI_H}, staged height {UI_SCALE_H})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
