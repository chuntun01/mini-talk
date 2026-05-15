const {contextBridge} = require("electron");

const SERVER_URL =
  process.env.VITE_SERVER_URL ||
  process.env.SERVER_URL ||
  "http://localhost:3001";

contextBridge.exposeInMainWorld("DESKTOP_CONFIG", {
  serverUrl: SERVER_URL,
});
