// Live Map front end. Plain JS, no build step (Anbaric runs source directly).
// All URLs are relative so the app works behind a proxy prefix like /app/<n>/.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function api(path, body) {
  const res = await fetch(`api/${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const KIND = {
  decision: { icon: "✅", name: "Decision" },
  action: { icon: "📌", name: "Task" },
  question: { icon: "❓", name: "Question" },
  idea: { icon: "💡", name: "Idea" },
};
const RECAP_ICON = { topic: "💬", decision: "✅", action: "📌", question: "❓", you: "🙋" };
const PALETTE = ["#f4a6c6", "#8ab4ff", "#7fe0c0", "#f4c26b", "#c9a2ff", "#ff9b8a"];
const speakerColors = new Map();
const colorOf = (name) => {
  if (!speakerColors.has(name)) speakerColors.set(name, PALETTE[speakerColors.size % PALETTE.length]);
  return speakerColors.get(name);
};

// ---------------- State ----------------
const state = {
  session: null,
  mode: "demo",
  userName: "Alex",
  timers: [],
  startedAt: 0,
  playing: false,
  demoDone: false,
  seenAlerts: new Set(),
  lastSeenIdx: 0,
  hiddenAtIdx: null,
  correcting: false,
  statuses: new Map(),
  stt: null,
};

// ---------------- Landing / setup ----------------
function show(view) {
  $("#landing").hidden = view !== "landing";
  $("#app").hidden = view !== "app";
}

async function openSetup(mode) {
  const form = $("#setup-form");
  if (mode) form.mode.value = mode;
  $("#setup").hidden = false;
  form.userName.focus();
  try {
    const st = await api("status");
    const p = st.providers;
    const any = p.gemini || p.deepseek || p.anthropic;
    $("#providers").innerHTML =
      [
        ["Gemini", p.gemini],
        ["DeepSeek", p.deepseek],
        ["Claude", p.anthropic],
        ["Deepgram", p.deepgram],
      ]
        .map(([n, on]) => `<span class="chip ${on ? "on" : "off"}">${on ? "●" : "○"} ${n}</span>`)
        .join("") + (any ? "" : `<span class="chip">No model keys found: using simulated models</span>`);
  } catch {
    $("#providers").innerHTML = "";
  }
}

$$("[data-start]").forEach((b) => b.addEventListener("click", () => openSetup(b.dataset.mode)));
$$("[data-close]").forEach((b) => b.addEventListener("click", () => ($("#setup").hidden = true)));
$("#setup").addEventListener("click", (e) => { if (e.target.id === "setup") $("#setup").hidden = true; });

$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const s = await api("session", { userName: f.userName.value, nicknames: f.nicknames.value, mode: f.mode.value });
    $("#setup").hidden = true;
    startSession(s);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#home").addEventListener("click", () => {
  stopSession();
  location.hash = "";
  show("landing");
});

// ---------------- Session lifecycle ----------------
function startSession(s) {
  stopSession();
  state.session = s;
  state.mode = s.mode;
  state.userName = s.userName;
  state.startedAt = Date.now();
  state.playing = false;
  state.demoDone = false;
  state.seenAlerts = new Set();
  state.lastSeenIdx = 0;
  state.statuses = new Map();
  speakerColors.clear();
  $("#lines").innerHTML = "";
  $("#map-nodes").innerHTML = "";
  $("#map-lines").innerHTML = "";
  $("#map-empty").hidden = false;
  closeDrawers();
  $("#alert").hidden = true;
  $("#mode-pill").textContent = s.mode === "demo" ? "Demo conversation" : "Live microphone";
  $("#play").hidden = s.mode !== "demo";
  $("#mic").hidden = s.mode !== "live";
  $("#play").disabled = false;
  $("#play").textContent = "▶ Play demo conversation";
  $("#stt-label").textContent = s.mode === "demo" ? "· scripted meeting" : "";
  setStatus(s.mode === "demo" ? "Press play to start the meeting." : "Press start, then talk.");
  location.hash = `#/session/${s.id}`;
  show("app");
  render(s);

  const mapEvery = s.mode === "demo" ? 7000 : 15000;
  state.timers.push(setInterval(tickTimer, 500));
  state.timers.push(setInterval(runMapUpdate, mapEvery));
  state.timers.push(setInterval(poll, 2000));
}

