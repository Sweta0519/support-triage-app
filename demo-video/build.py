"""Assembles the demo video (SUP-44) from the frames record.mjs captured.

    python3 demo-video/build.py            # -> demo-video/build/support-triage-demo.mp4

Steps: narration with macOS `say`, title cards and captions with Pillow,
each scene's frames into a clip fitted to its narration, crossfades between
scenes, and a generated ambient music bed that ducks under the voice.
Needs ffmpeg and Pillow. The shot list is in script.md.
"""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
FRAMES = BUILD / "frames"
WORK = BUILD / "work"
OUT = BUILD / "support-triage-demo.mp4"

W, H, FPS = 1920, 1080, 30
XFADE = 0.5  # seconds of crossfade between scenes
VOICE, RATE = "Samantha", 172
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"

SCENES = [
    {"id": "01-title", "card": ("Support Triage", "Every ticket, understood in seconds."),
     "say": "Support teams lose the first minutes of every ticket just working out what it is: "
            "how urgent it is, who should take it, and whether it's already been reported."},
    {"id": "02-customer", "clips": ["02-customer"],
     "say": "A customer files a ticket, the usual way."},
    {"id": "03-triage", "clips": ["03-triage"],
     "say": "Support Triage reads every new ticket the moment it arrives. In seconds, the AI suggests a "
            "category, a priority with its reason, the right team, related and duplicate tickets, how "
            "frustrated the customer is, and whether it might escalate. It drafts a first reply, and lists "
            "what's still needed from the customer. Every run shows its model, prompt version and cost."},
    {"id": "04-review", "clips": ["04-review"],
     "say": "It never acts on its own. An agent confirms or corrects it in one click, and nothing reaches "
            "the customer until a person sends it."},
    {"id": "05-queue", "clips": ["05-queue"],
     "say": "The queue puts what's urgent first, with live response-time targets, so nothing quietly goes overdue."},
    {"id": "06-board", "clips": ["06-board"],
     "say": "Prefer a board? Drag tickets between columns, flag them for follow-up, and label them right on the card."},
    {"id": "07-learning", "clips": ["07-learning"],
     "say": "And it learns. When the team corrects the AI, those corrections become examples for the next "
            "similar ticket. The panel shows exactly which ones it used, and an admin can exclude a bad one."},
    {"id": "08-incident", "clips": ["08-incident"],
     "say": "When several customers report the same problem at once, it spots the incident, groups the "
            "tickets, and drafts one update for all of them, sent only when the team says so."},
    {"id": "09-sage", "clips": ["09a-note", "09b-sage"],
     "say": "Every agent also has Sage, a private assistant that answers from their own notes, and says which note it used."},
    {"id": "10-analytics", "clips": ["10-analytics"],
     "say": "Analytics show SLA performance, how often the team accepts the AI, whether that's improving, "
            "and how customers rate the help they got."},
    {"id": "11-montage", "montage": [
        ("11-m01-on-behalf", "Staff file tickets for customers"),
        ("11-m02-csat", "Customers rate resolved tickets"),
        ("11-m03-share", "A shareable status page"),
        ("11-m04-labels", "Team labels"),
        ("11-m05-rerun", "Re-run the AI on any ticket"),
        ("11-m07-admin", "Admin overview, roles and people"),
        ("11-m08-settings", "Your settings, your theme"),
        ("11-m09-security", "Secure by default: RLS, CSRF, rate limits"),
        ("11-m10-tests", "Tested end to end, live on Vercel"),
     ],
     "say": "And everything a real help desk needs is already here."},
    {"id": "12-close", "card": ("Support Triage", "The AI does the reading. Your team does the helping."),
     "say": "Support Triage. The AI does the reading, so your team can do the helping."},
]
SHOT = 1.9  # seconds per montage shot


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def ffmpeg(*args):
    run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def narrate(scene):
    aiff, wav = WORK / f"{scene['id']}.aiff", WORK / f"{scene['id']}.wav"
    run("say", "-v", VOICE, "-r", RATE, "-o", aiff, scene["say"])
    ffmpeg("-i", aiff, "-ar", "48000", "-ac", "2", wav)
    return wav, duration(wav)


