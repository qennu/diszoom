import test from "node:test";
import assert from "node:assert/strict";

import { ADMIN_TOKEN } from "../src/config.js";
import { permanentRooms, sessionRooms } from "../src/state.js";
import { metrics } from "../src/metrics.js";
import {
  getAuthTokenFromReq,
  requireAdmin,
  canJoinRoom
} from "../src/auth.js";

function makeReq(headers = {}) {
  return { headers };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test.beforeEach(() => {
  permanentRooms.clear();
  sessionRooms.clear();
  metrics.auth_failures_total = 0;
});

test("getAuthTokenFromReq reads Bearer token and x-auth-token", () => {
  assert.equal(
    getAuthTokenFromReq(makeReq({ authorization: "Bearer abc123" })),
    "abc123"
  );
  assert.equal(
    getAuthTokenFromReq(makeReq({ "x-auth-token": "legacy-token" })),
    "legacy-token"
  );
  assert.equal(
    getAuthTokenFromReq(makeReq({ "x-auth-token": ["first", "second"] })),
    "first"
  );
  assert.equal(getAuthTokenFromReq(makeReq({})), "");
});

test("requireAdmin allows access when ADMIN_TOKEN is not configured", () => {
  if (ADMIN_TOKEN) return;
  const req = makeReq();
  const res = makeRes();
  let called = false;
  requireAdmin(req, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test("requireAdmin validates token when ADMIN_TOKEN is configured", () => {
  if (!ADMIN_TOKEN) return;

  const badReq = makeReq({ authorization: "Bearer wrong" });
  const badRes = makeRes();
  let badNextCalled = false;
  requireAdmin(badReq, badRes, () => {
    badNextCalled = true;
  });
  assert.equal(badNextCalled, false);
  assert.equal(badRes.statusCode, 401);
  assert.deepEqual(badRes.body, { error: "unauthorized" });
  assert.equal(metrics.auth_failures_total, 1);

  const goodReq = makeReq({ authorization: `Bearer ${ADMIN_TOKEN}` });
  const goodRes = makeRes();
  let goodNextCalled = false;
  requireAdmin(goodReq, goodRes, () => {
    goodNextCalled = true;
  });
  assert.equal(goodNextCalled, true);
  assert.equal(goodRes.statusCode, 200);
});

test("canJoinRoom checks permanent room allowed tokens", () => {
  permanentRooms.set("perm-1", {
    id: "perm-1",
    allowedTokens: ["t1", "t2"]
  });
  assert.deepEqual(canJoinRoom("perm-1", "t2"), { ok: true });
  assert.deepEqual(canJoinRoom("perm-1", "other"), { ok: false });
});

test("canJoinRoom checks session room join token", () => {
  sessionRooms.set("sess-1", {
    id: "sess-1",
    joinToken: "join-me"
  });
  assert.deepEqual(canJoinRoom("sess-1", "join-me"), { ok: true });
  assert.deepEqual(canJoinRoom("sess-1", "bad-token"), { ok: false });
});

test("canJoinRoom rejects unknown rooms", () => {
  assert.deepEqual(canJoinRoom("missing", "any"), { ok: false });
});
