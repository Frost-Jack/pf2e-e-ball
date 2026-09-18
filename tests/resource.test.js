import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE_DEFAULT,
  RESOURCE_MAX,
  RESOURCE_SLUG,
  clampResourceValue,
  resourceSnapshot
} from "../src/resource.js";

test("resource values are integer and remain within the E-Ball pool", () => {
  assert.equal(clampResourceValue(-4), 0);
  assert.equal(clampResourceValue(2.9), 1);
  assert.equal(clampResourceValue(99), RESOURCE_MAX);
  assert.equal(clampResourceValue("not-a-number"), 0);
});

test("resource snapshots use the PF2e-compatible resource shape", () => {
  assert.equal(RESOURCE_DEFAULT, 1);
  assert.equal(RESOURCE_MAX, 1);
  assert.deepEqual(resourceSnapshot(1, "E-Ball"), {
    slug: RESOURCE_SLUG,
    label: "E-Ball",
    value: 1,
    max: RESOURCE_MAX
  });
});
