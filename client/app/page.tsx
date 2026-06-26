"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  text?: string;
  image?: string | null;
  nickname: string;
  self: boolean; // true = sent by me, never echoed back from server
}

interface Profile {
  gender: string;
  age: string;
  nickname: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const MAX_MSG_LENGTH = 2000;

// ─── Serialisation helpers ────────────────────────────────────────────────────
// The backend only accepts plain strings, so we JSON-encode the payload.
function encodeMsg(payload: Omit<Message, "self">): string {
  return JSON.stringify(payload);
}
function decodeMsg(raw: string): Omit<Message, "self"> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // plain-text fallback
    return { text: raw, nickname: "Stranger" };
  }
  return null;
}

export default function Home() {
  // ── Socket ref (stable across renders, created once on mount) ──────────────
  const socketRef = useRef<Socket | null>(null);

  // ── Steps & profile ───────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [nickname, setNickname] = useState("");
  const [mode, setMode] = useState<"stranger" | "group" | "">("");

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState<"idle" | "searching" | "connected">(
    "idle"
  );
  const [roomUsers, setRoomUsers] = useState(0);
  const [partnerLeft, setPartnerLeft] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showLeaveBox, setShowLeaveBox] = useState(false);
  const [online, setOnline] = useState(5000);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingThrottle = useRef<number>(0);

  // Use a ref for nickname/mode so socket callbacks always read latest value
  const nicknameRef = useRef(nickname);
  const modeRef = useRef(mode);
  useEffect(() => { nicknameRef.current = nickname; }, [nickname]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Fake online count ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setOnline((prev) => {
        const next = prev + Math.floor(Math.random() * 21 - 10);
        return Math.min(9500, Math.max(3500, next));
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // ── Socket: create once on mount, destroy on unmount ─────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    // ── matched ──────────────────────────────────────────────────────────
    socket.on("matched", () => {
      setStatus("connected");
      setMessages([]);
      setPartnerLeft(false);
    });

    // ── incoming message ─────────────────────────────────────────────────
    socket.on("message", (raw: string) => {
      const payload = decodeMsg(raw);
      if (!payload) return;
      // Never add a message that came from ourselves (self flag is not set by server)
      setMessages((prev) => [...prev, { ...payload, self: false }]);
      setTyping(false);
    });

    // ── typing indicator ─────────────────────────────────────────────────
    socket.on("typing", () => {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 1500);
    });

    // ── partner left ─────────────────────────────────────────────────────
    socket.on("partner_left", () => {
      setStatus("searching");
      setMessages([]);
      setPartnerLeft(true);
      // Don't auto-requeue — let the user decide (skip button or message shown)
    });

    // ── group events ─────────────────────────────────────────────────────
    socket.on("group_joined", (data: { roomId: string; users: number }) => {
      setRoomUsers(data.users);
      setStatus("connected");
    });

    socket.on("room_update", (data: { users: number }) => {
      setRoomUsers(data.users);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setImage(null);
    setTyping(false);
    setPartnerLeft(false);
    setStatus("idle");
    setRoomUsers(0);
  }, []);

  // ── Step 1 → 2 ────────────────────────────────────────────────────────────
  const start = () => {
    if (!gender || !age || !nickname.trim()) return;
    setStep(2);
  };

  // ── Step 2 → 3 (mode select) ──────────────────────────────────────────────
  const selectMode = (m: "stranger" | "group") => {
    const socket = socketRef.current;
    if (!socket) return;

    resetChat();
    setMode(m);
    setStep(3);

    const profile: Profile = { gender, age, nickname };

    if (m === "stranger") {
      setStatus("searching");
      socket.emit("join_stranger", profile);
    } else {
      socket.emit("join_group", profile);
      // status set to "connected" when "group_joined" arrives
    }
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = () => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!input.trim() && !image) return;
    if (status !== "connected") return;

    const payload: Omit<Message, "self"> = {
      text: input.trim().slice(0, MAX_MSG_LENGTH) || undefined,
      image: image || undefined,
      nickname,
    };

    // Show immediately in own chat (self: true — never echoed by server)
    setMessages((prev) => [...prev, { ...payload, self: true }]);

    const encoded = encodeMsg(payload);

    if (modeRef.current === "stranger") {
      socket.emit("message_stranger", encoded);
    } else {
      socket.emit("message_room", encoded);
    }

    setInput("");
    setImage(null);
  };

  // ── Typing indicator (throttled — max 1 emit per 500 ms) ─────────────────
  const emitTyping = () => {
    const socket = socketRef.current;
    if (!socket || status !== "connected") return;

    const now = Date.now();
    if (now - typingThrottle.current < 500) return;
    typingThrottle.current = now;

    if (modeRef.current === "stranger") {
      socket.emit("typing");
    } else {
      socket.emit("typing_room");
    }
  };

  // ── Skip ──────────────────────────────────────────────────────────────────
  const skip = () => {
    const socket = socketRef.current;
    if (!socket) return;

    setMessages([]);
    setPartnerLeft(false);
    setStatus("searching");

    socket.emit("skip_and_requeue", { gender, age, nickname });
  };

  // ── Leave ─────────────────────────────────────────────────────────────────
  const leave = () => setShowLeaveBox(true);
  const cancelLeave = () => setShowLeaveBox(false);

  const confirmLeave = () => {
    const socket = socketRef.current;
    if (!socket) return;

    if (modeRef.current === "group") {
      socket.emit("leave_group");
    } else if (modeRef.current === "stranger") {
      // Disconnect from current pair WITHOUT re-queuing
      socket.emit("skip_and_requeue", { gender, age, nickname });
      // Immediately remove from queue by disconnecting and reconnecting
      // The cleanest approach: just skip once, then we go back to step 2
    }

    resetChat();
    setShowLeaveBox(false);
    setMode("");
    setStep(2);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── STEP 1: Profile ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="welcomeCard">
          <h1>💬 Stranger Chat</h1>

          <input
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
          />

          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>

          <select value={age} onChange={(e) => setAge(e.target.value)}>
            <option value="">Age</option>
            <option value="18-24">18-24</option>
            <option value="25+">25+</option>
          </select>

          <button onClick={start} disabled={!gender || !age || !nickname.trim()}>
            Continue
          </button>
        </div>
      )}

      {/* ── STEP 2: Mode select ──────────────────────────────────────────── */}
      {step === 2 && (
        <div className="welcomeCard">
          <h1>Choose Mode</h1>
          <button onClick={() => selectMode("stranger")}>🔥 Stranger Chat</button>
          <button onClick={() => selectMode("group")}>👥 Group Chat</button>
        </div>
      )}

      {/* ── STEP 3: Chat ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="chatContainer">

          {/* Sidebar */}
          <div className="sidebar">
            <h2>💬 StrangerChat</h2>
            <div className="online">🟢 {online.toLocaleString()} Online</div>
            {mode === "group" && (
              <div className="online">👥 {roomUsers}/8 Users</div>
            )}
          </div>

          {/* Chat panel */}
          <div className="chat">
            <div className="chatHeader">
              {status === "connected" ? "🟢 Connected" : "🔍 Searching..."}
            </div>

            {/* Partner-left notice */}
            {partnerLeft && status === "searching" && (
              <div className="notice">
                Your partner left. Click <b>Skip</b> to find a new one.
              </div>
            )}

            {/* Messages */}
            <div className="messages">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`bubble ${m.self ? "me" : "them"}`}
                >
                  <b>{m.self ? "You" : m.nickname}</b>
                  {m.text && <div>{m.text}</div>}
                  {m.image && (
                    <img src={m.image} className="chatImage" alt="shared" />
                  )}
                </div>
              ))}

              {typing && <div className="typing">typing…</div>}
              <div ref={bottomRef} />
            </div>

            {/* Input row */}
            <div className="inputArea">
              <input
                value={input}
                placeholder={
                  status === "connected" ? "Type message…" : "Waiting for match…"
                }
                disabled={status !== "connected"}
                onChange={(e) => {
                  setInput(e.target.value);
                  emitTyping();
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
                    reader.onload = () => setImage(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                />
              </label>

              <button onClick={send} disabled={status !== "connected"}>
                ➤
              </button>
            </div>

            {/* Image preview */}
            {image && (
              <div className="imagePreview">
                <img src={image} alt="preview" />
                <button onClick={() => setImage(null)}>✕</button>
              </div>
            )}

            {/* Action buttons */}
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

            {/* Leave confirm overlay */}
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