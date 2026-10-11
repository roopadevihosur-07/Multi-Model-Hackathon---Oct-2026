// Model providers. Each call returns parsed JSON plus token usage, and is priced by the ledger.
// If a provider's key is missing, the router falls back to the next provider for that role,
// and finally to a local "simulated" mode so the demo always runs end to end.

export type Provider = "gemini" | "anthropic" | "simulated";

export type ModelResult = {
  json: any;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

const env = process.env;

export const MODELS = {
  gemini: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  anthropic: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  // The checker runs after every map update, so it uses the small Claude model.
  check: env.ANTHROPIC_CHECK_MODEL || "claude-haiku-5-5",
};

// USD per million tokens [input, output], by provider default model
export const PRICES: Record<string, [number, number]> = {
  gemini: [0.1, 0.4],
  anthropic: [2, 10], // Claude Sonnet 5.5
  simulated: [0, 0],
};

// Models priced differently from their provider's default
const MODEL_PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export const priceOf = (provider: string, model?: string): [number, number] =>
  (model && MODEL_PRICES[model]) || PRICES[provider] || [0, 0];

// Per-call overrides: which Claude model to use, and how hard it should think.
export type CallOptions = { anthropicModel?: string; effort?: "low" | "medium" | "high" };

export function hasKey(p: Provider): boolean {
  if (p === "gemini") return !!env.GEMINI_API_KEY;
  if (p === "anthropic") return !!env.ANTHROPIC_API_KEY;
  return true;
}

export function providerStatus() {
  return {
    gemini: hasKey("gemini"),
    anthropic: hasKey("anthropic"),
    deepgram: !!env.DEEPGRAM_API_KEY,
  };
}

const TIMEOUT_MS = Number(env.MODEL_TIMEOUT_MS || 12000);

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

async function callGemini(system: string, user: string): Promise<ModelResult> {
  const t0 = Date.now();
  const model = MODELS.gemini;
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    },
  );
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return {
    json: parseJson(text),
    provider: "gemini",
    model,
    inputTokens: data?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
    ms: Date.now() - t0,
  };
}

async function callAnthropic(system: string, user: string, opts: CallOptions = {}): Promise<ModelResult> {
  const t0 = Date.now();
  const model = opts.anthropicModel ?? MODELS.anthropic;
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    {
      model,
      // Thinking tokens count toward max_tokens, so leave room for the JSON after them.
      max_tokens: 4000,
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      system: system + "\nRespond with a single JSON object only, no prose.",
      messages: [{ role: "user", content: user }],
    },
  );
  const text = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return {
    json: parseJson(text),
    provider: "anthropic",
    model,
    inputTokens: data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.output_tokens ?? 0,
    ms: Date.now() - t0,
  };
}

const CALLERS: Record<Exclude<Provider, "simulated">, (s: string, u: string, o?: CallOptions) => Promise<ModelResult>> = {
  gemini: callGemini,
  anthropic: callAnthropic,
};

/**
 * Try providers in order; skip ones without a key or that fail.
 * If all fail, run the simulated fallback so the pipeline keeps working.
 */
export async function route(
  order: Exclude<Provider, "simulated">[],
  system: string,
  user: string,
  simulate: () => any,
  opts: CallOptions = {},
): Promise<ModelResult & { fallbackFrom?: string[] }> {
  const failed: string[] = [];
  for (const p of order) {
    if (!hasKey(p)) continue;
    try {
      const r = await CALLERS[p](system, user, opts);
      return failed.length ? { ...r, fallbackFrom: failed } : r;
    } catch (e: any) {
      console.warn(`[model] ${p} failed: ${e?.message ?? e}`);
      failed.push(p);
    }
  }
  const t0 = Date.now();
  const json = simulate();
  const est = (s: string) => Math.ceil(s.length / 4);
  return {
    json,
    provider: "simulated",
    model: "local-rules",
    inputTokens: est(system + user),
    outputTokens: est(JSON.stringify(json)),
    ms: Date.now() - t0,
    fallbackFrom: failed,
  };
}

/** Short-lived Deepgram token so the browser can stream audio without seeing our key. */
export async function deepgramToken(): Promise<string | null> {
  if (!env.DEEPGRAM_API_KEY) return null;
  try {
    const data = await post(
      "https://api.deepgram.com/v1/auth/grant",
      { authorization: `Token ${env.DEEPGRAM_API_KEY}` },
      { ttl_seconds: 600 },
    );
    return data?.access_token ?? null;
  } catch (e: any) {
    console.warn(`[deepgram] token grant failed: ${e?.message ?? e}`);
    return null;
  }
}
