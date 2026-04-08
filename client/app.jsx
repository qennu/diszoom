import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as mediasoupClient from "mediasoup-client";

const TOKEN_KEY = "diszoom_token";

const initialMedia = () => ({
  socket: null,
  device: null,
  sendTransport: null,
  recvTransport: null,
  producers: new Map(),
  consumers: new Map(),
  remoteEls: new Map(),
  producerUserIds: new Map(),
  producerUserNames: new Map(),
  localStream: null,
  roomId: null,
  audioProducerId: null,
  videoProducerId: null,
  videoProducer: null,
  videoTrack: null,
  videoMode: "none",
  micEnabled: true,
  activeUserIds: new Set()
});

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  const [activeChannel, setActiveChannel] = useState(null);
  const [search, setSearch] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [modal, setModal] = useState("");
  const [inviteInfo, setInviteInfo] = useState("");
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [showEnableAudio, setShowEnableAudio] = useState(false);
  const [mediaConnected, setMediaConnected] = useState(false);
  const [mediaMicEnabled, setMediaMicEnabled] = useState(true);
  const [mediaVideoMode, setMediaVideoMode] = useState("none");
  const [mediaActiveUserIds, setMediaActiveUserIds] = useState(new Set());
  const [mediaConnection, setMediaConnection] = useState(() => ({
    serverId: localStorage.getItem("media_connected_server_id") || "",
    channelId: localStorage.getItem("media_connected_channel_id") || "",
    roomId: localStorage.getItem("media_connected_room_id") || ""
  }));
  const [mediaPeersByRoom, setMediaPeersByRoom] = useState({});
  const [localVideoVisible, setLocalVideoVisible] = useState(false);
  const [memberMenu, setMemberMenu] = useState({ visible: false, x: 0, y: 0, userId: "", value: 100 });
  const [authLoginUser, setAuthLoginUser] = useState("");
  const [authLoginPass, setAuthLoginPass] = useState("");
  const [authRegisterUser, setAuthRegisterUser] = useState("");
  const [authRegisterPass, setAuthRegisterPass] = useState("");
  const [authRegisterPassConfirm, setAuthRegisterPassConfirm] = useState("");
  const [serverName, setServerName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("text");
  const [roleName, setRoleName] = useState("");
  const [permManageRoles, setPermManageRoles] = useState(false);
  const [permManageChannels, setPermManageChannels] = useState(false);
  const [permCreateInvites, setPermCreateInvites] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDeviceId, setAudioDeviceId] = useState(() => localStorage.getItem("audio_device_id") || "");
  const [videoDeviceId, setVideoDeviceId] = useState(() => localStorage.getItem("video_device_id") || "");
  const [videoQuality, setVideoQuality] = useState(() => localStorage.getItem("video_quality") || "720");
  const [tileCols, setTileCols] = useState(() => localStorage.getItem("tile_cols") || "auto");

  const mediaRef = useRef(null);
  const pendingRef = useRef(new Map());
  const reqIdRef = useRef(1);
  const userVolumesRef = useRef({});
  const mediaConnectionRef = useRef(mediaConnection);
  const hasRestoredRef = useRef(false);
  const currentUserRef = useRef(null);
  const activeServerRef = useRef(null);
  const activeChannelRef = useRef(null);
  const mediaRemoteRef = useRef(null);
  const mediaLocalRef = useRef(null);
  const attachmentInputRef = useRef(null);

  if (!mediaRef.current) {
    mediaRef.current = initialMedia();
  }

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    activeServerRef.current = activeServer;
  }, [activeServer]);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    mediaConnectionRef.current = mediaConnection;
  }, [mediaConnection]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user_volumes");
      userVolumesRef.current = raw ? JSON.parse(raw) : {};
    } catch {
      userVolumesRef.current = {};
    }
  }, []);

  useEffect(() => {
    if (!token) {
      hasRestoredRef.current = false;
      setModal("auth");
      setAuthMode("login");
      return;
    }
    refresh().catch(() => {
      setToken("");
      localStorage.removeItem(TOKEN_KEY);
      setModal("auth");
      setAuthMode("login");
    });
  }, [token]);

  useEffect(() => {
    if (activeServer?.id) {
      localStorage.setItem("last_server_id", activeServer.id);
    }
  }, [activeServer?.id]);

  useEffect(() => {
    if (activeChannel?.id) {
      localStorage.setItem("last_channel_id", activeChannel.id);
    }
  }, [activeChannel?.id]);

  useEffect(() => {
    localStorage.setItem("tile_cols", tileCols);
  }, [tileCols]);

  useEffect(() => {
    if (!activeServer || !activeChannel || activeChannel.type !== "text") {
      setMessages([]);
      return;
    }
    loadMessages(activeServer.id, activeChannel.id).catch(() => {});
  }, [activeServer?.id, activeChannel?.id, activeChannel?.type]);

  useEffect(() => {
    if (!activeServer || !activeChannel || activeChannel.type === "text") return;
    loadMediaPeers(activeServer.id, activeChannel.id).catch(() => {});
  }, [activeServer?.id, activeChannel?.id, activeChannel?.type]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/app/events?token=${encodeURIComponent(token)}`);
    es.onmessage = evt => {
      if (!evt?.data) return;
      let event;
      try {
        event = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!event || !event.type) return;
      if (event.type === "server-deleted" && activeServerRef.current?.id === event.serverId) {
        if (mediaConnectionRef.current.serverId === event.serverId) {
          disconnectMedia({ clearStored: true });
        }
        setActiveServer(null);
        setActiveChannel(null);
        refreshServers().catch(() => {});
        return;
      }
      if (event.type === "media-peer-joined" || event.type === "media-peer-left") {
        const roomId = event.roomId;
        if (roomId) {
          setMediaPeersByRoom(prev => {
            const list = prev[roomId] || [];
            if (event.type === "media-peer-joined") {
              if (list.some(p => p.userId === event.userId)) return prev;
              return { ...prev, [roomId]: [...list, { userId: event.userId, username: event.username || "User" }] };
            }
            if (event.type === "media-peer-left") {
              return { ...prev, [roomId]: list.filter(p => p.userId !== event.userId) };
            }
            return prev;
          });
        }
        return;
      }

      if (event.serverId) {
        refreshServers().catch(() => {});
        if (activeServerRef.current?.id === event.serverId) {
          fetchServer(event.serverId)
            .then(serverData => {
              const currentChannelId = activeChannelRef.current?.id;
              applyServerState(serverData, currentChannelId);
            })
            .catch(() => {});
        }
      }
      if (event.type === "message-created" && event.serverId === activeServerRef.current?.id) {
        const currentChannelId = activeChannelRef.current?.id;
        if (currentChannelId && currentChannelId === event.channelId) {
          loadMessages(event.serverId, event.channelId).catch(() => {});
        }
      }
    };
    es.onerror = () => {};
    return () => es.close();
  }, [token]);

  useEffect(() => {
    if (!token || !currentUser || hasRestoredRef.current) return;
    if (!servers.length) return;
    const lastServerId = localStorage.getItem("last_server_id") || "";
    const lastChannelId = localStorage.getItem("last_channel_id") || "";
    const connectedServerId = localStorage.getItem("media_connected_server_id") || "";
    const connectedChannelId = localStorage.getItem("media_connected_channel_id") || "";
    hasRestoredRef.current = true;
    if (!lastServerId || !servers.some(s => s.id === lastServerId)) return;
    fetchServer(lastServerId)
      .then(serverData => {
        applyServerState(serverData, lastChannelId);
        api(`/app/servers/${lastServerId}/visit`, { method: "POST" }).catch(() => {});
        if (connectedServerId === lastServerId && connectedChannelId) {
          const connectedChannel = serverData.channels.find(ch => ch.id === connectedChannelId);
          if (connectedChannel && connectedChannel.type !== "text") {
            const roomId = `${lastServerId}-${connectedChannelId}`;
            connectMedia(roomId)
              .then(() => {
                setMediaConnection({ serverId: lastServerId, channelId: connectedChannelId, roomId });
                localStorage.setItem("media_connected_server_id", lastServerId);
                localStorage.setItem("media_connected_channel_id", connectedChannelId);
                localStorage.setItem("media_connected_room_id", roomId);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [token, currentUser, servers]);

  useEffect(() => {
    const media = mediaRef.current;
    const local = mediaLocalRef.current;
    if (!local) return;
    if (localVideoVisible && media.localStream) {
      local.srcObject = media.localStream;
    }
  }, [localVideoVisible]);

  useEffect(() => {
    const onClick = evt => {
      if (!evt.target.closest(".member-menu")) {
        setMemberMenu(prev => (prev.visible ? { ...prev, visible: false } : prev));
      }
    };
    const onContext = evt => {
      if (!evt.target.closest(".member-item")) {
        setMemberMenu(prev => (prev.visible ? { ...prev, visible: false } : prev));
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("contextmenu", onContext);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("contextmenu", onContext);
    };
  }, []);

  useEffect(() => () => disconnectMedia(), []);

  const filteredServers = useMemo(() => {
    const query = (search || "").toLowerCase();
    return servers.filter(s => !query || s.name.toLowerCase().includes(query));
  }, [servers, search]);

  const perms = useMemo(() => {
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
    const result = { owner: false, manageChannels: false, manageRoles: false, createInvites: false };
    for (const roleId of member.roleIds) {
      const role = activeServer.roles.find(r => r.id === roleId);
      if (!role || !role.permissions) continue;
      if (role.permissions.manageChannels) result.manageChannels = true;
      if (role.permissions.manageRoles) result.manageRoles = true;
      if (role.permissions.createInvites) result.createInvites = true;
    }
    return result;
  }, [activeServer, currentUser]);

  function openModal(name) {
    setModal(name);
  }

  function closeModal() {
    if (modal === "auth") return;
    setModal("");
  }

  function errorMessage(err) {
    const msg = err?.message || "Request failed";
    try {
      const parsed = JSON.parse(msg);
      if (parsed && parsed.error) return parsed.error;
    } catch {}
    return msg;
  }

  function formatBytes(size) {
    const val = Number(size) || 0;
    if (val < 1024) return `${val} B`;
    if (val < 1024 * 1024) return `${(val / 1024).toFixed(1)} KB`;
    return `${(val / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isImageAttachment(att) {
    return typeof att?.type === "string" && att.type.startsWith("image/");
  }

  function isVideoAttachment(att) {
    return typeof att?.type === "string" && att.type.startsWith("video/");
  }

  function isAudioAttachment(att) {
    return typeof att?.type === "string" && att.type.startsWith("audio/");
  }

  async function loadMediaPeers(serverId, channelId) {
    if (!serverId || !channelId) return;
    try {
      const data = await api(`/app/servers/${serverId}/media/${channelId}/peers`);
      const roomId = `${serverId}-${channelId}`;
      setMediaPeersByRoom(prev => ({ ...prev, [roomId]: data.peers || [] }));
    } catch {
      // ignore
    }
  }

  function normalizeServerDetail(data) {
    return {
      ...data,
      channels: (data.channels || []).map(ch => ({
        ...ch,
        type: ch.type === "text" ? "text" : "media"
      }))
    };
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json();
  }

  async function refreshServers() {
    const data = await api("/app/servers");
    setServers(data.servers || []);
    if (activeServerRef.current && !data.servers.some(s => s.id === activeServerRef.current.id)) {
      setActiveServer(null);
      setActiveChannel(null);
    }
  }

  async function refresh() {
    const me = await api("/app/me");
    setCurrentUser(me);
    await refreshServers();
  }

  async function fetchServer(serverId) {
    const data = await api(`/app/servers/${serverId}`);
    return normalizeServerDetail(data);
  }

  async function applyServerState(serverData, preferredChannelId) {
    if (!serverData) return;
    if (mediaConnectionRef.current.serverId === serverData.id && mediaConnectionRef.current.channelId) {
      const exists = serverData.channels.some(ch => ch.id === mediaConnectionRef.current.channelId);
      if (!exists) {
        disconnectMedia({ clearStored: true });
      }
    }
    setActiveServer(serverData);
    const channel =
      serverData.channels.find(ch => ch.id === preferredChannelId) ||
      serverData.channels[0] ||
      null;
    setActiveChannel(channel);
  }

  async function selectServer(serverId, options = {}) {
    const normalized = await fetchServer(serverId);
    await applyServerState(normalized, options.preferredChannelId);
    if (!options.skipVisit) {
      await api(`/app/servers/${serverId}/visit`, { method: "POST" });
    }
  }

  async function loadMessages(serverId, channelId) {
    const data = await api(`/app/servers/${serverId}/messages?channelId=${channelId}`);
    setMessages(data.messages || []);
  }

  function getUserVolume(userId) {
    if (!userId) return 1;
    const raw = Number(userVolumesRef.current[userId]);
    if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
    return 1;
  }

  function applyVolumeToElement(el, userId) {
    if (!el || !userId) return;
    if (el.tagName === "AUDIO") {
      el.muted = false;
      el.volume = getUserVolume(userId);
    }
  }

  function setUserVolume(userId, value) {
    if (!userId) return;
    const vol = Math.min(1, Math.max(0, value));
    userVolumesRef.current[userId] = vol;
    localStorage.setItem("user_volumes", JSON.stringify(userVolumesRef.current));
    for (const entry of mediaRef.current.remoteEls.values()) {
      if (entry.userId === userId) {
        applyVolumeToElement(entry.el, userId);
      }
    }
  }

  function resolveUsername(userId, fallbackName) {
    if (fallbackName) return fallbackName;
    const server = activeServerRef.current;
    const member = server?.members?.find(m => m.userId === userId);
    return member?.username || "User";
  }

  function showMemberMenu(userId, x, y) {
    if (!userId) return;
    const vol = Math.round(getUserVolume(userId) * 100);
    setMemberMenu({ visible: true, x, y, userId, value: vol });
  }

  async function login(username, password) {
    const data = await api("/app/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    setToken(data.token);
    localStorage.setItem(TOKEN_KEY, data.token);
    setModal("");
  }

  async function register(username, password) {
    const data = await api("/app/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    setToken(data.token);
    localStorage.setItem(TOKEN_KEY, data.token);
    setModal("");
  }

  async function submitRegister() {
    const username = authRegisterUser.trim();
    const password = authRegisterPass.trim();
    const confirm = authRegisterPassConfirm.trim();
    if (!username || !password || !confirm) {
      alert("Заполните все поля регистрации.");
      return;
    }
    if (password !== confirm) {
      alert("Пароли не совпадают.");
      return;
    }
    await register(username, password);
    setAuthRegisterPassConfirm("");
  }

  function logout() {
    disconnectMedia();
    setToken("");
    localStorage.removeItem(TOKEN_KEY);
    setActiveServer(null);
    setActiveChannel(null);
    setModal("auth");
    setAuthMode("login");
  }

  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioDevices(devices.filter(d => d.kind === "audioinput"));
    setVideoDevices(devices.filter(d => d.kind === "videoinput"));
  }

  function saveSettings() {
    localStorage.setItem("audio_device_id", audioDeviceId || "");
    localStorage.setItem("video_device_id", videoDeviceId || "");
    closeModal();
  }

  async function createServer() {
    const name = serverName.trim();
    if (!name) return;
    await api("/app/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    setServerName("");
    setModal("");
    refresh().catch(() => {});
  }

  async function joinServer() {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    try {
      await api(`/app/invites/${code}/join`, { method: "POST" });
      setInviteCode("");
      setModal("");
      refresh().catch(() => {});
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function addChannel() {
    const name = channelName.trim();
    if (!name || !activeServer) return;
    await api(`/app/servers/${activeServer.id}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: channelType })
    });
    setChannelName("");
    setChannelType("text");
    setModal("");
    await selectServer(activeServer.id);
  }

  async function createInvite() {
    if (!activeServer) return;
    try {
      const data = await api(`/app/servers/${activeServer.id}/invites`, { method: "POST" });
      setInviteInfo(`Invite code: ${data.code}`);
    } catch (err) {
      setInviteInfo(errorMessage(err));
    }
  }

  async function createRole() {
    if (!activeServer) return;
    const name = roleName.trim();
    if (!name) return;
    await api(`/app/servers/${activeServer.id}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        permissions: {
          manageRoles: permManageRoles,
          manageChannels: permManageChannels,
          createInvites: permCreateInvites
        }
      })
    });
    setRoleName("");
    setPermManageRoles(false);
    setPermManageChannels(false);
    setPermCreateInvites(false);
    await selectServer(activeServer.id);
  }

  async function assignRole(memberId, roleId) {
    if (!activeServer) return;
    await api(`/app/servers/${activeServer.id}/members/${memberId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId })
    });
    await selectServer(activeServer.id);
  }

  async function deleteChannel(channel) {
    if (!activeServer) return;
    if (!window.confirm(`Delete channel "${channel.name}"?`)) return;
    try {
      await api(`/app/servers/${activeServer.id}/channels/${channel.id}`, { method: "DELETE" });
      await selectServer(activeServer.id);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function deleteServer() {
    if (!activeServer) return;
    if (!window.confirm(`Delete server "${activeServer.name}"? This cannot be undone.`)) return;
    try {
      await api(`/app/servers/${activeServer.id}`, { method: "DELETE" });
      setActiveServer(null);
      setActiveChannel(null);
      await refreshServers();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function sendMessage() {
    if (!activeServer || !activeChannel || activeChannel.type !== "text") return;
    const text = messageInput.trim();
    if (!text && pendingAttachments.length === 0) return;
    await api(`/app/servers/${activeServer.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: activeChannel.id, text, attachments: pendingAttachments })
    });
    setMessageInput("");
    setPendingAttachments([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    await refreshServers();
    await loadMessages(activeServer.id, activeChannel.id);
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("file read failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function handleAttachmentPick(evt) {
    const files = Array.from(evt.target.files || []);
    if (!files.length) return;
    try {
      const maxSize = 10 * 1024 * 1024;
      const next = [];
      for (const file of files.slice(0, 5)) {
        if (file.size > maxSize) {
          alert(`Файл "${file.name}" больше 10MB и пропущен.`);
          continue;
        }
        const url = await fileToDataUrl(file);
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          url
        });
      }
      setPendingAttachments(prev => [...prev, ...next].slice(0, 5));
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  }

  function removePendingAttachment(id) {
    setPendingAttachments(prev => prev.filter(att => att.id !== id));
  }

  function getAudioConstraints() {
    const base = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    if (!audioDeviceId) return base;
    return { ...base, deviceId: { exact: audioDeviceId } };
  }

  function mediaRoomIdForChannel(channel) {
    if (!activeServerRef.current || !channel) return channel?.id || "";
    return `${activeServerRef.current.id}-${channel.id}`;
  }

  function wsRequest(action, data = {}) {
    const media = mediaRef.current;
    if (!media.socket || media.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("socket not open"));
    }
    const id = reqIdRef.current++;
    media.socket.send(JSON.stringify({ id, action, data }));
    return new Promise((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject });
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error("timeout"));
        }
      }, 15000);
    });
  }
  function cleanupMedia() {
    const media = mediaRef.current;
    for (const p of media.producers.values()) { try { p.close(); } catch {} }
    for (const c of media.consumers.values()) { try { c.close(); } catch {} }
    media.producers.clear();
    media.consumers.clear();
    for (const entry of media.remoteEls.values()) {
      try {
        (entry.tile || entry.el).remove();
      } catch {}
    }
    media.remoteEls.clear();
    media.producerUserIds.clear();
    media.producerUserNames.clear();
    if (mediaRemoteRef.current) mediaRemoteRef.current.innerHTML = "";
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
    setMediaActiveUserIds(new Set());
    setMediaConnected(false);
    setMediaVideoMode("none");
    setShowEnableAudio(false);
    updateLocalPreview();
  }

  function disconnectMedia(options = { clearStored: false }) {
    const media = mediaRef.current;
    if (media.socket) {
      try { media.socket.close(); } catch {}
    }
    cleanupMedia();
    if (options.clearStored) {
      setMediaConnection({ serverId: "", channelId: "", roomId: "" });
      localStorage.removeItem("media_connected_server_id");
      localStorage.removeItem("media_connected_channel_id");
      localStorage.removeItem("media_connected_room_id");
    }
  }

  function removeRemoteProducer(producerId) {
    const media = mediaRef.current;
    const consumer = media.consumers.get(producerId);
    if (consumer) {
      try { consumer.close(); } catch {}
      media.consumers.delete(producerId);
    }
    const entry = media.remoteEls.get(producerId);
    if (entry) {
      try { (entry.tile || entry.el).remove(); } catch {}
      media.remoteEls.delete(producerId);
    }
  }

  async function consumeProducer(producerId, userId = "", username = "") {
    const media = mediaRef.current;
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

    const container = mediaRemoteRef.current;
    if (container) {
      const stream = new MediaStream([consumer.track]);
      const el = document.createElement(consumer.kind === "video" ? "video" : "audio");
      el.autoplay = true;
      el.playsInline = true;
      el.controls = consumer.kind === "video";
      if (consumer.kind === "video") el.muted = true;
      el.srcObject = stream;

      const resolvedUserId = userId || media.producerUserIds.get(producerId) || "";
      const resolvedName = resolveUsername(resolvedUserId, username || media.producerUserNames.get(producerId));

      const tile = document.createElement("div");
      tile.className = `media-tile${consumer.kind === "audio" ? " audio-only" : ""}`;

      if (consumer.kind === "audio") {
        el.style.display = "none";
        const placeholder = document.createElement("div");
        placeholder.className = "media-audio-placeholder";
        placeholder.textContent = resolvedName.slice(0, 1).toUpperCase();
        tile.appendChild(placeholder);
      }

      tile.appendChild(el);
      const label = document.createElement("div");
      label.className = "media-label";
      label.textContent = resolvedName;
      tile.appendChild(label);
      container.appendChild(tile);

      media.remoteEls.set(producerId, { el, userId: resolvedUserId, kind: consumer.kind, tile });
      applyVolumeToElement(el, resolvedUserId);
      el.play().catch(() => setShowEnableAudio(true));
      consumer.track.onunmute = () => {
        el.play().catch(() => setShowEnableAudio(true));
      };
    }

    await wsRequest("resume", { consumerId: data.consumerId });
  }

  async function waitForRemoteContainer() {
    if (mediaRemoteRef.current) return;
    await new Promise(resolve => {
      let attempts = 0;
      const tick = () => {
        if (mediaRemoteRef.current || attempts > 60) return resolve();
        attempts += 1;
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function updateLocalPreview() {
    const media = mediaRef.current;
    const local = mediaLocalRef.current;
    if (!media.localStream) {
      setLocalVideoVisible(false);
      return;
    }
    const hasVideo = media.localStream.getVideoTracks().length > 0;
    if (hasVideo) {
      setLocalVideoVisible(true);
    } else {
      setLocalVideoVisible(false);
    }
    if (local) {
      local.srcObject = hasVideo ? media.localStream : null;
    }
  }

  async function startLocalAudio() {
    const media = mediaRef.current;
    if (!media.sendTransport || media.audioProducerId) return;
    const constraints = {
      audio: getAudioConstraints(),
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
    const quality = Number(videoQuality) || 720;
    const map = {
      360: { w: 640, h: 360 },
      480: { w: 854, h: 480 },
      720: { w: 1280, h: 720 },
      1080: { w: 1920, h: 1080 },
      1440: { w: 2560, h: 1440 },
      2160: { w: 3840, h: 2160 }
    };
    const size = map[quality] || map[720];
    return {
      width: { ideal: size.w },
      height: { ideal: size.h },
      frameRate: { ideal: 30, max: 60 }
    };
  }

  async function ensureVideoProducer(track) {
    const media = mediaRef.current;
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
    const media = mediaRef.current;
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
    const media = mediaRef.current;
    media.micEnabled = !media.micEnabled;
    if (media.localStream) {
      for (const track of media.localStream.getAudioTracks()) {
        track.enabled = media.micEnabled;
      }
    }
    setMediaMicEnabled(media.micEnabled);
  }

  async function setVideoMode(mode) {
    const media = mediaRef.current;
    const connected = media.socket && media.socket.readyState === WebSocket.OPEN;
    if (!connected) {
      media.videoMode = mode === "none" ? "none" : mode;
      setMediaVideoMode(media.videoMode);
      updateLocalPreview();
      return;
    }
    if (mode === "none") {
      stopLocalVideo();
      media.videoMode = "none";
      setMediaVideoMode(media.videoMode);
      return;
    }
    const constraints = getVideoQualityConstraints();
    let stream;
    if (mode === "screen") {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoDeviceId
          ? { deviceId: { exact: videoDeviceId }, ...constraints }
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
        }
      };
    }
    await ensureVideoProducer(track);
    media.videoMode = mode;
    setMediaVideoMode(media.videoMode);
  }

  async function toggleCamera() {
    const next = mediaRef.current.videoMode === "camera" ? "none" : "camera";
    await setVideoMode(next);
  }

  async function toggleScreenShare() {
    const next = mediaRef.current.videoMode === "screen" ? "none" : "screen";
    await setVideoMode(next);
  }
  async function connectMedia(roomId) {
    const media = mediaRef.current;
    if (!roomId) return;
    const prevVideoMode = media.videoMode;
    const prevMicEnabled = media.micEnabled;
    cleanupMedia();
    media.videoMode = prevVideoMode;
    media.micEnabled = prevMicEnabled;
    setMediaVideoMode(prevVideoMode);
    setMediaMicEnabled(prevMicEnabled);
    setShowEnableAudio(false);

    const base = new URL(window.location.origin);
    const wsProto = base.protocol === "https:" ? "wss:" : "ws:";
    const joinToken = activeServerRef.current?.mediaJoinToken || "";
    const userId = currentUserRef.current?.id || "";
    const username = currentUserRef.current?.username || "";
    const wsUrl = `${wsProto}//${base.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(joinToken)}&userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`;
    media.socket = new WebSocket(wsUrl);
    media.roomId = roomId;
    media.producerUserIds.clear();

    media.socket.addEventListener("message", evt => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.id && pendingRef.current.has(msg.id)) {
        const { resolve, reject } = pendingRef.current.get(msg.id);
        pendingRef.current.delete(msg.id);
        msg.ok ? resolve(msg.data) : reject(new Error(msg.error));
        return;
      }
      if (msg.notification === "newProducer") {
        const producerId = msg.data?.producerId;
        const userId = msg.data?.userId || "";
        const username = msg.data?.username || "";
        if (producerId && userId) media.producerUserIds.set(producerId, userId);
        if (producerId && username) media.producerUserNames.set(producerId, username);
        if (producerId) consumeProducer(producerId, userId, username).catch(() => {});
        return;
      }
      if (msg.notification === "producerClosed") {
        const producerId = msg.data?.producerId;
        if (producerId) removeRemoteProducer(producerId);
        return;
      }
      if (msg.notification === "peerJoined") {
        const uid = msg.data?.userId;
        if (uid) {
          const next = new Set(media.activeUserIds);
          next.add(uid);
          media.activeUserIds = next;
          setMediaActiveUserIds(new Set(next));
        }
        return;
      }
      if (msg.notification === "peerLeft") {
        const uid = msg.data?.userId;
        if (uid) {
          const next = new Set(media.activeUserIds);
          next.delete(uid);
          media.activeUserIds = next;
          setMediaActiveUserIds(new Set(next));
        }
      }
    });

    media.socket.addEventListener("close", () => {
      for (const [id, pendingReq] of pendingRef.current.entries()) {
        pendingReq.reject(new Error("socket closed"));
        pendingRef.current.delete(id);
      }
      cleanupMedia();
    });

    await new Promise((resolve, reject) => {
      media.socket.addEventListener("open", resolve, { once: true });
      media.socket.addEventListener("error", () => reject(new Error("ws error")), { once: true });
    });

    media.activeUserIds = new Set(currentUserRef.current?.id ? [currentUserRef.current.id] : []);
    setMediaActiveUserIds(new Set(media.activeUserIds));

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

    await waitForRemoteContainer();
    const list = await wsRequest("getProducers", {});
    for (const p of list) {
      if (p.userId) media.producerUserIds.set(p.producerId, p.userId);
      if (p.username) media.producerUserNames.set(p.producerId, p.username);
      await consumeProducer(p.producerId, p.userId, p.username);
    }

    try {
      const peers = await wsRequest("getPeers", {});
      const ids = peers.map(p => p.userId).filter(Boolean);
      media.activeUserIds = new Set(ids);
      setMediaActiveUserIds(new Set(ids));
      setMediaPeersByRoom(prev => ({
        ...prev,
        [roomId]: peers.map(p => ({ userId: p.userId, username: p.username || "User" }))
      }));
    } catch {}

    await startLocalAudio();
    if (media.videoMode !== "none") {
      await setVideoMode(media.videoMode);
    }

    setMediaMicEnabled(media.micEnabled);
    setMediaVideoMode(media.videoMode);
    setMediaConnected(true);
  }

  function handleJoinMedia() {
    if (!activeChannel) return;
    const roomId = mediaRoomIdForChannel(activeChannel);
    if (mediaConnected && mediaConnectionRef.current.channelId && mediaConnectionRef.current.channelId !== activeChannel.id) {
      disconnectMedia({ clearStored: false });
    }
    connectMedia(roomId)
      .then(() => {
        const serverId = activeServerRef.current?.id || "";
        const channelId = activeChannel.id;
        setMediaConnection({ serverId, channelId, roomId });
        localStorage.setItem("media_connected_server_id", serverId);
        localStorage.setItem("media_connected_channel_id", channelId);
        localStorage.setItem("media_connected_room_id", roomId);
      })
      .catch(err => alert(errorMessage(err)));
  }

  function handleLeaveMedia() {
    disconnectMedia({ clearStored: true });
    setMediaConnection({ serverId: "", channelId: "", roomId: "" });
    localStorage.removeItem("media_connected_server_id");
    localStorage.removeItem("media_connected_channel_id");
    localStorage.removeItem("media_connected_room_id");
  }

  function handleQualityChange(val) {
    setVideoQuality(val);
    localStorage.setItem("video_quality", val);
    if (mediaRef.current.videoMode !== "none") {
      setVideoMode(mediaRef.current.videoMode).catch(() => {});
    }
  }

  function enableAudio() {
    const container = mediaRemoteRef.current;
    if (!container) return;
    const elements = container.querySelectorAll("audio, video");
    elements.forEach(el => {
      try { el.play(); } catch {}
    });
    setShowEnableAudio(false);
  }

  function selectChannel(channel) {
    setActiveChannel(channel);
    if (channel?.id) {
      localStorage.setItem("last_channel_id", channel.id);
    }
  }

  const isMediaChannel = activeChannel && activeChannel.type !== "text";
  const activeRoomId = isMediaChannel && activeServer ? `${activeServer.id}-${activeChannel.id}` : "";
  const previewPeers = activeRoomId ? (mediaPeersByRoom[activeRoomId] || []) : [];
  const membersActiveSet = isMediaChannel
    ? (activeRoomId === mediaConnection.roomId && mediaConnected
      ? mediaActiveUserIds
      : new Set(previewPeers.map(p => p.userId)))
    : null;
  const connectedChannel = activeServer?.channels?.find(ch => ch.id === mediaConnection.channelId);
  const isConnectedToActive =
    mediaConnected &&
    activeServer?.id === mediaConnection.serverId &&
    activeChannel?.id === mediaConnection.channelId;
  const showConnectionHint = mediaConnected && connectedChannel && activeChannel?.id !== connectedChannel.id;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">DISZOOM</div>
        <div className="search-row">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="icon" onClick={() => openModal("joinServer")}>+</button>
        </div>
        <div className="server-list">
          {filteredServers.map(server => {
            const preview = server.lastMessage
              ? `${server.lastMessage.author || "User"}: ${server.lastMessage.text || ""}`
              : (server.description || "No messages yet.");
            const active = activeServer?.id === server.id;
            return (
              <div
                key={server.id}
                className={`server-card${active ? " active" : ""}`}
                onClick={() => selectServer(server.id)}
              >
                <div className="server-avatar">{server.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h4>{server.name}</h4>
                  <p>{preview}</p>
                </div>
              </div>
            );
          })}
        </div>
        <button className="primary" onClick={() => openModal("createServer")}>Create Server</button>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="top-left">
            <div className="server-title">{activeServer ? activeServer.name : "Welcome"}</div>
          </div>
          <div className="top-right">
            <button className="ghost" onClick={() => { loadDevices().catch(() => {}); openModal("settings"); }}>Settings</button>
            <div className="user-badge">{currentUser?.username || ""}</div>
          </div>
        </header>

        <div className="content">
          <aside className={`channels${activeServer ? "" : " hidden"}`}>
            <div className="channels-head">
              <span>Channels</span>
              <button className="icon" disabled={!perms.manageChannels} onClick={() => openModal("addChannel")}>+</button>
            </div>
            <div className="channel-group">
              <div className="channel-group-title">Text</div>
              <div className="channel-list">
                {activeServer?.channels?.filter(c => c.type === "text").map(ch => (
                  <div
                    key={ch.id}
                    className={`channel-item${activeChannel?.id === ch.id ? " active" : ""}`}
                    onClick={() => selectChannel(ch)}
                  >
                    <span>{ch.name}</span>
                    {perms.manageChannels ? (
                      <button className="channel-delete" onClick={e => { e.stopPropagation(); deleteChannel(ch); }}>x</button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="channel-group">
              <div className="channel-group-title">Media</div>
              <div className="channel-list">
                {activeServer?.channels?.filter(c => c.type !== "text").map(ch => (
                  <div
                    key={ch.id}
                    className={`channel-item${activeChannel?.id === ch.id ? " active" : ""}`}
                    onClick={() => selectChannel(ch)}
                  >
                    <span>{ch.name}</span>
                    {perms.manageChannels ? (
                      <button className="channel-delete" onClick={e => { e.stopPropagation(); deleteChannel(ch); }}>x</button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="channels-actions">
              <button className="ghost" disabled={!perms.manageRoles} onClick={() => openModal("roles")}>Roles</button>
              <button className="ghost" disabled={!perms.createInvites} onClick={() => { setInviteInfo(""); openModal("invite"); }}>Invite</button>
            </div>
          </aside>

          <main className="panel">
            <div className="panel-content">
              {!activeServer || !activeChannel ? (
                <div className="welcome">
                  <div>
                    <h1>Welcome to Diszoom!</h1>
                    <p>Select or add a server from the sidebar to start collaborating. Create roles, manage channels, and invite your team.</p>
                  </div>
                  <div className="bot">BOT</div>
                </div>
              ) : null}

              {activeServer && activeChannel?.type === "text" ? (
                <div className="chat">
                  <div className="messages">
                    {messages.map(msg => (
                      <div key={msg.id} className="message">
                        <strong>{msg.author}</strong>
                        {msg.text ? <span>{msg.text}</span> : null}
                        {Array.isArray(msg.attachments) && msg.attachments.length > 0 ? (
                          <div className="message-attachments">
                            {msg.attachments.map(att => (
                              <div key={att.id || `${msg.id}-${att.name}`} className="attachment-item">
                                {isImageAttachment(att) ? (
                                  <a href={att.url} target="_blank" rel="noreferrer">
                                    <img src={att.url} alt={att.name} className="attachment-image" />
                                  </a>
                                ) : null}
                                {isVideoAttachment(att) ? (
                                  <video className="attachment-video" src={att.url} controls />
                                ) : null}
                                {isAudioAttachment(att) ? (
                                  <audio className="attachment-audio" src={att.url} controls />
                                ) : null}
                                {!isImageAttachment(att) && !isVideoAttachment(att) && !isAudioAttachment(att) ? (
                                  <a href={att.url} target="_blank" rel="noreferrer" className="attachment-link">
                                    📎 {att.name || "file"}
                                  </a>
                                ) : null}
                                <div className="attachment-meta">{att.name || "file"} · {formatBytes(att.size)}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {pendingAttachments.length > 0 ? (
                    <div className="pending-attachments">
                      {pendingAttachments.map(att => (
                        <div key={att.id} className="pending-attachment">
                          <span>📎 {att.name} ({formatBytes(att.size)})</span>
                          <button className="ghost" onClick={() => removePendingAttachment(att.id)}>x</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="message-input">
                    <label className="attach-btn" title="Прикрепить файл">
                      📎
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        multiple
                        onChange={handleAttachmentPick}
                      />
                    </label>
                    <input
                      type="text"
                      placeholder="Type a message..."
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                    />
                    <button onClick={sendMessage}>Send</button>
                  </div>
                </div>
              ) : null}

              {(activeServer || mediaConnected) ? (
                <div className={`media-panel${activeChannel?.type === "media" ? "" : " hidden"}`}>
                  <div className="row">
                    {!isConnectedToActive ? (
                      <button className="primary" onClick={handleJoinMedia}>Join</button>
                    ) : null}
                    {isConnectedToActive ? (
                      <button className="danger" onClick={handleLeaveMedia}>Leave</button>
                    ) : null}
                    <button className="ghost" onClick={toggleMic}>
                      Mic: {mediaMicEnabled ? "On" : "Off"}
                    </button>
                    <button className="ghost" onClick={toggleCamera}>
                      Camera: {mediaVideoMode === "camera" ? "On" : "Off"}
                    </button>
                    <button className="ghost" onClick={toggleScreenShare}>
                      Screen: {mediaVideoMode === "screen" ? "On" : "Off"}
                    </button>
                    <select className="ghost" value={videoQuality} onChange={e => handleQualityChange(e.target.value)}>
                      <option value="360">360p</option>
                      <option value="480">480p</option>
                      <option value="720">720p</option>
                      <option value="1080">1080p</option>
                      <option value="1440">1440p</option>
                      <option value="2160">2160p</option>
                    </select>
                    <select className="ghost" value={tileCols} onChange={e => setTileCols(e.target.value)}>
                      <option value="auto">Auto</option>
                      <option value="2">2 cols</option>
                      <option value="3">3 cols</option>
                      <option value="4">4 cols</option>
                    </select>
                    {showEnableAudio ? (
                      <button className="ghost" onClick={enableAudio}>Enable Audio</button>
                    ) : null}
                    {showConnectionHint ? (
                      <span className="muted">Connected to {connectedChannel.name}</span>
                    ) : null}
                  </div>
                  {localVideoVisible ? (
                    <div className="media-tile local">
                      <video
                        ref={mediaLocalRef}
                        autoPlay
                        playsInline
                        muted
                      />
                      <div className="media-label">{currentUser?.username || "You"}</div>
                    </div>
                  ) : null}
                {activeChannel?.type === "media" ? (
                  <div
                    ref={mediaRemoteRef}
                    className="media-remote"
                    style={{
                      display: isConnectedToActive ? "grid" : "none",
                      ...(tileCols === "auto"
                        ? {}
                        : { gridTemplateColumns: `repeat(${tileCols}, minmax(0, 1fr))` })
                    }}
                  ></div>
                ) : null}
                  {activeChannel?.type === "media" && !isConnectedToActive ? (
                    <div
                      className="media-remote"
                      style={{
                        ...(tileCols === "auto"
                          ? {}
                          : { gridTemplateColumns: `repeat(${tileCols}, minmax(0, 1fr))` })
                      }}
                    >
                      {previewPeers.map(peer => (
                        <div key={peer.userId} className="media-tile audio-only">
                          <div className="media-audio-placeholder">{(peer.username || "U").slice(0, 1).toUpperCase()}</div>
                          <div className="media-label">{peer.username || "User"}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </main>

          <aside className={`members${activeServer ? "" : " hidden"}`}>
            <div className="members-head">Members</div>
            <div className="member-list">
              {activeServer?.members?.map(member => {
                const isActive = membersActiveSet ? membersActiveSet.has(member.userId) : true;
                const classes = ["member-item"];
                if (isActive) classes.push("active");
                else classes.push("inactive");
                return (
                  <div
                    key={member.userId}
                    className={classes.join(" ")}
                    onContextMenu={evt => {
                      evt.preventDefault();
                      showMemberMenu(member.userId, evt.clientX, evt.clientY);
                    }}
                  >
                    <div className="member-avatar">{(member.username || "U").slice(0, 1).toUpperCase()}</div>
                    <div>{member.username}</div>
                  </div>
                );
              })}
            </div>
            <button className={`danger${perms.owner ? "" : " hidden"}`} onClick={deleteServer}>Delete Server</button>
          </aside>
        </div>
      </section>

      <div className={`modal-overlay${modal ? "" : " hidden"}`} onClick={closeModal}></div>

      <div className={`modal${modal === "auth" ? "" : " hidden"}`}>
        <h2 className="auth-title">{authMode === "login" ? "Вход" : "Регистрация"}</h2>
        <p className="auth-subtitle">
          {authMode === "login"
            ? "Введите логин и пароль."
            : "Создайте новый аккаунт."}
        </p>
        <div className={`form${authMode === "login" ? "" : " hidden"}`}>
          <input type="text" placeholder="Логин" value={authLoginUser} onChange={e => setAuthLoginUser(e.target.value)} />
          <input type="password" placeholder="Пароль" value={authLoginPass} onChange={e => setAuthLoginPass(e.target.value)} />
          <button className="primary" onClick={() => login(authLoginUser.trim(), authLoginPass.trim())}>Войти</button>
          <button className="auth-switch" onClick={() => setAuthMode("register")}>Зарегистрироваться</button>
        </div>
        <div className={`form${authMode === "register" ? "" : " hidden"}`}>
          <input type="text" placeholder="Новый логин" value={authRegisterUser} onChange={e => setAuthRegisterUser(e.target.value)} />
          <input type="password" placeholder="Новый пароль" value={authRegisterPass} onChange={e => setAuthRegisterPass(e.target.value)} />
          <input
            type="password"
            placeholder="Подтверждение пароля"
            value={authRegisterPassConfirm}
            onChange={e => setAuthRegisterPassConfirm(e.target.value)}
          />
          <button className="primary" onClick={submitRegister}>Создать аккаунт</button>
          <button className="auth-switch" onClick={() => setAuthMode("login")}>У меня уже есть аккаунт</button>
        </div>
      </div>

      <div className={`modal${modal === "createServer" ? "" : " hidden"}`}>
        <h2>Create Server</h2>
        <input type="text" placeholder="Server name" value={serverName} onChange={e => setServerName(e.target.value)} />
        <button className="primary" onClick={createServer}>Create</button>
      </div>

      <div className={`modal${modal === "joinServer" ? "" : " hidden"}`}>
        <h2>Join Server</h2>
        <input type="text" placeholder="Invite code" value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
        <button className="primary" onClick={joinServer}>Join</button>
      </div>

      <div className={`modal${modal === "addChannel" ? "" : " hidden"}`}>
        <h2>Add Channel</h2>
        <input type="text" placeholder="Channel name" value={channelName} onChange={e => setChannelName(e.target.value)} />
        <select value={channelType} onChange={e => setChannelType(e.target.value)}>
          <option value="text">Text</option>
          <option value="media">Media</option>
        </select>
        <button className="primary" onClick={addChannel}>Add</button>
      </div>
      <div className={`modal${modal === "roles" ? "" : " hidden"}`}>
        <h2>Roles</h2>
        <div className="list">
          {activeServer?.roles?.map(role => (
            <div key={role.id} className="list-item">
              <strong>{role.name}</strong>
            </div>
          ))}
        </div>
        <div className="form">
          <input type="text" placeholder="Role name" value={roleName} onChange={e => setRoleName(e.target.value)} />
          <label className="inline">
            <input type="checkbox" checked={permManageRoles} onChange={e => setPermManageRoles(e.target.checked)} /> Manage Roles
          </label>
          <label className="inline">
            <input type="checkbox" checked={permManageChannels} onChange={e => setPermManageChannels(e.target.checked)} /> Manage Channels
          </label>
          <label className="inline">
            <input type="checkbox" checked={permCreateInvites} onChange={e => setPermCreateInvites(e.target.checked)} /> Create Invites
          </label>
          <button className="primary" onClick={createRole} disabled={!perms.manageRoles}>Create Role</button>
        </div>
        <h3>Members</h3>
        <div className="list">
          {activeServer?.members?.map(member => (
            <div key={member.userId} className="list-item">
              <div>{member.username}</div>
              <select
                className="ghost"
                value={member.roleIds?.[0] || ""}
                onChange={e => assignRole(member.userId, e.target.value)}
                disabled={!perms.manageRoles}
              >
                {activeServer?.roles?.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className={`modal${modal === "invite" ? "" : " hidden"}`}>
        <h2>Invite Link</h2>
        <div className="invite-info">{inviteInfo || "Invite code will appear here."}</div>
        <button className="primary" onClick={createInvite}>Generate Invite</button>
      </div>

      <div className={`modal${modal === "settings" ? "" : " hidden"}`}>
        <h2>Settings</h2>
        <label>Microphone</label>
        <select value={audioDeviceId} onChange={e => setAudioDeviceId(e.target.value)}>
          <option value="">Default</option>
          {audioDevices.map((dev, idx) => (
            <option key={dev.deviceId} value={dev.deviceId}>{dev.label || `Microphone ${idx + 1}`}</option>
          ))}
        </select>
        <label>Camera</label>
        <select value={videoDeviceId} onChange={e => setVideoDeviceId(e.target.value)}>
          <option value="">Default</option>
          {videoDevices.map((dev, idx) => (
            <option key={dev.deviceId} value={dev.deviceId}>{dev.label || `Camera ${idx + 1}`}</option>
          ))}
        </select>
        <button className="primary" onClick={saveSettings}>Save</button>
        <button className="ghost" onClick={logout}>Logout</button>
      </div>

      <div
        className={`member-menu${memberMenu.visible ? "" : " hidden"}`}
        style={{ left: `${memberMenu.x}px`, top: `${memberMenu.y}px` }}
      >
        <div className="menu-title">User volume</div>
        <input
          type="range"
          min="0"
          max="100"
          value={memberMenu.value}
          onChange={e => {
            const value = Number(e.target.value || 100);
            setMemberMenu(prev => ({ ...prev, value }));
            setUserVolume(memberMenu.userId, value / 100);
          }}
        />
        <div>{memberMenu.value}%</div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
