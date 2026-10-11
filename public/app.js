// dottie front end. Plain JS, no build step. All URLs are relative so the app works behind a proxy prefix.
// Visual rules come from the approved preview: linen ground, stitched patches joined by a thread,
// one saffron "Your turn" banner, and a fixed control bar. New patches are appended, never reordered.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const NS = "http://www.w3.org/2000/svg";

async function api(path, body) {
  const res = await fetch(`api/${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Icons, drawn to match the preview.
const ICON = {
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  topic: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const RECAP_ICON = { topic: "topic", decision: "check", action: "bell", question: "help", you: "bell" };
const svgIcon = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n] ?? ""}</svg>`;

// Speaker colours: "You" is always mint (teal in the design system); others take the palette in order.
const PALETTE = ["#3346C9", "#C2407A", "#F5B700", "#565B7A"];
const speakerColor = new Map();
function colorOf(name) {
  if (!name) return "#B9BFD3";
  if (name.toLowerCase() === state.userName.toLowerCase()) return "#17977A";
  if (!speakerColor.has(name)) speakerColor.set(name, PALETTE[speakerColor.size % PALETTE.length]);
  return speakerColor.get(name);
}

// ---------------- State ----------------
const state = {
  session: null,
  mode: "demo",
  userName: "Alex",
  timers: [],
  startedAt: 0,
  playing: false,
  paused: false,
  demoDone: false,
  seenAlerts: new Set(),
  lastSeenIdx: 0,
  hiddenAtIdx: null,
  correcting: false,
  calm: false,
  tab: "map",
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
    const any = p.gemini || p.anthropic;
    $("#providers").innerHTML =
      [
        ["Gemini", p.gemini],
        ["Claude", p.anthropic],
        ["Deepgram", p.deepgram],
      ]
        .map(([n, on]) => `<span class="chip ${on ? "on" : ""}">${n}: ${on ? "connected" : "not set"}</span>`)
        .join("") + (any ? "" : `<span class="chip">No model keys: running with local rules</span>`);
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
    setStatus(err.message);
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
  state.paused = false;
  state.demoDone = false;
  state.seenAlerts = new Set();
  state.lastSeenIdx = 0;
  speakerColor.clear();
  $("#lines").innerHTML = "";
  $("#patches").innerHTML = "";
  $("#thread").innerHTML = "";
  $("#map-empty").hidden = false;
  closeDrawers();
  $("#alert").hidden = true;
  $("#meeting").textContent = s.mode === "demo" ? "Demo meeting" : "Live meeting";
  $("#play").hidden = s.mode !== "demo";
  $("#mic").hidden = s.mode !== "live";
  $("#play").disabled = false;
  $("#play").textContent = "Play demo conversation";
  $("#stt-label").textContent = s.mode === "demo" ? "· scripted meeting" : "";
  setStatus(s.mode === "demo" ? "Press play to start the meeting." : "Press start, then talk.");
  setCalm(false);
  setTab("map");
  setRecState();
  location.hash = `#/session/${s.id}`;
  show("app");
  render(s);

  const mapEvery = s.mode === "demo" ? 7000 : 4000;
  state.timers.push(setInterval(tickTimer, 500));
  state.timers.push(setInterval(runMapUpdate, mapEvery));
  state.timers.push(setInterval(poll, 2000));
  state.timers.push(setInterval(() => state.tab === "overview" && loadOverview(), 8000));
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

// The recording indicator is always visible. Tapping it pauses or resumes capture.
function setRecState() {
  const live = state.mode === "live";
  const capturing = live ? !!state.stt : state.playing && !state.paused;
  const started = live ? true : state.playing || state.demoDone;
  const ended = state.demoDone && !state.playing;
  const label = ended ? "Ended" : !started ? "Not recording" : capturing ? "Recording" : "Paused";
  $("#rec-label").textContent = label;
  $("#rec").classList.toggle("paused", !capturing || ended);
  $("#rec").setAttribute("aria-label", capturing ? "Recording. Tap to pause" : "Paused. Tap to resume");
}

$("#rec").addEventListener("click", async () => {
  if (!state.session) return;
  if (state.mode === "live") {
    if (state.stt) {
      stopMic();
      $("#mic").textContent = "Start listening";
      setStatus("Paused.");
    } else {
      $("#mic").textContent = "Stop listening";
      try {
        await startMic();
      } catch (e) {
        stopMic();
        $("#mic").textContent = "Start listening";
        setStatus(`Microphone problem: ${e.message}. Try the demo conversation instead.`);
      }
    }
  } else if (state.playing) {
    state.paused = !state.paused;
    setStatus(state.paused ? "Paused. Tap Recording to resume." : "Resumed.");
  }
  setRecState();
});

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
  el.innerHTML = `<b>${esc(u.speaker)}${you ? " (you)" : ""} <span class="uid">${esc(u.id)}</span></b><p>${esc(u.text)}</p>`;
  const box = $("#lines");
  box.appendChild(el);
  box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
}

// ---------------- Demo playback ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$("#play").addEventListener("click", async () => {
  if (state.playing) return;
  state.playing = true;
  state.paused = false;
  setRecState();
  $("#play").disabled = true;
  $("#play").textContent = "Meeting in progress";
  const { script } = await api("demo-script");
  const speed = 1.3;
  let t = 0;
  for (const [i, line] of script.entries()) {
    while (state.paused && state.playing) await sleep(200);
    if (!state.playing) return;
    setStatus(`Line ${i + 1} of ${script.length}`);
    $("#typing").hidden = false;
    await sleep((line.seconds * 1000) / speed);
    $("#typing").hidden = true;
    if (!state.playing) return;
    await sendUtterance({ speaker: line.speaker, text: line.text, start: t, end: t + line.seconds, engine: "demo" });
    t += line.seconds + 0.4;
  }
  state.demoDone = true;
  state.playing = false;
  setRecState();
  setStatus("Meeting ended. Finishing the map.");
  await sleep(1200);
  await runMapUpdate();
  await sleep(2500);
  await runMapUpdate();
  $("#play").textContent = "Demo finished";
  setStatus("Done. Tap any item to see the exact quote behind it.");
});

