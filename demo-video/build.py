"""Renders the demo video (SUP-44) from what record.mjs captured.

    /usr/bin/python3 demo-video/build.py   # -> demo-video/build/support-triage-demo.mp4 (+ .vtt captions)
    /usr/bin/python3 demo-video/build.py --captions   # captions only, from the last render

(/usr/bin/python3 because it has Pillow; ffmpeg must be on PATH.)

The look of a product video, made from the raw screen recording:
- the app sits as a floating window (rounded corners, soft shadow) on a
  gradient, and the camera glides in to what matters and back out, from
  the cam() keyframes record.mjs logged;
- each section opens with a headline caption, the montage captions every shot;
- frames captured mid-scroll (which can tear) are replaced by a dissolve;
- the cursor and click ripples are drawn here from record.mjs's mouse log, so
  they move smoothly at 30 fps whatever rate the screen was captured at;
- animated title and closing cards;
- narration by ElevenLabs (or macOS `say` without a key), crossfades, and a generated music bed
  (pad, plucked arpeggio, soft kick and hats) that ducks under the voice.
The shot list is in script.md.
"""

import bisect
import hashlib
import json
import math
import os
import random
import re
import struct
import subprocess
import urllib.request
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
FRAMES = BUILD / "frames"
WORK = BUILD / "work"
OUT = BUILD / "support-triage-demo.mp4"

W, H, FPS = 1920, 1080, 30
XFADE = 0.6  # seconds of crossfade between scenes
VOICE, RATE = "Samantha", 168  # macOS fallback when there's no ElevenLabs key
# ElevenLabs narration (ELEVENLABS_API_KEY in .env.local). The first of these
# premade voices the account has; ELEVENLABS_VOICE overrides it.
ELEVEN_VOICES = ["Sarah", "Matilda", "Alice", "Brian", "Rachel"]
ELEVEN_MODEL = "eleven_multilingual_v2"
TTS_CACHE = BUILD / "tts-cache"
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
# The cursor and camera are drawn here, so a still capture doesn't mean
# nothing is happening: stills are only capped in scenes that wait on the
# model (`max_still`), where nothing moves meanwhile.
MAX_SPEED = 2.0
MOVE = 0.9  # seconds a camera move takes, in the finished video
INSET = 0.86  # the window's size on the gradient when the camera is all the way out
SHOT = 2.1  # seconds per montage shot

