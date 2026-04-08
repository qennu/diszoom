import * as mediasoupClient from "mediasoup-client";

const TOKEN_KEY = "diszoom_token";

let token = localStorage.getItem(TOKEN_KEY) || "";
let servers = [];
let activeServer = null;
let activeChannel = null;
let currentUser = null;

const ui = {
  serverSearch: document.getElementById("serverSearch"),
  serverList: document.getElementById("serverList"),
  createServerBtn: document.getElementById("createServerBtn"),
  joinServerBtn: document.getElementById("joinServerBtn"),
  serverTitle: document.getElementById("serverTitle"),
  userBadge: document.getElementById("userBadge"),
  channelsPanel: document.getElementById("channelsPanel"),
  textChannels: document.getElementById("textChannels"),
  mediaChannels: document.getElementById("mediaChannels"),
  addChannelBtn: document.getElementById("addChannelBtn"),
  panelContent: document.getElementById("panelContent"),
  membersPanel: document.getElementById("membersPanel"),
  membersPanelList: document.getElementById("membersPanelList"),
  deleteServerBtn: document.getElementById("deleteServerBtn"),
  rolesBtn: document.getElementById("rolesBtn"),
  inviteBtn: document.getElementById("inviteBtn"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  modalOverlay: document.getElementById("modalOverlay"),
  authModal: document.getElementById("authModal"),
  tabLogin: document.getElementById("tabLogin"),
  tabRegister: document.getElementById("tabRegister"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  loginUser: document.getElementById("loginUser"),
  loginPass: document.getElementById("loginPass"),
  registerUser: document.getElementById("registerUser"),
  registerPass: document.getElementById("registerPass"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  createServerModal: document.getElementById("createServerModal"),
  serverNameInput: document.getElementById("serverNameInput"),
  createServerConfirm: document.getElementById("createServerConfirm"),
  joinServerModal: document.getElementById("joinServerModal"),
  inviteCodeInput: document.getElementById("inviteCodeInput"),
  joinServerConfirm: document.getElementById("joinServerConfirm"),
  addChannelModal: document.getElementById("addChannelModal"),
  channelNameInput: document.getElementById("channelNameInput"),
  channelTypeSelect: document.getElementById("channelTypeSelect"),
  addChannelConfirm: document.getElementById("addChannelConfirm"),
  rolesModal: document.getElementById("rolesModal"),
  rolesList: document.getElementById("rolesList"),
  roleNameInput: document.getElementById("roleNameInput"),
  permManageRoles: document.getElementById("permManageRoles"),
  permManageChannels: document.getElementById("permManageChannels"),
  permCreateInvites: document.getElementById("permCreateInvites"),
  createRoleConfirm: document.getElementById("createRoleConfirm"),
  membersList: document.getElementById("membersList"),
  inviteModal: document.getElementById("inviteModal"),
  inviteInfo: document.getElementById("inviteInfo"),
  createInviteConfirm: document.getElementById("createInviteConfirm"),
  settingsModal: document.getElementById("settingsModal"),
  audioDeviceSelect: document.getElementById("audioDeviceSelect"),
  videoDeviceSelect: document.getElementById("videoDeviceSelect"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  memberMenu: document.getElementById("memberMenu"),
  memberVolumeRange: document.getElementById("memberVolumeRange"),
  memberVolumeValue: document.getElementById("memberVolumeValue")
};

const mediaPrefs = {
  audioDeviceId: localStorage.getItem("audio_device_id") || "",
  videoDeviceId: localStorage.getItem("video_device_id") || "",
  videoQuality: localStorage.getItem("video_quality") || "720",
  tileSize: Number(localStorage.getItem("tile_size") || 240)
};

const userVolumes = (() => {
  try {
    const raw = localStorage.getItem("user_volumes");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

function openModal(modal) {
  ui.modalOverlay.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModals() {
  ui.modalOverlay.classList.add("hidden");
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
}

ui.modalOverlay.addEventListener("click", closeModals);
document.addEventListener("click", evt => {
  if (!ui.memberMenu.contains(evt.target)) hideMemberMenu();
});
document.addEventListener("contextmenu", evt => {
  if (!evt.target.closest(".member-item")) hideMemberMenu();
});

function setAuthMode(mode) {
  const isLogin = mode === "login";
  ui.tabLogin.classList.toggle("active", isLogin);
  ui.tabRegister.classList.toggle("active", !isLogin);
  ui.loginForm.classList.toggle("hidden", !isLogin);
  ui.registerForm.classList.toggle("hidden", isLogin);
}

function showMemberMenu(userId, x, y) {
  if (!userId) return;
  ui.memberMenu.dataset.userId = userId;
  const vol = Math.round(getUserVolume(userId) * 100);
  ui.memberVolumeRange.value = String(vol);
  ui.memberVolumeValue.textContent = `${vol}%`;
  ui.memberMenu.style.left = `${x}px`;
  ui.memberMenu.style.top = `${y}px`;
  ui.memberMenu.classList.remove("hidden");
}

function hideMemberMenu() {
  ui.memberMenu.classList.add("hidden");
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function login(username, password) {
  const data = await api("/app/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  closeModals();
  await refresh();
}

async function register(username, password) {
  const data = await api("/app/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  closeModals();
  await refresh();
}

async function refreshServers() {
  const data = await api("/app/servers");
  servers = data.servers;
  if (activeServer && !servers.some(s => s.id === activeServer.id)) {
    activeServer = null;
    activeChannel = null;
  }
}

async function selectServer(serverId) {
  const data = await api(`/app/servers/${serverId}`);
  activeServer = {
    ...data,
    channels: (data.channels || []).map(ch => ({
      ...ch,
      type: ch.type === "text" ? "text" : "media"
    }))
  };
  activeChannel = activeServer.channels[0] || null;
  await api(`/app/servers/${serverId}/visit`, { method: "POST" });
  renderAll();
}

function renderServers() {
  const query = (ui.serverSearch.value || "").toLowerCase();
  ui.serverList.innerHTML = "";
  servers.filter(s => !query || s.name.toLowerCase().includes(query)).forEach(server => {
    const preview = server.lastMessage?.text || server.description || "No messages yet.";
    const card = document.createElement("div");
    card.className = "server-card" + (activeServer?.id === server.id ? " active" : "");
    card.innerHTML = `
      <div class="server-avatar">${server.name.slice(0, 2).toUpperCase()}</div>
      <div>
        <h4>${server.name}</h4>
        <p>${preview}</p>
      </div>
    `;
    card.addEventListener("click", () => selectServer(server.id));
    ui.serverList.appendChild(card);
  });
}

function getPermissions() {
  if (!activeServer || !currentUser) {
    return { owner: false, manageChannels: false, manageRoles: false, createInvites: false };
  }
  if (activeServer.ownerId === currentUser.id) {
    return { owner: true, manageChannels: true, manageRoles: true, createInvites: true };
  }
  const member = activeServer.members.find(m => m.userId === currentUser.id);
  if (!member) {
    return { owner: false, manageChannels: false, manageRoles: false, createInvites: false };
  }
  const perms = { owner: false, manageChannels: false, manageRoles: false, createInvites: false };
  for (const roleId of member.roleIds) {
    const role = activeServer.roles.find(r => r.id === roleId);
    if (!role || !role.permissions) continue;
    if (role.permissions.manageChannels) perms.manageChannels = true;
    if (role.permissions.manageRoles) perms.manageRoles = true;
    if (role.permissions.createInvites) perms.createInvites = true;
  }
  return perms;
}

function renderMembersPanel() {
  if (!activeServer) {
    ui.membersPanel.classList.add("hidden");
    return;
  }
  ui.membersPanel.classList.remove("hidden");
  const perms = getPermissions();
  ui.deleteServerBtn.classList.toggle("hidden", !perms.owner);

  const isMedia = activeChannel && activeChannel.type !== "text";
  ui.membersPanelList.innerHTML = "";
  const activeSet = isMedia ? media.activeUserIds : null;
  activeServer.members.forEach(member => {
    const item = document.createElement("div");
    item.className = "member-item";
    item.dataset.userId = member.userId;
    if (isMedia) {
      if (activeSet?.has(member.userId)) item.classList.add("active");
      else item.classList.add("inactive");
    } else {
      item.classList.add("active");
    }
    item.innerHTML = `
      <div class="member-avatar">${(member.username || "U").slice(0, 1).toUpperCase()}</div>
      <div>${member.username}</div>
    `;
    item.addEventListener("contextmenu", evt => {
      evt.preventDefault();
      showMemberMenu(member.userId, evt.clientX, evt.clientY);
    });
    ui.membersPanelList.appendChild(item);
  });
}

function renderChannels() {
  ui.textChannels.innerHTML = "";
  ui.mediaChannels.innerHTML = "";
  if (!activeServer) return;

  const perms = getPermissions();
  const renderList = (el, list) => {
    list.forEach(ch => {
      const item = document.createElement("div");
      item.className = "channel-item" + (activeChannel?.id === ch.id ? " active" : "");
      item.textContent = ch.name;
      item.addEventListener("click", () => {
        activeChannel = ch;
        renderPanel();
        renderChannels();
        renderMembersPanel();
      });
      if (perms.manageChannels) {
        const del = document.createElement("button");
        del.className = "channel-delete";
        del.textContent = "×";
        del.addEventListener("click", async e => {
          e.stopPropagation();
          if (!confirm(`Delete channel "${ch.name}"?`)) return;
          try {
            await api(`/app/servers/${activeServer.id}/channels/${ch.id}`, { method: "DELETE" });
            await selectServer(activeServer.id);
          } catch (err) {
            alert(errorMessage(err));
          }
        });
        item.appendChild(del);
      }
      el.appendChild(item);
    });
  };

  renderList(ui.textChannels, activeServer.channels.filter(c => c.type === "text"));
  renderList(ui.mediaChannels, activeServer.channels.filter(c => c.type !== "text"));
}

function renderWelcome() {
  ui.panelContent.innerHTML = `
    <div class="welcome">
      <div>
        <h1>Welcome to Diszoom!</h1>
        <p>Select or add a server from the sidebar to start collaborating. Create roles, manage channels, and invite your team.</p>
      </div>
      <div class="bot">🤖</div>
    </div>
  `;
}

async function renderTextChannel() {
  const data = await api(`/app/servers/${activeServer.id}/messages?channelId=${activeChannel.id}`);
  ui.panelContent.innerHTML = `
    <div class="chat">
      <div class="messages" id="messages"></div>
      <div class="message-input">
        <input id="messageInput" type="text" placeholder="Type a message..." />
        <button id="sendMessageBtn">Send</button>
      </div>
    </div>
  `;
  const msgContainer = document.getElementById("messages");
  data.messages.forEach(msg => {
    const div = document.createElement("div");
    div.className = "message";
    div.innerHTML = `<strong>${msg.author}</strong><span>${msg.text}</span>`;
    msgContainer.appendChild(div);
  });

  document.getElementById("sendMessageBtn").addEventListener("click", async () => {
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text) return;
    await api(`/app/servers/${activeServer.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: activeChannel.id, text })
    });
    input.value = "";
    await refreshServers();
    renderServers();
    renderTextChannel();
  });
}

// Mediasoup client
const media = {
  socket: null,
  device: null,
  sendTransport: null,
  recvTransport: null,
  producers: new Map(),
  consumers: new Map(),
  remoteEls: new Map(),
  producerUserIds: new Map(),
  localStream: null,
  roomId: null,
  audioProducerId: null,
  videoProducerId: null,
  videoProducer: null,
  videoTrack: null,
  videoMode: "none",
  micEnabled: true,
  activeUserIds: new Set()
};
let pending = new Map();
let reqId = 1;

function errorMessage(err) {
  const msg = err?.message || "Request failed";
  try {
    const parsed = JSON.parse(msg);
    if (parsed && parsed.error) return parsed.error;
  } catch {}
  return msg;
}

function mediaRoomIdForChannel(channel) {
  if (!activeServer || !channel) return channel?.id || "";
  return `${activeServer.id}-${channel.id}`;
}

function getUserVolume(userId) {
  if (!userId) return 1;
  const val = Number(userVolumes[userId]);
  if (Number.isFinite(val)) return Math.min(1, Math.max(0, val));
  return 1;
}

function setUserVolume(userId, value) {
  if (!userId) return;
  const vol = Math.min(1, Math.max(0, value));
  userVolumes[userId] = vol;
  localStorage.setItem("user_volumes", JSON.stringify(userVolumes));
  for (const entry of media.remoteEls.values()) {
    if (entry.userId === userId) {
      applyVolumeToElement(entry.el, userId);
    }
  }
}

function applyVolumeToElement(el, userId) {
  if (!el || !userId) return;
  const vol = getUserVolume(userId);
  if (el.tagName === "AUDIO") {
    el.muted = false;
    el.volume = vol;
  }
}

async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter(d => d.kind === "audioinput");
  const videoInputs = devices.filter(d => d.kind === "videoinput");
  const fillSelect = (select, list, current) => {
    select.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Default";
    select.appendChild(def);
    list.forEach(dev => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `${dev.kind} ${select.children.length}`;
      select.appendChild(opt);
    });
    select.value = current || "";
  };
  fillSelect(ui.audioDeviceSelect, audioInputs, mediaPrefs.audioDeviceId);
  fillSelect(ui.videoDeviceSelect, videoInputs, mediaPrefs.videoDeviceId);
}

function wsRequest(action, data = {}) {
  if (!media.socket || media.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("socket not open"));
  }
  const id = reqId++;
  media.socket.send(JSON.stringify({ id, action, data }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout"));
      }
    }, 15000);
  });
}

function cleanupMedia() {
  for (const p of media.producers.values()) { try { p.close(); } catch {} }
  for (const c of media.consumers.values()) { try { c.close(); } catch {} }
  media.producers.clear();
  media.consumers.clear();
  for (const el of media.remoteEls.values()) {
    try { el.el.remove(); } catch {}
  }
  media.remoteEls.clear();
  media.producerUserIds.clear();
  const container = document.getElementById("mediaRemote");
  if (container) container.innerHTML = "";
  const enableBtn = document.getElementById("enableAudioBtn");
  if (enableBtn) enableBtn.classList.add("hidden");
  if (media.sendTransport) { try { media.sendTransport.close(); } catch {} }
  if (media.recvTransport) { try { media.recvTransport.close(); } catch {} }
  if (media.localStream) { for (const t of media.localStream.getTracks()) t.stop(); }
  media.socket = null;
  media.device = null;
  media.sendTransport = null;
  media.recvTransport = null;
  media.localStream = null;
  media.roomId = null;
  media.audioProducerId = null;
  media.videoProducerId = null;
  media.videoProducer = null;
  media.videoTrack = null;
  media.videoMode = "none";
  media.activeUserIds = new Set();
  updateLocalPreview();
}

function disconnectMedia() {
  if (media.socket) media.socket.close();
  cleanupMedia();
  renderMembersPanel();
}

async function connectMedia(roomId) {
  const base = new URL(window.location.origin);
  const wsProto = base.protocol === "https:" ? "wss:" : "ws:";
  const joinToken = activeServer?.mediaJoinToken || "";
  const userId = currentUser?.id || "";
  const username = currentUser?.username || "";
  const wsUrl = `${wsProto}//${base.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(joinToken)}&userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`;
  media.socket = new WebSocket(wsUrl);
  media.roomId = roomId;
  media.producerUserIds.clear();

  media.socket.addEventListener("message", evt => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.ok ? resolve(msg.data) : reject(new Error(msg.error));
      return;
    }
    if (msg.notification === "newProducer") {
      const producerId = msg.data?.producerId;
      const userId = msg.data?.userId || "";
      if (producerId && userId) {
        media.producerUserIds.set(producerId, userId);
      }
      if (producerId) {
        consumeProducer(producerId, userId).catch(() => {});
      }
      return;
    }
    if (msg.notification === "producerClosed") {
      const producerId = msg.data?.producerId;
      if (producerId) removeRemoteProducer(producerId);
      return;
    }
    if (msg.notification === "peerJoined") {
      const userId = msg.data?.userId;
      if (userId) {
        media.activeUserIds.add(userId);
        renderMembersPanel();
      }
      return;
    }
    if (msg.notification === "peerLeft") {
      const userId = msg.data?.userId;
      if (userId) {
        media.activeUserIds.delete(userId);
        renderMembersPanel();
      }
    }
  });

  media.socket.addEventListener("close", () => {
    for (const [id, pendingReq] of pending.entries()) {
      pendingReq.reject(new Error("socket closed"));
      pending.delete(id);
    }
  });

  await new Promise((resolve, reject) => {
    media.socket.addEventListener("open", resolve, { once: true });
    media.socket.addEventListener("error", () => reject(new Error("ws error")), { once: true });
  });

  media.activeUserIds = new Set(currentUser?.id ? [currentUser.id] : []);
  renderMembersPanel();

  let iceServers = [];
  try {
    const iceRes = await fetch(`${base.origin}/ice`);
    const iceData = await iceRes.json();
    iceServers = Array.isArray(iceData.iceServers) ? iceData.iceServers : [];
  } catch {}

  const routerRtpCapabilities = await wsRequest("getRouterRtpCapabilities", {});
  media.device = new mediasoupClient.Device();
  await media.device.load({ routerRtpCapabilities });

  const sendParams = await wsRequest("createWebRtcTransport", {});
  media.sendTransport = media.device.createSendTransport({ ...sendParams, iceServers });
  media.sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    wsRequest("connectWebRtcTransport", { transportId: media.sendTransport.id, dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });
  media.sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
    wsRequest("produce", { transportId: media.sendTransport.id, kind, rtpParameters, appData })
      .then(({ producerId }) => callback({ id: producerId }))
      .catch(errback);
  });

  const recvParams = await wsRequest("createWebRtcTransport", {});
  media.recvTransport = media.device.createRecvTransport({ ...recvParams, iceServers });
  media.recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    wsRequest("connectWebRtcTransport", { transportId: media.recvTransport.id, dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });

  const list = await wsRequest("getProducers", {});
  for (const p of list) {
    if (p.userId) media.producerUserIds.set(p.producerId, p.userId);
    await consumeProducer(p.producerId, p.userId);
  }

  try {
    const peers = await wsRequest("getPeers", {});
    const ids = peers.map(p => p.userId).filter(Boolean);
    media.activeUserIds = new Set(ids);
    renderMembersPanel();
  } catch {}

  media.micEnabled = media.micEnabled !== false;
  await startLocalAudio();
  if (media.videoMode !== "none") {
    await setVideoMode(media.videoMode);
  }
}

function removeRemoteProducer(producerId) {
  const consumer = media.consumers.get(producerId);
  if (consumer) {
    try { consumer.close(); } catch {}
    media.consumers.delete(producerId);
  }
  const el = media.remoteEls.get(producerId);
  if (el) {
    try { el.el.remove(); } catch {}
    media.remoteEls.delete(producerId);
  }
}

async function consumeProducer(producerId, userId = "") {
  if (!media.device || !media.recvTransport) return;
  if (media.consumers.has(producerId)) return;

  const data = await wsRequest("consume", {
    transportId: media.recvTransport.id,
    producerId,
    rtpCapabilities: media.device.rtpCapabilities
  });

  const consumer = await media.recvTransport.consume({
    id: data.consumerId,
    producerId: data.producerId,
    kind: data.kind,
    rtpParameters: data.rtpParameters
  });
  media.consumers.set(producerId, consumer);

  const container = document.getElementById("mediaRemote");
  if (container) {
    const stream = new MediaStream([consumer.track]);
    const el = document.createElement(consumer.kind === "video" ? "video" : "audio");
    el.autoplay = true;
    el.playsInline = true;
    el.controls = consumer.kind === "video";
    if (consumer.kind === "video") el.muted = true;
    el.srcObject = stream;
    container.appendChild(el);
    const resolvedUserId = userId || media.producerUserIds.get(producerId) || "";
    media.remoteEls.set(producerId, { el, userId: resolvedUserId, kind: consumer.kind });
    applyVolumeToElement(el, resolvedUserId);
    el.play().catch(() => {
      const btn = document.getElementById("enableAudioBtn");
      if (btn) btn.classList.remove("hidden");
    });
    consumer.track.onunmute = () => {
      el.play().catch(() => {
        const btn = document.getElementById("enableAudioBtn");
        if (btn) btn.classList.remove("hidden");
      });
    };
  }

  await wsRequest("resume", { consumerId: data.consumerId });
}

function updateLocalPreview() {
  const local = document.getElementById("mediaLocal");
  if (!local) return;
  if (!media.localStream) {
    local.srcObject = null;
    local.classList.add("hidden");
    return;
  }
  const hasVideo = media.localStream.getVideoTracks().length > 0;
  if (hasVideo) {
    local.srcObject = media.localStream;
    local.classList.remove("hidden");
  } else {
    local.srcObject = null;
    local.classList.add("hidden");
  }
}

async function startLocalAudio() {
  if (!media.sendTransport || media.audioProducerId) return;
  const constraints = {
    audio: mediaPrefs.audioDeviceId ? { deviceId: { exact: mediaPrefs.audioDeviceId } } : true,
    video: false
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  if (!media.localStream) media.localStream = new MediaStream();
  media.localStream.addTrack(track);
  const producer = await media.sendTransport.produce({ track });
  media.producers.set(producer.id, producer);
  media.audioProducerId = producer.id;
  track.enabled = media.micEnabled;
  updateLocalPreview();
}

function getVideoQualityConstraints() {
  const quality = Number(mediaPrefs.videoQuality) || 720;
  const map = {
    360: { w: 640, h: 360 },
    480: { w: 854, h: 480 },
    720: { w: 1280, h: 720 },
    1080: { w: 1920, h: 1080 }
  };
  const size = map[quality] || map[720];
  return {
    width: { ideal: size.w },
    height: { ideal: size.h },
    frameRate: { ideal: 30, max: 60 }
  };
}

async function ensureVideoProducer(track) {
  if (!media.sendTransport) return;
  if (!media.localStream) media.localStream = new MediaStream();
  for (const t of media.localStream.getVideoTracks()) {
    media.localStream.removeTrack(t);
  }
  media.localStream.addTrack(track);
  if (media.videoProducer) {
    await media.videoProducer.replaceTrack({ track });
  } else {
    const producer = await media.sendTransport.produce({ track });
    media.producers.set(producer.id, producer);
    media.videoProducerId = producer.id;
    media.videoProducer = producer;
  }
  if (media.videoTrack && media.videoTrack !== track) {
    try { media.videoTrack.stop(); } catch {}
  }
  media.videoTrack = track;
  updateLocalPreview();
}

function stopLocalVideo() {
  if (media.videoProducer) {
    try { wsRequest("closeProducer", { producerId: media.videoProducer.id }); } catch {}
    try { media.videoProducer.close(); } catch {}
    media.producers.delete(media.videoProducer.id);
  }
  media.videoProducer = null;
  media.videoProducerId = null;
  if (media.videoTrack) {
    try { media.videoTrack.stop(); } catch {}
    media.videoTrack = null;
  }
  if (media.localStream) {
    for (const track of media.localStream.getVideoTracks()) {
      track.stop();
      media.localStream.removeTrack(track);
    }
  }
  updateLocalPreview();
}

function toggleMic() {
  media.micEnabled = !media.micEnabled;
  if (media.localStream) {
    for (const track of media.localStream.getAudioTracks()) {
      track.enabled = media.micEnabled;
    }
  }
}

async function setVideoMode(mode) {
  const connected = media.socket && media.socket.readyState === WebSocket.OPEN;
  if (!connected) {
    media.videoMode = mode === "none" ? "none" : mode;
    updateLocalPreview();
    return;
  }
  if (mode === "none") {
    stopLocalVideo();
    media.videoMode = "none";
    return;
  }
  const constraints = getVideoQualityConstraints();
  let stream;
  if (mode === "screen") {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      video: mediaPrefs.videoDeviceId
        ? { deviceId: { exact: mediaPrefs.videoDeviceId }, ...constraints }
        : constraints,
      audio: false
    });
  }
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  if (mode === "screen") {
    track.onended = () => {
      if (media.videoMode === "screen") {
        setVideoMode("none").catch(() => {});
        updateMediaControls();
      }
    };
  }
  await ensureVideoProducer(track);
  media.videoMode = mode;
}

async function toggleCamera() {
  const next = media.videoMode === "camera" ? "none" : "camera";
  await setVideoMode(next);
}

async function toggleScreenShare() {
  const next = media.videoMode === "screen" ? "none" : "screen";
  await setVideoMode(next);
}

function updateMediaControls() {
  const micBtn = document.getElementById("toggleMicBtn");
  const camBtn = document.getElementById("toggleCamBtn");
  const screenBtn = document.getElementById("shareScreenBtn");
  const joinBtn = document.getElementById("joinMediaBtn");
  const leaveBtn = document.getElementById("leaveMediaBtn");
  const connected = !!media.socket && media.socket.readyState === WebSocket.OPEN;
  if (micBtn) {
    micBtn.textContent = `Mic: ${media.micEnabled ? "On" : "Off"}`;
    micBtn.disabled = false;
  }
  if (camBtn) {
    camBtn.textContent = `Camera: ${media.videoMode === "camera" ? "On" : "Off"}`;
    camBtn.disabled = false;
  }
  if (screenBtn) {
    screenBtn.textContent = `Screen: ${media.videoMode === "screen" ? "On" : "Off"}`;
    screenBtn.disabled = false;
  }
  if (joinBtn) joinBtn.disabled = connected;
  if (leaveBtn) leaveBtn.disabled = !connected;
  if (joinBtn) joinBtn.style.display = connected ? "none" : "";
  if (leaveBtn) leaveBtn.style.display = connected ? "" : "none";
}

async function ensureMediaRoom(channel) {
  return mediaRoomIdForChannel(channel);
}

function renderMediaChannel() {
  ui.panelContent.innerHTML = `
    <div class="media-panel">
      <div class="row">
        <button id="joinMediaBtn" class="primary">Join</button>
        <button id="leaveMediaBtn" class="danger">Leave</button>
        <button id="toggleMicBtn" class="ghost">Mic: On</button>
        <button id="toggleCamBtn" class="ghost">Camera: Off</button>
        <button id="shareScreenBtn" class="ghost">Screen: Off</button>
        <select id="qualitySelect" class="ghost">
          <option value="360">360p</option>
          <option value="480">480p</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
        <label class="inline">Tile size
          <input id="tileSizeRange" type="range" min="160" max="420" value="240" />
        </label>
        <button id="enableAudioBtn" class="ghost hidden">Enable Audio</button>
      </div>
      <video id="mediaLocal" autoplay playsinline muted class="hidden"></video>
      <div id="mediaRemote" class="media-remote"></div>
    </div>
  `;

  document.getElementById("joinMediaBtn").addEventListener("click", async () => {
    try {
      const roomId = await ensureMediaRoom(activeChannel);
      await connectMedia(roomId);
      updateLocalPreview();
      updateMediaControls();
    } catch (err) {
      alert(errorMessage(err));
    }
  });

  document.getElementById("leaveMediaBtn").addEventListener("click", () => {
    disconnectMedia();
    updateMediaControls();
  });

  document.getElementById("toggleMicBtn").addEventListener("click", () => {
    toggleMic();
    updateMediaControls();
  });

  document.getElementById("toggleCamBtn").addEventListener("click", async () => {
    await toggleCamera();
    updateMediaControls();
  });

  document.getElementById("shareScreenBtn").addEventListener("click", async () => {
    await toggleScreenShare();
    updateMediaControls();
  });

  const qualitySelect = document.getElementById("qualitySelect");
  qualitySelect.value = mediaPrefs.videoQuality;
  qualitySelect.addEventListener("change", async () => {
    mediaPrefs.videoQuality = qualitySelect.value;
    localStorage.setItem("video_quality", mediaPrefs.videoQuality);
    if (media.videoMode !== "none") {
      await setVideoMode(media.videoMode);
      updateMediaControls();
    }
  });

  const tileRange = document.getElementById("tileSizeRange");
  tileRange.value = String(mediaPrefs.tileSize);
  tileRange.addEventListener("input", () => {
    mediaPrefs.tileSize = Number(tileRange.value);
    localStorage.setItem("tile_size", String(mediaPrefs.tileSize));
    const remote = document.getElementById("mediaRemote");
    if (remote) remote.style.setProperty("--tile-size", `${mediaPrefs.tileSize}px`);
  });

  document.getElementById("enableAudioBtn").addEventListener("click", async () => {
    const elements = document.querySelectorAll("#mediaRemote audio, #mediaRemote video");
    for (const el of elements) {
      try { await el.play(); } catch {}
    }
    document.getElementById("enableAudioBtn").classList.add("hidden");
  });

  const remote = document.getElementById("mediaRemote");
  if (remote) remote.style.setProperty("--tile-size", `${mediaPrefs.tileSize}px`);
  updateMediaControls();
}

async function renderPanel() {
  if (!activeServer || !activeChannel) return renderWelcome();
  if (activeChannel.type === "text") return renderTextChannel();
  renderMediaChannel();
}

async function renderAll() {
  renderServers();
  if (!activeServer) {
    ui.channelsPanel.classList.add("hidden");
    ui.membersPanel.classList.add("hidden");
    ui.serverTitle.textContent = "Welcome";
    await renderPanel();
    return;
  }
  ui.channelsPanel.classList.remove("hidden");
  renderChannels();
  const perms = getPermissions();
  ui.addChannelBtn.disabled = !perms.manageChannels;
  ui.rolesBtn.disabled = !perms.manageRoles;
  ui.inviteBtn.disabled = !perms.createInvites;
  ui.serverTitle.textContent = activeServer.name;
  await renderPanel();
  renderMembersPanel();
}

async function refresh() {
  const me = await api("/app/me");
  currentUser = me;
  ui.userBadge.textContent = me.username;
  await refreshServers();
  renderAll();
}

ui.serverSearch.addEventListener("input", renderServers);
ui.createServerBtn.addEventListener("click", () => openModal(ui.createServerModal));
ui.joinServerBtn.addEventListener("click", () => openModal(ui.joinServerModal));
ui.addChannelBtn.addEventListener("click", () => openModal(ui.addChannelModal));
ui.rolesBtn.addEventListener("click", () => openModal(ui.rolesModal));
ui.inviteBtn.addEventListener("click", () => openModal(ui.inviteModal));
ui.openSettingsBtn.addEventListener("click", () => {
  loadDevices().catch(() => {});
  openModal(ui.settingsModal);
});

ui.createServerConfirm.addEventListener("click", async () => {
  const name = ui.serverNameInput.value.trim();
  if (!name) return;
  await api("/app/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  closeModals();
  refresh();
});

ui.joinServerConfirm.addEventListener("click", async () => {
  const code = ui.inviteCodeInput.value.trim().toUpperCase();
  if (!code) return;
  try {
    await api(`/app/invites/${code}/join`, { method: "POST" });
    closeModals();
    refresh();
  } catch (err) {
    alert(errorMessage(err));
  }
});

ui.addChannelConfirm.addEventListener("click", async () => {
  const name = ui.channelNameInput.value.trim();
  const type = ui.channelTypeSelect.value;
  if (!name) return;
  await api(`/app/servers/${activeServer.id}/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type })
  });
  closeModals();
  await selectServer(activeServer.id);
});

ui.createInviteConfirm.addEventListener("click", async () => {
  try {
    const data = await api(`/app/servers/${activeServer.id}/invites`, { method: "POST" });
    ui.inviteInfo.textContent = `Invite code: ${data.code}`;
  } catch (err) {
    ui.inviteInfo.textContent = errorMessage(err);
  }
});

ui.createRoleConfirm.addEventListener("click", async () => {
  const name = ui.roleNameInput.value.trim();
  if (!name) return;
  await api(`/app/servers/${activeServer.id}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      permissions: {
        manageRoles: ui.permManageRoles.checked,
        manageChannels: ui.permManageChannels.checked,
        createInvites: ui.permCreateInvites.checked
      }
    })
  });
  await selectServer(activeServer.id);
});

ui.saveSettingsBtn.addEventListener("click", () => {
  mediaPrefs.audioDeviceId = ui.audioDeviceSelect.value;
  mediaPrefs.videoDeviceId = ui.videoDeviceSelect.value;
  localStorage.setItem("audio_device_id", mediaPrefs.audioDeviceId);
  localStorage.setItem("video_device_id", mediaPrefs.videoDeviceId);
  closeModals();
});

ui.logoutBtn.addEventListener("click", () => {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  activeServer = null;
  activeChannel = null;
  closeModals();
  openModal(ui.authModal);
  setAuthMode("login");
});

ui.memberVolumeRange.addEventListener("input", () => {
  const userId = ui.memberMenu.dataset.userId || "";
  const val = Number(ui.memberVolumeRange.value || 100);
  ui.memberVolumeValue.textContent = `${val}%`;
  setUserVolume(userId, val / 100);
});

ui.deleteServerBtn.addEventListener("click", async () => {
  if (!activeServer) return;
  if (!confirm(`Delete server "${activeServer.name}"? This cannot be undone.`)) return;
  try {
    await api(`/app/servers/${activeServer.id}`, { method: "DELETE" });
    activeServer = null;
    activeChannel = null;
    await refreshServers();
    renderAll();
  } catch (err) {
    alert(errorMessage(err));
  }
});

ui.tabLogin.addEventListener("click", () => {
  setAuthMode("login");
});

ui.tabRegister.addEventListener("click", () => {
  setAuthMode("register");
});

ui.loginBtn.addEventListener("click", () => login(ui.loginUser.value.trim(), ui.loginPass.value.trim()));
ui.registerBtn.addEventListener("click", () => register(ui.registerUser.value.trim(), ui.registerPass.value.trim()));

if (!token) {
  setAuthMode("login");
  openModal(ui.authModal);
} else {
  refresh().catch(() => {
    setAuthMode("login");
    openModal(ui.authModal);
  });
}
