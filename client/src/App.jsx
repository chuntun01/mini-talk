import { useEffect, useMemo, useRef, useState } from "react";
import { applySinkId } from "./audioDevices.js";
import { useRoom } from "./useRoom.js";
import "./App.css";

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get("room") || "";
}

function deviceLabel(device) {
  return device.label || `${device.kind} (${device.deviceId.slice(0, 8)}…)`;
}

function DeviceSelect({ label, devices, value, onChange, disabled }) {
  return (
    <label className="device-row">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Mặc định hệ thống</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VoiceModePicker({ value, onChange }) {
  return (
    <fieldset className="voice-modes">
      <legend>Chế độ nói</legend>
      <label className="mode-option">
        <input
          type="radio"
          name="voiceMode"
          checked={value === "continuous"}
          onChange={() => onChange("continuous")}
        />
        Liên tục
      </label>
      <label className="mode-option">
        <input
          type="radio"
          name="voiceMode"
          checked={value === "ptt-toggle"}
          onChange={() => onChange("ptt-toggle")}
        />
        Bật/tắt (nút hoặc Space)
      </label>
      <label className="mode-option">
        <input
          type="radio"
          name="voiceMode"
          checked={value === "ptt-hold"}
          onChange={() => onChange("ptt-hold")}
        />
        Giữ để nói
      </label>
    </fieldset>
  );
}

function MicControl({ room }) {
  const { voiceMode, muted, setMuted, isTransmitting, togglePtt, setPttPressed } =
    room;

  if (voiceMode === "continuous") {
    return (
      <button
        type="button"
        className={`btn mic-btn ${muted ? "muted" : "live"}`}
        onClick={() => setMuted((m) => !m)}
      >
        {muted ? "Mic tắt — bấm bật" : "Mic đang bật — bấm tắt"}
      </button>
    );
  }

  if (voiceMode === "ptt-toggle") {
    return (
      <button
        type="button"
        className={`btn mic-btn ${isTransmitting ? "live" : ""}`}
        onClick={togglePtt}
      >
        {isTransmitting ? "Đang nói — bấm để tắt" : "Bấm để nói (Space)"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`btn mic-btn ${isTransmitting ? "live" : ""}`}
      onMouseDown={() => setPttPressed(true)}
      onMouseUp={() => setPttPressed(false)}
      onMouseLeave={() => setPttPressed(false)}
      onTouchStart={(e) => {
        e.preventDefault();
        setPttPressed(true);
      }}
      onTouchEnd={() => setPttPressed(false)}
    >
      {isTransmitting ? "Đang nói…" : "Giữ để nói (Space)"}
    </button>
  );
}

function AudioSettings({ room, compact }) {
  return (
    <section className={`audio-settings ${compact ? "compact" : ""}`}>
      <h3>{compact ? "Âm thanh" : "Thiết bị & hiệu năng"}</h3>
      <DeviceSelect
        label="Micro"
        devices={room.inputDevices}
        value={room.inputDeviceId}
        onChange={room.changeInputDevice}
      />
      <DeviceSelect
        label="Loa / tai nghe"
        devices={room.outputDevices}
        value={room.outputDeviceId}
        onChange={room.changeOutputDevice}
        disabled={!room.outputDevices.length}
      />
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={room.gameMode}
          onChange={(e) => room.setGameMode(e.target.checked)}
        />
        Chế độ game (nhẹ CPU, ít xử lý âm thanh)
      </label>
    </section>
  );
}

export default function App() {
  const [roomId, setRoomId] = useState(getRoomFromUrl);
  const [userName, setUserName] = useState(
    () => sessionStorage.getItem("mv_name") || ""
  );
  const [inLobby, setInLobby] = useState(true);
  const chatEndRef = useRef(null);

  const room = useRoom(roomId, userName);

  const inviteUrl = useMemo(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId || "demo");
    return u.toString();
  }, [roomId]);

  const handleJoin = async () => {
    if (!userName.trim()) return;
    const id = roomId.trim() || randomRoomId();
    setRoomId(id);
    sessionStorage.setItem("mv_name", userName.trim());
    const u = new URL(window.location.href);
    u.searchParams.set("room", id);
    window.history.replaceState({}, "", u);
    const ok = await room.join();
    if (ok) setInLobby(false);
  };

  const turnLabel = room.turnLoading
    ? "Đang kiểm tra TURN…"
    : room.turnEnabled
      ? "Metered TURN"
      : "STUN only — kiểm tra .env và khởi động lại server";

  const handleLeave = () => {
    room.leave();
    setInLobby(true);
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
  };

  useEffect(() => {
    if (!room.connected || room.voiceMode === "continuous") return;

    const onKeyDown = (e) => {
      if (e.code !== "Space" || e.repeat) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      e.preventDefault();
      if (room.voiceMode === "ptt-hold") room.setPttPressed(true);
      else room.togglePtt();
    };

    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      if (room.voiceMode === "ptt-hold") room.setPttPressed(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    room.connected,
    room.voiceMode,
    room.setPttPressed,
    room.togglePtt,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [room.messages]);

  if (inLobby) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>Mini Voice</h1>
          <p className="tagline">
            Voice chat nhẹ cho game · P2P · Mặc định nói liên tục
          </p>

          <label>
            Tên của bạn
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="VD: Minh"
              maxLength={24}
            />
          </label>

          <label>
            Mã phòng
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Để trống = tạo phòng mới"
              maxLength={32}
            />
          </label>

          <AudioSettings room={room} />
          <VoiceModePicker value={room.voiceMode} onChange={room.setVoiceMode} />

          {room.error && <p className="error">{room.error}</p>}

          <button
            type="button"
            className="btn primary"
            disabled={!userName.trim()}
            onClick={handleJoin}
          >
            Vào phòng
          </button>

          <p className="hint">
            Chia sẻ link <code>?room=...</code>. Chế độ liên tục: mic mở, không
            chiếm phím Space.
          </p>
          <p className="meta-hint">{turnLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mini Voice</h1>
          <span className="room-badge">#{roomId}</span>
          <span
            className={`tx-badge ${room.isTransmitting ? "on" : ""}`}
            title="Trạng thái mic"
          >
            {room.isTransmitting ? "● Đang gửi tiếng" : "○ Im lặng"}
          </span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={copyInvite}>
            Chia sẻ link
          </button>
          <button type="button" className="btn danger" onClick={handleLeave}>
            Rời phòng
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2>Phòng ({room.peers.length + 1}/10)</h2>
          <ul className="member-list">
            <li className="member you">
              <span className="dot online" />
              {userName} (bạn)
            </li>
            {room.peers.map((p) => (
              <li key={p.id} className="member">
                <span className="dot online" />
                {p.name}
              </li>
            ))}
          </ul>

          <section className="controls">
            <h3>Điều khiển</h3>
            <VoiceModePicker
              value={room.voiceMode}
              onChange={room.setVoiceMode}
            />
            <MicControl room={room} />
            <AudioSettings room={room} compact />
            <p className="meta-hint">Audio ~32kbps · {turnLabel}</p>
          </section>
        </aside>

        <main className="main">
          <VoiceGrid
            localStream={room.localStream}
            remoteStreams={room.remoteStreams}
            peers={room.peers}
            outputDeviceId={room.outputDeviceId}
          />
          <ChatPanel
            messages={room.messages}
            onSend={room.sendMessage}
            chatEndRef={chatEndRef}
          />
        </main>
      </div>

      {room.error && <div className="toast error">{room.error}</div>}
    </div>
  );
}

function VoiceGrid({ localStream, remoteStreams, peers, outputDeviceId }) {
  const localAudioRef = useRef(null);

  useEffect(() => {
    if (!localStream || !localAudioRef.current) return;
    localAudioRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (localAudioRef.current) applySinkId(localAudioRef.current, outputDeviceId);
  }, [outputDeviceId]);

  return (
    <div className="voice-grid">
      <div className="tile local">
        <div className="avatar">Bạn</div>
        <audio ref={localAudioRef} autoPlay muted className="sr-only" />
        <span className="tile-label">Bạn</span>
      </div>
      {remoteStreams.map(({ peerId, stream }) => {
        const name = peers.find((p) => p.id === peerId)?.name || "Khách";
        return (
          <RemoteTile
            key={peerId}
            stream={stream}
            name={name}
            outputDeviceId={outputDeviceId}
          />
        );
      })}
    </div>
  );
}

function RemoteTile({ stream, name, outputDeviceId }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (audioRef.current) applySinkId(audioRef.current, outputDeviceId);
  }, [outputDeviceId, stream]);

  return (
    <div className="tile">
      <div className="avatar">{name[0]?.toUpperCase()}</div>
      <audio ref={audioRef} autoPlay playsInline className="sr-only" />
      <span className="tile-label">{name}</span>
    </div>
  );
}

function ChatPanel({ messages, onSend, chatEndRef }) {
  const [text, setText] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <section className="chat">
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="empty">Chưa có tin nhắn. Gõ để chat text.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-msg">
            <strong>{m.name}</strong>
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nhập tin nhắn…"
          maxLength={500}
        />
        <button type="submit" className="btn primary">
          Gửi
        </button>
      </form>
    </section>
  );
}
