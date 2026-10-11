import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env if present (no dependency needed). LIVE_MAP_SKIP_ENV=1 skips it, for tests.
const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = join(root, ".env");
if (process.env.LIVE_MAP_SKIP_ENV !== "1" && existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { createSession, getSession, onUtterance, updateMap, recap, overview, correct, confirm, keep, view } = await import("./pipeline.ts");
const { providerStatus, deepgramToken, MODELS } = await import("./models.ts");
const { DEMO_SCRIPT, DEMO_SPEAKERS } = await import("./demo.ts");

const PUBLIC = join(root, "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function session(res: ServerResponse, id: string | undefined) {
  const s = id ? getSession(id) : undefined;
  if (!s) send(res, 404, { error: "Session not found. Start a new one." });
  return s;
}

async function api(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
  const method = req.method ?? "GET";

  if (path === "status" && method === "GET")
    return send(res, 200, { providers: providerStatus(), models: MODELS, speakers: DEMO_SPEAKERS });

  if (path === "demo-script" && method === "GET") return send(res, 200, { script: DEMO_SCRIPT, speakers: DEMO_SPEAKERS });

  if (path === "stt-token" && method === "GET") return send(res, 200, { token: await deepgramToken() });

  if (path === "session" && method === "POST") {
    const b = await body(req);
    const nick = Array.isArray(b.nicknames) ? b.nicknames : String(b.nicknames ?? "").split(",");
    const s = createSession(String(b.userName ?? "Alex"), nick, b.mode === "live" ? "live" : "demo");
    return send(res, 200, view(s));
  }

  if (path === "session" && method === "GET") {
    const s = session(res, url.searchParams.get("id") ?? undefined);
    return s && send(res, 200, view(s));
  }

  if (path === "utterance" && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    const text = String(b.text ?? "").trim();
    if (!text) return send(res, 400, { error: "Empty utterance" });
    const out = await onUtterance(s, {
      speaker: String(b.speaker ?? "Speaker"),
      text,
      start: Number(b.start ?? 0),
      end: Number(b.end ?? 0),
      engine: ["deepgram", "browser", "demo"].includes(b.engine) ? b.engine : "demo",
      confidence: b.confidence == null ? undefined : Number(b.confidence),
    });
    return send(res, 200, out);
  }

  if (path === "map/update" && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    const out = await updateMap(s);
    return send(res, 200, { ...out, session: view(s) });
  }

  if (path === "recap" && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    return send(res, 200, await recap(s, typeof b.sinceIndex === "number" ? b.sinceIndex : undefined));
  }

  if (path === "overview" && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    return send(res, 200, await overview(s));
  }

  if ((path === "confirm" || path === "keep") && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    const ok = path === "confirm" ? confirm(s, String(b.itemId)) : keep(s, String(b.itemId));
    return send(res, ok ? 200 : 400, { session: view(s) });
  }

  if (path === "correct" && method === "POST") {
    const b = await body(req);
    const s = session(res, b.sessionId);
    if (!s) return;
    correct(s, String(b.itemId));
    return send(res, 200, { session: view(s) });
  }

  send(res, 404, { error: "Unknown endpoint" });
}

async function serveStatic(res: ServerResponse, path: string) {
  const rel = path === "" || path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Works both at the root and behind a proxy prefix such as /app/<n>/ (Anbaric strips it).
    const apiIdx = url.pathname.indexOf("/api/");
    if (apiIdx >= 0) return await api(req, res, url.pathname.slice(apiIdx + 5), url);
    return await serveStatic(res, url.pathname);
  } catch (e: any) {
    console.error(e);
    send(res, 500, { error: e?.message ?? "Server error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  const p = providerStatus();
  console.log(`Live Conversation Map running on http://localhost:${port}`);
  console.log(
    `Providers: gemini=${p.gemini ? "on" : "off"} anthropic=${p.anthropic ? "on" : "off"} deepgram=${p.deepgram ? "on" : "off"}` +
      (!p.gemini && !p.anthropic ? "  (no model keys: running in simulated mode)" : ""),
  );
});
