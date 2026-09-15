import type { Citation } from "../shared/types";
import { markCitedUrls, upsertFinding, type BrandRow } from "./findings";
import { putSnapshot } from "./http";
import { INTENT_PROXIMITY } from "./scoring";

type PromptRow = {
  id: string;
  prompt: string;
  intent: string;
};

type ProbeResult = {
  model: string;
  answer: string;
  citations: Citation[];
};

export async function runAiProbe(
  env: Cloudflare.Env,
  brand: BrandRow,
  runId: string,
): Promise<{ answers: number; citations: number }> {
  const prompts = await env.DB.prepare(
    "SELECT id, prompt, intent FROM prompts WHERE brand_id = ? AND active = 1",
  )
    .bind(brand.id)
    .all<PromptRow>();

  const now = new Date().toISOString();
  let answers = 0;
  let citationCount = 0;
  const cited: string[] = [];

  for (const prompt of prompts.results ?? []) {
    const results = await probeModels(env, prompt.prompt, brand.fact_sheet);
    for (const result of results) {
      answers += 1;
      const accuracy = scoreAccuracy(result.answer, brand.fact_sheet);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO ai_answers (
          id, brand_id, run_id, prompt_id, prompt, model, answer, citations,
          accuracy_score, accuracy_notes, flagged_claims, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          brand.id,
          runId,
          prompt.id,
          prompt.prompt,
          result.model,
          result.answer,
          JSON.stringify(result.citations),
          accuracy.score,
          accuracy.notes,
          JSON.stringify(accuracy.flags),
          now,
        )
        .run();

      const snapshotKey = `ai/${brand.id}/${runId}/${id}.json`;
      await putSnapshot(env, snapshotKey, JSON.stringify({ ...result, prompt, accuracy }));

      await upsertFinding(env.DB, {
        brandId: brand.id,
        family: "ai",
        sourceType: modelSource(result.model),
        url: `repsec://ai/${result.model}/${prompt.id}`,
        title: `${result.model} — ${prompt.prompt.slice(0, 80)}`,
        excerpt: result.answer.slice(0, 400),
        position: null,
        proximity: INTENT_PROXIMITY[(prompt.intent as keyof typeof INTENT_PROXIMITY) ?? "branded"] ?? 0.6,
        intent: prompt.intent,
        rawRef: id,
        now,
      });

      for (const citation of result.citations) {
        if (!citation.url) continue;
        citationCount += 1;
        cited.push(citation.url);
        await upsertFinding(env.DB, {
          brandId: brand.id,
          family: "search",
          sourceType: "other",
          url: citation.url,
          title: citation.title ?? citation.url,
          excerpt: `Cited by ${result.model} for: ${prompt.prompt}`,
          position: null,
          proximity: 0.85,
          intent: prompt.intent,
          aiCited: true,
          rawRef: id,
          now,
        });
      }
    }
  }

  await markCitedUrls(env.DB, brand.id, [...new Set(cited)], now);
  return { answers, citations: citationCount };
}

async function probeModels(env: Cloudflare.Env, prompt: string, factSheet: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const jobs: Array<Promise<ProbeResult | null>> = [
    probeOpenAi(env, prompt),
    probeGemini(env, prompt),
    probePerplexity(env, prompt),
    probeWorkersAi(env, prompt, factSheet),
  ];
  const settled = await Promise.all(jobs);
  for (const item of settled) {
    if (item) results.push(item);
  }
  if (results.length === 0) {
    results.push({
      model: "unavailable",
      answer:
        "No model providers were configured. Set OPENAI_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY, or enable Workers AI.",
      citations: [],
    });
  }
  return results;
}

async function probeOpenAi(env: Cloudflare.Env, prompt: string): Promise<ProbeResult | null> {
  if (!env.OPENAI_API_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Answer as a buyer-research assistant. If you rely on sources, list them as a final JSON array of {url,title} after a ---CITATIONS--- marker.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return splitAnswer("chatgpt", data.choices?.[0]?.message?.content ?? "");
}

async function probeGemini(env: Cloudflare.Env, prompt: string): Promise<ProbeResult | null> {
  if (!env.GEMINI_API_KEY) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\nList sources as ---CITATIONS--- [{url,title}]` }] }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return splitAnswer("gemini", data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

async function probePerplexity(env: Cloudflare.Env, prompt: string): Promise<ProbeResult | null> {
  if (!env.PERPLEXITY_API_KEY) return null;
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };
  const answer = data.choices?.[0]?.message?.content ?? "";
  const citations = (data.citations ?? []).map((url) => ({ url }));
  return { model: "perplexity", answer, citations };
}

async function probeWorkersAi(
  env: Cloudflare.Env,
  prompt: string,
  factSheet: string,
): Promise<ProbeResult | null> {
  if (!env.AI) return null;
  try {
    const result = (await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content:
            "You are answering a buyer research question. Be specific. If you are unsure, say so.",
        },
        {
          role: "user",
          content: `${prompt}\n\nKnown brand facts (may be incomplete):\n${factSheet || "(none)"}`,
        },
      ],
      max_tokens: 400,
    })) as { response?: string };
    const answer = result.response ?? JSON.stringify(result);
    if (!answer) return null;
    return { model: "workers_ai", answer, citations: [] };
  } catch (error) {
    return {
      model: "workers_ai",
      answer: `Workers AI error: ${error instanceof Error ? error.message : String(error)}`,
      citations: [],
    };
  }
}

function splitAnswer(model: string, text: string): ProbeResult {
  const [answer, rest] = text.split("---CITATIONS---");
  let citations: Citation[] = [];
  if (rest) {
    try {
      const parsed = JSON.parse(rest.trim()) as Citation[];
      if (Array.isArray(parsed)) citations = parsed.filter((c) => c.url);
    } catch {
      citations = [];
    }
  }
  return { model, answer: (answer ?? text).trim(), citations };
}

function scoreAccuracy(answer: string, factSheet: string): { score: number; notes: string; flags: string[] } {
  if (!factSheet.trim()) {
    return { score: 0.5, notes: "No fact sheet on file; accuracy is unanchored.", flags: [] };
  }
  const flags: string[] = [];
  const lower = answer.toLowerCase();
  if (/\b(scam|fraud|ponzi|untrustworthy)\b/i.test(answer)) flags.push("trust_attack");
  if (/\b(shutdown|bankrupt|out of business)\b/i.test(answer)) flags.push("status_false");
  const tokens = factSheet
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 4)
    .slice(0, 24);
  const hits = tokens.filter((t) => lower.includes(t)).length;
  const overlap = tokens.length ? hits / tokens.length : 0.5;
  const penalty = flags.length * 0.25;
  const score = Math.max(0, Math.min(1, overlap - penalty + 0.2));
  return {
    score: Math.round(score * 100) / 100,
    notes: flags.length ? `Flagged: ${flags.join(", ")}` : `Fact overlap ${Math.round(overlap * 100)}%`,
    flags,
  };
}

function modelSource(model: string): string {
  if (model.includes("gpt") || model === "chatgpt") return "chatgpt";
  if (model.includes("gemini")) return "gemini";
  if (model.includes("perplexity")) return "perplexity";
  if (model.includes("workers")) return "workers_ai";
  return "other";
}
