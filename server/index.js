const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");



// ---------------- GROUP ROOMS ----------------

const MAX_ROOM_SIZE = 8;

let rooms = {};
let roomCounter = 1;




const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
cors: {
origin: "*",
methods: ["GET", "POST"]
}
});

// ---------------- STATE ----------------
let queue = [];
let users = {}; // socket.id -> { partnerId, sessionId }
let lastAction = {};

// ---------------- RATE LIMIT ----------------
function canAct(id, limit = 800) {
const now = Date.now();

if (!lastAction[id]) {
lastAction[id] = now;
return true;
}

if (now - lastAction[id] < limit) {
return false;
}

lastAction[id] = now;
return true;
}

// ---------------- CLEAR PAIR ----------------
function clearPair(socket) {
const data = users[socket.id];

if (data?.partnerId) {
io.to(data.partnerId).emit("partner_left");
delete users[data.partnerId];
}

delete users[socket.id];
}

// ---------------- MATCHMAKING ----------------
function tryMatch() {
while (queue.length >= 2) {
const a = queue.shift();
const b = queue.shift();

```
if (!a || !b) continue;

if (!a.connected || !b.connected) continue;

const sessionId =
  Date.now().toString() +
  "_" +
  Math.random().toString(36).substring(2, 8);

users[a.id] = {
  partnerId: b.id,
  sessionId,
};

users[b.id] = {
  partnerId: a.id,
  sessionId,
};

a.emit("matched", { sessionId });
b.emit("matched", { sessionId });
```

}
}

// ---------------- HEALTH CHECK ----------------
app.get("/", (req, res) => {
res.send("Stranger Chat Server Running 🚀");
});

// ---------------- SOCKET ----------------
io.on("connection", (socket) => {
console.log("User Connected:", socket.id);

// ---------------- JOIN STRANGER ----------------
socket.on("join_stranger", (profile) => {
socket.profile = profile;

```
queue = queue.filter(
  (u) => u.id !== socket.id
);

queue.push(socket);

tryMatch();
```

});

// ---------------- MESSAGE ----------------
socket.on("message_stranger", (msg) => {
if (!canAct(socket.id, 300)) return;

```
const data = users[socket.id];

if (!data) return;

io.to(data.partnerId).emit(
  "message",
  msg
);
```

});

// ---------------- SKIP ----------------
socket.on(
"skip_and_requeue",
(profile) => {
if (!canAct(socket.id, 1200))
return;

```
  socket.profile = profile;

  clearPair(socket);

  queue = queue.filter(
    (u) => u.id !== socket.id
  );

  queue.push(socket);

  tryMatch();
}
```

});

// ---------------- TYPING ----------------
socket.on("typing", () => {
const data = users[socket.id];

```
if (data) {
  io.to(data.partnerId).emit(
    "typing"
  );
}
```

});




//---------------- Update Disconnect ----------------

socket.on("disconnect", () => {
  console.log("User Disconnected:", socket.id);

  // Stranger cleanup
  clearPair(socket);

  queue = queue.filter(
    (u) => u.id !== socket.id
  );

  delete lastAction[socket.id];

  // Group cleanup
  if (socket.roomId && rooms[socket.roomId]) {

    rooms[socket.roomId] =
      rooms[socket.roomId].filter(
        (id) => id !== socket.id
      );

    io.to(socket.roomId).emit(
      "room_update",
      {
        users: rooms[socket.roomId].length,
      }
    );

    if (rooms[socket.roomId].length === 0) {
      delete rooms[socket.roomId];
    }
  }
});
// ---------------- JOIN GROUP ----------------

socket.on("join_group", (profile) => {
  socket.profile = profile;

  const roomId = findAvailableRoom();

  socket.join(roomId);

  rooms[roomId].push(socket.id);

  socket.roomId = roomId;

  io.to(roomId).emit("room_update", {
    users: rooms[roomId].length,
  });

  socket.emit("group_joined", {
    roomId,
    users: rooms[roomId].length,
  });
});



// ---------------- MESSAGE ROOM ----------------
socket.on("message_room", (msg) => {
  const roomId = socket.roomId;

  if (!roomId) return;

  socket.to(roomId).emit("message", msg);
});



// ---------------- TYPING ROOM ----------------
socket.on("typing_room", () => {
  const roomId = socket.roomId;

  if (!roomId) return;

  socket.to(roomId).emit("typing");
});



// ---------------- LEAVE GROUP ----------------

socket.on("leave_group", () => {
  const roomId = socket.roomId;

  if (!roomId) return;

  socket.leave(roomId);

  if (rooms[roomId]) {

    rooms[roomId] =
      rooms[roomId].filter(
        (id) => id !== socket.id
      );

    io.to(roomId).emit("room_update", {
      users: rooms[roomId].length,
    });

    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
    }
  }

  socket.roomId = null;
});

});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
console.log(
`Server running on port ${PORT}`
);
});



// ---------------- GROUP ROOMS ----------------


function findAvailableRoom() {
  for (const roomId in rooms) {
    if (rooms[roomId].length < MAX_ROOM_SIZE) {
      return roomId;
    }
  }

  const newRoom = `room_${roomCounter++}`;
  rooms[newRoom] = [];

  return newRoom;
}