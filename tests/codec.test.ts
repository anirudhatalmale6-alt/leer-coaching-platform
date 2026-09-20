import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  codecWarning,
  detectCodecFromFile,
  findBox,
  readBoxHeader,
  readCodecFromMoov,
} from "../src/lib/video/codec";

/**
 * These run against REAL files, produced by ffmpeg and confirmed with ffprobe,
 * not hand-written byte arrays. A synthetic fixture only proves the parser
 * agrees with my idea of the format; the whole point of this check is that
 * real encoders lay files out in ways you would not guess - every .mov here
 * puts `moov` AFTER the media data, which is the case that matters.
 *
 * Regenerate with tests/fixtures/README.md.
 */
const FIXTURES = join(import.meta.dirname, "fixtures");
const load = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** Minimal Blob-alike so detectCodecFromFile can be driven from Node. */
function asBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart]);
}

function codecOf(name: string) {
  const bytes = load(name);
  const moov = findBox(bytes, "moov");
  assert.ok(moov, `${name}: no moov box found`);
  return readCodecFromMoov(bytes, moov.offset + moov.headerSize, moov.offset + moov.size);
}

describe("readBoxHeader", () => {
  test("reads a plain 32-bit box header", () => {
    const bytes = load("h264.mp4");
    const header = readBoxHeader(bytes, 0);
    assert.equal(header?.type, "ftyp");
    assert.equal(header?.headerSize, 8);
    assert.ok((header?.size ?? 0) > 8);
  });

  test("handles the 64-bit size escape", () => {
    // size === 1 means the real length follows the type as a 64-bit value.
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1);
    bytes.set([0x6d, 0x64, 0x61, 0x74], 4); // "mdat"
    view.setUint32(8, 0);
    view.setUint32(12, 24);
    const header = readBoxHeader(bytes, 0);
    assert.deepEqual(header, { type: "mdat", headerSize: 16, size: 24 });
  });

  test("size 0 means to the end of the file", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x6d, 0x64, 0x61, 0x74], 4);
    assert.equal(readBoxHeader(bytes, 0)?.size, 32);
  });

  test("refuses a size smaller than its own header rather than looping", () => {
    // A walk that accepted this would never advance.
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(0, 4);
    assert.equal(readBoxHeader(bytes, 0), null);
  });

  test("returns null past the end instead of reading rubbish", () => {
    assert.equal(readBoxHeader(new Uint8Array(4), 0), null);
  });
});

describe("codec detection on real files", () => {
  test("H.264 in MP4 is recognised and is not flagged", () => {
    const r = codecOf("h264.mp4");
    assert.equal(r.codec, "h264");
    assert.equal(r.fourcc, "avc1");
    assert.equal(r.risky, false);
  });

  test("HEVC in MP4 is recognised and IS flagged", () => {
    const r = codecOf("hevc.mp4");
    assert.equal(r.codec, "hevc");
    assert.equal(r.fourcc, "hvc1");
    assert.equal(r.risky, true);
  });

  test("H.264 in a .mov is NOT flagged - the container says nothing", () => {
    // Warning on the .mov extension would nag people whose files are fine.
    const r = codecOf("h264.mov");
    assert.equal(r.codec, "h264");
    assert.equal(r.risky, false);
  });

  test("HEVC in a .mov - the actual iPhone case - is flagged", () => {
    const r = codecOf("hevc.mov");
    assert.equal(r.codec, "hevc");
    assert.equal(r.risky, true);
  });
});

describe("moov placement", () => {
  test("THE CASE THAT MATTERS: moov written after the media data", () => {
    // Every .mov ffmpeg produces here puts moov last, and so do iPhones. A
    // detector that only read the start of the file would find nothing on
    // precisely the clips this feature exists for.
    const bytes = load("hevc.mov");
    const moov = findBox(bytes, "moov");
    const mdat = findBox(bytes, "mdat");
    assert.ok(moov && mdat, "expected both boxes");
    assert.ok(moov.offset > mdat.offset, "fixture should have moov AFTER mdat");
    assert.equal(codecOf("hevc.mov").codec, "hevc");
  });

  test("and moov at the front still works", () => {
    const bytes = load("hevc_faststart.mov");
    const moov = findBox(bytes, "moov");
    const mdat = findBox(bytes, "mdat");
    assert.ok(moov && mdat);
    assert.ok(moov.offset < mdat.offset, "fixture should have moov BEFORE mdat");
    assert.equal(codecOf("hevc_faststart.mov").codec, "hevc");
  });
});

describe("detectCodecFromFile - the path the browser actually uses", () => {
  test("finds HEVC by walking boxes, with moov at the end", async () => {
    const r = await detectCodecFromFile(asBlob(load("hevc.mov")));
    assert.equal(r.codec, "hevc");
    assert.equal(r.risky, true);
  });

  test("finds H.264 and leaves it alone", async () => {
    const r = await detectCodecFromFile(asBlob(load("h264.mp4")));
    assert.equal(r.codec, "h264");
    assert.equal(r.risky, false);
  });

  test("garbage returns unknown rather than throwing", async () => {
    const junk = new Uint8Array(4096).fill(0x41);
    const r = await detectCodecFromFile(asBlob(junk));
    assert.equal(r.codec, "unknown");
    assert.equal(r.risky, false);
  });

  test("an empty file is not an error", async () => {
    const r = await detectCodecFromFile(asBlob(new Uint8Array(0)));
    assert.equal(r.codec, "unknown");
  });

  test("a truncated file - upload cut off mid-transfer - does not hang", async () => {
    const half = load("hevc.mov").slice(0, 1200);
    const r = await detectCodecFromFile(asBlob(half));
    assert.ok(["unknown", "hevc"].includes(r.codec));
  });
});

describe("codecWarning", () => {
  test("tells an iPhone user exactly which setting to change", () => {
    const msg = codecWarning({ codec: "hevc", fourcc: "hvc1", risky: true });
    assert.ok(msg);
    assert.match(msg, /Most Compatible/);
    assert.match(msg, /Chrome/);
  });

  test("says nothing about a file that is fine", () => {
    assert.equal(codecWarning({ codec: "h264", fourcc: "avc1", risky: false }), null);
    assert.equal(codecWarning({ codec: "unknown", fourcc: null, risky: false }), null);
  });
});
