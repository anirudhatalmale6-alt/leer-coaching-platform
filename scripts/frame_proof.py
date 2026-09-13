"""Prove frame accuracy by pixels, not by trusting the app's own counter.

For several target frames: step the UI there, grab the video element's pixels in
the FRAME-number region, and compare against that same region extracted from the
file by ffmpeg for frames N-1, N and N+1. The best match must be N.
"""
import base64, io, os, subprocess, sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

PORT = os.environ.get("LEER_PORT", "3000")
BASE = f"http://127.0.0.1:{PORT}"
CLIP = os.path.join(os.path.dirname(__file__), "..", "public", "sample-coaching-a.mp4")
WORK = os.path.join(os.path.dirname(__file__), ".frames")
os.makedirs(WORK, exist_ok=True)

# The burned-in "FRAME nnnn" text sits at x=40,y=40 with fontsize 48.
CROP = (30, 25, 470, 100)   # left, upper, right, lower in 1280x720 source

GRAB = """
() => {
  const v = document.querySelector('video');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  return c.toDataURL('image/png');
}
"""

def ffmpeg_frame(n):
    """Extract exactly frame n as a PIL image."""
    out = f"{WORK}/f{n:04d}.png"
    if not os.path.exists(out):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", CLIP,
             "-vf", f"select=eq(n\\,{n})", "-vsync", "0", "-frames:v", "1", out],
            check=True)
    return Image.open(out).convert("L").crop(CROP)

def diff(a, b):
    return sum(ImageChops.difference(a, b).getdata()) / (a.size[0] * a.size[1])

def main():
    targets = [0, 7, 23, 61, 140]
    failures = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 1280, "height": 720})
        page.goto(f"{BASE}/canvas", wait_until="networkidle")
        page.wait_for_timeout(2500)

        for t in targets:
            page.goto(f"{BASE}/canvas", wait_until="networkidle")
            page.wait_for_timeout(2200)
            current = 0
            # Navigate using the real controls a coach uses: tens, then ones.
            while current + 10 <= t:
                page.click("text=10 \u25b6\u25b6")
                current += 10
                page.wait_for_timeout(350)
            while current < t:
                page.click("text=1 \u25b6")
                current += 1
                page.wait_for_timeout(350)
            page.wait_for_timeout(900)

            ui = int(page.locator('[data-testid="frame-readout"]').inner_text())
            png = page.evaluate(GRAB)
            shown = Image.open(io.BytesIO(base64.b64decode(png.split(",")[1]))).convert("L").crop(CROP)

            scores = {n: diff(shown, ffmpeg_frame(n)) for n in (t - 1, t, t + 1) if n >= 0}
            best = min(scores, key=scores.get)
            others = [v for k, v in scores.items() if k != t]
            decisive = scores[t] < min(others) * 0.6 if others else True
            ok = (best == t and ui == t and decisive)
            print(f"target {t:>4} | ui says {ui:>4} | pixel best-match frame {best:>4} "
                  f"| diffs { {k: round(v,2) for k,v in scores.items()} } {'OK' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"target {t}: ui={ui} pixels={best}")

        b.close()

    if failures:
        print("\nFAILURES:", *failures, sep="\n - ")
        sys.exit(1)
    print("\nPIXEL-VERIFIED: the frame on screen is the frame the counter claims.")

main()
