// End-to-end test: starts the real server in simulated mode (no model keys) and drives
// the scripted demo meeting through the HTTP API, checking the behaviours the demo promises.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

// Blank keys so the server starts in simulated mode. Note: a .env file with real keys still
// fills them in, so run the test without one to be sure it is fully offline.
const NO_KEYS = { GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "", DEEPGRAM_API_KEY: "" };

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
    env: { ...process.env, ...NO_KEYS, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout!.on("data", (d) => {
      if (String(d).includes("running on")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => server?.kill());

async function api(path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/${path}`, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() as any };
}

test("serves the landing page and static assets", async () => {
  const page = await fetch(`${BASE}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /dottie/);
  assert.equal((await fetch(`${BASE}/app.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/styles.css`)).status, 200);
});

test("reports simulated mode when no keys are set", async () => {
  const { data } = await api("status");
  assert.deepEqual(data.providers, { gemini: false, deepseek: false, anthropic: false, deepgram: false });
});

test("demo meeting: alert, verification, downgrade, recap and correction", async () => {
  const { data: script } = await api("demo-script");
  const { data: session } = await api("session", { userName: "Alex", nicknames: "Al, Lex", mode: "demo" });
  const sid = session.id;

  let t = 0;
  const alerts: any[] = [];
  for (const line of script.script) {
    const r = await api("utterance", { sessionId: sid, speaker: line.speaker, text: line.text, start: t, end: t + line.seconds });
    assert.equal(r.status, 200);
    if (r.data.alert) alerts.push(r.data.alert);
    t += line.seconds + 0.4;
  }

  // The question aimed at Alex raises exactly one alert, with the lines before it as context.
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].askedBy, "Priya");
  assert.match(alerts[0].question, /leadership email/);
  assert.ok(alerts[0].context.length > 0);

  // Mapping and background verification. Poll until nothing is still "checking".
  await api("map/update", { sessionId: sid });
  let view: any;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    view = await (await fetch(`${BASE}/api/session?id=${sid}`)).json();
    if (view.items.length && !view.items.some((x: any) => x.status === "proposed")) break;
  }
  const find = (re: RegExp) => view.items.find((x: any) => re.test(x.label));

  const crash = find(/crash before launch/);
  assert.equal(crash?.kind, "decision");
  assert.equal(crash?.status, "verified");
  assert.ok(crash.evidence.length > 0, "decisions cite transcript evidence");

  // A person confirms a verified decision. Questions cannot be confirmed.
  const confirmed = await api("confirm", { sessionId: sid, itemId: crash.id });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.session.items.find((x: any) => x.id === crash.id).confirmedBy, "Alex");
  assert.equal((await api("confirm", { sessionId: sid, itemId: find(/31st/).id })).status, 400);

  const task = find(/Marcus will take/);
  assert.equal(task?.owner, "Marcus");
  assert.equal(task?.status, "verified");

  // "Maybe we move the launch..." was floated, never agreed: it must not become a decision.
  const maybe = find(/31st/);
  assert.equal(maybe?.kind, "question");
  assert.equal(maybe?.status, "not_agreed");

  // Cost ledger: the routed total must come in below the single-model baseline.
  assert.ok(view.cost.routedUsd > 0);
  assert.ok(view.cost.singleModelUsd > view.cost.routedUsd);

  // Recap covers the conversation and includes the "you" card.
  const recap = await api("recap", { sessionId: sid });
  assert.ok(recap.data.cards.length >= 1 && recap.data.cards.length <= 3);
  assert.ok(recap.data.cards.some((c: any) => c.icon === "you"));

  // Human correction removes the item and it stays in the removed list.
  const target = view.items.find((x: any) => x.kind === "idea");
  const fixed = await api("correct", { sessionId: sid, itemId: target.id });
  assert.equal(fixed.status, 200);
  assert.ok(!fixed.data.session.items.some((x: any) => x.id === target.id));
  assert.ok(fixed.data.session.removed.some((x: any) => x.id === target.id));

  // Overview: one numbered stage per topic, in conversation order, each with a summary and points.
  const ov = await api("overview", { sessionId: sid });
  assert.equal(ov.status, 200);
  assert.ok(ov.data.stages.length >= 3);
  assert.deepEqual(ov.data.stages.map((g: any) => g.n), ov.data.stages.map((_: any, k: number) => k + 1));
  assert.ok(ov.data.stages.every((g: any) => g.summary && g.speakers.length && g.lines > 0));
  const crashStage = ov.data.stages.find((g: any) => g.points.some((p: any) => /crash before launch/.test(p.label)));
  assert.ok(crashStage, "the crash decision appears in a stage");
  assert.ok(crashStage.speakers.includes("Marcus"));
  assert.ok(typeof ov.data.now === "string" && ov.data.now.length > 0);

  // Evals: every call is counted once, by model, and the shares add up to 100%.
  const live = await api(`session?id=${sid}`);
  const usage = live.data.usage;
  assert.equal(usage.calls, live.data.cost.calls);
  assert.equal(usage.models.reduce((n: number, m: any) => n + m.calls, 0), usage.calls);
  assert.ok(Math.abs(usage.models.reduce((n: number, m: any) => n + m.share, 0) - 1) < 1e-9);
  assert.ok(usage.models.some((m: any) => m.key === "simulated/local-rules"));
  assert.ok(usage.matrix.every((row: any) => Object.values(row.byModel).reduce((n: number, c: any) => n + c, 0) === usage.roles.find((r: any) => r.loop === row.loop).total));

  // Consent and the start of the session are in the audit trail.
  const actions = view.audit.map((a: any) => a.action);
  assert.ok(actions.includes("consent"));
  assert.ok(actions.includes("alert"));
});

test("rejects unknown sessions and empty utterances", async () => {
  const missing = await api("utterance", { sessionId: "nope", text: "hi" });
  assert.equal(missing.status, 404);

  const { data: session } = await api("session", { userName: "Alex", mode: "demo" });
  const empty = await api("utterance", { sessionId: session.id, speaker: "Priya", text: "   " });
  assert.equal(empty.status, 400);
});
