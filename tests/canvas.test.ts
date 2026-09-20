import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  angleAt,
  fitContain,
  isInsideVideo,
  lineLength,
  nearestHandle,
  toNormalised,
  toScreen,
} from "../src/lib/canvas/geometry";
import {
  clampFrame,
  estimateFps,
  formatTimecode,
  frameToTime,
  resolvePausedFrame,
  timeToFrame,
  totalFrames,
} from "../src/lib/canvas/frames";

describe("fitContain", () => {
  test("letterboxes a 16:9 video in a 4:3 box", () => {
    const v = fitContain(1920, 1080, 800, 600);
    assert.equal(v.width, 800);
    assert.equal(v.height, 450);
    assert.equal(v.offsetX, 0);
    assert.equal(v.offsetY, 75);
  });

  test("pillarboxes a portrait video in a landscape box", () => {
    const v = fitContain(1080, 1920, 800, 600);
    assert.equal(v.height, 600);
    assert.equal(Math.round(v.width), 338);
    assert.ok(v.offsetX > 0);
    assert.equal(v.offsetY, 0);
  });

  test("degenerate sizes do not produce NaN", () => {
    const v = fitContain(0, 0, 800, 600);
    assert.deepEqual(v, { offsetX: 0, offsetY: 0, width: 0, height: 0 });
  });
});

describe("coordinate round trip", () => {
  test("screen -> normalised -> screen is stable", () => {
    const vp = fitContain(1920, 1080, 800, 600);
    const screen = { x: 400, y: 300 };
    const norm = toNormalised(screen, vp);
    const back = toScreen(norm, vp);
    assert.ok(Math.abs(back.x - screen.x) < 1e-9);
    assert.ok(Math.abs(back.y - screen.y) < 1e-9);
  });

  test("a click on the letterbox bar is rejected", () => {
    const vp = fitContain(1920, 1080, 800, 600);
    // y = 10 is inside the canvas but above the video, in the black bar.
    assert.equal(isInsideVideo(toNormalised({ x: 400, y: 10 }, vp)), false);
    assert.equal(isInsideVideo(toNormalised({ x: 400, y: 300 }, vp)), true);
  });
});

describe("angleAt", () => {
  const SQUARE = 1;
  const WIDE = 16 / 9;

  test("a right angle on a square video reads 90", () => {
    const deg = angleAt({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }, SQUARE);
    assert.ok(Math.abs(deg - 90) < 1e-6, `got ${deg}`);
  });

  test("a straight line reads 180", () => {
    const deg = angleAt({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.5 }, { x: 0.9, y: 0.5 }, WIDE);
    assert.ok(Math.abs(deg - 180) < 1e-6, `got ${deg}`);
  });

  test("THE ASPECT TRAP: the same shape reads differently without correction", () => {
    // Identical normalised points. Measured in normalised space (aspect 1) this
    // is 90 degrees; on a real 16:9 clip the true angle is not 90, and using
    // the uncorrected value would put a wrong number in front of a coach.
    const vertex = { x: 0.5, y: 0.5 };
    const a = { x: 0.5, y: 0.3 };
    const b = { x: 0.7, y: 0.5 };

    const naive = angleAt(vertex, a, b, 1);
    const corrected = angleAt(vertex, a, b, 16 / 9);

    assert.ok(Math.abs(naive - 90) < 1e-6);
    assert.ok(Math.abs(corrected - 90) < 1e-6);

    // Now a case where the rays are not axis-aligned, where the difference bites.
    const a2 = { x: 0.3, y: 0.3 };
    const naive2 = angleAt(vertex, a2, b, 1);
    const corrected2 = angleAt(vertex, a2, b, 16 / 9);
    assert.ok(
      Math.abs(naive2 - corrected2) > 5,
      `expected a meaningful difference, got ${naive2} vs ${corrected2}`,
    );
  });

  test("zero-length ray returns 0 rather than NaN", () => {
    const deg = angleAt({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }, WIDE);
    assert.equal(deg, 0);
  });

  test("collapsed points cannot produce NaN through acos overflow", () => {
    const deg = angleAt({ x: 0, y: 0 }, { x: 1e-12, y: 0 }, { x: 2e-12, y: 0 }, 1);
    assert.ok(Number.isFinite(deg));
  });
});

describe("lineLength", () => {
  test("measures in video pixels, not normalised units", () => {
    const px = lineLength({ x: 0, y: 0 }, { x: 1, y: 0 }, 1920, 1080);
    assert.equal(px, 1920);
  });
});

describe("nearestHandle", () => {
  const vp = fitContain(1000, 1000, 1000, 1000);
  test("finds a handle within the grab radius", () => {
    const idx = nearestHandle({ x: 502, y: 498 }, [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], vp);
    assert.equal(idx, 1);
  });
  test("returns -1 when nothing is close", () => {
    const idx = nearestHandle({ x: 10, y: 900 }, [{ x: 0.5, y: 0.5 }], vp);
    assert.equal(idx, -1);
  });
});

