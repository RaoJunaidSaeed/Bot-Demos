/**
 * Enterprise console UI + mic/PCM playback client.
 */

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const stepCode = document.getElementById("stepCode");
const endpointEl = document.getElementById("endpoint");
const partialEl = document.getElementById("partial");
const userTurnEl = document.getElementById("userTurn");
const decideMsEl = document.getElementById("decideMs");
const leadName = document.getElementById("leadName");
const leadRep = document.getElementById("leadRep");
const leadState = document.getElementById("leadState");
const lastIntent = document.getElementById("lastIntent");
const stripIntent = document.getElementById("stripIntent");
const turnReason = document.getElementById("turnReason");
const qaStatus = document.getElementById("qaStatus");
const qaFlags = document.getElementById("qaFlags");
const qaNotes = document.getElementById("qaNotes");
const logEl = document.getElementById("log");
const pipeline = document.getElementById("pipeline");

const PIPELINE_ORDER = [
  "how_are_you",
  "pitch",
  "insurance_check_1",
  "state_confirm",
  "insurance_check_2",
  "transfer_consent",
  "transferring",
];

let ws = null;
let captureCtx = null;
let playCtx = null;
let mediaStream = null;
let processor = null;
let source = null;
let muteGain = null;
let playing = [];
let nextPlayTime = 0;
let pcmOddByte = null;
const PLAY_RATE = 16000;

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = `chip ${cls}`.trim();
}

function setPipeline(step) {
  const idx = PIPELINE_ORDER.indexOf(step);
  for (const li of pipeline.querySelectorAll("li")) {
    const s = li.getAttribute("data-step");
    li.classList.remove("active", "done", "fail");
    const i = PIPELINE_ORDER.indexOf(s);
    if (step === "disqualified" || step === "dnc" || step === "ended") {
      if (i >= 0 && idx < 0) li.classList.add("fail");
    }
    if (s === step) li.classList.add("active");
    else if (i >= 0 && idx >= 0 && i < idx) li.classList.add("done");
  }
  stepCode.textContent = step;
}

function addLog(who, text, cls = "") {
  const empty = document.getElementById("transcriptEmpty");
  if (empty) empty.hidden = true;
  const li = document.createElement("li");
  li.className = cls || who;
  li.innerHTML = `<span class="who">${who}</span><div>${escapeHtml(text)}</div>`;
  logEl.prepend(li);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function stopPlayback() {
  for (const n of playing) {
    try { n.stop(); } catch { /* */ }
  }
  playing = [];
  nextPlayTime = 0;
  pcmOddByte = null;
}

function enqueuePcm16(arrayBuffer) {
  if (!playCtx || !arrayBuffer.byteLength) return;
  const probe = new Uint8Array(arrayBuffer, 0, Math.min(1, arrayBuffer.byteLength));
  if (probe[0] === 0x7b) return;

  let merged;
  if (pcmOddByte !== null) {
    merged = new Uint8Array(1 + arrayBuffer.byteLength);
    merged[0] = pcmOddByte;
    merged.set(new Uint8Array(arrayBuffer), 1);
    pcmOddByte = null;
  } else {
    merged = new Uint8Array(arrayBuffer);
  }

  if (merged.byteLength % 2 === 1) {
    pcmOddByte = merged[merged.byteLength - 1];
    merged = merged.subarray(0, merged.byteLength - 1);
  }
  if (merged.byteLength < 2) return;

  const clean = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
  const int16 = new Int16Array(clean);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

  const buf = playCtx.createBuffer(1, f32.length, PLAY_RATE);
  buf.copyToChannel(f32, 0);
  const node = playCtx.createBufferSource();
  node.buffer = buf;
  node.connect(playCtx.destination);

  const now = playCtx.currentTime;
  if (nextPlayTime < now + 0.012) nextPlayTime = now + 0.012;
  node.start(nextPlayTime);
  nextPlayTime += buf.duration;
  playing.push(node);
  node.onended = () => {
    playing = playing.filter((n) => n !== node);
    if (!playing.length && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "playback_done" }));
    }
  };
}

function downsampleTo16k(float32, inRate) {
  if (inRate === 16000) return float32ToInt16(float32);
  const ratio = inRate / 16000;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), float32.length);
    let sum = 0;
    const n = Math.max(1, end - start);
    for (let j = start; j < end; j++) sum += float32[j];
    out[i] = sum / n;
  }
  return float32ToInt16(out);
}

function float32ToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToArrayBuffer(pcm) {
  return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
}

