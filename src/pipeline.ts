import { route, PRICES, type ModelResult, type Provider } from "./models.ts";

// ---------- Types ----------

export type Utterance = { id: string; speaker: string; text: string; start: number; end: number };

export type Kind = "decision" | "action" | "question" | "idea";
export type Status = "proposed" | "verified" | "not_agreed" | "rejected";

export type Topic = { id: string; label: string; createdAt: number };
export type Item = {
  id: string;
  kind: Kind;
  label: string;
  topicId: string;
  speaker: string;
  owner?: string;
  evidence: string[];
  status: Status;
  verifiedBy?: string;
  reason?: string;
  createdAt: number;
};

export type Actor = { type: "human" | "agent" | "code"; name: string; model?: string };
export type AuditEntry = { at: number; actor: Actor; action: string; detail: string };

export type CostEvent = {
  at: number;
  loop: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  baselineUsd: number; // what one strong model doing this job would cost
  ms: number;
};

export type Alert = { id: string; question: string; askedBy: string; context: string[]; at: number; provider: string };

export type Session = {
  id: string;
  userName: string;
  nicknames: string[];
  mode: "demo" | "live";
  utterances: Utterance[];
  mappedUpTo: number; // index into utterances already sent to the mapper
  topics: Topic[];
  items: Item[];
  rejected: string[];
  alerts: Alert[];
  ledger: CostEvent[];
  audit: AuditEntry[];
  skippedAlertChecks: number;
  busy: boolean;
  createdAt: number;
};

// ---------- Session store ----------

const sessions = new Map<string, Session>();
let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createSession(userName: string, nicknames: string[], mode: "demo" | "live"): Session {
  const s: Session = {
    id: uid("s"),
    userName: userName.trim() || "Alex",
    nicknames: nicknames.map((n) => n.trim()).filter(Boolean),
    mode,
    utterances: [],
    mappedUpTo: 0,
    topics: [],
    items: [],
    rejected: [],
    alerts: [],
    ledger: [],
    audit: [],
    skippedAlertChecks: 0,
    busy: false,
    createdAt: Date.now(),
  };
  sessions.set(s.id, s);
  audit(s, { type: "human", name: s.userName }, "consent", "Confirmed everyone present knows the conversation is transcribed");
  audit(s, { type: "human", name: s.userName }, "start", `Started a ${mode} session`);
  return s;
}

export const getSession = (id: string) => sessions.get(id);

function audit(s: Session, actor: Actor, action: string, detail: string) {
  s.audit.push({ at: Date.now(), actor, action, detail });
}

const AGENT_NAMES: Record<string, string> = {
  alert: "Alert spotter",
  map: "Mapper",
  verify: "Verifier",
  recap: "Recap writer",
};

function agentFor(loop: string, r: ModelResult): Actor {
  return { type: "agent", name: AGENT_NAMES[loop] ?? loop, model: `${r.provider}/${r.model}` };
}

function charge(s: Session, loop: string, r: ModelResult) {
  const [pi, po] = PRICES[r.provider];
  const [bi, bo] = PRICES.anthropic;
  // Simulated calls are priced as if the routed model had run, so the comparison stays honest.
  const routedPrice = r.provider === "simulated" ? PRICES[loop === "recap" ? "anthropic" : loop === "verify" ? "deepseek" : "gemini"] : [pi, po];
  const usd = (r.inputTokens * routedPrice[0] + r.outputTokens * routedPrice[1]) / 1e6;
  const baselineUsd = (r.inputTokens * bi + r.outputTokens * bo) / 1e6;
  s.ledger.push({
    at: Date.now(),
    loop,
    provider: r.provider,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    usd,
    baselineUsd,
    ms: r.ms,
  });
}

// ---------- Helpers ----------

const fmt = (u: Utterance) => `[${u.id}] ${u.speaker}: ${u.text}`;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function similar(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 3));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return norm(a) === norm(b);
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.7;
}

// ---------- 1. Alert: free name check, then fast model ----------

const ADDRESS = /\?|\b(can you|could you|would you|will you|what do you think|your take|do you)\b/i;

