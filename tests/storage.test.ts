import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  buildObjectKey,
  validateUpload,
} from "../src/lib/storage/r2";

describe("validateUpload", () => {
  const ok = { contentType: "video/mp4", size: 5 * 1024 * 1024, durationSeconds: 12 };

  test("accepts a normal coaching clip", () => {
    assert.deepEqual(validateUpload(ok), { ok: true });
  });

  test("accepts the formats a phone actually produces", () => {
    for (const t of ["video/mp4", "video/webm", "video/quicktime"]) {
      assert.equal(validateUpload({ ...ok, contentType: t }).ok, true, t);
    }
  });

  test("rejects a format we cannot decode in the browser", () => {
    const r = validateUpload({ ...ok, contentType: "video/x-msvideo" });
    assert.equal(r.ok, false);
  });

  test("rejects anything over 100MB", () => {
    assert.equal(validateUpload({ ...ok, size: MAX_UPLOAD_BYTES + 1 }).ok, false);
    assert.equal(validateUpload({ ...ok, size: MAX_UPLOAD_BYTES }).ok, true);
  });

  test("rejects a clip longer than 60s", () => {
    assert.equal(validateUpload({ ...ok, durationSeconds: 61 }).ok, false);
  });

  test("tolerates a hair over 60s, which real encoders produce", () => {
    // A '60 second' export routinely measures 60.03s depending on how the
    // encoder rounded the final frame. Rejecting those is maddening and wrong.
    assert.equal(validateUpload({ ...ok, durationSeconds: MAX_DURATION_SECONDS + 0.03 }).ok, true);
    assert.equal(validateUpload({ ...ok, durationSeconds: MAX_DURATION_SECONDS + 0.9 }).ok, false);
  });

  test("rejects a zero or negative size rather than signing it", () => {
    assert.equal(validateUpload({ ...ok, size: 0 }).ok, false);
    assert.equal(validateUpload({ ...ok, size: -1 }).ok, false);
  });

  test("rejects an unreadable duration instead of letting it through", () => {
    assert.equal(validateUpload({ ...ok, durationSeconds: Number.NaN }).ok, false);
    assert.equal(validateUpload({ ...ok, durationSeconds: Infinity }).ok, false);
  });

  test("size and type are still enforced when duration is unknown", () => {
    const { durationSeconds: _omitted, ...noDuration } = ok;
    assert.equal(validateUpload(noDuration).ok, true);
    assert.equal(validateUpload({ ...noDuration, size: MAX_UPLOAD_BYTES + 1 }).ok, false);
  });
});

describe("buildObjectKey", () => {
  test("is unguessable and namespaced to the owner", () => {
    const a = buildObjectKey("user_123", "video/mp4");
    const b = buildObjectKey("user_123", "video/mp4");
    assert.notEqual(a, b, "two uploads must not collide");
    assert.ok(a.startsWith("uploads/user_123/"));
    assert.ok(a.endsWith(".mp4"));
    // A UUID, not a counter: coaching footage is somebody's body, and a
    // predictable key is a directory listing for anyone who finds the bucket.
    assert.ok(/[0-9a-f-]{36}\.mp4$/.test(a), a);
  });

  test("maps each accepted type to a sensible extension", () => {
    assert.ok(buildObjectKey("u", "video/webm").endsWith(".webm"));
    assert.ok(buildObjectKey("u", "video/quicktime").endsWith(".mov"));
  });
});
