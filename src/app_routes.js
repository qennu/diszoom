import { randomUUID, createHash } from "crypto";
import { getAppState, updateAppState } from "./app_store.js";
import { permanentRooms } from "./state.js";
import { savePermanentRoomsToDisk, logEvent } from "./storage.js";
import { closeRoom, getRoom, listPeers } from "./mediasoup_manager.js";
import { nowIso } from "./utils.js";

const PASSWORD_SALT = process.env.APP_AUTH_SALT || "diszoom";
const appEventClients = new Set();

function hashPassword(password) {
  return createHash("sha256").update(`${PASSWORD_SALT}:${password}`).digest("hex");
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return "";
}

function auth(req, res, next) {
  const token = getToken(req);
  const state = getAppState();
  const userId = state.sessions[token];
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const user = state.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  req.token = token;
  next();
}

function ensureMember(server, userId) {
  if (server.ownerId === userId) return true;
  return server.members.some(m => m.userId === userId);
}

export function broadcastAppEvent(event) {
  const state = getAppState();
  for (const client of appEventClients) {
    if (event.serverId) {
      const server = state.servers.find(s => s.id === event.serverId);
      if (!server || !ensureMember(server, client.userId)) continue;
    }
    try {
      client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  }
}

function hasPerm(server, userId, perm) {
  if (server.ownerId === userId) return true;
  const member = server.members.find(m => m.userId === userId);
  if (!member) return false;
  for (const roleId of member.roleIds) {
    const role = server.roles.find(r => r.id === roleId);
    if (role && role.permissions?.[perm]) return true;
  }
  return false;
}

function normalizeChannelType(type) {
  if (type === "voice" || type === "video" || type === "media") return "media";
  return "text";
}

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const name = typeof item.name === "string" ? item.name.slice(0, 200) : "file";
      const type = typeof item.type === "string" ? item.type.slice(0, 120) : "application/octet-stream";
      const url = typeof item.url === "string" ? item.url : "";
      const size = Number.isFinite(item.size) ? Math.max(0, Math.floor(item.size)) : 0;
      if (!url.startsWith("data:")) return null;
      return { id: randomUUID(), name, type, size, url };
    })
    .filter(Boolean);
}

function getLastMessage(server) {
  if (!server.messages) return null;
  let last = null;
  for (const list of Object.values(server.messages)) {
    if (!Array.isArray(list)) continue;
    for (const msg of list) {
      if (!msg) continue;
      if (!last || (msg.ts || 0) > (last.ts || 0)) last = msg;
    }
  }
  if (!last) return null;
  return { text: last.text, author: last.author, ts: last.ts, channelId: last.channelId };
}

function ensureServerMediaToken(server) {
  if (server.mediaJoinToken) return server.mediaJoinToken;
  const token = randomUUID();
  updateAppState(s => {
    const srv = s.servers.find(x => x.id === server.id);
    if (srv) srv.mediaJoinToken = token;
  });
  server.mediaJoinToken = token;
  return token;
}

async function ensureMediaRoom(server, channel) {
  if (normalizeChannelType(channel.type) !== "media") return;
  const roomId = `${server.id}-${channel.id}`;
  const token = ensureServerMediaToken(server);
  if (permanentRooms.has(roomId)) {
    const room = permanentRooms.get(roomId);
    const allowed = Array.isArray(room.allowedTokens) ? room.allowedTokens : [];
    if (!allowed.includes(token)) {
      room.allowedTokens = [...allowed, token];
      permanentRooms.set(roomId, room);
      await savePermanentRoomsToDisk();
      await logEvent("permanent-room-tokens-updated", { roomId, source: "app" });
    }
    return;
  }
  const room = {
    id: roomId,
    name: `${server.name} / ${channel.name}`,
    createdAt: nowIso(),
    allowedTokens: [token]
  };
  permanentRooms.set(roomId, room);
  await savePermanentRoomsToDisk();
  await logEvent("permanent-room-created", { roomId, source: "app" });
}

async function removeMediaRoom(serverId, channelId) {
  const roomId = `${serverId}-${channelId}`;
  if (!permanentRooms.has(roomId)) return;
  permanentRooms.delete(roomId);
  closeRoom(roomId);
  await savePermanentRoomsToDisk();
  await logEvent("permanent-room-deleted", { roomId, source: "app" });
}

function serverSummary(server) {
  return {
    id: server.id,
    name: server.name,
    description: server.description || "",
    ownerId: server.ownerId,
    lastMessage: getLastMessage(server)
  };
}

function serverDetail(server, state) {
  return {
    ...serverSummary(server),
    mediaJoinToken: ensureServerMediaToken(server),
    roles: server.roles,
    channels: server.channels,
    members: server.members.map(m => ({
      userId: m.userId,
      username: state.users.find(u => u.id === m.userId)?.username || "User",
      roleIds: m.roleIds
    }))
  };
}