function stopSession() {
  state.timers.forEach(clearInterval);
  state.timers = [];
  state.playing = false;
  stopMic();
}

function tickTimer() {
  const sec = Math.floor((Date.now() - state.startedAt) / 1000);
  $("#timer").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function setStatus(t) {
  $("#status").textContent = t;
}

let mapping = false;
async function runMapUpdate() {
  if (!state.session || mapping) return;
  mapping = true;
  try {
    const r = await api("map/update", { sessionId: state.session.id });
    if (r.session) render(r.session);
  } catch (e) {
    console.warn(e);
  } finally {
    mapping = false;
  }
}

async function poll() {
  if (!state.session) return;
  try {
    render(await api(`session?id=${state.session.id}`));
  } catch {}
}

// ---------------- Utterances ----------------
async function sendUtterance(u) {
  if (!state.session) return;
  addLine({ ...u, id: "" });
  try {
    const r = await api("utterance", { sessionId: state.session.id, ...u });
    const last = $("#lines").lastElementChild;
    if (last && r.utterance) last.querySelector(".uid").textContent = r.utterance.id;
    if (r.alert) showAlert(r.alert);
  } catch (e) {
    console.warn(e);
  }
}

function addLine(u) {
  const you = u.speaker.toLowerCase() === state.userName.toLowerCase();
  const el = document.createElement("div");
  el.className = `line${you ? " you" : ""}`;
  el.dataset.uid = u.id || "";
  el.innerHTML = `<b><span class="sp" style="background:${colorOf(u.speaker)}"></span>${esc(u.speaker)}${you ? " (you)" : ""} <span class="uid">${esc(u.id)}</span></b><p>${esc(u.text)}</p>`;
  $("#lines").appendChild(el);
  el.scrollIntoView({ block: "end", behavior: "smooth" });
}

// ---------------- Demo playback ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$("#play").addEventListener("click", async () => {
  if (state.playing) return;
  state.playing = true;
  $("#play").disabled = true;
  $("#play").textContent = "● Meeting in progress";
  const { script } = await api("demo-script");
  const speed = 1.3;
  let t = 0;
  for (const [i, line] of script.entries()) {
    if (!state.playing) return;
    setStatus(`Line ${i + 1} of ${script.length}`);
    $("#typing").hidden = false;
    await sleep((line.seconds * 1000) / speed);
    $("#typing").hidden = true;
    if (!state.playing) return;
    await sendUtterance({ speaker: line.speaker, text: line.text, start: t, end: t + line.seconds });
    t += line.seconds + 0.4;
  }
  state.demoDone = true;
  setStatus("Meeting ended. Finishing the map…");
  await sleep(1200);
  await runMapUpdate();
  await sleep(2500);
  await runMapUpdate();
  $("#play").textContent = "✓ Demo finished";
  setStatus("Done. Tap any item to see the exact quote behind it.");
});

// ---------------- Live microphone ----------------
$("#mic").addEventListener("click", async () => {
  if (state.stt) {
    stopMic();
    $("#mic").textContent = "🎙 Start listening";
    setStatus("Paused.");
    return;
  }
  $("#mic").textContent = "■ Stop listening";
  try {
    await startMic();
  } catch (e) {
    stopMic();
    $("#mic").textContent = "🎙 Start listening";
    setStatus(`Microphone problem: ${e.message}. Try the demo conversation instead.`);
  }
});

async function startMic() {
  const { token } = await api("stt-token");
  if (token) return startDeepgram(token);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("no Deepgram key and this browser has no built-in speech recognition (use Chrome)");
  return startBrowserSpeech(SR);
}

