import test from "node:test";
import assert from "node:assert/strict";

import {
  hashPassword,
  ensureMember,
  hasPerm,
  normalizeChannelType,
  normalizeAttachments,
  getLastMessage,
  serverSummary
} from "../src/app_routes.js";

test("hashPassword returns deterministic SHA-256 hash", () => {
  const a = hashPassword("secret");
  const b = hashPassword("secret");
  const c = hashPassword("other");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("ensureMember checks owner and server members", () => {
  const server = {
    ownerId: "u1",
    members: [{ userId: "u2", roleIds: [] }]
  };
  assert.equal(ensureMember(server, "u1"), true);
  assert.equal(ensureMember(server, "u2"), true);
  assert.equal(ensureMember(server, "u3"), false);
});

test("hasPerm checks role permissions and owner override", () => {
  const server = {
    ownerId: "owner",
    roles: [
      { id: "r1", permissions: { manageChannels: true } },
      { id: "r2", permissions: { manageChannels: false } }
    ],
    members: [
      { userId: "member-ok", roleIds: ["r1"] },
      { userId: "member-no", roleIds: ["r2"] }
    ]
  };
  assert.equal(hasPerm(server, "owner", "manageChannels"), true);
  assert.equal(hasPerm(server, "member-ok", "manageChannels"), true);
  assert.equal(hasPerm(server, "member-no", "manageChannels"), false);
  assert.equal(hasPerm(server, "unknown", "manageChannels"), false);
});

test("normalizeChannelType maps voice/video/media to media", () => {
  assert.equal(normalizeChannelType("voice"), "media");
  assert.equal(normalizeChannelType("video"), "media");
  assert.equal(normalizeChannelType("media"), "media");
  assert.equal(normalizeChannelType("text"), "text");
  assert.equal(normalizeChannelType("anything"), "text");
});

test("normalizeAttachments keeps only valid data URL attachments and truncates fields", () => {
  const longName = "x".repeat(300);
  const longType = "a".repeat(200);
  const items = normalizeAttachments([
    { name: longName, type: longType, size: 123.9, url: "data:text/plain;base64,AAA" },
    { name: "bad", type: "text/plain", size: 1, url: "https://example.com/file.txt" },
    null,
    {}
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].name.length, 200);
  assert.equal(items[0].type.length, 120);
  assert.equal(items[0].size, 123);
  assert.match(items[0].id, /^[0-9a-f-]{36}$/);
});

test("getLastMessage returns newest message from all channels", () => {
  const server = {
    messages: {
      c1: [
        { ts: 100, text: "old", author: "A", channelId: "c1" },
        { ts: 200, text: "newer", author: "B", channelId: "c1" }
      ],
      c2: [
        { ts: 150, text: "middle", author: "C", channelId: "c2" }
      ]
    }
  };
  assert.deepEqual(getLastMessage(server), {
    text: "newer",
    author: "B",
    ts: 200,
    channelId: "c1"
  });
});

test("serverSummary includes lastMessage projection", () => {
  const server = {
    id: "s1",
    name: "Test",
    description: "",
    ownerId: "owner",
    messages: {
      c1: [{ ts: 1, text: "hello", author: "User", channelId: "c1" }]
    }
  };
  assert.deepEqual(serverSummary(server), {
    id: "s1",
    name: "Test",
    description: "",
    ownerId: "owner",
    lastMessage: {
      text: "hello",
      author: "User",
      ts: 1,
      channelId: "c1"
    }
  });
});