export function registerAppRoutes(app) {
  app.get("/app/events", (req, res) => {
    const token = getToken(req) || (typeof req.query.token === "string" ? req.query.token : "");
    const state = getAppState();
    const userId = state.sessions[token];
    if (!userId) {
      res.status(401).end();
      return;
    }
    const user = state.users.find(u => u.id === userId);
    if (!user) {
      res.status(401).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const client = { res, userId };
    appEventClients.add(client);
    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch {}
    }, 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      appEventClients.delete(client);
    });
  });

  app.post("/app/register", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "missing fields" });
    const state = getAppState();
    if (state.users.some(u => u.username === username)) {
      return res.status(409).json({ error: "username exists" });
    }
    const user = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      visits: []
    };
    const token = randomUUID();
    updateAppState(s => {
      s.users.push(user);
      s.sessions[token] = user.id;
    });
    res.json({ token, user: { id: user.id, username: user.username } });
  });

  app.post("/app/login", (req, res) => {
    const { username, password } = req.body || {};
    const state = getAppState();
    const user = state.users.find(u => u.username === username);
    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    const token = randomUUID();
    updateAppState(s => {
      s.sessions[token] = user.id;
    });
    res.json({ token, user: { id: user.id, username: user.username } });
  });

  app.get("/app/me", auth, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username });
  });

  app.get("/app/servers", auth, (req, res) => {
    const state = getAppState();
    const user = req.user;
    const visited = user.visits || [];
    const servers = state.servers.filter(s => ensureMember(s, user.id));
    const ordered = visited
      .map(id => servers.find(s => s.id === id))
      .filter(Boolean)
      .concat(servers.filter(s => !visited.includes(s.id)));
    res.json({ servers: ordered.map(s => serverSummary(s)) });
  });

  app.get("/app/servers/:id", auth, async (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    for (const ch of server.channels) {
      if (normalizeChannelType(ch.type) === "media") {
        await ensureMediaRoom(server, ch);
      }
    }
    res.json(serverDetail(server, state));
  });

  app.post("/app/servers", auth, (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "missing name" });
    const ownerId = req.user.id;
    const ownerRoleId = randomUUID();
    const memberRoleId = randomUUID();
    const server = {
      id: randomUUID(),
      name,
      ownerId,
      roles: [
        { id: ownerRoleId, name: "Owner", permissions: { manageRoles: true, manageChannels: true, createInvites: true } },
        { id: memberRoleId, name: "Member", permissions: { manageRoles: false, manageChannels: false, createInvites: false } }
      ],
      members: [{ userId: ownerId, roleIds: [ownerRoleId] }],
      channels: [{ id: randomUUID(), name: "general", type: "text" }],
      invites: [],
      messages: {},
      mediaJoinToken: randomUUID()
    };
    updateAppState(s => {
      s.servers.push(server);
      const user = s.users.find(u => u.id === ownerId);
      if (user) {
        user.visits = user.visits || [];
        if (!user.visits.includes(server.id)) user.visits.push(server.id);
      }
    });
    broadcastAppEvent({ type: "server-created", serverId: server.id });
    res.json(serverSummary(server));
  });

  app.post("/app/servers/:id/visit", auth, (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    updateAppState(s => {
      const user = s.users.find(u => u.id === req.user.id);
      if (!user) return;
      user.visits = user.visits || [];
      if (!user.visits.includes(server.id)) user.visits.push(server.id);
    });
    res.json({ ok: true });
  });

  app.post("/app/servers/:id/channels", auth, async (req, res) => {
    const { name, type } = req.body || {};
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    if (!hasPerm(server, req.user.id, "manageChannels")) {
      return res.status(403).json({ error: "forbidden" });
    }
    const channel = { id: randomUUID(), name, type: normalizeChannelType(type) };
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      srv.channels.push(channel);
    });
    await ensureMediaRoom(server, channel);
    broadcastAppEvent({ type: "channel-added", serverId: server.id, channelId: channel.id });
    res.json(channel);
  });

  app.delete("/app/servers/:id/channels/:channelId", auth, async (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    if (!hasPerm(server, req.user.id, "manageChannels")) {
      return res.status(403).json({ error: "forbidden" });
    }
    const channel = server.channels.find(c => c.id === req.params.channelId);
    if (!channel) return res.status(404).json({ error: "channel not found" });
    const normalizedType = normalizeChannelType(channel.type);
    if (normalizedType === "text") {
      const textChannels = server.channels.filter(c => normalizeChannelType(c.type) === "text");
      if (textChannels.length === 1 && channel.name === "general") {
        return res.status(400).json({ error: "cannot delete last general channel" });
      }
    }
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      srv.channels = srv.channels.filter(c => c.id !== channel.id);
      if (srv.messages) delete srv.messages[channel.id];
    });
    if (normalizedType === "media") {
      await removeMediaRoom(server.id, channel.id);
    }
    broadcastAppEvent({ type: "channel-removed", serverId: server.id, channelId: channel.id });
    res.json({ ok: true });
  });

  app.post("/app/servers/:id/roles", auth, (req, res) => {
    const { name, permissions } = req.body || {};
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    if (!hasPerm(server, req.user.id, "manageRoles")) {
      return res.status(403).json({ error: "forbidden" });
    }
    const role = { id: randomUUID(), name, permissions };
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      srv.roles.push(role);
    });
    broadcastAppEvent({ type: "roles-updated", serverId: server.id });
    res.json(role);
  });

  app.post("/app/servers/:id/members/:memberId/role", auth, (req, res) => {
    const { roleId } = req.body || {};
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    if (!hasPerm(server, req.user.id, "manageRoles")) {
      return res.status(403).json({ error: "forbidden" });
    }
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      const member = srv.members.find(m => m.userId === req.params.memberId);
      if (member) member.roleIds = [roleId];
    });
    broadcastAppEvent({ type: "members-updated", serverId: server.id, userId: req.params.memberId });
    res.json({ ok: true });
  });

  app.post("/app/servers/:id/invites", auth, (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    if (!hasPerm(server, req.user.id, "createInvites")) {
      return res.status(403).json({ error: "forbidden" });
    }
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      srv.invites.push({ code, createdBy: req.user.id, createdAt: Date.now() });
    });
    res.json({ code });
  });

  app.post("/app/invites/:code/join", auth, (req, res) => {
    const code = req.params.code.toUpperCase();
    const state = getAppState();
    const server = state.servers.find(s => s.invites.some(i => i.code === code));
    if (!server) return res.status(404).json({ error: "invite not found" });
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      if (!srv.members.some(m => m.userId === req.user.id)) {
        const memberRole = srv.roles.find(r => r.name === "Member");
        srv.members.push({ userId: req.user.id, roleIds: [memberRole?.id].filter(Boolean) });
      }
      const user = s.users.find(u => u.id === req.user.id);
      if (user) {
        user.visits = user.visits || [];
        if (!user.visits.includes(srv.id)) user.visits.push(srv.id);
      }
    });
    broadcastAppEvent({ type: "member-joined", serverId: server.id, userId: req.user.id });
    res.json(serverSummary(server));
  });

  app.get("/app/servers/:id/messages", auth, (req, res) => {
    const { channelId } = req.query;
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    const list = server.messages[channelId] || [];
    res.json({ messages: list });
  });

  app.get("/app/servers/:id/media/:channelId/peers", auth, (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    const channel = server.channels.find(c => c.id === req.params.channelId);
    if (!channel || normalizeChannelType(channel.type) !== "media") {
      return res.status(404).json({ error: "channel not found" });
    }
    const roomId = `${server.id}-${channel.id}`;
    const room = getRoom(roomId);
    const peers = room ? listPeers(room) : [];
    res.json({ peers });
  });

  app.post("/app/servers/:id/messages", auth, (req, res) => {
    const { channelId, text, attachments } = req.body || {};
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server || !ensureMember(server, req.user.id)) {
      return res.status(404).json({ error: "server not found" });
    }
    const normalizedText = typeof text === "string" ? text.trim() : "";
    const normalizedAttachments = normalizeAttachments(attachments);
    if (!normalizedText && normalizedAttachments.length === 0) {
      return res.status(400).json({ error: "message is empty" });
    }
    const msg = {
      id: randomUUID(),
      text: normalizedText,
      attachments: normalizedAttachments,
      author: req.user.username,
      ts: Date.now(),
      channelId
    };
    updateAppState(s => {
      const srv = s.servers.find(x => x.id === server.id);
      srv.messages[channelId] = srv.messages[channelId] || [];
      srv.messages[channelId].push(msg);
    });
    broadcastAppEvent({ type: "message-created", serverId: server.id, channelId });
    res.json(msg);
  });

  app.delete("/app/servers/:id", auth, async (req, res) => {
    const state = getAppState();
    const server = state.servers.find(s => s.id === req.params.id);
    if (!server) return res.status(404).json({ error: "server not found" });
    if (server.ownerId !== req.user.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    for (const ch of server.channels) {
      if (normalizeChannelType(ch.type) === "media") {
        await removeMediaRoom(server.id, ch.id);
      }
    }
    updateAppState(s => {
      s.servers = s.servers.filter(srv => srv.id !== server.id);
      for (const user of s.users) {
        if (Array.isArray(user.visits)) {
          user.visits = user.visits.filter(id => id !== server.id);
        }
      }
    });
    broadcastAppEvent({ type: "server-deleted", serverId: server.id });
    res.json({ ok: true });
  });
}