async function startMic(sendPcm) {
  captureCtx = new AudioContext();
  playCtx = new AudioContext();
  await Promise.all([captureCtx.resume(), playCtx.resume()]);

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  source = captureCtx.createMediaStreamSource(mediaStream);
  processor = captureCtx.createScriptProcessor(4096, 1, 1);
  muteGain = captureCtx.createGain();
  muteGain.gain.value = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    const pcm = downsampleTo16k(copy, captureCtx.sampleRate);
    sendPcm(int16ToArrayBuffer(pcm));
  };

  source.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(captureCtx.destination);
}

function cleanupAudio() {
  stopPlayback();
  try { processor?.disconnect(); } catch { /* */ }
  try { source?.disconnect(); } catch { /* */ }
  try { muteGain?.disconnect(); } catch { /* */ }
  mediaStream?.getTracks().forEach((t) => t.stop());
  void captureCtx?.close();
  void playCtx?.close();
  processor = source = muteGain = mediaStream = captureCtx = playCtx = null;
}

async function startCall() {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  logEl.innerHTML = "";
  const empty = document.getElementById("transcriptEmpty");
  if (empty) empty.hidden = false;
  setStatus("Connecting…", "warn");
  setPipeline("how_are_you");

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    try {
      await startMic((buf) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(buf);
      });
      ws.send(JSON.stringify({ type: "start" }));
      setStatus("Live", "live");
    } catch (e) {
      setStatus("Mic error", "danger");
      addLog("sys", String(e), "sys");
      hangup();
    }
  };

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      enqueuePcm16(ev.data);
      return;
    }
    handleMsg(JSON.parse(ev.data));
  };

  ws.onclose = () => {
    setStatus("Idle");
    startBtn.disabled = false;
    stopBtn.disabled = true;
  };
}

function handleMsg(msg) {
  switch (msg.type) {
    case "ready":
      leadName.textContent = `${msg.lead.firstName} ${msg.lead.lastName}`;
      leadRep.textContent = msg.lead.rep;
      leadState.textContent = msg.lead.state;
      setPipeline(msg.step);
      break;
    case "partial":
      if (msg.text) partialEl.textContent = msg.text;
      break;
    case "user_turn":
      userTurnEl.textContent = msg.text;
      turnReason.textContent = `${msg.reason} · ${msg.confidence.toFixed(2)}`;
      addLog("you", msg.text);
      partialEl.textContent = "—";
      break;
    case "decide_ms":
      decideMsEl.textContent = `${msg.ms} ms`;
      break;
    case "qa": {
      const bad = (msg.flags || []).filter((f) => f !== "ok");
      lastIntent.textContent = `${msg.intent} (${Number(msg.confidence).toFixed(2)})`;
      stripIntent.textContent = msg.intent;
      qaFlags.textContent = (msg.flags || []).join(", ") || "—";
      qaNotes.textContent = (msg.notes || []).join(" · ") || "—";
      qaStatus.textContent = bad.length ? "FLAGGED" : "OK";
      qaStatus.className = `mono ${bad.length ? "bad" : "ok"}`;
      if (bad.length) {
        addLog("sys", `QA: ${bad.join(", ")} — ${(msg.notes || []).join("; ")}`, "sys");
      }
      break;
    }
    case "bot_say":
      stopPlayback();
      setPipeline(msg.step);
      endpointEl.textContent = `${msg.endpoint.endpointingMs}ms · ue ${msg.endpoint.utteranceEndMs}ms · conf≥${msg.endpoint.minConfidence}`;
      addLog("bot", msg.text, "bot");
      break;
    case "barge_in":
      stopPlayback();
      setStatus("Barge-in", "warn");
      addLog("sys", "Interrupted — TTS killed", "sys");
      setTimeout(() => setStatus("Live", "live"), 500);
      break;
    case "transfer":
      addLog("sys", msg.message, "sys");
      setStatus("Transfer", "warn");
      setPipeline("transferring");
      break;
    case "ended":
      setStatus("Ended");
      break;
    case "error":
      addLog("sys", msg.message, "sys");
      setStatus("Error", "danger");
      break;
    case "warn":
      addLog("sys", msg.message, "sys");
      // Keep Live status — transient STT noise shouldn't hard-fail the call
      break;
    case "bot_done":
      if (statusEl.textContent === "Error") setStatus("Live", "live");
      break;
    default:
      break;
  }
}

function hangup() {
  try { ws?.send(JSON.stringify({ type: "stop" })); } catch { /* */ }
  try { ws?.close(); } catch { /* */ }
  ws = null;
  cleanupAudio();
  setStatus("Idle");
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", () => void startCall());
stopBtn.addEventListener("click", hangup);