// ---------------- Live microphone ----------------
$("#mic").addEventListener("click", async () => {
  if (state.stt) {
    stopMic();
    $("#mic").textContent = "Start listening";
    setStatus("Paused.");
    setRecState();
    return;
  }
  $("#mic").textContent = "Stop listening";
  try {
    await startMic();
  } catch (e) {
    stopMic();
    $("#mic").textContent = "Start listening";
    setStatus(`Microphone problem: ${e.message}. Try the demo conversation instead.`);
  }
  setRecState();
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
    setStatus("Listening with Deepgram, speaker labels on.");
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
    sendUtterance({ speaker: `Speaker ${sp + 1}`, text, start: d.start, end: d.start + d.duration, engine: "deepgram", confidence: alt.confidence });
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
      sendUtterance({ speaker: "Speaker", text: text[0].toUpperCase() + text.slice(1), start: Math.max(0, now - 3), end: now, engine: "browser" });
    }
  };
  r.onend = () => alive && r.start();
  r.onerror = (e) => setStatus(`Speech recognition: ${e.error}`);
  r.start();
  setStatus("Listening with the browser's speech recognition. Speaker labels are off.");
  $("#stt-label").textContent = "· browser speech";
  state.stt = { stop: () => { alive = false; try { r.stop(); } catch {} } };
}

function stopMic() {
  state.stt?.stop();
  state.stt = null;
}

// ---------------- "It's your turn": the one loud element ----------------
// It stays until someone dismisses it. It is never auto-hidden.
function activeTopicLabel(s) {
  const latest = s?.items.reduce((a, i) => (!a || i.createdAt > a.createdAt ? i : a), null);
  return s?.topics.find((t) => t.id === latest?.topicId)?.label ?? "";
}

