// Signaling server, embedded directly in the host app's main process so
// there's only one thing to launch. Logic is identical to
// signaling-server/server.js (see that file's comments for why it's
// deliberately dumb) — this copy just serves the viewer page bundled
// alongside the app instead of a sibling directory.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const rooms = new Map(); // code -> { host: ws|null, viewer: ws|null }

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const VIEWER_DIR = path.join(__dirname, "viewer");
function serveStatic(req, res) {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(VIEWER_DIR, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(VIEWER_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    const type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function startSignalingServer(port) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: "/signal" });

  wss.on("connection", (ws) => {
    let joinedCode = null;
    let role = null; // "host" | "viewer"

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.type === "host") {
        const code = makeCode();
        rooms.set(code, { host: ws, viewer: null });
        joinedCode = code;
        role = "host";
        send(ws, { type: "hosting", code });
        return;
      }

      if (msg.type === "join") {
        const code = typeof msg.code === "string" ? msg.code.trim().toUpperCase() : "";
        const room = rooms.get(code);
        if (!room || !room.host) { send(ws, { type: "join-error", reason: "No host with that code." }); return; }
        if (room.viewer) { send(ws, { type: "join-error", reason: "Someone's already viewing that host." }); return; }
        room.viewer = ws;
        joinedCode = code;
        role = "viewer";
        send(ws, { type: "joined", code });
        send(room.host, { type: "viewer-joined" });
        return;
      }

      if (!joinedCode) return;
      const room = rooms.get(joinedCode);
      if (!room) return;
      const other = role === "host" ? room.viewer : room.host;
      send(other, msg);
    });

    ws.on("close", () => {
      if (!joinedCode) return;
      const room = rooms.get(joinedCode);
      if (!room) return;
      if (role === "host") {
        send(room.viewer, { type: "host-left" });
        rooms.delete(joinedCode);
      } else if (role === "viewer") {
        room.viewer = null;
        send(room.host, { type: "viewer-left" });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

module.exports = { startSignalingServer };
