#!/usr/bin/env python3
"""Cut the phone screens' video from source footage.

    python3 scripts/deck_media.py [SOURCE_DIR]

Reads scripts/deck-shots.txt. For each name, every shot is cropped to a tall
9:16 frame around its center, scaled to 720x1280 at 30 fps, slowed if asked,
given the same light grade, and joined in order. Writes media/v2/deck/<name>.mp4
(H.264, no sound, starts fast on the web) and a poster <name>.jpg.

SOURCE_DIR defaults to media/ (the current site's reels). New footage can live
anywhere: pass its folder and name the files in the shot list.
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "scripts", "deck-shots.txt")
OUT = os.path.join(ROOT, "media", "v2", "deck")
W, H, FPS = 720, 1280, 30
GRADE = "eq=contrast=1.06:saturation=1.08"


def run(args):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args], check=True)


def size(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
        check=True, capture_output=True, text=True,
    ).stdout.strip().split(",")
    return int(out[0]), int(out[1])


def read_shots():
    groups = {}
    with open(SHOTS) as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            name, source, start, dur, center, speed = line.split()
            groups.setdefault(name, []).append((source, float(start), float(dur), float(center), float(speed)))
    return groups


def crop_filter(sw, sh, center):
    # The tallest 9:16 frame the source holds, slid across to the shot's center.
    cw = min(sw, round(sh * 9 / 16 / 2) * 2)
    ch = min(sh, round(cw * 16 / 9 / 2) * 2)
    x = max(0, min(sw - cw, round(center * sw - cw / 2)))
    y = (sh - ch) // 2
    return f"crop={cw}:{ch}:{x}:{y}"


def main():
    src_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "media")
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="deck-")
    try:
        for name, shots in read_shots().items():
            parts = []
            for i, (source, start, dur, center, speed) in enumerate(shots):
                path = os.path.join(src_dir, source)
                sw, sh = size(path)
                part = os.path.join(tmp, f"{name}-{i:02d}.mp4")
                vf = ",".join([
                    crop_filter(sw, sh, center),
                    f"scale={W}:{H}:flags=lanczos",
                    f"setpts=PTS/{speed}",
                    f"fps={FPS}",
                    GRADE,
                    "setsar=1",
                    "format=yuv420p",
                ])
                run(["-ss", str(start), "-t", str(dur), "-i", path, "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", part])
                parts.append(part)
            listing = os.path.join(tmp, f"{name}.txt")
            with open(listing, "w") as f:
                f.writelines(f"file '{p}'\n" for p in parts)
            video = os.path.join(OUT, f"{name}.mp4")
            run(["-f", "concat", "-safe", "0", "-i", listing, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
                 "-profile:v", "high", "-pix_fmt", "yuv420p", "-g", str(FPS), "-movflags", "+faststart", video])
            run(["-ss", "0.2", "-i", video, "-frames:v", "1", "-q:v", "5", os.path.join(OUT, f"{name}.jpg")])
            print(f"{name}: {len(parts)} shots, {os.path.getsize(video) // 1024} KB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