function showAlert(a) {
  if (state.seenAlerts.has(a.id)) return;
  state.seenAlerts.add(a.id);
  const topic = activeTopicLabel(state.session);
  $("#alert-title").textContent = `Your turn: ${a.askedBy} is asking you`;
  $("#alert-q").textContent = `“${a.question}”`;
  $("#alert-ctx").textContent = topic ? `They were just talking about ${topic.toLowerCase()}.` : "";
  $("#alert-model").textContent = `Spotted by ${a.provider}`;
  $("#alert").hidden = false;
  try { navigator.vibrate?.(60); } catch {}
}
$("#alert-close").addEventListener("click", () => ($("#alert").hidden = true));
$("#alert-catch").addEventListener("click", () => {
  $("#alert").hidden = true;
  doRecap("catchup");
});

// ---------------- Recaps: "Catch me up" ----------------
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
      .map((c) => `<div class="recap-card"><div class="ic">${svgIcon(RECAP_ICON[c.icon] ?? "topic", "")}</div><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></div>`)
      .join("");
    $("#recap-meta").textContent = `${r.lines} lines summarised by ${r.provider}`;
  } catch (e) {
    $("#recap-cards").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
  state.lastSeenIdx = total;
  state.hiddenAtIdx = null;
}

document.addEventListener("visibilitychange", () => {
  if (!state.session) return;
  if (document.hidden) state.hiddenAtIdx = state.session.utterances.length;
  else if (state.hiddenAtIdx !== null && state.session.utterances.length > state.hiddenAtIdx) setStatus("You were away. Tap 'What did I miss?'");
});

// ---------------- Calm mode ----------------
$("#calm").addEventListener("click", () => setCalm(!state.calm));
function setCalm(on) {
  state.calm = on;
  $("#calm").setAttribute("aria-pressed", String(on));
  if (state.session) renderMap(state.session);
}

// ---------------- Correction ----------------
$("#wrong").addEventListener("click", () => setCorrecting(!state.correcting));
$("#correct-cancel").addEventListener("click", () => setCorrecting(false));
function setCorrecting(on) {
  state.correcting = on;
  $("#patches").classList.toggle("correcting", on);
  $("#correct-hint").hidden = !on;
  $("#wrong").setAttribute("aria-pressed", String(on));
  $("#wrong").classList.toggle("active", on);
}

async function markWrong(id) {
  setCorrecting(false);
  hidePopover();
  const r = await api("correct", { sessionId: state.session.id, itemId: id });
  render(r.session);
  setStatus("Removed. The models won't add it back.");
}

// Human decisions on the map: tie a loose decision, keep or remove an item the checker isn't sure about.
$("#patches").addEventListener("click", async (e) => {
  const actEl = e.target.closest("[data-act]");
  if (!actEl) return;
  const id = actEl.dataset.id;
  if (state.correcting) return markWrong(id);
  const act = actEl.dataset.act;
  if (act === "quote") return openPopover(id, actEl);
  if (act === "remove") return markWrong(id);
  if (act === "confirm" || act === "keep") {
    const r = await api(act, { sessionId: state.session.id, itemId: id });
    render(r.session);
    setStatus(act === "confirm" ? "Tied by you. It's recorded in the audit trail." : "Kept. It stays on the map.");
  }
});

// ---------------- Tabs ----------------
function setTab(name) {
  state.tab = name;
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $("#map-view").hidden = name !== "map";
  $("#overview").hidden = name !== "overview";
  $("#evals").hidden = name !== "evals";
  if (name === "map") drawThread();
  if (name === "overview") loadOverview();
  if (name === "evals" && state.session) renderEvals(state.session);
}
$$(".tab").forEach((t) => t.addEventListener("click", () => state.session && setTab(t.dataset.tab)));
window.addEventListener("resize", () => state.session && state.tab === "map" && drawThread());