SCENES = [
    {"id": "01-title", "card": ("Support Triage", "Every ticket, understood in seconds."),
     "say": "Every support ticket starts with the same questions. What is this? How urgent is it? "
            "And who should take it? Support Triage answers them in seconds."},
    {"id": "02-customer", "clips": ["02-customer"], "max_speed": 3.0,
     "caption": ("THE CUSTOMER", "A ticket comes in"),
     "say": "A customer writes in."},
    {"id": "03-triage", "clips": ["03-triage"],
     "caption": ("AI TRIAGE", "Understood in seconds"),
     "say": "Before anyone opens it, the AI has read it. Category, priority, and the reason why. The right team. "
            "How frustrated the customer is. What's still missing. And a first reply, already drafted. "
            "Every run shows its model, and what it cost."},
    {"id": "04-sage", "clips": ["04-sage"], "max_speed": 2.5, "max_still": 1.5,  # the wait for Sage's answer
     "caption": ("SAGE", "Your private AI assistant"),
     "say": "Need the policy? Ask Sage, your private assistant. It answers from your own notes, and shows which one it used."},
    {"id": "05-review", "clips": ["05-review"],
     "caption": ("HUMAN IN THE LOOP", "AI suggests. People decide."),
     "say": "The AI only suggests. An agent corrects it in one click, claims the ticket, and sends the reply. "
            "Nothing reaches a customer without a person."},
    {"id": "06-queue", "clips": ["06-queue"],
     "caption": ("THE QUEUE", "Nothing goes overdue"),
     "say": "The queue keeps the team on time, with live response targets, urgent work first, "
            "and every action one click away."},
    {"id": "07-board", "clips": ["07-board"],
     "caption": ("THE BOARD", "Drag. Drop. Done."),
     "say": "Prefer a board? Drag and drop."},
    {"id": "08-learning", "clips": ["08-learning"],
     "caption": ("LEARNING", "It learns from your team"),
     "say": "And it learns. Every correction becomes an example for the next similar ticket, "
            "and you can see exactly which ones it used."},
    {"id": "09-incident", "clips": ["09-incident"],
     "caption": ("INCIDENTS", "One problem. One update."),
     "say": "When many customers hit the same problem, it spots the incident, and drafts one update for all of them. "
            "Your team decides when it goes out."},
    {"id": "10-analytics", "clips": ["10-analytics"],
     "caption": ("ANALYTICS", "Know it's working"),
     "say": "Analytics show response times, customer satisfaction, and whether the AI is getting better."},
    # Each montage shot has its own line, and lasts as long as it.
    {"id": "11-montage", "montage": [
        ("11-m01-on-behalf", "File tickets for customers",
         "Plus everything a modern help desk needs. Agents file tickets for customers who call in."),
        ("11-m02-csat", "Customers rate the help they got", "Customers rate the help they got."),
        ("11-m03-share", "Shareable status pages", "Share a public status page for any ticket."),
        ("11-m04-labels", "Team labels", "Organise the work with team labels."),
        ("11-m05-rerun", "Re-run the AI any time", "Re-run the AI whenever you need to."),
        ("11-m07-admin", "Admin overview", "Admins see the whole operation at a glance."),
        ("11-m08-settings", "Light and dark themes", "Light and dark themes."),
        ("11-m09-security", "Secure by default", "It's secure by default,"),
        ("11-m10-privacy", "Privacy built in", "with a clear privacy policy, and your data under your control."),
     ],
     "say": "Plus everything a modern help desk needs."},
    {"id": "12-close", "card": ("Support Triage", "The AI does the reading. Your team does the helping."),
     "say": "Support Triage. The AI does the reading. Your team does the helping."},
]


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def ffmpeg(*args):
    run("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args)


def duration(path):
    # From ffmpeg's own header line, so ffprobe isn't needed.
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def font(size, weight="regular"):
    return ImageFont.truetype(FONT, size, index={"regular": 0, "bold": 1, "light": 7}[weight])


def ease(p):
    p = max(0.0, min(1.0, p))
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def env(name):
    """From the environment, else from the repo's .env.local (never printed)."""
    if os.environ.get(name):
        return os.environ[name]
    path = ROOT.parent / ".env.local"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip().removeprefix("export ").lstrip()
            if line.startswith(f"{name}="):
                value = line.split("=", 1)[1].strip()
                if value[:1] in "\"'" and value[-1:] == value[:1] and len(value) > 1:
                    return value[1:-1]
                return value.split(" #", 1)[0].strip()  # an unquoted value's trailing comment
    return None


def eleven(path, method="GET", body=None):
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/{path}", method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"xi-api-key": env("ELEVENLABS_API_KEY"), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


_voice_id = None


def eleven_voice():
    """ELEVENLABS_VOICE (a name or id) from the account's voices, else the first of ELEVEN_VOICES found."""
    global _voice_id
    if _voice_id is None:
        voices = json.loads(eleven("voices"))["voices"]
        wanted = [env("ELEVENLABS_VOICE")] if env("ELEVENLABS_VOICE") else ELEVEN_VOICES
        for name in wanted:
            match = [v for v in voices if v["voice_id"] == name or v["name"].split(" ")[0].lower() == name.lower()]
            if match:
                _voice_id = match[0]["voice_id"]
                print(f"ElevenLabs voice: {match[0]['name']}", flush=True)
                break
        else:
            raise SystemExit(f"None of {wanted} among this account's ElevenLabs voices: {[v['name'] for v in voices]}")
    return _voice_id


def narrate(scene, prev_text=None, next_text=None):
    """One scene's line: ElevenLabs when ELEVENLABS_API_KEY is set (cached by
    text and voice, so re-renders don't spend characters), else macOS `say`."""
    wav = WORK / f"{scene['id']}.wav"
    if env("ELEVENLABS_API_KEY"):
        voice = eleven_voice()
        key = hashlib.sha1(json.dumps([voice, ELEVEN_MODEL, scene["say"], prev_text, next_text]).encode()).hexdigest()[:16]
        TTS_CACHE.mkdir(parents=True, exist_ok=True)
        mp3 = TTS_CACHE / f"{key}.mp3"
        if not mp3.exists():
            body = {"text": scene["say"], "model_id": ELEVEN_MODEL,
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}}
            # The neighbouring lines keep the delivery consistent from scene to scene.
            if prev_text:
                body["previous_text"] = prev_text
            if next_text:
                body["next_text"] = next_text
            mp3.write_bytes(eleven(f"text-to-speech/{voice}?output_format=mp3_44100_128", "POST", body))
        ffmpeg("-i", mp3, "-ar", "48000", "-ac", "2", wav)
    else:
        aiff = WORK / f"{scene['id']}.aiff"
        run("say", "-v", VOICE, "-r", RATE, "-o", aiff, scene["say"])
        ffmpeg("-i", aiff, "-ar", "48000", "-ac", "2", wav)
    return wav, duration(wav)


