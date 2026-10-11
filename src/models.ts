// Model providers. Each call returns parsed JSON plus token usage, and is priced by the ledger.
// If a provider's key is missing, the router falls back to the next provider for that role,
// and finally to a local "simulated" mode so the demo always runs end to end.

export type Provider = "gemini" | "deepseek" | "anthropic" | "simulated";

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
  gemini: env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  deepseek: env.DEEPSEEK_MODEL || "deepseek-chat",
  anthropic: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
};

// USD per million tokens [input, output]
export const PRICES: Record<string, [number, number]> = {
  gemini: [0.1, 0.4],
  deepseek: [0.14, 0.28],
  anthropic: [3, 15],
  simulated: [0, 0],
};

export function hasKey(p: Provider): boolean {
  if (p === "gemini") return !!env.GEMINI_API_KEY;
  if (p === "deepseek") return !!env.DEEPSEEK_API_KEY;
  if (p === "anthropic") return !!env.ANTHROPIC_API_KEY;
  return true;
}

export function providerStatus() {
  return {
    gemini: hasKey("gemini"),
    deepseek: hasKey("deepseek"),
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

async function callDeepSeek(system: string, user: string): Promise<ModelResult> {
  const t0 = Date.now();
  const model = MODELS.deepseek;
  const data = await post(
    "https://api.deepseek.com/chat/completions",
    { authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    {
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  );
  return {
    json: parseJson(data?.choices?.[0]?.message?.content ?? ""),
    provider: "deepseek",
    model,
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
    ms: Date.now() - t0,
  };
}

async function callAnthropic(system: string, user: string): Promise<ModelResult> {
  const t0 = Date.now();
  const model = MODELS.anthropic;
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    {
      model,
      max_tokens: 1500,
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

const CALLERS: Record<Exclude<Provider, "simulated">, (s: string, u: string) => Promise<ModelResult>> = {
  gemini: callGemini,
  deepseek: callDeepSeek,
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
): Promise<ModelResult & { fallbackFrom?: string[] }> {
  const failed: string[] = [];
  for (const p of order) {
    if (!hasKey(p)) continue;
    try {
      const r = await CALLERS[p](system, user);
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