// ---------------- Overview ----------------
let overviewBusy = false;
async function loadOverview() {
  if (!state.session || overviewBusy) return;
  overviewBusy = true;
  try {
    renderOverview(await api("overview", { sessionId: state.session.id }));
  } catch (e) {
    $("#ov-meta").textContent = e.message;
  } finally {
    overviewBusy = false;
  }
}

function pointLabel(p) {
  if (p.kind === "decision") return p.status === "verified" ? "Decided:" : "Checking:";
  if (p.kind === "action") return (p.status === "verified" ? "Task" : "Checking task") + (p.owner ? ` for ${esc(p.owner)}` : "") + ":";
  return `${({ question: "Question", idea: "Idea" })[p.kind] ?? "Idea"}:`;
}

function renderOverview(o) {
  $("#ov-now").textContent = o.now;
  $("#ov-stages").innerHTML = o.stages.length
    ? o.stages
        .map((g) => {
          const involves = g.speakers.some((sp) => sp.toLowerCase() === state.userName.toLowerCase());
          const points = g.points.map((p) => `<li class="ov-pt ${p.status}">${pointLabel(p)} ${esc(p.label)}</li>`).join("");
          return `<li class="ov-stage">
            <span class="ov-n">${g.n}</span>
            <div class="ov-body">
              <div class="ov-head"><b>${esc(g.topic)}</b>${involves ? '<span class="ov-you">Involves you</span>' : ""}</div>
              <span class="muted">${esc(g.speakers.join(", "))} · ${g.lines} line${g.lines === 1 ? "" : "s"}</span>
              <p class="ov-sum">${esc(g.summary)}</p>
              ${points ? `<ul class="ov-points">${points}</ul>` : ""}
            </div>
          </li>`;
        })
        .join("")
    : `<li class="ov-empty">The first topic will appear here as people talk.</li>`;
  $("#ov-meta").textContent = o.provider === "none" ? "" : `Written by ${o.provider} · refreshes every few seconds`;
}

// ---------------- Evals ----------------
const MODEL_NAME = (key) => (key === "simulated/local-rules" ? "Local rules (no model)" : key.replace("/", " · "));
const PROVIDER_NAME = { gemini: "Gemini", anthropic: "Claude", simulated: "Local" };

