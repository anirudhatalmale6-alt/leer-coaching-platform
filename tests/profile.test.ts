import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  MAX_PORTFOLIO_LINKS,
  RESERVED_USERNAMES,
  formatPrice,
  isCategory,
  isSellable,
  normaliseBio,
  normaliseFocusNote,
  normaliseInstagram,
  normalisePortfolioLinks,
  normalisePortfolioUrl,
  normaliseUsername,
  normaliseYouTube,
  parsePriceToCents,
} from "../src/lib/profile";

describe("normaliseUsername", () => {
  test("folds case so one handle cannot be claimed twice", () => {
    const a = normaliseUsername("JohnDoe");
    assert.ok(a.ok && a.value === "johndoe");
  });

  test("trims surrounding whitespace a paste brings with it", () => {
    const a = normaliseUsername("  coach_mike  ");
    assert.ok(a.ok && a.value === "coach_mike");
  });

  test("rejects the characters the spec excludes", () => {
    for (const bad of ["john.doe", "john-doe", "john doe", "john@doe", "jöhn"]) {
      const r = normaliseUsername(bad);
      assert.equal(r.ok, false, `${bad} should have been rejected`);
    }
  });

  test("enforces the length bounds", () => {
    assert.equal(normaliseUsername("ab").ok, false);
    assert.equal(normaliseUsername("a".repeat(21)).ok, false);
    assert.equal(normaliseUsername("abc").ok, true);
    assert.equal(normaliseUsername("a".repeat(20)).ok, true);
  });

  test("must start with a letter or number, not an underscore", () => {
    assert.equal(normaliseUsername("_coach").ok, false);
    assert.equal(normaliseUsername("c_oach").ok, true);
  });

  test("REFUSES A ROUTE NAME - the failure would be silent and permanent", () => {
    // Next.js resolves /dashboard to the app's own page, so a trainer holding
    // that handle would have a page nobody can ever reach - and they would only
    // find out after putting the link in their Instagram bio.
    for (const reserved of ["dashboard", "api", "signin", "upload", "room", "canvas"]) {
      const r = normaliseUsername(reserved);
      assert.equal(r.ok, false, `${reserved} must be reserved`);
    }
  });

  test("the reserved list is checked AFTER case folding", () => {
    assert.equal(normaliseUsername("DASHBOARD").ok, false);
  });

  test("every reserved word is itself a shape the validator would otherwise allow", () => {
    // Guards against someone adding a reserved word that could never be typed
    // anyway, which would give false confidence about coverage.
    for (const word of RESERVED_USERNAMES) {
      assert.match(word, /^[a-z0-9_]{1,20}$/, `${word} is not a claimable shape`);
    }
  });
});

describe("normaliseBio", () => {
  test("collapses a multi-line paste into one line", () => {
    const r = normaliseBio("IFBB Pro\n\nPosing specialist");
    assert.ok(r.ok && r.value === "IFBB Pro Posing specialist");
  });

  test("an empty bio is allowed - it clears the field", () => {
    const r = normaliseBio("   ");
    assert.ok(r.ok && r.value === "");
  });

  test("rejects an essay", () => {
    assert.equal(normaliseBio("x".repeat(161)).ok, false);
    assert.equal(normaliseBio("x".repeat(160)).ok, true);
  });
});

describe("social handles", () => {
  test("takes the handle out of a full profile URL", () => {
    const r = normaliseInstagram("https://www.instagram.com/coach.mike/");
    assert.ok(r.ok && r.value === "coach.mike");
  });

  test("strips a leading @", () => {
    const r = normaliseInstagram("@coach.mike");
    assert.ok(r.ok && r.value === "coach.mike");
  });

  test("takes a bare handle as-is", () => {
    const r = normaliseInstagram("coachmike");
    assert.ok(r.ok && r.value === "coachmike");
  });

  test("refuses a link to somewhere else entirely", () => {
    // Storing a pasted URL verbatim would let a trainer point an "Instagram"
    // icon at any site they like.
    const r = normaliseInstagram("https://evil.example.com/coach");
    assert.equal(r.ok, false);
  });

  test("YouTube accepts @handle URLs and hyphens, Instagram does not", () => {
    const y = normaliseYouTube("https://youtube.com/@coach-mike");
    assert.ok(y.ok && y.value === "coach-mike");
    assert.equal(normaliseInstagram("coach-mike").ok, false);
  });

  test("youtu.be is still YouTube", () => {
    const y = normaliseYouTube("https://youtu.be/@coach");
    assert.ok(y.ok && y.value === "coach");
  });

  test("blank clears the field rather than erroring", () => {
    const r = normaliseInstagram("");
    assert.ok(r.ok && r.value === "");
  });
});

describe("normalisePortfolioUrl", () => {
  test("assumes https for a bare host", () => {
    const r = normalisePortfolioUrl("instagram.com/reel/abc");
    assert.ok(r.ok && r.value.startsWith("https://instagram.com/reel/abc"));
  });

  test("REJECTS javascript: - this value becomes an href", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const r = normalisePortfolioUrl(bad);
      assert.equal(r.ok, false, `${bad} must be rejected`);
    }
  });

  test("REJECTS the authority form that survives a hostname check", () => {
    // These are the cases that matter. `javascript:alert(1)` parses with an
    // empty hostname, so a "must contain a dot" rule rejects it by accident and
    // the scheme check looks untested. Adding an authority gives the URL a real
    // hostname - and in JS the // opens a comment, so everything after the
    // newline still executes. Only an explicit http/https check stops these.
    for (const bad of [
      "javascript://evil.com/%0aalert(1)",
      "javascript://evil.com/%0d%0aalert(document.cookie)",
      "data://evil.com/x",
    ]) {
      const r = normalisePortfolioUrl(bad);
      assert.equal(r.ok, false, `${bad} must be rejected`);
    }
  });

  test("rejects something with no dot in the host", () => {
    assert.equal(normalisePortfolioUrl("notalink").ok, false);
  });

  test("rejects an absurdly long link", () => {
    assert.equal(normalisePortfolioUrl(`https://x.com/${"a".repeat(300)}`).ok, false);
  });
});