async function startDeepgram(token) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const params = new URLSearchParams({ model: "nova-3", diarize: "true", smart_format: "true", punctuate: "true", endpointing: "400" });
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["bearer", token]);
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const keepAlive = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "KeepAlive" })), 8000);
  ws.onopen = () => {
    rec.ondataavailable = (e) => e.data.size && ws.readyState === 1 && ws.send(e.data);
    rec.start(250);
    setStatus("Listening with Deepgram (speaker labels on)…");
    $("#stt-label").textContent = "· Deepgram nova-3";
  };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.type !== "Results" || !d.is_final) return;
    const alt = d.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) return;
    const counts = {};
    for (const w of alt.words ?? []) counts[w.speaker ?? 0] = (counts[w.speaker ?? 0] ?? 0) + 1;
    const sp = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
    sendUtterance({ speaker: `Speaker ${sp + 1}`, text, start: d.start, end: d.start + d.duration });
  };
  ws.onerror = () => setStatus("Deepgram connection error. Try the demo conversation.");
  ws.onclose = () => clearInterval(keepAlive);
  state.stt = { stop: () => { try { rec.stop(); } catch {} stream.getTracks().forEach((t) => t.stop()); try { ws.close(); } catch {} clearInterval(keepAlive); } };
}

function startBrowserSpeech(SR) {
  const r = new SR();
  r.continuous = true;
  r.interimResults = false;
  r.lang = "en-US";
  let alive = true;
  const t0 = Date.now();
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const text = e.results[i][0].transcript.trim();
      if (!text) continue;
      const now = (Date.now() - t0) / 1000;
      sendUtterance({ speaker: "Speaker", text: text[0].toUpperCase() + text.slice(1), start: Math.max(0, now - 3), end: now });
    }
  };
  r.onend = () => alive && r.start();
  r.onerror = (e) => setStatus(`Speech recognition: ${e.error}`);
  r.start();
  setStatus("Listening with the browser's speech recognition (no speaker labels)…");
  $("#stt-label").textContent = "· browser speech";
  state.stt = { stop: () => { alive = false; try { r.stop(); } catch {} } };
}

function stopMic() {
  state.stt?.stop();
  state.stt = null;
}

// ---------------- Alert ----------------
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch {}
}

function showAlert(a) {
  if (state.seenAlerts.has(a.id)) return;
  state.seenAlerts.add(a.id);
  $("#alert-title").textContent = `${a.askedBy} is asking you`;
  $("#alert-q").textContent = a.question;
  $("#alert-ctx").innerHTML = (a.context || []).map((c) => `<span>${esc(c)}</span>`).join("");
  $("#alert-model").textContent = `Spotted by ${a.provider}`;
  $("#alert").hidden = false;
  chime();
}
$("#alert-close").addEventListener("click", () => ($("#alert").hidden = true));
$("#alert-catch").addEventListener("click", () => {
  $("#alert").hidden = true;
  doRecap("catchup");
});

// ---------------- Recaps ----------------
$("#catchup").addEventListener("click", () => doRecap("catchup"));
$("#missed").addEventListener("click", () => doRecap("missed"));

async function doRecap(kind) {
  if (!state.session) return;
  closeDrawers();
  const total = state.session.utterances.length;
  const since = kind === "missed" ? (state.hiddenAtIdx ?? state.lastSeenIdx) : undefined;
  $("#recap-title").textContent = kind === "missed" ? "What you missed" : "Catch me up";
  $("#recap-cards").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  $("#recap-meta").textContent = "";
  $("#recap").hidden = false;
  try {
    const r = await api("recap", { sessionId: state.session.id, sinceIndex: since });
    $("#recap-cards").innerHTML = r.cards
      .map((c, i) => `<div class="recap-card" style="animation-delay:${i * 90}ms"><div class="ic">${RECAP_ICON[c.icon] ?? "💬"}</div><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></div>`)
      .join("");
    $("#recap-meta").textContent = `${r.lines} lines summarised by ${r.provider}`;
  } catch (e) {
    $("#recap-cards").innerHTML = `<p class="meta">${esc(e.message)}</p>`;
  }
  state.lastSeenIdx = total;
  state.hiddenAtIdx = null;
}