export async function onUtterance(s: Session, u: Omit<Utterance, "id">) {
  const utt: Utterance = { ...u, id: `u${s.utterances.length + 1}` };
  s.utterances.push(utt);

  if (norm(utt.speaker) === norm(s.userName)) return { utterance: utt, alert: null };

  const names = [s.userName, ...s.nicknames].filter(Boolean).map((n) => n.toLowerCase());
  const mentions = names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(utt.text));
  if (!mentions || !ADDRESS.test(utt.text)) {
    s.skippedAlertChecks++;
    return { utterance: utt, alert: null };
  }

  const recent = s.utterances.filter((x) => x.end >= utt.end - 30).slice(-6);
  const system =
    `You detect when someone in a live conversation directly asks or addresses ${s.userName}` +
    (s.nicknames.length ? ` (also called ${s.nicknames.join(", ")})` : "") +
    `. Return JSON {"addressed": boolean, "question": string, "askedBy": string}. ` +
    `"question" is a short, plain restatement of what they are being asked, under 20 words.`;
  const user = `Recent conversation:\n${recent.map(fmt).join("\n")}\n\nIs the LAST line addressing ${s.userName}?`;

  const r = await route(["gemini", "deepseek", "anthropic"], system, user, () => ({
    addressed: true,
    question: utt.text.replace(new RegExp(`^${s.userName},?\\s*`, "i"), ""),
    askedBy: utt.speaker,
  }));
  charge(s, "alert", r);
  if (!r.json?.addressed) return { utterance: utt, alert: null };

  const alert: Alert = {
    id: uid("a"),
    question: String(r.json.question || utt.text),
    askedBy: String(r.json.askedBy || utt.speaker),
    context: recent.slice(-3, -1).map((x) => `${x.speaker}: ${x.text}`),
    at: Date.now(),
    provider: `${r.provider}/${r.model}`,
  };
  s.alerts.push(alert);
  audit(s, agentFor("alert", r), "alert", `${alert.askedBy} is asking ${s.userName}: ${alert.question}`);
  return { utterance: utt, alert };
}

// ---------- 2. Mapper: fast model proposes map changes ----------

type ProposedItem = { kind: Kind; label: string; topic: string; owner?: string; evidence: string[] };

function mapSummary(s: Session) {
  return s.topics
    .map((t) => {
      const kids = s.items.filter((i) => i.topicId === t.id && i.status !== "rejected");
      return `- ${t.label}\n${kids.map((k) => `    - (${k.kind}) ${k.label}`).join("\n")}`;
    })
    .join("\n");
}

export async function updateMap(s: Session) {
  if (s.busy) return { changed: false, busy: true };
  const fresh = s.utterances.slice(s.mappedUpTo);
  const pendingItems = s.items.filter((i) => i.status === "proposed");
  if (!fresh.length && !pendingItems.length) return { changed: false };
  s.busy = true;
  try {
    let added: Item[] = [];
    if (fresh.length) {
      const upTo = s.utterances.length;
      const context = s.utterances.slice(Math.max(0, s.mappedUpTo - 3), s.mappedUpTo);
      const system =
        `You maintain a live visual map of a conversation for a neurodivergent participant. ` +
        `Given the current map and NEW transcript lines, return only additions as JSON: ` +
        `{"topics": [{"label": string}], "items": [{"kind": "decision"|"action"|"question"|"idea", "label": string, "topic": string, "owner": string|null, "evidence": [utterance ids]}]}. ` +
        `Rules: topic labels are 2-4 words. Item labels are under 9 words, plain language. ` +
        `"decision" = something the group is choosing to do. "action" = a task someone took on (owner = that person). ` +
        `"question" = an open question still unanswered. "idea" = a suggestion. ` +
        `Every item MUST cite the utterance ids it comes from. "topic" must match an existing or new topic label. ` +
        `Do not repeat items already on the map. Never add items from this rejected list: ${JSON.stringify(s.rejected)}. ` +
        `If nothing new, return {"topics": [], "items": []}.`;
      const user =
        `Current map:\n${mapSummary(s) || "(empty)"}\n\n` +
        (context.length ? `Earlier lines (context only):\n${context.map(fmt).join("\n")}\n\n` : "") +
        `NEW lines:\n${fresh.map(fmt).join("\n")}`;

      const r = await route(["gemini", "deepseek", "anthropic"], system, user, () => simulateMap(s, fresh));
      charge(s, "map", r);
      s.mappedUpTo = upTo;
      added = applyMapChanges(s, r.json, r);
      (s as any).lastMapper = r.provider;
    }
    // Verification runs in the background so unverified items visibly show "checking" first.
    startVerify(s);
    return { changed: true, added: added.length };
  } finally {
    s.busy = false;
  }
}

