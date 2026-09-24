import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseAnnotations,
  serialiseAnnotations,
  type Annotation,
} from "../src/lib/canvas/annotations";

const line: Annotation = {
  id: "a1", kind: "line", frame: 12, source: "a", colour: "#4ade80",
  points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }],
};
const angle: Annotation = {
  id: "a2", kind: "angle", frame: 30, source: "a", colour: "#fbbf24",
  points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }],
};
const text: Annotation = {
  id: "a3", kind: "text", frame: 45, source: "b", colour: "#ffffff",
  points: [{ x: 0.3, y: 0.3 }], text: "lower back",
};

describe("round trip - the coach's marks survive delivery", () => {
  test("every kind comes back intact", () => {
    const marks = [line, angle, text];
    assert.deepEqual(parseAnnotations(serialiseAnnotations(marks)), marks);
  });

  test("an empty set is an empty set, not a crash", () => {
    assert.deepEqual(parseAnnotations(serialiseAnnotations([])), []);
  });
});

describe("parseAnnotations - defensive, because this comes from the database", () => {
  test("null, empty and junk give nothing rather than throwing", () => {
    for (const bad of [null, undefined, "", "not json", "{}", '"a string"', "42"]) {
      assert.deepEqual(parseAnnotations(bad as string), [], `${bad} should be ignored`);
    }
  });

  test("A LINE WITH THE WRONG POINT COUNT IS DROPPED", () => {
    // The renderer indexes points[1] directly; a one-point "line" would throw
    // during a redraw and take down a room somebody paid for.
    const broken = JSON.stringify([{ ...line, points: [{ x: 0.1, y: 0.2 }] }]);
    assert.deepEqual(parseAnnotations(broken), []);
  });

  test("an angle needs exactly three points", () => {
    assert.deepEqual(parseAnnotations(JSON.stringify([{ ...angle, points: angle.points.slice(0, 2) }])), []);
    assert.equal(parseAnnotations(JSON.stringify([angle])).length, 1);
  });

  test("unknown kinds are dropped, known ones around them survive", () => {
    const mixed = JSON.stringify([line, { ...line, id: "x", kind: "spaceship" }, text]);
    const got = parseAnnotations(mixed);
    assert.equal(got.length, 2);
    assert.deepEqual(got.map((a) => a.id), ["a1", "a3"]);
  });

  test("NaN and non-finite coordinates are refused", () => {
    const nan = JSON.stringify([{ ...line, points: [{ x: 0.1, y: 0.2 }, { x: null, y: 0.5 }] }]);
    assert.deepEqual(parseAnnotations(nan), []);
  });

  test("a negative or non-numeric frame is refused", () => {
    assert.deepEqual(parseAnnotations(JSON.stringify([{ ...line, frame: -1 }])), []);
    assert.deepEqual(parseAnnotations(JSON.stringify([{ ...line, frame: "12" }])), []);
  });

  test("text without its text is refused", () => {
    const noText = JSON.stringify([{ ...text, text: undefined }]);
    assert.deepEqual(parseAnnotations(noText), []);
  });

  test("a bad source pane is refused", () => {
    assert.deepEqual(parseAnnotations(JSON.stringify([{ ...line, source: "c" }])), []);
  });

  test("one corrupt mark does not lose the rest of the session", () => {
    const mixed = JSON.stringify([line, { nonsense: true }, null, angle]);
    assert.deepEqual(parseAnnotations(mixed).map((a) => a.id), ["a1", "a2"]);
  });
});