document.addEventListener("visibilitychange", () => {
  if (!state.session) return;
  if (document.hidden) state.hiddenAtIdx = state.session.utterances.length;
  else if (state.hiddenAtIdx !== null && state.session.utterances.length > state.hiddenAtIdx) setStatus("You were away. Tap 'What did I miss?'");
});

// ---------------- Correction ----------------
$("#wrong").addEventListener("click", () => setCorrecting(!state.correcting));
$("#correct-cancel").addEventListener("click", () => setCorrecting(false));
function setCorrecting(on) {
  state.correcting = on;
  $("#map").classList.toggle("correcting", on);
  $("#correct-hint").hidden = !on;
  $("#wrong").classList.toggle("active", on);
}

async function markWrong(id) {
  setCorrecting(false);
  hidePopover();
  const r = await api("correct", { sessionId: state.session.id, itemId: id });
  render(r.session);
  setStatus("Removed. The models won't add it back.");
}

// ---------------- Drawers ----------------
function closeDrawers() {
  ["#recap", "#audit", "#routing-panel"].forEach((s) => ($(s).hidden = true));
}
$$("[data-close-drawer]").forEach((b) => b.addEventListener("click", closeDrawers));
$("#audit-btn").addEventListener("click", () => {
  const open = $("#audit").hidden;
  closeDrawers();
  $("#audit").hidden = !open;
});
$("#cost-btn").addEventListener("click", () => {
  const open = $("#routing-panel").hidden;
  closeDrawers();
  $("#routing-panel").hidden = !open;
});
$("#cost").addEventListener("click", () => $("#cost-btn").click());

// ---------------- Render ----------------
const money = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
const LOOP_INFO = {
  alert: ["Alert spotter", "Runs only when your name + a question appear (free check first)"],
  map: ["Mapper", "Fast, cheap model proposes map changes"],
  verify: ["Verifier", "A different provider checks decisions and tasks"],
  recap: ["Recap writer", "Strong reasoning model, only when you ask"],
};

function render(s) {
  if (!s || !state.session || s.id !== state.session.id) return;
  state.session = s;

  // Transcript ids for lines sent before the server assigned them
  const lines = $$("#lines .line");
  s.utterances.forEach((u, i) => {
    if (lines[i] && !lines[i].dataset.uid) {
      lines[i].dataset.uid = u.id;
      lines[i].querySelector(".uid").textContent = u.id;
    }
  });

  // Cost meter
  const c = s.cost;
  $("#cost-routed").textContent = money(c.routedUsd);
  $("#cost-single").textContent = money(c.singleModelUsd);
  $("#cost-ratio").textContent = c.ratio ? `${c.ratio.toFixed(1)}×` : "–";
  $("#routing-list").innerHTML =
    Object.entries(c.byLoop)
      .map(([k, v]) => `<div class="route-row"><span class="usd">${money(v.usd)}</span><b>${LOOP_INFO[k]?.[0] ?? k}</b> · ${v.calls} call${v.calls > 1 ? "s" : ""}<div class="m">${LOOP_INFO[k]?.[1] ?? ""}</div><div class="m">${v.providers.map(esc).join(", ")}</div></div>`)
      .join("") +
    `<div class="route-row"><b>Free checks</b><div class="m">${c.freeAlertChecks} lines skipped the alert model because your name wasn't in them.</div></div>` +
    `<div class="route-row"><span class="usd">${money(c.sttUsd)}</span><b>Speech-to-text</b><div class="m">${c.minutes.toFixed(1)} min at Deepgram streaming + speaker label rates</div></div>`;

  // Audit
  $("#audit-list").innerHTML = [...s.audit]
    .reverse()
    .map((a) => `<li><span class="who ${a.actor.type}">${esc(a.actor.name)}</span> <span class="act">${esc(a.action)}</span><div>${esc(a.detail)}</div><div class="m">${a.actor.model ? esc(a.actor.model) + " · " : a.actor.type === "human" ? "person · " : ""}${new Date(a.at).toLocaleTimeString()}</div></li>`)
    .join("");

  // Alerts that arrived through polling
  for (const a of s.alerts) if (!state.seenAlerts.has(a.id)) showAlert(a);

  drawMap(s);
}