def narrate_montage(scene, prev_text, next_text):
    """One line per montage shot. Each shot lasts its line plus a beat (at
    least SHOT), and the lines are joined with silence to match, so every
    line plays over its own shot. Returns (wav, seconds, shot lengths)."""
    lines = [text for _, _, text in scene["montage"]]
    parts, lengths = [], []
    for k, (name, _, text) in enumerate(scene["montage"]):
        wav, said = narrate({"id": name, "say": text},
                            lines[k - 1] if k else prev_text, lines[k + 1] if k + 1 < len(lines) else next_text)
        seconds = max(SHOT, said + 0.6)  # the scene audio starts 0.5 s in
        padded = WORK / f"{name}-padded.wav"
        ffmpeg("-i", wav, "-af", f"apad,atrim=duration={seconds:.3f}", "-ar", "48000", "-ac", "2", padded)
        parts.append(padded)
        lengths.append(seconds)
    listfile = WORK / "11-montage-audio.txt"
    listfile.write_text("".join(f"file '{p}'\n" for p in parts))
    out = WORK / f"{scene['id']}.wav"
    ffmpeg("-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", out)
    # The scene's own target adds 1.3 s; the shots already include their beats.
    return out, sum(lengths) - 1.3, lengths


# ---- looks -------------------------------------------------------------

def background():
    """Deep indigo with two soft glows."""
    img = Image.new("RGB", (W, H), "#0a0a1a")
    glow = Image.new("RGB", (W, H), "#0a0a1a")
    d = ImageDraw.Draw(glow)
    d.ellipse((-300, -400, 1100, 700), fill="#3b2a9e")
    d.ellipse((1000, 500, 2300, 1500), fill="#7b2f8f")
    return Image.blend(img, glow.filter(ImageFilter.GaussianBlur(260)), 0.75)


BG = None
_shadow_cache, _mask_cache = {}, {}


def shadow(size):
    if size not in _shadow_cache:
        sw, sh = size
        s = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        x0, y0 = (W - sw) // 2, (H - sh) // 2 + 18
        ImageDraw.Draw(s).rounded_rectangle((x0, y0, x0 + sw, y0 + sh), radius=24, fill=(0, 0, 0, 150))
        _shadow_cache[size] = s.filter(ImageFilter.GaussianBlur(36))
    return _shadow_cache[size]


def round_mask(size, radius):
    key = (size, radius)
    if key not in _mask_cache:
        m = Image.new("L", size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
        _mask_cache[key] = m
    return _mask_cache[key]


def logo(size):
    png = WORK / f"logo-{size}.png"
    if not png.exists():
        run("node", "-e", f"require('sharp')('{ROOT.parent / 'app' / 'icon.svg'}').resize({size},{size}).png().toFile('{png}')")
    return Image.open(png).convert("RGBA")


def caption_card(eyebrow, headline):
    """A dark glass card: small spaced eyebrow over a big headline."""
    fe, fh = font(26, "bold"), font(64, "bold")
    eyebrow = " ".join(eyebrow)  # letter-spaced
    d0 = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    ew = d0.textbbox((0, 0), eyebrow, font=fe)[2]
    hw = d0.textbbox((0, 0), headline, font=fh)[2]
    cw, ch = max(ew, hw) + 96, 180
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, cw - 1, ch - 1), radius=28, fill=(14, 12, 30, 225), outline=(255, 255, 255, 40), width=2)
    d.text((48, 34), eyebrow, font=fe, fill=(167, 160, 255, 255))
    d.text((48, 74), headline, font=fh, fill=(255, 255, 255, 255))
    return card


def pill(text):
    f = font(44, "bold")
    d0 = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    tw = d0.textbbox((0, 0), text, font=f)[2]
    p = Image.new("RGBA", (tw + 80, 92), (0, 0, 0, 0))
    d = ImageDraw.Draw(p)
    d.rounded_rectangle((0, 0, tw + 79, 91), radius=46, fill=(14, 12, 30, 230), outline=(255, 255, 255, 40), width=2)
    d.text(((tw + 80) / 2, 46), text, font=f, fill="white", anchor="mm")
    return p


