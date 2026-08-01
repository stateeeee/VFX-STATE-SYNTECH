/*
 * The AI provider behind the five /api/gemini/* endpoints.
 *
 * Three states, decided by which key is in .env.local — nothing else:
 *
 *   GROQ_API_KEY set    → Groq. Free tier, no credit card, and the model is a
 *                         Llama 3.3 70B — far better at returning STRICT JSON
 *                         than a small flash model, which is what the optimizer
 *                         and the agent actually need.
 *   GEMINI_API_KEY set  → Gemini, as before.
 *   neither             → generate() throws immediately, every endpoint falls
 *                         through to its own offline answer, and the app works.
 *                         No key is required for anything that is not AI.
 *
 * Groq speaks the OpenAI wire format, so this is one fetch. Both branches take
 * the same request shape and return plain text, so the endpoints do not care
 * which one answered.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/* Two tiers, because the endpoints ask for two different things: a cheap fast
   model for chat/critique, a stronger one for the JSON-producing agent. On Groq
   both default to the same 70B — it is free and it is the good one — but each
   is overridable, so a rejected model id is a .env edit and not a code change. */
export type Tier = "fast" | "pro";

const MODELS = {
  groq: {
    fast: process.env.GROQ_MODEL_FAST || "llama-3.3-70b-versatile",
    pro: process.env.GROQ_MODEL_PRO || "llama-3.3-70b-versatile",
  },
  gemini: {
    fast: process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash",
    pro: process.env.GEMINI_MODEL_PRO || "gemini-3.1-pro-preview",
  },
} as const;

export type Provider = "groq" | "gemini" | "none";

export function activeProvider(): Provider {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "none";
}

export interface Turn { role: "user" | "model"; text: string }

export interface GenRequest {
  tier: Tier;
  systemInstruction: string;
  /** The conversation. A single user turn is the common case. */
  contents: Turn[];
  temperature?: number;
  /** Ask for a raw JSON object back — the agent and the optimizer need this. */
  json?: boolean;
}

/** What the caller gets. `text` is never null; a provider that says nothing throws. */
export interface GenResult { text: string; provider: Provider; model: string }

/* The Gemini client is created lazily and only once: constructing it with no key
   is legal but pointless, and doing it at import time is what produced the two
   "API key should be set when using the Gemini API" lines on every boot. */
let geminiClient: any = null;
async function gemini(req: GenRequest): Promise<GenResult> {
  if (!geminiClient) {
    const { GoogleGenAI } = await import("@google/genai");
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }
  const model = MODELS.gemini[req.tier];
  const response = await geminiClient.models.generateContent({
    model,
    contents: req.contents.map((t) => ({
      role: t.role === "user" ? "user" : "model",
      parts: [{ text: t.text }],
    })),
    config: {
      systemInstruction: req.systemInstruction,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  });
  const text = response.text?.trim();
  if (!text) throw new Error("gemini returned no text");
  return { text, provider: "gemini", model };
}

async function groq(req: GenRequest): Promise<GenResult> {
  const model = MODELS.groq[req.tier];
  const messages = [
    { role: "system", content: req.systemInstruction },
    ...req.contents.map((t) => ({
      role: t.role === "user" ? "user" : "assistant",
      content: t.text,
    })),
  ];
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      /* json_object mode needs the word "JSON" somewhere in the prompt or Groq
         rejects the request outright. Every caller that sets json:true already
         says it, but belt and braces — a 400 here would look like a dead key. */
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) {
    /* Carry the body into the error: Groq explains itself well (unknown model,
       rate limit, revoked key) and that message is the difference between a
       five-second fix and an afternoon. It reaches the server log, never the UI. */
    throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  const data: any = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("groq returned no text");
  return { text, provider: "groq", model };
}

/**
 * Ask the active provider. Throws when there is no key, when the provider says
 * no, and when it answers with nothing — every caller already catches and has
 * its own offline answer ready, so throwing IS the fallback path.
 */
export async function generate(req: GenRequest): Promise<GenResult> {
  const p = activeProvider();
  if (p === "none") throw new Error("no AI provider configured (set GROQ_API_KEY or GEMINI_API_KEY)");
  try {
    return p === "groq" ? await groq(req) : await gemini(req);
  } catch (err: any) {
    /* Log it HERE, once, for every endpoint. The callers all swallow their error
       and answer from their offline archive — which is the right behaviour for
       the user and a terrible one for whoever is debugging: a wrong key and a
       rejected model id both look exactly like "the AI is being poetic today".
       This line is the difference. It never reaches the browser. */
    console.warn(`[ai:${p}] ${err?.message || err}`);
    throw err;
  }
}

/** One honest line at boot, in place of a library warning nobody could act on. */
export function describeProvider(): string {
  const p = activeProvider();
  if (p === "none") {
    return "AI provider: none — offline fallbacks active. Set GROQ_API_KEY (free, console.groq.com) or GEMINI_API_KEY in .env.local to switch it on.";
  }
  return `AI provider: ${p} (fast=${MODELS[p].fast}, pro=${MODELS[p].pro})`;
}

/** Strip the ```json fences a model may wrap its answer in, then parse. */
export function parseJson<T = any>(text: string): T {
  return JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
}