function renderEvals(s) {
  const u = s.usage;
  const sp = s.speech;
  $("#ev-stt-min").textContent = `${sp.minutes.toFixed(2)} min`;
  $("#ev-stt-usd").textContent = money(sp.usd);
  $("#ev-calls").textContent = u.calls;
  $("#ev-tokens").textContent = `${u.inputTokens.toLocaleString()} / ${u.outputTokens.toLocaleString()}`;
  $("#ev-usd").textContent = money(u.usd);
  $("#ev-ms").textContent = `${Math.round(u.avgMs)} ms`;
  $("#ev-fb").textContent = u.fallbacks;

  $("#ev-models").innerHTML = u.calls
    ? `<thead><tr><th>Model</th><th>Calls</th><th>Share</th><th>Tokens in / out</th><th>Avg time</th><th>Spend</th></tr></thead><tbody>` +
      u.models
        .map((m) => `<tr>
          <td><b>${esc(MODEL_NAME(m.key))}</b><div class="m">${esc(PROVIDER_NAME[m.provider] ?? m.provider)}${m.fallbacks ? ` · ${m.fallbacks} after fallback` : ""}</div></td>
          <td>${m.calls}</td>
          <td class="share"><div class="ev-bar"><i style="width:${(m.share * 100).toFixed(1)}%"></i></div><span>${Math.round(m.share * 100)}%</span></td>
          <td>${m.inputTokens.toLocaleString()} / ${m.outputTokens.toLocaleString()}</td>
          <td>${Math.round(m.avgMs)} ms</td>
          <td>${money(m.usd)}</td>
        </tr>`)
        .join("") + "</tbody>"
    : `<tbody><tr><td class="m">No model calls yet. Play the demo or speak to start.</td></tr></tbody>`;

  const models = u.models.map((m) => m.key);
  $("#ev-jobs").innerHTML = u.calls
    ? `<thead><tr><th>Job</th>${models.map((k) => `<th>${esc(MODEL_NAME(k))}</th>`).join("")}<th>Total</th></tr></thead><tbody>` +
      u.matrix
        .map((row) => `<tr><td><b>${esc(LOOP_INFO[row.loop]?.[0] ?? row.loop)}</b><div class="m">${esc(LOOP_INFO[row.loop]?.[1] ?? "")}</div></td>${models
          .map((k) => `<td>${row.byModel[k] ?? "–"}</td>`)
          .join("")}<td>${u.roles.find((r) => r.loop === row.loop)?.total ?? 0}</td></tr>`)
        .join("") + "</tbody>"
    : "";

  const ENGINE_NAME = {
    deepgram: "Deepgram nova-3 · speaker labels",
    browser: "Chrome speech · free, no speaker labels",
    demo: "Scripted demo · no speech service",
  };
  $("#ev-speech").innerHTML = sp.lines
    ? `<thead><tr><th>Engine</th><th>Lines</th><th>Audio time</th><th>Avg confidence</th><th>Spend</th></tr></thead><tbody>` +
      sp.engines
        .map((e) => `<tr>
          <td><b>${esc(ENGINE_NAME[e.engine] ?? e.engine)}</b></td>
          <td>${e.lines}</td>
          <td>${e.seconds.toFixed(1)} s</td>
          <td>${e.avgConfidence == null ? "–" : `${Math.round(e.avgConfidence * 100)}%`}</td>
          <td>${money(e.usd)}</td>
        </tr>`)
        .join("") + "</tbody>"
    : `<tbody><tr><td class="m">No speech yet. Use live mode to see speech usage.</td></tr></tbody>`;

  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  $("#ev-stt-log").innerHTML = sp.log.length
    ? `<thead><tr><th>Line</th><th>Time</th><th>Speaker</th><th>Engine</th><th>Audio</th><th>Confidence</th><th>Cost</th></tr></thead><tbody>` +
      sp.log
        .map((r) => `<tr>
          <td>${esc(r.id)}</td>
          <td>${clock(r.start)}</td>
          <td>${esc(r.speaker)}</td>
          <td>${esc(r.engine)}</td>
          <td>${r.seconds.toFixed(1)} s</td>
          <td>${r.confidence == null ? "–" : `${Math.round(r.confidence * 100)}%`}</td>
          <td>${money(r.usd)}</td>
        </tr>`)
        .join("") + "</tbody>"
    : `<tbody><tr><td class="m">Nothing logged yet.</td></tr></tbody>`;

  const failed = Object.entries(u.failures);
  $("#ev-fail").innerHTML = failed.length
    ? failed.map(([p, n]) => `<div>${esc(PROVIDER_NAME[p] ?? p)} failed ${n} time${n > 1 ? "s" : ""}. The next provider answered.</div>`).join("")
    : `<div>No failures. Every call was answered by its first choice.</div>`;
}