describe("normalisePortfolioLinks", () => {
  test("drops blanks and duplicates without complaining", () => {
    const r = normalisePortfolioLinks([
      "https://x.com/a",
      "",
      "   ",
      "https://x.com/a",
      "https://x.com/b",
    ]);
    assert.ok(r.ok);
    assert.deepEqual(r.value, ["https://x.com/a", "https://x.com/b"]);
  });

  test("caps at five", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://x.com/${i}`);
    assert.equal(normalisePortfolioLinks(six).ok, false);
    assert.equal(normalisePortfolioLinks(six.slice(0, MAX_PORTFOLIO_LINKS)).ok, true);
  });

  test("reports a bad link instead of silently dropping it", () => {
    const r = normalisePortfolioLinks(["https://x.com/a", "javascript:alert(1)"]);
    assert.equal(r.ok, false);
  });
});

describe("parsePriceToCents", () => {
  test("accepts the shapes a human types", () => {
    assert.deepEqual(parsePriceToCents("50"), { ok: true, value: 5000 });
    assert.deepEqual(parsePriceToCents("$50"), { ok: true, value: 5000 });
    assert.deepEqual(parsePriceToCents("50.00"), { ok: true, value: 5000 });
    assert.deepEqual(parsePriceToCents(" 49.99 "), { ok: true, value: 4999 });
    assert.deepEqual(parsePriceToCents("49.5"), { ok: true, value: 4950 });
  });

  test("EVERY price in the allowed range parses to an exact integer", () => {
    // Not a spot check. Number("32.05") * 100 is 3204.9999999999995, and a
    // non-integer amount is rejected by Stripe - the coach's page would just
    // stop taking bookings. Most values come out exact by luck, so only
    // sweeping the whole range proves the parser rather than the luck.
    const drifting: string[] = [];
    for (let cents = 30_00; cents <= 500_00; cents++) {
      const typed = (cents / 100).toFixed(2);
      const r = parsePriceToCents(typed);
      if (!r.ok || r.value !== cents || !Number.isInteger(r.value)) {
        drifting.push(typed);
        if (drifting.length > 5) break;
      }
    }
    assert.deepEqual(drifting, [], `these prices did not round-trip: ${drifting.join(", ")}`);
  });

  test("the specific value that exposes float parsing", () => {
    const r = parsePriceToCents("32.05");
    assert.ok(r.ok);
    assert.equal(r.value, 3205);
    assert.notEqual(r.value, Number("32.05") * 100);
  });

  test("rejects junk and third decimals", () => {
    for (const bad of ["", "abc", "50.123", "-50", "5e2", "50."]) {
      assert.equal(parsePriceToCents(bad).ok, false, `${bad} should be rejected`);
    }
  });

  test("holds the escrow price bounds", () => {
    assert.equal(parsePriceToCents("29.99").ok, false);
    assert.equal(parsePriceToCents("30").ok, true);
    assert.equal(parsePriceToCents("500").ok, true);
    assert.equal(parsePriceToCents("500.01").ok, false);
  });
});

describe("formatPrice", () => {
  test("renders what the CTA button shows", () => {
    assert.equal(formatPrice(5000), "$50.00");
    assert.equal(formatPrice(4999), "$49.99");
  });
});

describe("isCategory", () => {
  test("accepts only the spec's six", () => {
    assert.equal(CATEGORIES.length, 6);
    assert.equal(isCategory("Classic Physique"), true);
    assert.equal(isCategory("Underwater Basket Weaving"), false);
  });
});

describe("isSellable", () => {
  const base = {
    isTrainer: true,
    username: "coach",
    coachingEnabled: true,
    coachingPriceCents: 5000,
    stripeTransfersStatus: "active",
  };

  test("a complete trainer sells", () => {
    assert.equal(isSellable(base), true);
  });

  test("the toggle alone is not enough - payouts must actually work", () => {
    // The worst state this platform can produce is a bookable coach who cannot
    // be paid, with the trainee's money already in escrow.
    assert.equal(isSellable({ ...base, stripeTransfersStatus: "restricted" }), false);
    assert.equal(isSellable({ ...base, stripeTransfersStatus: null }), false);
  });

  test("off means off", () => {
    assert.equal(isSellable({ ...base, coachingEnabled: false }), false);
  });

  test("no handle means no page to sell from", () => {
    assert.equal(isSellable({ ...base, username: null }), false);
  });

  test("a price outside the bounds cannot be sold even if stored", () => {
    assert.equal(isSellable({ ...base, coachingPriceCents: 1 }), false);
    assert.equal(isSellable({ ...base, coachingPriceCents: 900_00 }), false);
  });
});

describe("normaliseFocusNote", () => {
  test("keeps line breaks - it is prose, not a handle", () => {
    const r = normaliseFocusNote("Check my lat spread.\nAlso the lower back.");
    assert.ok(r.ok && r.value.includes("\n"));
  });

  test("caps the length", () => {
    assert.equal(normaliseFocusNote("x".repeat(501)).ok, false);
  });
});
