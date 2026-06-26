const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
 
const app = express();
app.use(cors());
 
const server = http.createServer(app);
 
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
 
// ---------------- CONFIG ----------------
const MAX_ROOM_SIZE = 8;
const MAX_MSG_LENGTH = 2000;
 
// ---------------- STATE ----------------
let queue = [];          // sockets waiting for stranger match
let users = {};          // socket.id -> { partnerId, sessionId }
let lastAction = {};     // socket.id -> timestamp  (rate limiting)
let rooms = {};          // roomId -> [socket.id, ...]
let roomCounter = 1;
 
// ---------------- RATE LIMIT ----------------
/**
 * Returns true if the socket is allowed to act.
 * @param {string} id  - socket.id
 * @param {number} limit - min ms between actions
 */
function canAct(id, limit = 800) {
  const now = Date.now();
  if (lastAction[id] === undefined || now - lastAction[id] >= limit) {
    lastAction[id] = now;
    return true;
  }
  return false;
}
 
// ---------------- FIND AVAILABLE ROOM ----------------
function findAvailableRoom() {
  for (const roomId in rooms) {
    if (rooms[roomId].length < MAX_ROOM_SIZE) {
      return roomId;
    }
  }
  const newRoomId = `room_${roomCounter++}`;
  rooms[newRoomId] = [];
  return newRoomId;
}
 
// ---------------- CLEAR STRANGER PAIR ----------------
/**
 * Severs the stranger pairing for `socket`.
 * Notifies the partner and cleans up both entries from `users`.
 * Does NOT re-queue the partner — the client should handle that.
 */
function clearPair(socket) {
  const data = users[socket.id];
  if (!data) return;
 
  const { partnerId } = data;
 
  // Clean up this socket first so the partner's handler can't loop back.
  delete users[socket.id];
 
  if (partnerId && users[partnerId]) {
    // Only notify if the partner's session still matches ours.
    if (users[partnerId].partnerId === socket.id) {
      delete users[partnerId];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket && partnerSocket.connected) {
        partnerSocket.emit("partner_left");
      }
    }
  }
}
 
// ---------------- MATCHMAKING ----------------
function tryMatch() {
  // Deduplicate queue (safety net against double-joins)
  const seen = new Set();
  queue = queue.filter((s) => {
    if (seen.has(s.id) || !s.connected || users[s.id]) return false;
    seen.add(s.id);
    return true;
  });
 
  console.log(`tryMatch — queue size: ${queue.length}`);
 
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
 
    // Re-validate: either socket might have disconnected or already matched
    if (!a.connected || !b.connected || users[a.id] || users[b.id]) {
      // Put back any valid socket that lost its partner to a bad draw
      if (a.connected && !users[a.id]) queue.unshift(a);
      if (b.connected && !users[b.id]) queue.unshift(b);
      continue;
    }
 
    const sessionId =
      Date.now().toString() + "_" + Math.random().toString(36).substring(2, 8);
 
    users[a.id] = { partnerId: b.id, sessionId };
    users[b.id] = { partnerId: a.id, sessionId };
 
    a.emit("matched", { sessionId });
    b.emit("matched", { sessionId });
 
    console.log(`Matched: ${a.id} <-> ${b.id}  session: ${sessionId}`);
  }
}
 
// ---------------- HEALTH CHECK ----------------
app.get("/", (_req, res) => res.send("Stranger Chat Server Running 🚀"));
 
// ---------------- SOCKET ----------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
 
  // ── JOIN STRANGER ──────────────────────────────────────────────────────────
  socket.on("join_stranger", (profile) => {
    // Ignore if already matched
    if (users[socket.id]) return;
 
    socket.profile = profile;
 
    // Remove any stale queue entry for this socket before pushing
    queue = queue.filter((s) => s.id !== socket.id);
    queue.push(socket);
 
    console.log(`join_stranger: ${socket.id}  queue: ${queue.length}`);
    tryMatch();
  });
 
  // ── STRANGER MESSAGE ───────────────────────────────────────────────────────
  socket.on("message_stranger", (msg) => {
    if (!canAct(socket.id, 300)) return;
 
    const data = users[socket.id];
    if (!data) return;
 
    // Sanitise: only forward plain strings, capped at MAX_MSG_LENGTH
    if (typeof msg !== "string") return;
    const safe = msg.slice(0, MAX_MSG_LENGTH);
 
    io.to(data.partnerId).emit("message", safe);
  });
 
  // ── SKIP & RE-QUEUE ────────────────────────────────────────────────────────
  socket.on("skip_and_requeue", (profile) => {
    if (!canAct(socket.id, 1200)) return;
 
    socket.profile = profile;
 
    clearPair(socket);
 
    // Remove any stale entry then push back
    queue = queue.filter((s) => s.id !== socket.id);
    queue.push(socket);
 
    tryMatch();
  });
 
  // ── STRANGER TYPING ────────────────────────────────────────────────────────
  socket.on("typing", () => {
    // Light rate-limit so a held key can't spam the partner
    if (!canAct(socket.id, 400)) return;
 
    const data = users[socket.id];
    if (!data) return;
 
    io.to(data.partnerId).emit("typing");
  });
 
  // ── JOIN GROUP ─────────────────────────────────────────────────────────────
  socket.on("join_group", (profile) => {
    // Leave any existing group first
    if (socket.roomId) {
      leaveGroup(socket);
    }
 
    socket.profile = profile;
 
    const roomId = findAvailableRoom();
    socket.join(roomId);
    rooms[roomId].push(socket.id);
    socket.roomId = roomId;
 
    io.to(roomId).emit("room_update", { users: rooms[roomId].length });
    socket.emit("group_joined", { roomId, users: rooms[roomId].length });
 
    console.log(`${socket.id} joined group ${roomId}`);
  });
 
  // ── GROUP MESSAGE ──────────────────────────────────────────────────────────
  socket.on("message_room", (msg) => {
    if (!canAct(socket.id, 300)) return;
 
    const roomId = socket.roomId;
    if (!roomId) return;
 
    if (typeof msg !== "string") return;
    const safe = msg.slice(0, MAX_MSG_LENGTH);
 
    socket.to(roomId).emit("message", safe);
  });
 
  // ── GROUP TYPING ───────────────────────────────────────────────────────────
  socket.on("typing_room", () => {
    if (!canAct(socket.id, 400)) return;
 
    const roomId = socket.roomId;
    if (!roomId) return;
 
    socket.to(roomId).emit("typing");
  });
 
  // ── LEAVE GROUP ────────────────────────────────────────────────────────────
  socket.on("leave_group", () => {
    leaveGroup(socket);
  });
 
  // ── DISCONNECT ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
 
    // Stranger cleanup
    clearPair(socket);
    queue = queue.filter((s) => s.id !== socket.id);
    delete lastAction[socket.id];
 
    // Group cleanup
    leaveGroup(socket);
  });
});
 
// ---------------- LEAVE GROUP (shared logic) ----------------
/**
 * Removes `socket` from its current group room and cleans up state.
 * Safe to call even if the socket is not in any room.
 */
function leaveGroup(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
 
  // Clear the roomId first to prevent double-calls
  socket.roomId = null;
 
  socket.leave(roomId);
 
  if (!rooms[roomId]) return;
 
  rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
 
  if (rooms[roomId].length === 0) {
    delete rooms[roomId];
  } else {
    io.to(roomId).emit("room_update", { users: rooms[roomId].length });
  }
 
  console.log(`${socket.id} left group ${roomId}`);
}
 
// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));