def overlay(frame, img, xy, alpha):
    if alpha <= 0:
        return
    a = img.getchannel("A").point(lambda v: int(v * alpha))
    frame.paste(img, xy, a)


# ---- timeline ----------------------------------------------------------

class Clip:
    """One recorded shot: its frames on a timeline with long stills capped,
    and its camera keyframes on the same timeline."""

    def __init__(self, name, max_still=None):
        d = FRAMES / name
        meta = json.loads((d / "frames.json").read_text())
        self.dir = d
        self.src = (meta["size"]["width"], meta["size"]["height"]) if "size" in meta else (W, H)
        frames, end = meta["frames"], meta["ended"]
        self.files, self.starts = [], []
        real, comp = [], []
        c = 0.0
        for i, fr in enumerate(frames):
            nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
            self.files.append(fr["file"])
            self.starts.append(c)
            real.append(fr["t"])
            comp.append(c)
            gap = max(nxt - fr["t"], 0.0)
            c += min(gap, max_still) if max_still else gap
        self.length = c
        self._real, self._comp, self._max_still = real, comp, max_still
        cam_file = d / "camera.json"
        keys = json.loads(cam_file.read_text()) if cam_file.exists() else []
        sx, sy = self.src
        if not keys:
            keys = [{"t": meta["started"], "x": sx / 2, "y": sy / 2, "zoom": 1}]
        self.keys = [(self.to_comp(k["t"]), k["x"], k["y"], k["zoom"]) for k in keys]
        self._cache = (None, None)
        mouse_file = d / "mouse.json"
        moves = json.loads(mouse_file.read_text()) if mouse_file.exists() else []
        self.mouse = [(self.to_comp(m["t"]), m["x"], m["y"]) for m in moves if not m.get("click")]
        self._mouse_times = [m[0] for m in self.mouse]
        self._key_times = [k[0] for k in self.keys]
        self._starts = {}  # per move duration: where each keyframe's ease starts
        self.clicks = [self.to_comp(m["t"]) for m in moves if m.get("click")]
        scroll_file = d / "scrolls.json"
        spans = json.loads(scroll_file.read_text()) if scroll_file.exists() else []
        self.scrolls = [(self.to_comp(sp["from"]), self.to_comp(sp["to"])) for sp in spans]

    def to_comp(self, t):
        i = bisect.bisect_right(self._real, t) - 1
        if i < 0:
            return 0.0
        into = t - self._real[i]
        if self._max_still:
            into = min(into, self._max_still)
        return min(self._comp[i] + into, self._comp[i + 1] if i + 1 < len(self._comp) else self.length)

    def cursor_at(self, c):
        """Where the cursor is at time c (None if this shot has no mouse log)."""
        if not self.mouse:
            return None
        i = bisect.bisect_right(self._mouse_times, c) - 1
        if i < 0:
            return self.mouse[0][1:]
        if i + 1 >= len(self.mouse):
            return self.mouse[-1][1:]
        (t0, x0, y0), (t1, x1, y1) = self.mouse[i], self.mouse[i + 1]
        p = ease((c - t0) / (t1 - t0)) if t1 > t0 else 1
        return x0 + (x1 - x0) * p, y0 + (y1 - y0) * p

    def frame_at(self, c):
        # Mid-scroll captures can tear: dissolve from before the scroll to after it.
        for c0, c1 in self.scrolls:
            if c0 < c < c1:
                # A quick 0.25 s blend at the middle, so text doesn't ghost for long.
                mid = (c0 + c1) / 2
                a, b = self._frame(c0 - 0.01).copy(), self._frame(c1)
                return Image.blend(a, b, ease((c - mid) / 0.25 + 0.5))
        return self._frame(c)

    def _frame(self, c):
        i = max(0, bisect.bisect_right(self.starts, c) - 1)
        if self._cache[0] != i:
            self._cache = (i, Image.open(self.dir / self.files[i]).convert("RGB"))
        return self._cache[1]

    def camera_at(self, c, move):
        """(x, y, zoom) at time c: each keyframe eases from where the camera was."""
        starts = self._starts.get(move)
        if starts is None:
            starts = []
            for k, (ck, x, y, z) in enumerate(self.keys):
                if k == 0:
                    starts.append((x, y, z))
                    continue
                starts.append(self._eval(ck, k - 1, starts, move))
            self._starts[move] = starts
        last = max(0, bisect.bisect_right(self._key_times, c) - 1)
        return self._eval(c, last, starts, move)

    def _eval(self, c, k, starts, move):
        ck, x, y, z = self.keys[k]
        x0, y0, z0 = starts[k]
        p = ease((c - ck) / move) if move > 0 else 1
        zl = math.exp(math.log(z0) + (math.log(z) - math.log(z0)) * p)
        return x0 + (x - x0) * p, y0 + (y - y0) * p, zl