// ---------------- Drawers ----------------
function closeDrawers() {
  ["#recap", "#audit", "#routing-panel", "#transcript"].forEach((s) => ($(s).hidden = true));
}
$$("[data-close-drawer]").forEach((b) => b.addEventListener("click", closeDrawers));
$("#transcript-btn").addEventListener("click", () => {
  const open = $("#transcript").hidden;
  closeDrawers();
  $("#transcript").hidden = !open;
});
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
  alert: ["Alert check", "Runs only when your name and a question appear"],
  map: ["Mapper", "A fast, low-cost model proposes map changes"],
  verify: ["Verifier", "A different provider checks decisions and tasks"],
  recap: ["Recap writer", "A reasoning model, only when you ask"],
  overview: ["Overview writer", "Explains the meeting flow for someone who joined late"],
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
  $("#cost-ratio").textContent = c.ratio ? `${c.ratio.toFixed(1)}× cheaper` : "–";
  $("#routing-list").innerHTML =
    Object.entries(c.byLoop)
      .map(([k, v]) => `<div class="route-row"><span class="usd">${money(v.usd)}</span><b>${LOOP_INFO[k]?.[0] ?? k}</b> · ${v.calls} call${v.calls > 1 ? "s" : ""}<div class="m">${LOOP_INFO[k]?.[1] ?? ""}</div><div class="m">${v.providers.map(esc).join(", ")}</div></div>`)
      .join("") +
    `<div class="route-row"><b>Free checks</b><div class="m">${c.freeAlertChecks} lines skipped the alert check because your name wasn't in them.</div></div>` +
    `<div class="route-row"><span class="usd">${money(c.sttUsd)}</span><b>Speech-to-text</b><div class="m">${c.minutes.toFixed(1)} min at streaming and speaker-label rates</div></div>`;

  // Audit
  $("#audit-list").innerHTML = [...s.audit]
    .reverse()
    .map((a) => `<li><span class="who ${a.actor.type}">${esc(a.actor.name)}</span> <span class="act">${esc(a.action)}</span><div>${esc(a.detail)}</div><div class="m">${a.actor.model ? esc(a.actor.model) + " · " : a.actor.type === "human" ? "Person · " : ""}${new Date(a.at).toLocaleTimeString()}</div></li>`)
    .join("");

  // Alerts that arrived through polling
  for (const a of s.alerts) if (!state.seenAlerts.has(a.id)) showAlert(a);

  renderPeople(s);
  renderMap(s);
  if (state.tab === "overview") loadOverview();
  if (state.tab === "evals") renderEvals(s);
}

function renderPeople(s) {
  const names = [...new Set(s.utterances.map((u) => u.speaker))];
  $("#people").innerHTML = names
    .map((n) => {
      const you = n.toLowerCase() === state.userName.toLowerCase();
      return `<span><b style="background:${colorOf(n)}"></b>${esc(n)}${you ? " (you)" : ""}</span>`;
    })
    .join("");
}

// Item states. Decisions wait as "Loose" until a person ties them.
function itemState(i) {
  if (i.kind === "decision") {
    if (i.status === "proposed") return "checking";
    return i.confirmedBy ? "confirmed" : "pending";
  }
  if (i.status === "proposed") return "checking";
  if (i.status === "not_agreed" && !i.kept) return "unsure";
  return "";
}