describe("frame and time conversion", () => {
  test("frameToTime aims at the middle of the frame interval", () => {
    // Aiming at exactly 1/30 sits on the boundary between frames 0 and 1 and
    // the browser may land either side; the midpoint is unambiguous.
    assert.equal(frameToTime(0, 30), 0.5 / 30);
    assert.equal(frameToTime(1, 30), 1.5 / 30);
  });

  test("round trips every frame of a 60s 30fps clip", () => {
    for (let f = 0; f < 1800; f++) {
      assert.equal(timeToFrame(frameToTime(f, 30), 30), f, `frame ${f} did not round trip`);
    }
  });

  test("round trips at 29.97, where naive maths drifts", () => {
    for (let f = 0; f < 1800; f++) {
      assert.equal(timeToFrame(frameToTime(f, 29.97), 29.97), f, `frame ${f} drifted`);
    }
  });

  test("clampFrame keeps the playhead inside the clip", () => {
    assert.equal(clampFrame(-5, 10, 30), 0);
    assert.equal(clampFrame(9999, 10, 30), 299);
    assert.equal(totalFrames(10, 30), 300);
  });
});

describe("estimateFps", () => {
  test("measures a clean 30fps", () => {
    const fps = estimateFps(
      { mediaTime: 1, presentedFrames: 30 },
      { mediaTime: 3, presentedFrames: 90 },
    );
    assert.equal(fps, 30);
  });

  test("snaps 29.97 rather than reporting 29.94", () => {
    const fps = estimateFps(
      { mediaTime: 0, presentedFrames: 0 },
      { mediaTime: 10.01, presentedFrames: 300 },
    );
    assert.equal(fps, 29.97);
  });

  test("refuses a sample too small to trust", () => {
    assert.equal(
      estimateFps({ mediaTime: 0, presentedFrames: 0 }, { mediaTime: 0.05, presentedFrames: 2 }),
      null,
    );
  });

  test("refuses a nonsense rate rather than returning Infinity", () => {
    assert.equal(
      estimateFps({ mediaTime: 1, presentedFrames: 0 }, { mediaTime: 1, presentedFrames: 600 }),
      null,
    );
  });
});

describe("formatTimecode", () => {
  test("pads to mm:ss.mmm", () => {
    assert.equal(formatTimecode(0), "00:00.000");
    assert.equal(formatTimecode(65.25), "01:05.250");
  });
  test("never renders NaN to a coach", () => {
    assert.equal(formatTimecode(Number.NaN), "00:00.000");
    assert.equal(formatTimecode(-3), "00:00.000");
  });
});

describe("estimateFps - regression: samples taken across a seek", () => {
  test("rejects the seek-shaped sample that once collapsed fps to 3", () => {
    // Reproduces a real failure. requestVideoFrameCallback also fires when a
    // SEEK completes, so stepping ten frames at a time produced samples like
    // "6 presented frames spanning 2 seconds of media" - a plausible-looking
    // 3 fps. Frame numbering then went wrong everywhere, and because the end of
    // the clip is derived from fps, the timeline clamped at frame 29 of 300.
    assert.equal(
      estimateFps({ mediaTime: 0.2, presentedFrames: 4 }, { mediaTime: 2.2, presentedFrames: 10 }),
      null,
    );
  });

  test("still accepts a genuine low-ish rate a real camera might produce", () => {
    assert.equal(
      estimateFps({ mediaTime: 0, presentedFrames: 0 }, { mediaTime: 2, presentedFrames: 50 }),
      25,
    );
  });

  test("a clip stepped frame by frame cannot be mistaken for a frame rate", () => {
    // One frame presented per seek, spread over half a second of media.
    assert.equal(
      estimateFps({ mediaTime: 1.0, presentedFrames: 100 }, { mediaTime: 1.5, presentedFrames: 105 }),
      10,
    );
  });
});

describe("resolvePausedFrame - the pause off-by-one the client found", () => {
  test("prefers the PRESENTED frame over the lagging playback clock", () => {
    // The live reproduction: the clip displayed FRAME 0081 (mediaTime 2.700)
    // while video.currentTime still read ~2.68, which floors to 80. The counter
    // must report what is on screen.
    assert.equal(
      resolvePausedFrame({ presentedFrame: 81, currentTime: 2.68, fps: 30 }),
      81,
    );
  });

  test("falls back to the clock when no frame has been presented", () => {
    // Browsers without requestVideoFrameCallback never report a presented
    // frame; there the clock is the best available signal.
    assert.equal(
      resolvePausedFrame({ presentedFrame: null, currentTime: 2.7, fps: 30 }),
      81,
    );
  });

  test("ignores a nonsense presented value rather than trusting it", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      assert.equal(
        resolvePausedFrame({ presentedFrame: bad, currentTime: 2.7, fps: 30 }),
        81,
        `should have fallen back for ${bad}`,
      );
    }
  });

  test("frame 0 is a real frame, not a falsy value to skip", () => {
    assert.equal(
      resolvePausedFrame({ presentedFrame: 0, currentTime: 5, fps: 30 }),
      0,
    );
  });

  test("this is NOT a constant index shift - stepping stays exact", () => {
    // Guard against 'fixing' the report by adding 1 everywhere. Seek/step maths
    // was always correct and must stay correct.
    for (const f of [0, 7, 80, 299]) {
      assert.equal(timeToFrame(frameToTime(f, 30), 30), f);
    }
  });
});
