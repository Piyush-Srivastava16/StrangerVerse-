"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io(
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001",
  {
    transports: ["websocket", "polling"],
  }
);

export default function Home() {
    const [roomUsers, setRoomUsers] = useState(0);

  // ---------------- STEP ----------------
  const [step, setStep] = useState(1);

  // ---------------- PROFILE ----------------
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [nickname, setNickname] = useState("");

  const [mode, setMode] = useState("");

  // ---------------- CHAT ----------------
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<any>(null);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState("idle");

  // ---------------- ONLINE FAKE USERS ----------------
  const [online, setOnline] = useState(5000);

  // ---------------- LEAVE BOX ----------------
  const [showLeaveBox, setShowLeaveBox] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // AUTO SCROLL
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // FAKE ONLINE USERS
  useEffect(() => {
    const interval = setInterval(() => {
      setOnline((prev) => {
        const change = Math.floor(Math.random() * 21 - 10);
        let next = prev + change;

        if (next < 3500) next = 3500;
        if (next > 9500) next = 9500;

        return next;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);
// SOCKET EVENTS
useEffect(() => {
  socket.on("matched", () => {
    setStatus("connected");
    setMessages([]);
  });

  socket.on("message", (msg) => {
    setMessages((p) => [...p, msg]);
    setTyping(false);
  });

  socket.on("typing", () => {
    setTyping(true);
    setTimeout(() => setTyping(false), 1000);
  });

  socket.on("partner_left", () => {
  setStatus("searching");
  setMessages([]);

  setTimeout(() => {
    socket.emit("skip_and_requeue");
  }, 1500);
});

  socket.on("group_joined", (data) => {
    setRoomUsers(data.users);
  });

  socket.on("room_update", (data) => {
    setRoomUsers(data.users);
  });

  return () => {
    socket.off("matched");
    socket.off("message");
    socket.off("typing");
    socket.off("partner_left");
    socket.off("group_joined");
    socket.off("room_update");
  };
}, []);
  // ---------------- START ----------------
  const start = () => {
    if (!gender || !age || !nickname) return;
    setStep(2);
  };

  // ---------------- MODE ----------------
const selectMode = (m: string) => {
  setMode(m);
  setStep(3);

  if (m === "stranger") {
    setStatus("searching");

    socket.emit("join_stranger", {
      gender,
      age,
      nickname,
    });
  } else {
    setStatus("connected");

    socket.emit("join_group", {
      gender,
      age,
      nickname,
    });
  }
};

  // ---------------- SEND ----------------
  const send = () => {
  if (!input.trim() && !image) return;

  const msg = {
    text: input,
    image,
    nickname,
  };

  // Show message instantly in own chat
  setMessages((p) => [...p, msg]);

  // Send to server
  if (mode === "stranger") {
    socket.emit("message_stranger", msg);
  } else {
    socket.emit("message_room", msg);
  }

  // Clear input
  setInput("");
  setImage(null);
};

  // ---------------- SKIP ----------------
  const skip = () => {
    setMessages([]);
    setStatus("searching");

    socket.emit("skip_and_requeue", {
      gender,
      age,
      nickname,
    });
  };

  // ---------------- LEAVE ----------------
  const leave = () => {
    setShowLeaveBox(true);
  };
const confirmLeave = () => {

  if (mode === "group") {
    socket.emit("leave_group");
  }

  if (mode === "stranger") {
    socket.emit("skip_and_requeue", {
      gender,
      age,
      nickname,
    });
  }

  setMessages([]);
  setInput("");
  setImage(null);
  setTyping(false);
  setStatus("idle");
  setShowLeaveBox(false);
  setStep(2);
};
  
  const cancelLeave = () => {
    setShowLeaveBox(false);
  };

  return (
    <div className="app">

      {/* STEP 1 */}
      {step === 1 && (
        <div className="welcomeCard">
          <h1>💬 Stranger Chat</h1>

          <input
            placeholder="Nickname"
            onChange={(e) => setNickname(e.target.value)}
          />

          <select onChange={(e) => setGender(e.target.value)}>
            <option value="">Gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>

          <select onChange={(e) => setAge(e.target.value)}>
            <option value="">Age</option>
            <option value="18-24">18-24</option>
            <option value="25+">25+</option>
          </select>

          <button onClick={start}>Continue</button>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="welcomeCard">
          <h1>Choose Mode</h1>

          <button onClick={() => selectMode("stranger")}>
            🔥 Stranger Chat
          </button>

          <button onClick={() => selectMode("group")}>
            👥 Group Chat
          </button>
        </div>
      )}

      {/* STEP 3 CHAT */}
      {step === 3 && (
        <div className="chatContainer">

          {/* SIDEBAR */}

          <div className="sidebar">
            <h2>💬 StrangerChat</h2>

            <div className="online">
              🟢 {online.toLocaleString()} Online
            </div>
          </div>
              {mode === "group" && (
  <div className="online">
    👥 {roomUsers}/8 Users
  </div>
)}

          {/* CHAT */}
          <div className="chat">

            <div className="chatHeader">
              {status === "connected"
                ? "🟢 Connected"
                : "🔍 Searching..."}
            </div>

            {/* MESSAGES */}
            <div className="messages">

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`bubble ${m.nickname === nickname ? "me" : "them"}`}
                >
                  <b>{m.nickname}</b>
                  {m.text && <div>{m.text}</div>}
                  {m.image && (
                    <img src={m.image} className="chatImage" />
                  )}
                </div>
              ))}

              {typing && <div className="typing">typing...</div>}

              <div ref={bottomRef} />
            </div>

            {/* INPUT */}
            <div className="inputArea">

              <input
                value={input}
                placeholder="Type message..."
   onChange={(e) => {
  setInput(e.target.value);

  if (mode === "stranger") {
    socket.emit("typing");
  } else {
    socket.emit("typing_room");
  }
}}

                onKeyDown={(e) => e.key === "Enter" && send()}
              />

              <label className="uploadBtn">
                📷
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = () => setImage(reader.result);
                    reader.readAsDataURL(file);
                  }}
                />
              </label>

              <button onClick={send}>➤</button>
            </div>

            {/* ACTIONS */}
            <div className="actionButtons">

              {mode === "stranger" && (
                <button className="skipBtn" onClick={skip}>
                  Skip
                </button>
              )}

              <button className="leaveBtn" onClick={leave}>
                Leave
              </button>

            </div>

            {/* LEAVE CONFIRM BOX (INSIDE CHAT) */}
            {showLeaveBox && (
              <div className="leaveBoxOverlay">
                <div className="leaveBox">
                  <h2>Leave Chat?</h2>
                  <p>Do you really want to leave this conversation?</p>

                  <div className="leaveBoxActions">
                    <button className="stayBtn" onClick={cancelLeave}>
                      Stay 
                    </button>

                    <button className="leaveConfirmBtn" onClick={confirmLeave}>
                      Leave
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}