const itemLi = (i, s) => {
  const st = itemState(i);
  const id = esc(i.id);
  if (st === "checking") return `<li><span class="ring" style="border-style:dotted;border-color:var(--ink-soft)"></span><span class="label muted-item" data-act="quote" data-id="${id}">${esc(i.label)} <small class="muted">Checking</small></span></li>`;
  if (st === "pending")
    return `<li style="display:block"><div class="pending"><span class="label" data-act="quote" data-id="${id}"><b>Loose:</b> ${esc(i.label)}</span><div class="btns"><button class="btn btn-tie btn-sm" data-act="confirm" data-id="${id}">Tie it</button><button class="btn btn-ghost btn-sm" data-act="remove" data-id="${id}">Not decided</button></div></div></li>`;
  if (st === "confirmed")
    return `<li style="display:block"><span class="tied label" data-act="quote" data-id="${id}">${svgIcon("check", "ico")} Tied: ${esc(i.label)}</span></li>`;
  if (st === "unsure")
    return `<li><span class="ring" style="border-style:dotted;border-color:var(--ink-soft)"></span><span class="unsure-wrap"><span class="unsure" data-act="quote" data-id="${id}">${esc(i.label)}</span><small>Not sure this was said. <button class="linkbtn" data-act="keep" data-id="${id}">Keep</button> or <button class="linkbtn" data-act="remove" data-id="${id}">remove</button>?</small></span></li>`;
  if (i.kind === "action")
    return `<li><svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h10M10 5l5 5-5 5" stroke="#C2407A" stroke-width="2" fill="none" stroke-linecap="round"/></svg><span class="label" data-act="quote" data-id="${id}">${esc(i.label)}${i.owner ? ` <small class="muted">(${esc(i.owner)})</small>` : ""}</span></li>`;
  if (i.kind === "question") {
    const forYou = new RegExp(`\\b${s.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(i.label);
    return `<li><svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#F5B700"/><path d="M10 6v5M10 14v.5" stroke="#1D2140" stroke-width="2" stroke-linecap="round"/></svg><span class="label" data-act="quote" data-id="${id}">${forYou ? "<b>Question for you:</b> " : ""}${esc(i.label)}</span></li>`;
  }
  return `<li><span class="ring"></span><span class="label" data-act="quote" data-id="${id}">${esc(i.label)}</span></li>`;
};

function patchHtml(t, items, s, active) {
  const firstWithEvidence = items.find((i) => i.evidence.length);
  const ev = firstWithEvidence ? s.utterances.find((u) => u.id === firstWithEvidence.evidence[0]) : null;
  const speakers = [...new Set(items.map((i) => i.speaker).filter(Boolean))];
  const mins = ev ? Math.floor((ev.start || 0) / 60) : null;
  const who = speakers.join(" and ") + (mins !== null ? ` · ${mins} min` : "");
  return `${active ? '<span class="now-tag">Now</span>' : ""}
    <div class="who"><span class="dot" style="background:${colorOf(speakers[0])}"></span>${esc(who)}</div>
    <h3>${esc(t.label)}</h3>
    <ul class="items">${items.map((i) => itemLi(i, s)).join("")}</ul>`;
}

// The map is a row of stitched patches, one per topic, in the order the topics came up.
// Existing patches keep their place. Only their content updates in place.
// The flow strip: one dot per sentence, in the order it was said, coloured by speaker.
// A ring marks a sentence that became a card. The newest sentence is marked "latest".
function renderFlow(s) {
  const box = $("#flow");
  const lines = s.utterances.slice(-40);
  box.hidden = !lines.length;
  if (!lines.length) return;
  const mapped = new Set(s.items.flatMap((i) => i.evidence));
  box.innerHTML = `<div class="flow-track">${lines
    .map((u, k) => {
      const label = /\d+/.exec(u.speaker)?.[0] ?? (u.speaker[0] || "?");
      const cls = ["flow-node", mapped.has(u.id) && "mapped", k === lines.length - 1 && "latest"].filter(Boolean).join(" ");
      return `<div class="${cls}" title="${esc(u.speaker)}: ${esc(u.text)}">
        <span class="flow-dot" style="background:${colorOf(u.speaker)}">${esc(label)}</span>
        <span class="flow-text">${esc(u.text)}</span>
      </div>`;
    })
    .join("")}</div>
    <div class="flow-key">
      <span>Each dot is one sentence, in the order it was said</span>
      <span><i class="k-ring"></i>became a card</span>
      <span><i class="k-now"></i>latest line</span>
    </div>`;
  box.querySelector(".flow-track").scrollLeft = 1e9;
}

function renderMap(s) {
  renderFlow(s);
  const holder = $("#patches");
  const latest = s.items.reduce((a, i) => (!a || i.createdAt > a.createdAt ? i : a), null);
  const active = latest?.topicId;
  const shown = (i) => !state.calm || i.kind === "decision" || i.kind === "question";
  const keep = new Set();

  for (const t of s.topics) {
    const items = s.items.filter((i) => i.topicId === t.id && shown(i));
    let el = document.getElementById(`p-${t.id}`);
    if (!items.length) {
      el?.remove();
      continue;
    }
    if (!el) {
      el = document.createElement("article");
      el.id = `p-${t.id}`;
      el.className = "patch";
      holder.appendChild(el);
    }
    keep.add(el.id);
    el.classList.toggle("now", t.id === active);
    const html = patchHtml(t, items, s, t.id === active);
    if (el._html !== html) {
      el.innerHTML = html;
      el._html = html;
    }
  }
  for (const el of [...holder.children]) if (!keep.has(el.id)) el.remove();
  $("#map-empty").hidden = keep.size > 0;
  drawThread();
}

// Joins consecutive patches with a row of dots. Only new segments animate.
function drawThread() {
  const mapEl = $("#map-view");
  if (mapEl.hidden) return;
  const svg = $("#thread");
  const cards = [...$("#patches").children];
  const base = mapEl.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  };
  for (let k = 0; k < cards.length - 1; k++) {
    const a = box(cards[k]);
    const b = box(cards[k + 1]);
    let d;
    if (Math.abs(a.y - b.y) < 10) {
      const sx = a.x + a.w, sy = a.y + a.h / 2, ex = b.x, ey = b.y + b.h / 2;
      const mx = (sx + ex) / 2;
      d = `M${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;
    } else {
      const sx = a.x + a.w / 2, sy = a.y + a.h, ex = b.x + b.w / 2, ey = b.y;
      const my = (sy + ey) / 2;
      d = `M${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`;
    }
    let p = document.getElementById(`seg-${k}`);
    if (!p) {
      p = document.createElementNS(NS, "path");
      p.id = `seg-${k}`;
      p.setAttribute("pathLength", "1");
      p.classList.add("draw");
      svg.appendChild(p);
    }
    if (p.getAttribute("d") !== d) p.setAttribute("d", d);
  }
  for (const p of [...svg.querySelectorAll("path")]) {
    if (Number(p.id.slice(4)) >= cards.length - 1) p.remove();
  }
}

// ---------------- Patch clicks: item quote and correction mode ----------------
// The delegated click above handles tie, keep, remove and quote.

// ---------------- Popover with the exact quote ----------------
function openPopover(id, anchor) {
  const s = state.session;
  const item = s.items.find((i) => i.id === id);
  if (!item) return;
  const quotes = item.evidence.map((eid) => s.utterances.find((u) => u.id === eid)).filter(Boolean);
  const status =
    item.kind === "decision" && item.status === "verified"
      ? item.confirmedBy
        ? `Tied by ${esc(item.confirmedBy)}. Checked by ${esc(item.verifiedBy)}${item.reason ? `: ${esc(item.reason)}` : ""}`
        : `Checked by ${esc(item.verifiedBy)}${item.reason ? `: ${esc(item.reason)}` : ""}. Waiting for someone to tie it.`
      : item.status === "not_agreed"
        ? `Not sure this was said. ${esc(item.reason ?? "Nobody agreed to it.")}`
        : item.status === "proposed"
          ? "Still being checked."
          : "Questions and ideas are shown as said. They are not treated as facts.";
  const pop = $("#popover");
  pop.innerHTML =
    `<b>${esc(item.label)}</b>` +
    (quotes.length
      ? quotes.map((q) => `<div class="q">“${esc(q.text)}”<small>${esc(q.speaker)} · ${esc(q.id)}</small></div>`).join("")
      : `<div class="m">No quote attached.</div>`) +
    `<div class="m">${status}</div>` +
    `<button class="btn btn-ghost btn-sm" id="pop-wrong">That's wrong</button>`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 336, Math.max(16, r.left));
  const top = r.bottom + 8 + 240 > window.innerHeight ? Math.max(16, r.top - 8 - pop.offsetHeight) : r.bottom + 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  $("#pop-wrong").onclick = () => markWrong(item.id);
  $$("#lines .line").forEach((l) => l.classList.toggle("hl", item.evidence.includes(l.dataset.uid)));
  const first = $(`#lines .line[data-uid="${item.evidence[0]}"]`);
  if (first) $("#lines").scrollTo({ top: first.offsetTop - $("#lines").offsetTop - 80, behavior: "smooth" });
}
function hidePopover() {
  $("#popover").hidden = true;
  $$("#lines .line.hl").forEach((l) => l.classList.remove("hl"));
}
document.addEventListener("click", (e) => {
  if (!$("#popover").hidden && !e.target.closest("#popover") && !e.target.closest("[data-act=quote]")) hidePopover();
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
$("#home").innerHTML = svgIcon("back", "");
show("landing");
