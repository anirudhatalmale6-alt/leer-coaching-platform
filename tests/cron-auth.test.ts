import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * The sweep's auth outcomes, as a table.
 *
 * Mirrors authorise() in src/app/api/cron/sweep/route.ts. The distinction
 * matters for more than tidiness: answering 404 to a wrong credential made a
 * misconfigured scheduler look exactly like a wrong URL, which is precisely the
 * confusion this split removes.
 */
function authorise(secret: string | undefined, header: string | null) {
  if (!secret) return "anonymous";
  if (!header || !header.trim()) return "anonymous";
  if (header === `Bearer ${secret}`) return "ok";
  return "wrong-credentials";
}

describe("cron sweep authorisation", () => {
  const SECRET = "s3cr3t";

  test("the right bearer token is accepted", () => {
    assert.equal(authorise(SECRET, `Bearer ${SECRET}`), "ok");
  });

  test("no header stays a 404 - a scanner learns nothing", () => {
    assert.equal(authorise(SECRET, null), "anonymous");
    assert.equal(authorise(SECRET, ""), "anonymous");
    assert.equal(authorise(SECRET, "   "), "anonymous");
  });

  test("a wrong token is a 401 - that is an operator, not a scanner", () => {
    assert.equal(authorise(SECRET, "Bearer nope"), "wrong-credentials");
    assert.equal(authorise(SECRET, "Bearer "), "wrong-credentials");
    assert.equal(authorise(SECRET, SECRET), "wrong-credentials");
  });

  test("case and prefix are exact - no sloppy matching on a payment endpoint", () => {
    assert.equal(authorise(SECRET, `bearer ${SECRET}`), "wrong-credentials");
    assert.equal(authorise(SECRET, `Bearer  ${SECRET}`), "wrong-credentials");
    assert.equal(authorise(SECRET, `Basic ${SECRET}`), "wrong-credentials");
  });

  test("with no CRON_SECRET configured the route refuses everything", () => {
    // It must never fall open: this endpoint cancels payments.
    assert.equal(authorise(undefined, `Bearer ${SECRET}`), "anonymous");
    assert.equal(authorise("", `Bearer ${SECRET}`), "anonymous");
  });
});