def compose(src, cam):
    """The source frame seen through the camera, as a floating window on the gradient."""
    x, y, z = cam
    sw, sh = src.size
    cw, ch = sw / z, sh / z
    x = min(max(x, cw / 2), sw - cw / 2)
    y = min(max(y, ch / 2), sh - ch / 2)
    s = INSET + (1 - INSET) * ease((z - 1) / 0.45)
    if s >= 0.999:
        s = 1.0
    ww, wh = (W, H) if s == 1.0 else (int(W * s) // 2 * 2, int(H * s) // 2 * 2)
    view = src.resize((ww, wh), Image.BICUBIC, box=(x - cw / 2, y - ch / 2, x + cw / 2, y + ch / 2))
    # Maps a source point to the output frame.
    ox, oy, k = (W - ww) // 2, (H - wh) // 2, ww / cw
    to_out = lambda px, py: (ox + (px - (x - cw / 2)) * k, oy + (py - (y - ch / 2)) * k)
    if s == 1.0:
        return view, to_out, k
    frame = BG.copy()
    frame.paste(shadow((ww, wh)), (0, 0), shadow((ww, wh)))
    frame.paste(view, (ox, oy), round_mask((ww, wh), int(22 * s / INSET)))
    return frame, to_out, k


_cursor_cache = {}


def cursor_img(size):
    """The arrow cursor, drawn 4x and scaled down for smooth edges."""
    size = max(12, int(size))
    if size not in _cursor_cache:
        S = 4 * size
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pts = [(0.17, 0.08), (0.83, 0.48), (0.54, 0.54), (0.40, 0.83)]
        poly = [(px * S, py * S) for px, py in pts]
        shadow_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(shadow_layer).polygon([(px + S * 0.03, py + S * 0.04) for px, py in poly], fill=(0, 0, 0, 90))
        img = Image.alpha_composite(img, shadow_layer.filter(ImageFilter.GaussianBlur(S * 0.03)))
        d = ImageDraw.Draw(img)
        d.polygon(poly, fill=(17, 17, 17, 255), outline=(255, 255, 255, 255), width=max(2, int(S * 0.06)))
        _cursor_cache[size] = img.resize((size, size), Image.LANCZOS)
    return _cursor_cache[size]


def draw_pointer(frame, clip, c, to_out, k, speed):
    """The cursor, and a ripple for half a second after each click."""
    pos = clip.cursor_at(c)
    if pos is None:
        return
    cx, cy = to_out(*pos)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for tc in clip.clicks:
        age = (c - tc) / speed  # in finished-video seconds
        if 0 <= age < 0.55:
            r = (14 + 60 * ease(age / 0.55)) * k
            a = int(140 * (1 - age / 0.55))
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(99, 102, 241, a))
    frame.paste(layer, (0, 0), layer)
    pressed = any(0 <= (c - tc) / speed < 0.15 for tc in clip.clicks)
    img = cursor_img(46 * k * (0.85 if pressed else 1))
    frame.paste(img, (int(cx - img.width * 0.17), int(cy - img.height * 0.08)), img)


class Encoder:
    def __init__(self, out):
        self.p = subprocess.Popen(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
             "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "17", "-preset", "medium",
             "-pix_fmt", "yuv420p", str(out)],
            stdin=subprocess.PIPE)

    def write(self, img):
        self.p.stdin.write(img.convert("RGB").tobytes())

    def close(self):
        self.p.stdin.close()
        if self.p.wait() != 0:
            raise SystemExit(f"ffmpeg failed while encoding (exit {self.p.returncode})")