function startVerify(s: Session) {
  if ((s as any).verifying) return;
  (s as any).verifying = true;
  const delay = s.mode === "demo" ? 1200 : 0;
  setTimeout(() => {
    verify(s)
      .catch((e) => console.warn("[verify]", e))
      .finally(() => ((s as any).verifying = false));
  }, delay);
}

function applyMapChanges(s: Session, json: any, r: ModelResult): Item[] {
  const actor = agentFor("map", r);
  const topicFor = (label: string): Topic => {
    const clean = String(label || "General").trim();
    let t = s.topics.find((x) => similar(x.label, clean));
    if (!t) {
      t = { id: uid("t"), label: clean, createdAt: Date.now() };
      s.topics.push(t);
      audit(s, actor, "add topic", clean);
    }
    return t;
  };
  for (const t of json?.topics ?? []) if (t?.label) topicFor(t.label);

  const valid = new Set(s.utterances.map((u) => u.id));
  const added: Item[] = [];
  for (const p of (json?.items ?? []) as ProposedItem[]) {
    if (!p?.label || !["decision", "action", "question", "idea"].includes(p.kind)) continue;
    if (s.rejected.some((x) => similar(x, p.label))) continue;
    if (s.items.some((i) => i.kind === p.kind && similar(i.label, p.label))) continue;
    const evidence = (p.evidence ?? []).map(String).filter((id) => valid.has(id));
    const first = s.utterances.find((u) => u.id === evidence[0]);
    const needsCheck = p.kind === "decision" || p.kind === "action";
    const item: Item = {
      id: uid("i"),
      kind: p.kind,
      label: String(p.label).trim(),
      topicId: topicFor(p.topic).id,
      speaker: first?.speaker ?? "",
      owner: p.owner || undefined,
      evidence,
      status: needsCheck ? "proposed" : "verified",
      createdAt: Date.now(),
    };
    // A claim with no evidence cannot be checked, so it never reaches the map as fact.
    if (needsCheck && !evidence.length) continue;
    s.items.push(item);
    added.push(item);
    audit(s, actor, `propose ${p.kind}`, item.label);
  }
  return added;
}

// ---------- 3. Verifier: a different provider checks decisions and actions ----------

async function verify(s: Session) {
  const pending = s.items.filter((i) => i.status === "proposed");
  if (!pending.length) return;
  const mapper = (s as any).lastMapper as string | undefined;
  const order = (["deepseek", "anthropic", "gemini"] as const).filter((p) => p !== mapper);
  if (mapper && mapper !== "simulated") order.push(mapper as any);

  const claims = pending.map((i) => {
    const idx = i.evidence.map((id) => s.utterances.findIndex((u) => u.id === id)).filter((n) => n >= 0);
    const lo = Math.max(0, Math.min(...idx) - 2);
    const hi = Math.min(s.utterances.length, Math.max(...idx) + 3);
    return { id: i.id, kind: i.kind, claim: i.label, owner: i.owner ?? null, transcript: s.utterances.slice(lo, hi).map(fmt) };
  });

  const system =
    `You are a strict fact-checker for a live meeting map. For each claim, read ONLY its transcript excerpt. ` +
    `Return JSON {"verdicts": [{"id": string, "verdict": "supported"|"not_agreed"|"unsupported"|"pending", "reason": string}]}. ` +
    `"supported": a decision the group actually agreed to, or a task the owner actually took on. ` +
    `"not_agreed": it was floated or suggested but nobody agreed (it will be shown as an open question). ` +
    `"unsupported": the transcript does not say this. ` +
    `"pending": the claim is in the final line of the excerpt and others have not had a chance to respond. ` +
    `Reasons are under 12 words.`;
  const user = JSON.stringify({ claims }, null, 1);

  const r = await route(order as any, system, user, () => simulateVerify(s, pending));
  charge(s, "verify", r);
  const actor = agentFor("verify", r);

  for (const v of r.json?.verdicts ?? []) {
    const item = s.items.find((i) => i.id === v.id);
    if (!item || item.status !== "proposed") continue;
    const reason = String(v.reason ?? "");
    if (v.verdict === "supported") {
      item.status = "verified";
      item.verifiedBy = `${r.provider}/${r.model}`;
      item.reason = reason;
      audit(s, actor, "verified", `${item.label} (${reason})`);
    } else if (v.verdict === "not_agreed") {
      item.status = "not_agreed";
      item.kind = "question";
      item.verifiedBy = `${r.provider}/${r.model}`;
      item.reason = reason || "Suggested, but nobody agreed";
      audit(s, actor, "downgraded to open question", `${item.label} (${item.reason})`);
    } else if (v.verdict === "unsupported") {
      item.status = "rejected";
      item.verifiedBy = `${r.provider}/${r.model}`;
      item.reason = reason || "Not in the transcript";
      s.rejected.push(item.label);
      audit(s, actor, "removed", `${item.label} (${item.reason})`);
    }
  }
}