def logo(size):
    png = WORK / f"logo-{size}.png"
    if not png.exists():
        run("node", "-e", f"require('sharp')('{ROOT.parent / 'app' / 'icon.svg'}').resize({size},{size}).png().toFile('{png}')")
    return Image.open(png).convert("RGBA")


def card_image(title, subtitle):
    img = Image.new("RGB", (W, H), "#0b0b14")
    glow = Image.new("RGB", (W, H), "#0b0b14")
    ImageDraw.Draw(glow).ellipse((W / 2 - 700, H / 2 - 420, W / 2 + 700, H / 2 + 420), fill="#2a1f6b")
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(220)), 0.9)
    mark = logo(150)
    img.paste(mark, ((W - 150) // 2, 300), mark)
    d = ImageDraw.Draw(img)
    d.text((W / 2, 540), title, font=font(96, True), fill="white", anchor="mm")
    d.text((W / 2, 640), subtitle, font=font(44), fill="#c9c6ff", anchor="mm")
    return img


def caption_png(text, path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(46, True)
    box = d.textbbox((0, 0), text, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    x0, y0 = (W - tw) / 2 - 36, H - 170
    d.rounded_rectangle((x0, y0, x0 + tw + 72, y0 + th + 44), radius=22, fill=(17, 17, 27, 225))
    d.text((W / 2, y0 + (th + 44) / 2), text, font=f, fill="white", anchor="mm")
    img.save(path)


def frames_to_clip(name, out):
    """A screencast frame set -> constant-30fps 1080p clip (frames last until the next one)."""
    meta = json.loads((FRAMES / name / "frames.json").read_text())
    frames, end = meta["frames"], meta["ended"]
    lines = []
    for i, fr in enumerate(frames):
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
        lines += [f"file '{FRAMES / name / fr['file']}'", f"duration {max(nxt - fr['t'], 1 / FPS):.4f}"]
    lines.append(f"file '{FRAMES / name / frames[-1]['file']}'")
    listfile = WORK / f"{name}.txt"
    listfile.write_text("\n".join(lines) + "\n")
    ffmpeg("-f", "concat", "-safe", "0", "-i", listfile,
           "-vf", f"scale={W}:{H}:flags=lanczos,fps={FPS},format=yuv420p",
           "-c:v", "libx264", "-crf", "16", "-preset", "medium", out)
    return duration(out)


def fit(src, length, target, out, extra_vf=None):
    """Speeds a clip up to fit `target` seconds (at most 2.2x), else holds its last frame."""
    speed = min(max(length / target, 1.0), 2.2)
    vf = [f"setpts=PTS/{speed:.4f}", f"tpad=stop_mode=clone:stop_duration={target + 1}", f"trim=duration={target:.3f}",
          "setpts=PTS-STARTPTS", f"fps={FPS}", "format=yuv420p"]
    args = ["-i", src]
    if extra_vf:
        args += ["-i", extra_vf]
        filt = f"[0:v]{','.join(vf)}[v];[v][1:v]overlay=0:0,format=yuv420p"
        ffmpeg(*args, "-filter_complex", filt, "-an", "-c:v", "libx264", "-crf", "16", out)
    else:
        ffmpeg(*args, "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-crf", "16", out)


def concat(parts, out):
    listfile = WORK / f"{out.stem}-parts.txt"
    listfile.write_text("".join(f"file '{p}'\n" for p in parts))
    ffmpeg("-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", out)
    return duration(out)


def music(seconds, out):
    """A soft ambient pad: four slow chords (Cmaj7, Am7, Fmaj7, G6), 4 s each, echoed and low-passed."""
    chords = [[261.63, 329.63, 392.0, 493.88], [220.0, 261.63, 329.63, 392.0],
              [174.61, 220.0, 261.63, 329.63], [196.0, 246.94, 293.66, 329.63]]
    terms = []
    for i, ch in enumerate(chords):
        tone = "+".join(f"sin(2*PI*{f}*t)+0.35*sin(2*PI*{f * 2}*t)" for f in ch)
        terms.append(f"(between(mod(t,16),{i * 4},{i * 4 + 4})*({tone}))")
    expr = f"0.05*({'+'.join(terms)})*(0.75+0.25*sin(2*PI*0.25*t))"
    ffmpeg("-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={seconds:.2f}",
           "-af", "lowpass=f=1400,aecho=0.8:0.7:120|260:0.35|0.25,afade=t=in:d=2,"
                  f"afade=t=out:st={seconds - 3:.2f}:d=3,aformat=channel_layouts=stereo",
           out)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    clips, voices = [], []
    for scene in SCENES:
        sid = scene["id"]
        wav, said = narrate(scene)
        target = said + 1.2  # breathing room after the line
        out = WORK / f"{sid}.mp4"
        if "card" in scene:
            png = WORK / f"{sid}.png"
            card_image(*scene["card"]).save(png)
            ffmpeg("-loop", "1", "-i", png, "-t", f"{target + 0.6:.2f}", "-vf",
                   f"zoompan=z='1+0.0004*on':d=1:s={W}x{H}:fps={FPS},format=yuv420p",
                   "-c:v", "libx264", "-crf", "16", out)
        elif "montage" in scene:
            shots = []
            for name, text in scene["montage"]:
                raw = WORK / f"{name}-raw.mp4"
                length = frames_to_clip(name, raw)
                cap = WORK / f"{name}-cap.png"
                caption_png(text, cap)
                shot = WORK / f"{name}.mp4"
                fit(raw, length, SHOT, shot, extra_vf=cap)
                shots.append(shot)
            concat(shots, out)
        else:
            parts = []
            for name in scene["clips"]:
                raw = WORK / f"{name}-raw.mp4"
                frames_to_clip(name, raw)
                parts.append(raw)
            joined = WORK / f"{sid}-joined.mp4"
            length = concat(parts, joined)
            fit(joined, length, target, out)
        clips.append((out, duration(out)))
        voices.append(wav)
        print(f"{sid}: {clips[-1][1]:.1f} s (narration {said:.1f} s)")

    # Crossfade the scenes; each scene's narration starts 0.4 s into it.
    inputs, vf, starts = [], [], []
    t, label = 0.0, "0:v"
    for i, (clip, length) in enumerate(clips):
        inputs += ["-i", clip]
        starts.append(t)
        if i:
            vf.append(f"[{label}][{i}:v]xfade=transition=fade:duration={XFADE}:offset={t:.3f}[x{i}]")
            label = f"x{i}"
        t += length - XFADE
    total = t + XFADE
    music_wav = WORK / "music.wav"
    music(total, music_wav)
    n = len(clips)
    for wav in voices:
        inputs += ["-i", wav]
    inputs += ["-i", music_wav]
    af = [f"[{n + i}:a]adelay={int((starts[i] + 0.4) * 1000)}|{int((starts[i] + 0.4) * 1000)}[v{i}]" for i in range(n)]
    af.append("".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,apad[voice]")
    af.append("[voice]asplit[vo][key]")
    af.append(f"[{2 * n}:a][key]sidechaincompress=threshold=0.02:ratio=8:attack=60:release=600[bed]")
    af.append(f"[vo][bed]amix=inputs=2:normalize=0,atrim=duration={total:.3f},loudnorm=I=-16:TP=-1.5[a]")
    ffmpeg(*inputs, "-filter_complex", ";".join(vf + af), "-map", f"[{label}]", "-map", "[a]",
           "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT)
    print(f"\n{OUT} ({duration(OUT):.1f} s)")


if __name__ == "__main__":
    main()