def render_clip(enc, clip, seconds, speed, caption=None, pill_img=None, tail=False):
    """Writes `seconds` of the clip at `speed`, holding the last frame if it runs out."""
    n = int(round(seconds * FPS))
    offset = max(0.0, clip.length - seconds * speed) if tail else 0.0
    move = MOVE * speed
    for k in range(n):
        u = k / FPS
        c = min(offset + u * speed, clip.length)
        frame, to_out, k_scale = compose(clip.frame_at(c), clip.camera_at(c, move))
        draw_pointer(frame, clip, c, to_out, k_scale, speed)
        if caption is not None:
            # In over 0.5 s at 0.3 s, out at 3.6 s, rising 20 px.
            a = ease((u - 0.3) / 0.5) * (1 - ease((u - 3.6) / 0.5))
            overlay(frame, caption, (90, H - caption.height - 80 + int(20 * (1 - a))), a)
        if pill_img is not None:
            a = ease(u / 0.3) * (1 - ease((u - seconds + 0.25) / 0.25))
            overlay(frame, pill_img, ((W - pill_img.width) // 2, H - pill_img.height - 70), a)
        enc.write(frame)


def render_card(enc, title, subtitle, seconds):
    mark = logo(170)
    ft, fs = font(110, "bold"), font(46)
    n = int(round(seconds * FPS))
    for k in range(n):
        u = k / FPS
        frame = BG.copy()
        # A slow push-in on the background.
        z = 1 + 0.03 * u / seconds
        frame = frame.resize((int(W * z), int(H * z)), Image.BICUBIC).crop(
            (int(W * (z - 1) / 2), int(H * (z - 1) / 2), int(W * (z - 1) / 2) + W, int(H * (z - 1) / 2) + H))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        a1, a2, a3 = (ease((u - t0) / 0.7) for t0 in (0.1, 0.45, 0.8))
        m = mark.copy()
        m.putalpha(m.getchannel("A").point(lambda v: int(v * a1)))
        layer.paste(m, ((W - 170) // 2, 280 + int(24 * (1 - a1))), m)
        d.text((W / 2, 560 + 24 * (1 - a2)), title, font=ft, fill=(255, 255, 255, int(255 * a2)), anchor="mm")
        d.text((W / 2, 670 + 24 * (1 - a3)), subtitle, font=fs, fill=(201, 198, 255, int(255 * a3)), anchor="mm")
        frame.paste(layer, (0, 0), layer)
        enc.write(frame)


# ---- music -------------------------------------------------------------

def music(seconds, out, sr=44100):
    """A calm, modern bed at 96 BPM: a soft chord pad, a plucked arpeggio,
    a low kick and quiet hats, in A minor / C / F / G."""
    bpm = 96
    beat = 60 / bpm
    bar = 4 * beat
    chords = [[220.0, 261.63, 329.63], [261.63, 329.63, 392.0], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]]
    n = int(seconds * sr)
    rnd = random.Random(7)
    noise = [rnd.uniform(-1, 1) for _ in range(4096)]
    two_pi = 2 * math.pi
    frames = bytearray()
    for i in range(n):
        t = i / sr
        ch = chords[int(t / bar) % 4]
        # Pad: detuned sines with a slow swell per bar.
        pb = (t % bar) / bar
        swell = 0.6 + 0.4 * math.sin(math.pi * pb)
        pad = sum(math.sin(two_pi * f * t) + 0.5 * math.sin(two_pi * f * 1.003 * t) for f in ch) * 0.045 * swell
        # Arpeggio: eighth notes up the chord, an octave up, plucked.
        step = int(t / (beat / 2))
        tn = t % (beat / 2)
        f = ch[step % 3] * 2
        arp = math.sin(two_pi * f * t) * math.exp(-tn * 9) * 0.10
        # Kick on beats 1 and 3, hats on the off-beats.
        tb = t % beat
        kick = 0.0
        if int(t / beat) % 2 == 0:
            kick = math.sin(two_pi * (45 + 70 * math.exp(-tb * 30)) * tb) * math.exp(-tb * 9) * 0.32
        th = (t + beat / 2) % beat
        hat = noise[i % 4096] * math.exp(-th * 60) * 0.035
        # The pad and arpeggio duck a little on each kick (a gentle pump).
        duck = 1 - 0.35 * math.exp(-tb * 6) if int(t / beat) % 2 == 0 else 1.0
        v = (pad + arp) * duck + kick + hat
        # Fade in and out.
        v *= min(1.0, t / 2.0, (seconds - t) / 3.0)
        s = int(max(-1.0, min(1.0, v)) * 32000)
        frames += struct.pack("<hh", s, s)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(bytes(frames))


# ---- main --------------------------------------------------------------

def main():
    global BG
    WORK.mkdir(parents=True, exist_ok=True)
    BG = background()
    clips, voices = [], []
    for i, scene in enumerate(SCENES):
        sid = scene["id"]
        prev_say = SCENES[i - 1]["say"] if i else None
        next_say = SCENES[i + 1]["say"] if i + 1 < len(SCENES) else None
        if "montage" in scene:
            wav, said, shot_lengths = narrate_montage(scene, prev_say, next_say)
        else:
            wav, said = narrate(scene, prev_say, next_say)
        target = said + 1.3  # breathing room after the line
        out = WORK / f"{sid}.mp4"
        enc = Encoder(out)
        if "card" in scene:
            render_card(enc, *scene["card"], target + 0.8)
        elif "montage" in scene:
            for (name, text, _), seconds in zip(scene["montage"], shot_lengths):
                clip = Clip(name)
                speed = min(max(clip.length / seconds, 1.0), 3.0)
                render_clip(enc, clip, seconds, speed, pill_img=pill(text), tail=True)
        else:
            clip = Clip(scene["clips"][0], scene.get("max_still"))
            max_speed = scene.get("max_speed", MAX_SPEED)
            speed = min(max(clip.length / target, 1.0), max_speed)
            seconds = max(target, clip.length / speed)
            render_clip(enc, clip, seconds, speed, caption=caption_card(*scene["caption"]))
        enc.close()
        clips.append((out, duration(out)))
        voices.append(wav)
        print(f"{sid}: {clips[-1][1]:.1f} s (narration {said:.1f} s)", flush=True)

    # Crossfade the scenes; each scene's narration starts 0.5 s into it.
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
    # Generating the bed takes minutes, so it's kept per length.
    music_wav = WORK / f"music-{total:.3f}.wav"
    if not music_wav.exists():
        music(total, music_wav)
    n = len(clips)
    for wav in voices:
        inputs += ["-i", wav]
    inputs += ["-i", music_wav]
    af = [f"[{n + i}:a]adelay={int((starts[i] + 0.5) * 1000)}|{int((starts[i] + 0.5) * 1000)}[v{i}]" for i in range(n)]
    af.append("".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,apad[voice]")
    af.append("[voice]asplit[vo][key]")
    af.append(f"[{2 * n}:a]aresample=48000,volume=0.9[mus]")
    af.append("[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=80:release=700[bed]")
    af.append(f"[vo][bed]amix=inputs=2:normalize=0,atrim=duration={total:.3f},loudnorm=I=-16:TP=-1.5,aresample=48000[a]")
    ffmpeg(*inputs, "-filter_complex", ";".join(vf + af), "-map", f"[{label}]", "-map", "[a]",
           "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-color_range", "tv",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT)
    print(f"\n{OUT} ({duration(OUT):.1f} s)")


def vtt_time(t):
    h, rem = divmod(t, 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{sec:06.3f}"


def write_captions(out=BUILD / "support-triage-demo.vtt"):
    """WebVTT captions for the finished video, from the rendered scenes and
    narration in WORK: each line is split into sentences, timed in proportion
    to their length, starting 0.5 s into its scene (as the audio mix does)."""
    cues, t = [], 0.0
    for scene in SCENES:
        sid = scene["id"]
        length = duration(WORK / f"{sid}.mp4")
        if "montage" in scene:
            lines, at = [], t + 0.5
            for name, _, text in scene["montage"]:
                said = duration(WORK / f"{name}.wav")
                lines.append((at, said, text))
                at += max(SHOT, said + 0.6)
        else:
            lines = [(t + 0.5, duration(WORK / f"{sid}.wav"), scene["say"])]
        for start, said, text in lines:
            parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", text) if p.strip()]
            total = sum(len(p) for p in parts)
            for part in parts:
                d = said * len(part) / total
                cues.append((start, start + d, part))
                start += d
        t += length - XFADE
    body = "WEBVTT\n\n" + "\n\n".join(f"{vtt_time(a)} --> {vtt_time(b)}\n{text}" for a, b, text in cues) + "\n"
    out.write_text(body)
    print(f"{out} ({len(cues)} cues)")


if __name__ == "__main__":
    import sys

    if "--captions" in sys.argv:
        write_captions()
    else:
        main()
        write_captions()
