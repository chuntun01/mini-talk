import dotenv from "dotenv";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: join(__dirname, ".env")});
dotenv.config({path: join(__dirname, "..", ".env")});
import {createServer} from "http";
import {Server} from "socket.io";
import cors from "cors";

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
// simple request logger to help Render logs diagnose incoming requests
app.use((req, res, next) => {
  console.log(`REQ ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.get("/health", (_req, res) => {
  console.log("HEALTH OK");
  res.json({ok: true});
});

/** Metered.ca TURN — API key chỉ ở server, client gọi same-origin */
app.get("/api/turn-credentials", async (req, res) => {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;
  if (!apiKey || !appName) {
    return res.status(503).json({error: "TURN not configured"});
  }
  try {
    const url = new URL(
      `https://${appName}.metered.live/api/v1/turn/credentials`,
    );
    url.searchParams.set("apiKey", apiKey);
    const region = req.query.region || process.env.METERED_REGION;
    if (region) url.searchParams.set("region", region);
    const upstream = await fetch(url);
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch {
    res.status(502).json({error: "Failed to fetch TURN credentials"});
  }
});

app.use(express.static("../client/dist"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {origin: "*", methods: ["GET", "POST"]},
});

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

io.on("connection", (socket) => {
  let currentRoom = null;
  let userId = null;

  socket.on("join-room", ({roomId, name}) => {
    if (!roomId || !name?.trim()) return;

    if (currentRoom) {
      socket.leave(currentRoom);
      const prev = getRoom(currentRoom);
      prev.delete(userId);
      if (prev.size === 0) rooms.delete(currentRoom);
    }

    currentRoom = roomId;
    userId = socket.id;
    const room = getRoom(roomId);

    if (room.size >= 10) {
      socket.emit("room-full");
      return;
    }

    const user = {id: userId, name: name.trim()};
    room.set(userId, user);
    socket.join(roomId);

    const peers = [...room.values()].filter((u) => u.id !== userId);
    socket.emit("joined", {user, peers});
    socket.to(roomId).emit("user-joined", {user});
  });

  socket.on("signal", ({to, data}) => {
    io.to(to).emit("signal", {from: socket.id, data});
  });

  socket.on("chat-message", ({text}) => {
    if (!currentRoom || !text?.trim()) return;
    const room = getRoom(currentRoom);
    const user = room.get(userId);
    if (!user) return;
    io.to(currentRoom).emit("chat-message", {
      id: `${Date.now()}-${userId}`,
      userId,
      name: user.name,
      text: text.trim(),
      at: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    if (!currentRoom || !userId) return;
    const room = getRoom(currentRoom);
    room.delete(userId);
    if (room.size === 0) rooms.delete(currentRoom);
    socket.to(currentRoom).emit("user-left", {userId});
  });
});

httpServer.listen(PORT, () => {
  console.log(`Signaling server http://localhost:${PORT}`);
});
