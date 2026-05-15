import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  applySinkId,
  listAudioDevices,
  loadSavedDevice,
  saveDevice,
} from "./audioDevices.js";
import {
  enhanceAudio,
  createPeerConnection,
  getLocalStream,
  replaceAudioTrack,
  setAudioBitrate,
} from "./webrtc.js";
import {
  iceServersUseTurn,
  resetIceServersCache,
  resolveIceServers,
} from "./iceServers.js";

const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "" : window.location.origin);

const STORAGE_VOICE_MODE = "mv_voice_mode";
const STORAGE_INPUT = "mv_input_device";
const STORAGE_OUTPUT = "mv_output_device";
const STORAGE_GAME_MODE = "mv_game_mode";

/** continuous = mic mở (trừ khi tắt); ptt-* = cần bật để nói */
export function loadVoiceMode() {
  const v = sessionStorage.getItem(STORAGE_VOICE_MODE);
  if (v === "ptt-hold" || v === "ptt-toggle") return v;
  return "continuous";
}

function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function useRoom(roomId, userName) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [voiceMode, setVoiceModeState] = useState(loadVoiceMode);
  const [pttActive, setPttActive] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [turnEnabled, setTurnEnabled] = useState(false);
  const [turnLoading, setTurnLoading] = useState(true);
  const [gameMode, setGameModeState] = useState(
    () => sessionStorage.getItem(STORAGE_GAME_MODE) !== "0"
  );
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [inputDeviceId, setInputDeviceId] = useState(() =>
    loadSavedDevice(STORAGE_INPUT)
  );
  const [outputDeviceId, setOutputDeviceId] = useState(() =>
    loadSavedDevice(STORAGE_OUTPUT)
  );

  const socketRef = useRef(null);
  const iceServersRef = useRef(null);
  const localStreamRef = useRef(null);
  const rawStreamRef = useRef(null);
  const audioEnhanceRef = useRef(null);
  const pcsRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const selfIdRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState([]);

  const setVoiceMode = useCallback((mode) => {
    setVoiceModeState(mode);
    sessionStorage.setItem(STORAGE_VOICE_MODE, mode);
    if (mode === "continuous") setPttActive(false);
    if (mode.startsWith("ptt")) setPttActive(false);
  }, []);

  const setGameMode = useCallback((on) => {
    setGameModeState(on);
    sessionStorage.setItem(STORAGE_GAME_MODE, on ? "1" : "0");
  }, []);

  const loadIceServers = useCallback(async () => {
    setTurnLoading(true);
    try {
      const iceServers = await resolveIceServers();
      iceServersRef.current = iceServers;
      setTurnEnabled(iceServersUseTurn(iceServers));
      return iceServers;
    } finally {
      setTurnLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIceServers();
  }, [loadIceServers]);

  const refreshDevices = useCallback(async () => {
    const { inputs, outputs } = await listAudioDevices();
    setInputDevices(inputs);
    setOutputDevices(outputs);
    return { inputs, outputs };
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices
      );
    };
  }, [refreshDevices]);

  const syncRemote = useCallback(() => {
    setRemoteStreams(
      [...remoteStreamsRef.current.entries()].map(([peerId, stream]) => ({
        peerId,
        stream,
      }))
    );
  }, []);

  const applyMicState = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const pttMuted =
      voiceMode === "ptt-hold" || voiceMode === "ptt-toggle"
        ? !pttActive
        : false;
    track.enabled = !muted && !pttMuted;
  }, [muted, voiceMode, pttActive]);

  useEffect(() => {
    applyMicState();
  }, [applyMicState]);

  const buildLocalStream = useCallback(
    async (raw) => {
      audioEnhanceRef.current?.stop();
      audioEnhanceRef.current = null;

      let stream = raw;
      if (!gameMode) {
        audioEnhanceRef.current = enhanceAudio(raw);
        stream = audioEnhanceRef.current.stream;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    },
    [gameMode]
  );

  const captureMic = useCallback(async () => {
    const raw = await getLocalStream({
      deviceId: inputDeviceId || undefined,
      noiseSuppression: !gameMode,
      echoCancellation: true,
    });
    rawStreamRef.current = raw;
    return buildLocalStream(raw);
  }, [inputDeviceId, gameMode, buildLocalStream]);

  const addTracks = useCallback((pc, stream) => {
    stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
  }, []);

  const removePeer = useCallback(
    (peerId) => {
      const pc = pcsRef.current.get(peerId);
      if (pc) {
        pc.close();
        pcsRef.current.delete(peerId);
      }
      remoteStreamsRef.current.delete(peerId);
      setPeers((p) => p.filter((u) => u.id !== peerId));
      syncRemote();
    },
    [syncRemote]
  );

  const createOffer = useCallback(
    async (peerId) => {
      const stream = localStreamRef.current;
      if (!stream) return;

      const pc = createPeerConnection(
        iceServersRef.current,
        (remote) => {
          remoteStreamsRef.current.set(peerId, remote);
          syncRemote();
        },
        (candidate) => {
          socketRef.current?.emit("signal", {
            to: peerId,
            data: { type: "ice", candidate },
          });
        }
      );

      addTracks(pc, stream);
      pcsRef.current.set(peerId, pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setAudioBitrate(pc);

      socketRef.current?.emit("signal", {
        to: peerId,
        data: { type: "offer", sdp: offer },
      });
    },
    [addTracks, syncRemote]
  );

  const handleSignal = useCallback(
    async (from, data) => {
      const stream = localStreamRef.current;
      if (!stream) return;

      if (data.type === "offer") {
        let pc = pcsRef.current.get(from);
        if (!pc) {
          pc = createPeerConnection(
            iceServersRef.current,
            (remote) => {
              remoteStreamsRef.current.set(from, remote);
              syncRemote();
            },
            (candidate) => {
              socketRef.current?.emit("signal", {
                to: from,
                data: { type: "ice", candidate },
              });
            }
          );
          addTracks(pc, stream);
          pcsRef.current.set(from, pc);
        }

        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setAudioBitrate(pc);

        socketRef.current?.emit("signal", {
          to: from,
          data: { type: "answer", sdp: answer },
        });
      } else if (data.type === "answer") {
        const pc = pcsRef.current.get(from);
        if (pc) await pc.setRemoteDescription(data.sdp);
      } else if (data.type === "ice" && data.candidate) {
        const pc = pcsRef.current.get(from);
        if (pc) await pc.addIceCandidate(data.candidate);
      }
    },
    [addTracks, syncRemote]
  );

  const changeInputDevice = useCallback(
    async (deviceId) => {
      setInputDeviceId(deviceId);
      saveDevice(STORAGE_INPUT, deviceId);

      if (!localStreamRef.current) return;

      try {
        stopStream(rawStreamRef.current);
        const raw = await getLocalStream({
          deviceId: deviceId || undefined,
          noiseSuppression: !gameMode,
        });
        rawStreamRef.current = raw;
        const stream = await buildLocalStream(raw);
        await replaceAudioTrack(pcsRef.current, stream);
        applyMicState();
      } catch {
        setError("Không đổi được micro.");
      }
    },
    [gameMode, buildLocalStream, applyMicState]
  );

  const changeOutputDevice = useCallback((deviceId) => {
    setOutputDeviceId(deviceId);
    saveDevice(STORAGE_OUTPUT, deviceId);
  }, []);

  const togglePtt = useCallback(() => {
    if (voiceMode === "ptt-toggle") {
      setPttActive((a) => !a);
    }
  }, [voiceMode]);

  const setPttPressed = useCallback(
    (pressed) => {
      if (voiceMode === "ptt-hold") setPttActive(pressed);
    },
    [voiceMode]
  );

  const join = useCallback(async () => {
    if (!roomId || !userName?.trim()) return false;

    setError(null);

    try {
      if (!iceServersRef.current) await loadIceServers();

      await captureMic();
      applyMicState();

      const socket = io(SERVER, { transports: ["websocket", "polling"] });
      socketRef.current = socket;

      socket.on("connect", () => {
        selfIdRef.current = socket.id;
        socket.emit("join-room", { roomId, name: userName.trim() });
      });

      socket.on("joined", ({ peers: existing }) => {
        setConnected(true);
        setPeers(existing);
        refreshDevices();
      });

      socket.on("user-joined", ({ user }) => {
        setPeers((p) => [...p, user]);
        createOffer(user.id);
      });

      socket.on("user-left", ({ userId }) => removePeer(userId));

      socket.on("signal", ({ from, data }) => handleSignal(from, data));

      socket.on("chat-message", (msg) => {
        setMessages((m) => [...m, msg]);
      });

      socket.on("room-full", () => {
        setError("Phòng đã đủ 10 người.");
        socket.disconnect();
      });

      socket.on("connect_error", () => {
        setError("Không kết nối được server. Chạy npm run dev ở thư mục gốc.");
      });
      return true;
    } catch (e) {
      setError(
        e.name === "NotAllowedError"
          ? "Cần quyền micro để tham gia."
          : "Không mở được micro."
      );
      return false;
    }
  }, [
    roomId,
    userName,
    captureMic,
    applyMicState,
    createOffer,
    handleSignal,
    removePeer,
    loadIceServers,
    refreshDevices,
  ]);

  const leave = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    remoteStreamsRef.current.clear();
    stopStream(rawStreamRef.current);
    rawStreamRef.current = null;
    audioEnhanceRef.current?.stop();
    audioEnhanceRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setConnected(false);
    setPeers([]);
    setMessages([]);
    setRemoteStreams([]);
    setPttActive(false);
    iceServersRef.current = null;
    setTurnEnabled(false);
    resetIceServersCache();
    loadIceServers();
  }, [loadIceServers]);

  const sendMessage = useCallback((text) => {
    socketRef.current?.emit("chat-message", { text });
  }, []);

  useEffect(() => () => leave(), [leave]);

  const isTransmitting =
    voiceMode === "continuous"
      ? !muted
      : pttActive && !muted;

  return {
    connected,
    peers,
    messages,
    error,
    muted,
    setMuted,
    voiceMode,
    setVoiceMode,
    pttActive,
    setPttActive,
    togglePtt,
    setPttPressed,
    isTransmitting,
    gameMode,
    setGameMode,
    inputDevices,
    outputDevices,
    inputDeviceId,
    outputDeviceId,
    changeInputDevice,
    changeOutputDevice,
    refreshDevices,
    applySinkId,
    localStream,
    turnEnabled,
    turnLoading,
    remoteStreams,
    join,
    leave,
    sendMessage,
    selfId: selfIdRef.current,
  };
}