function drawMap(s) {
  const wrap = $("#map");
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const topics = s.topics.filter((t) => s.items.some((i) => i.topicId === t.id));
  $("#map-empty").hidden = topics.length > 0;

  const colW = 250;
  const cols = Math.max(1, Math.min(topics.length, Math.floor((W - 20) / colW)));
  const itemW = Math.min(220, Math.floor((W - 20) / Math.max(cols, 1)) - 30);
  const rootY = 60;
  const ROW_GAP = 60;
  const GAP = 12;

  // Measure each card's real height first, so cards never overlap.
  const heights = new Map();
  for (const i of s.items) heights.set(i.id, measureItem(i, itemW));

  const pos = new Map();
  pos.set("root", { x: W / 2, y: rootY });
  let rowTop = rootY + 100;
  for (let r = 0; r * cols < topics.length; r++) {
    const row = topics.slice(r * cols, r * cols + cols);
    const span = (W - 20) / row.length;
    let rowBottom = rowTop + 30;
    row.forEach((t, c) => {
      const cx = 10 + span * c + span / 2;
      pos.set(t.id, { x: cx, y: rowTop });
      let y = rowTop + 46;
      for (const k of s.items.filter((i) => i.topicId === t.id)) {
        const h = heights.get(k.id);
        pos.set(k.id, { x: cx + 8, y: y + h / 2, w: itemW });
        y += h + GAP;
      }
      rowBottom = Math.max(rowBottom, y);
    });
    rowTop = rowBottom + ROW_GAP + 30;
  }
  const contentH = Math.max(H, rowTop - ROW_GAP);
  $("#map-nodes").style.height = `${contentH}px`;
  $("#map-lines").style.height = `${contentH}px`;
  $("#map-lines").setAttribute("viewBox", `0 0 ${W} ${contentH}`);

  // Lines
  const paths = [];
  const root = pos.get("root");
  for (const t of topics) {
    const p = pos.get(t.id);
    const midY = (root.y + 46 + p.y - 20) / 2;
    paths.push(`<path class="t" d="M${root.x} ${root.y + 46} C ${root.x} ${midY}, ${p.x} ${midY}, ${p.x} ${p.y - 20}"/>`);
    for (const k of s.items.filter((i) => i.topicId === t.id)) {
      const q = pos.get(k.id);
      const spineX = q.x - q.w / 2 - 12;
      paths.push(`<path d="M${p.x} ${p.y + 20} L ${p.x} ${p.y + 34} Q ${p.x} ${p.y + 40}, ${p.x - 6} ${p.y + 40} L ${spineX + 6} ${p.y + 40} Q ${spineX} ${p.y + 40}, ${spineX} ${p.y + 46} L ${spineX} ${q.y - 6} Q ${spineX} ${q.y}, ${spineX + 6} ${q.y} L ${q.x - q.w / 2} ${q.y}"/>`);
    }
  }
  $("#map-lines").innerHTML = topics.length ? paths.join("") : "";

  // Nodes (reuse DOM elements so they glide instead of jumping)
  const layer = $("#map-nodes");
  const keep = new Set();
  const place = (id, cls, html, p, extra = {}) => {
    keep.add(id);
    let el = layer.querySelector(`[data-id="${id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = id;
      layer.appendChild(el);
    }
    el.className = `node ${cls}`;
    if (el._html !== html) {
      el.innerHTML = html;
      el._html = html;
    }
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    if (p.w) el.style.width = `${p.w}px`;
    Object.assign(el, extra);
    return el;
  };

  if (topics.length) place("root", "root-node", "Meeting", root);
  for (const t of topics) place(t.id, "topic-node", esc(t.label), pos.get(t.id));
  for (const i of s.items) {
    const p = pos.get(i.id);
    if (!p) continue;
    const el = place(i.id, `item-node ${i.kind} ${i.status}`, itemHtml(i), p);
    el.onclick = (e) => {
      e.stopPropagation();
      state.correcting ? markWrong(i.id) : openPopover(i, el);
    };
    const prev = state.statuses.get(i.id);
    if (prev && prev !== i.status && i.status !== "proposed") {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
    state.statuses.set(i.id, i.status);
  }
  for (const el of [...layer.children]) if (el !== measurer && !keep.has(el.dataset.id)) el.remove();
}

function itemHtml(i) {
  const k = KIND[i.kind] ?? KIND.idea;
  const checks = i.kind === "decision" || i.kind === "action";
  let st = "";
  if (i.status === "proposed") st = `<span class="st"><span class="spin"></span> checking</span>`;
  else if (i.status === "not_agreed") st = `<span class="st">not agreed</span>`;
  else if (checks && i.status === "verified") st = `<span class="st ok">✓ verified</span>`;
  const who = i.owner ? `Owner: ${i.owner}` : i.speaker;
  return `<div class="row">${k.icon} ${k.name}${st}</div><div class="label">${esc(i.label)}</div>${who ? `<div class="who"><span class="sp" style="background:${colorOf(i.owner || i.speaker)}"></span>${esc(who)}</div>` : ""}`;
}

let measurer;
function measureItem(i, w) {
  if (!measurer) {
    measurer = document.createElement("div");
    measurer.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;transform:none;animation:none";
    $("#map-nodes").appendChild(measurer);
    measurer.dataset.id = "__measure";
  }
  if (!measurer.isConnected) $("#map-nodes").appendChild(measurer);
  measurer.className = `item-node ${i.kind} ${i.status}`;
  measurer.style.width = `${w}px`;
  measurer.innerHTML = itemHtml(i);
  return measurer.offsetHeight;
}

window.addEventListener("resize", () => state.session && drawMap(state.session));

// ---------------- Popover ----------------
function openPopover(item, el) {
  const s = state.session;
  const quotes = item.evidence.map((id) => s.utterances.find((u) => u.id === id)).filter(Boolean);
  const status =
    item.status === "verified" && (item.kind === "decision" || item.kind === "action")
      ? `✓ Verified by ${esc(item.verifiedBy)}${item.reason ? `: ${esc(item.reason)}` : ""}`
      : item.status === "not_agreed"
        ? `Turned into an open question by ${esc(item.verifiedBy)}: ${esc(item.reason)}`
        : item.status === "proposed"
          ? "Waiting for the verifier…"
          : "Questions and ideas are shown as said; they are not treated as facts.";
  const pop = $("#popover");
  pop.innerHTML =
    `<b>${esc(item.label)}</b>` +
    (quotes.length
      ? quotes.map((q) => `<div class="q">"${esc(q.text)}"<small>${esc(q.speaker)} · ${esc(q.id)}</small></div>`).join("")
      : `<div class="m">No quote attached.</div>`) +
    `<div class="m">${status}</div>` +
    `<button class="btn btn-soft danger btn-sm" id="pop-wrong">✕ That's wrong</button>`;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 316, Math.max(16, r.left));
  const top = r.bottom + 8 + 220 > window.innerHeight ? Math.max(16, r.top - 8 - pop.offsetHeight) : r.bottom + 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  $("#pop-wrong").onclick = () => markWrong(item.id);
  $$("#lines .line").forEach((l) => l.classList.toggle("hl", item.evidence.includes(l.dataset.uid)));
  const first = $(`#lines .line[data-uid="${item.evidence[0]}"]`);
  first?.scrollIntoView({ block: "center", behavior: "smooth" });
}
function hidePopover() {
  $("#popover").hidden = true;
  $$("#lines .line.hl").forEach((l) => l.classList.remove("hl"));
}
document.addEventListener("click", (e) => {
  if (!$("#popover").hidden && !e.target.closest("#popover") && !e.target.closest(".item-node")) hidePopover();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hidePopover();
    setCorrecting(false);
    closeDrawers();
    $("#alert").hidden = true;
  }
});

// ---------------- Boot ----------------
show("landing");