// ---------- 4. Recap: reasoning model ----------

export async function recap(s: Session, sinceIndex?: number) {
  const since = sinceIndex ?? Math.max(0, s.utterances.length - 12);
  const lines = s.utterances.slice(since);
  const system =
    `You help a neurodivergent person catch up on a live conversation in 10 seconds. ` +
    `Return JSON {"cards": [{"icon": "topic"|"decision"|"action"|"question"|"you", "title": string, "text": string}]}. ` +
    `3 to 5 cards, most important first. Titles under 5 words, text under 18 words, plain and calm. ` +
    `Include a "you" card if anything involves ${s.userName}. Only use facts from the transcript.`;
  const user = `Map:\n${mapSummary(s) || "(empty)"}\n\nTranscript to recap:\n${lines.map(fmt).join("\n") || "(nothing yet)"}`;
  const r = await route(["anthropic", "gemini", "deepseek"], system, user, () => simulateRecap(s, lines));
  charge(s, "recap", r);
  audit(s, agentFor("recap", r), "recap", `${(r.json?.cards ?? []).length} cards covering ${lines.length} lines`);
  return { cards: r.json?.cards ?? [], provider: `${r.provider}/${r.model}`, lines: lines.length };
}

// ---------- 5. Human control ----------

export function correct(s: Session, itemId: string) {
  const item = s.items.find((i) => i.id === itemId);
  if (!item) return false;
  item.status = "rejected";
  item.reason = `Marked wrong by ${s.userName}`;
  s.rejected.push(item.label);
  audit(s, { type: "human", name: s.userName }, "marked wrong", item.label);
  return true;
}

// ---------- Views ----------

const STT_PER_MIN = 0.0065 + 0.002; // Deepgram streaming + speaker labels

export function costView(s: Session) {
  const minutes = s.utterances.length ? (s.utterances.at(-1)!.end - s.utterances[0].start) / 60 : 0;
  const stt = minutes * STT_PER_MIN;
  const routed = s.ledger.reduce((a, e) => a + e.usd, 0) + stt;
  // A single strong model would also check every utterance for the alert (we skip those for free).
  const skipped = s.skippedAlertChecks * ((400 * PRICES.anthropic[0] + 40 * PRICES.anthropic[1]) / 1e6);
  const single = s.ledger.reduce((a, e) => a + e.baselineUsd, 0) + skipped + stt;
  const byLoop: Record<string, { calls: number; usd: number; providers: string[] }> = {};
  for (const e of s.ledger) {
    const b = (byLoop[e.loop] ??= { calls: 0, usd: 0, providers: [] });
    b.calls++;
    b.usd += e.usd;
    const tag = `${e.provider}/${e.model}`;
    if (!b.providers.includes(tag)) b.providers.push(tag);
  }
  return {
    routedUsd: routed,
    singleModelUsd: single,
    ratio: routed > 0 ? single / routed : 0,
    sttUsd: stt,
    minutes,
    freeAlertChecks: s.skippedAlertChecks,
    byLoop,
    calls: s.ledger.length,
  };
}

export function view(s: Session) {
  return {
    id: s.id,
    userName: s.userName,
    mode: s.mode,
    utterances: s.utterances,
    topics: s.topics,
    items: s.items.filter((i) => i.status !== "rejected"),
    removed: s.items.filter((i) => i.status === "rejected"),
    alerts: s.alerts,
    cost: costView(s),
    audit: s.audit.slice(-60),
  };
}

// ---------- Simulated fallbacks (used only when no model key works) ----------

const TOPIC_RULES: [RegExp, string][] = [
  [/crash|android|payment/i, "Android payment crash"],
  [/onboarding|video|marketing/i, "Onboarding video"],
  [/leadership|deadline update|email/i, "Leadership update"],
  [/launch|release|ship/i, "Launch date"],
];

function topicOf(text: string, fallback: string) {
  for (const [re, label] of TOPIC_RULES) if (re.test(text)) return label;
  return fallback;
}

