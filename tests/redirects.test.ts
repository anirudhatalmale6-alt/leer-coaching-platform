import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AFTER_SIGN_IN, safeNext } from "../src/lib/redirects";

describe("safeNext", () => {
  test("keeps an in-app path so the booking is not lost", () => {
    assert.equal(safeNext("/book/maria_rojas"), "/book/maria_rojas");
    assert.equal(safeNext("/coaching/0bd8-7cd5"), "/coaching/0bd8-7cd5");
  });

  test("falls back when there is nothing to return to", () => {
    assert.equal(safeNext(null), DEFAULT_AFTER_SIGN_IN);
    assert.equal(safeNext(undefined), DEFAULT_AFTER_SIGN_IN);
    assert.equal(safeNext(""), DEFAULT_AFTER_SIGN_IN);
  });

  test("REFUSES to send a trainee off-site after sign-in", () => {
    // An open redirect on a sign-in page is a phishing primitive: the victim
    // arrives from a real LEER link and lands on a copy, about to type card
    // details.
    for (const evil of [
      "https://evil.example/login",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "mailto:a@b.c",
    ]) {
      assert.equal(safeNext(evil), DEFAULT_AFTER_SIGN_IN, `${evil} must not survive`);
    }
  });

  test("a control character cannot smuggle a host past the check", () => {
    assert.equal(safeNext("/\n//evil.example"), DEFAULT_AFTER_SIGN_IN);
    assert.equal(safeNext("/\tbook"), DEFAULT_AFTER_SIGN_IN);
  });
});
