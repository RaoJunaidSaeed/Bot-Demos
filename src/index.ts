import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { env } from "./config.js";
import { DemoSession } from "./voice/demo-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const app = express();
app.use(express.static(publicDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  const session = new DemoSession(ws);
  let started = false;

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      session.onAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      return;
    }
    const text = data.toString();
    try {
      const msg = JSON.parse(text) as { type?: string };
      if (msg.type === "start" && !started) {
        started = true;
        void session.start().catch((e) => {
          ws.send(JSON.stringify({ type: "error", message: String(e) }));
        });
        return;
      }
    } catch {
      /* fall through */
    }
    session.onClientJson(text);
  });

  ws.on("close", () => session.close());
  ws.on("error", () => session.close());
});

server.listen(env.PORT, () => {
  console.log(`\n  Americas Health voice demo`);
  console.log(`  Open http://localhost:${env.PORT}\n`);
  console.log(`  Click Start call, allow mic, talk naturally.`);
  console.log(`  Interrupt the bot anytime — playback should cut instantly.\n`);
});