function tidy(text: string) {
  return text
    .replace(/^(okay|ok|so|then|great|perfect|agreed|hmm|sure)[,.!]?\s+/i, "")
    .replace(/^(so )?we're decided:?\s*/i, "")
    .replace(/[.!?]+$/, "")
    .replace(/^\w/, (c) => c.toUpperCase())
    .slice(0, 70);
}

function simulateMap(s: Session, fresh: Utterance[]) {
  let current = s.topics.at(-1)?.label ?? "General";
  const topics: { label: string }[] = [];
  const items: ProposedItem[] = [];
  for (const u of fresh) {
    const topic = topicOf(u.text, current);
    current = topic;
    if (!s.topics.some((t) => t.label === topic) && !topics.some((t) => t.label === topic)) topics.push({ label: topic });
    const t = u.text;
    if (/\b(let's (fix|go with|do|ship)|we're decided|we will go with|maybe we (move|push|change))\b/i.test(t))
      items.push({ kind: "decision", label: tidy(t), topic, evidence: [u.id] });
    else if (/\bI'll (take|send|do|own|handle|fix|write)\b/i.test(t))
      items.push({ kind: "action", label: tidy(t.replace(/^.*?I'll/i, `${u.speaker} will`)), topic, owner: u.speaker, evidence: [u.id] });
    else if (/\b(what about|how about|we could)\b/i.test(t))
      items.push({ kind: "idea", label: tidy(t.replace(/^(what|how) about\s*/i, "")), topic, evidence: [u.id] });
    else if (/\?$/.test(t.trim()) && !new RegExp(s.userName, "i").test(t))
      items.push({ kind: "question", label: tidy(t), topic, evidence: [u.id] });
  }
  return { topics, items };
}

const AGREE = /\b(agreed|sounds good|yes|yep|perfect|great|let's do it|works for me|sure)\b/i;
const DOUBT = /\b(not sure|hmm|don't think|disagree|keep thinking|no,)\b/i;

function simulateVerify(s: Session, pending: Item[]) {
  return {
    verdicts: pending.map((i) => {
      const idx = s.utterances.findIndex((u) => u.id === i.evidence[0]);
      const src = s.utterances[idx];
      if (!src) return { id: i.id, verdict: "unsupported", reason: "No matching line in transcript" };
      if (i.kind === "action")
        return /\bI'll\b/i.test(src.text)
          ? { id: i.id, verdict: "supported", reason: `${src.speaker} took this on directly` }
          : { id: i.id, verdict: "not_agreed", reason: "Nobody committed to it" };
      const after = s.utterances.slice(idx + 1, idx + 3).filter((u) => u.speaker !== src.speaker);
      if (!after.length) return { id: i.id, verdict: "pending", reason: "Waiting for a response" };
      if (after.some((u) => DOUBT.test(u.text))) return { id: i.id, verdict: "not_agreed", reason: `${after[0].speaker} was not sure` };
      if (/\bmaybe\b/i.test(src.text) && !after.some((u) => AGREE.test(u.text)))
        return { id: i.id, verdict: "not_agreed", reason: "Floated as a maybe, not agreed" };
      if (after.some((u) => AGREE.test(u.text))) return { id: i.id, verdict: "supported", reason: `${after.find((u) => AGREE.test(u.text))!.speaker} agreed` };
      return { id: i.id, verdict: "not_agreed", reason: "No one confirmed it" };
    }),
  };
}

function simulateRecap(s: Session, lines: Utterance[]) {
  const cards: any[] = [];
  const ids = new Set(lines.map((l) => l.id));
  const recent = s.items.filter((i) => i.status !== "rejected" && i.evidence.some((e) => ids.has(e)));
  const topics = [...new Set(recent.map((i) => s.topics.find((t) => t.id === i.topicId)?.label).filter(Boolean))];
  if (topics.length) cards.push({ icon: "topic", title: "Talking about", text: topics.slice(0, 3).join(", ") });
  const you = s.alerts.at(-1);
  if (you) cards.push({ icon: "you", title: "Asked of you", text: `${you.askedBy}: ${you.question}` });
  for (const d of recent.filter((i) => i.kind === "decision" && i.status === "verified").slice(0, 2))
    cards.push({ icon: "decision", title: "Decided", text: d.label });
  for (const a of recent.filter((i) => i.kind === "action").slice(0, 1)) cards.push({ icon: "action", title: "To do", text: a.label });
  for (const q of recent.filter((i) => i.kind === "question").slice(0, 1)) cards.push({ icon: "question", title: "Still open", text: q.label });
  if (!cards.length) cards.push({ icon: "topic", title: "Just started", text: "Nothing major yet. The conversation is warming up." });
  return { cards: cards.slice(0, 5) };
}
