import test from "node:test";
import assert from "node:assert/strict";

import { permanentRooms, sessionRooms } from "../src/state.js";
import { getRoomType } from "../src/rooms.js";
import { nowIso } from "../src/utils.js";

test.beforeEach(() => {
  permanentRooms.clear();
  sessionRooms.clear();
});

test("getRoomType resolves permanent and session rooms", () => {
  permanentRooms.set("perm", { id: "perm" });
  sessionRooms.set("sess", { id: "sess" });
  assert.equal(getRoomType("perm"), "permanent");
  assert.equal(getRoomType("sess"), "session");
  assert.equal(getRoomType("missing"), null);
});

test("nowIso returns valid ISO datetime string", () => {
  const value = nowIso();
  assert.equal(typeof value, "string");
  assert.match(value, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isNaN(Date.parse(value)), false);
});
