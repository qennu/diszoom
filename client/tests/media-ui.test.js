import test from "node:test";
import assert from "node:assert/strict";

import {
  getVideoQualityConstraints,
  getMediaGridStyle
} from "../media_ui.js";

test("getVideoQualityConstraints returns defaults for invalid values", () => {
  const constraints = getVideoQualityConstraints("bad-value");
  assert.deepEqual(constraints, {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 }
  });
});

test("getVideoQualityConstraints maps known quality presets", () => {
  const q360 = getVideoQualityConstraints(360);
  const q1080 = getVideoQualityConstraints("1080");
  assert.equal(q360.width.ideal, 640);
  assert.equal(q360.height.ideal, 360);
  assert.equal(q1080.width.ideal, 1920);
  assert.equal(q1080.height.ideal, 1080);
});

test("getMediaGridStyle handles auto and numeric columns", () => {
  assert.deepEqual(getMediaGridStyle("auto"), {});
  assert.deepEqual(getMediaGridStyle("3"), {
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))"
  });
  assert.deepEqual(getMediaGridStyle("wrong"), {});
});
