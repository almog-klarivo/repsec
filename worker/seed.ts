import { INTENT_PROXIMITY } from "../collectors/scoring";
import type { QueryIntent } from "../shared/types";

const ORG_ID = "org_repsec";
const NOW = "2026-09-15T00:00:00.000Z";

type BrandSeed = {
  id: string;
  name: string;
  legalName: string;
  domains: string[];
  aliases: string[];
  competitors: string[];
  products: string[];
  factSheet: string;
};

const BRANDS: BrandSeed[] = [
  {
    id: "brand_repsec",
    name: "RepSec",
    legalName: "RepSec — Reputation Security",
    domains: ["repsec.ai"],
    aliases: ["RepSec", "Reputation Security"],
    competitors: ["BrandYourself", "ReputationDefender", "Podium"],
    products: ["Baseline audit", "Continuous monitoring", "Response ops"],
    factSheet:
      "RepSec is a reputation security firm. It treats branded SERP, review sites, social, and AI answers as an unowned perimeter. It classifies threats into impersonation, organic negative content, coordinated attack, and machine-layer distortion, then responds with remove, displace, and occupy. It is not an ORM marketing vendor. The loss event is fraud, diligence failure, or an AI telling buyers the company cannot be trusted.",
  },
  {
    id: "brand_klarivo",
    name: "Klarivo",
    legalName: "Klarivo",
    domains: ["klarivo.ai"],
    aliases: ["Klarivo"],
    competitors: [],
    products: [],
    factSheet:
      "Klarivo is an operating company at klarivo.ai. This is a dogfood brand used to exercise RepSec collection across search, AI answers, and impersonation surfaces.",
  },
];

export async function ensureSeed(env: Cloudflare.Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM organizations WHERE id = ?")
    .bind(ORG_ID)
    .first();
  if (existing) {
    await refreshQuotedQueries(env);
    return;
  }

  await env.DB.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)")
    .bind(ORG_ID, "RepSec", NOW)
    .run();

  for (const brand of BRANDS) {
    await env.DB.prepare(
      `INSERT INTO brands (
        id, organization_id, name, legal_name, domains, aliases, marks, executives,
        products, competitors, locales, fact_sheet, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, '["en-US"]', ?, ?)`,
    )
      .bind(
        brand.id,
        ORG_ID,
        brand.name,
        brand.legalName,
        JSON.stringify(brand.domains),
        JSON.stringify(brand.aliases),
        JSON.stringify(brand.products),
        JSON.stringify(brand.competitors),
        brand.factSheet,
        NOW,
      )
      .run();

    for (const query of queryBattery(brand)) {
      await env.DB.prepare(
        `INSERT INTO queries (id, brand_id, query, intent, proximity_weight, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
        .bind(crypto.randomUUID(), brand.id, query.query, query.intent, query.weight)
        .run();
    }

    for (const prompt of promptBattery(brand)) {
      await env.DB.prepare(
        `INSERT INTO prompts (id, brand_id, prompt, intent, active) VALUES (?, ?, ?, ?, 1)`,
      )
        .bind(crypto.randomUUID(), brand.id, prompt.prompt, prompt.intent)
        .run();
    }
  }
}

function queryBattery(brand: BrandSeed): Array<{ query: string; intent: QueryIntent; weight: number }> {
  const name = brand.name;
  const competitor = brand.competitors[0];
  const rows: Array<{ query: string; intent: QueryIntent; weight: number }> = [
    { query: `"${name}"`, intent: "branded", weight: INTENT_PROXIMITY.branded },
    { query: `"${name}" login`, intent: "login", weight: INTENT_PROXIMITY.login },
    { query: `"${name}" support`, intent: "support", weight: INTENT_PROXIMITY.support },
    { query: `"${name}" review`, intent: "review", weight: INTENT_PROXIMITY.review },
    { query: `"${name}" scam`, intent: "scam", weight: INTENT_PROXIMITY.scam },
    { query: `"${name}" alternatives`, intent: "alternatives", weight: INTENT_PROXIMITY.alternatives },
    { query: `site:reddit.com "${name}"`, intent: "review", weight: 0.7 },
    { query: `site:g2.com "${name}"`, intent: "review", weight: 0.75 },
    { query: `site:trustpilot.com "${name}"`, intent: "review", weight: 0.75 },
    { query: `site:news "${name}"`, intent: "branded", weight: 0.55 },
  ];
  if (competitor) {
    rows.push({
      query: `${name} vs ${competitor}`,
      intent: "vs",
      weight: INTENT_PROXIMITY.vs,
    });
  }
  return rows;
}

function promptBattery(brand: BrandSeed): Array<{ prompt: string; intent: QueryIntent }> {
  return [
    { prompt: `What is ${brand.name}? Is it a legitimate company?`, intent: "branded" },
    { prompt: `Is ${brand.name} safe to buy from? Any scams or complaints?`, intent: "scam" },
    { prompt: `What do customers say about ${brand.name}? Summarize reviews.`, intent: "review" },
    {
      prompt: `Compare ${brand.name} with alternatives. Who should a buyer choose?`,
      intent: "alternatives",
    },
  ];
}

async function refreshQuotedQueries(env: Cloudflare.Env): Promise<void> {
  const sample = await env.DB.prepare(
    `SELECT query FROM queries WHERE brand_id = 'brand_repsec' LIMIT 1`,
  ).first<{ query: string }>();
  if (!sample || sample.query.startsWith('"')) return;
  await env.DB.prepare("DELETE FROM queries WHERE brand_id IN ('brand_repsec', 'brand_klarivo')").run();
  for (const brand of BRANDS) {
    for (const query of queryBattery(brand)) {
      await env.DB.prepare(
        `INSERT INTO queries (id, brand_id, query, intent, proximity_weight, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
        .bind(crypto.randomUUID(), brand.id, query.query, query.intent, query.weight)
        .run();
    }
  }
}

export function operatorEmails(env: Cloudflare.Env): string[] {
  return (env.ALLOWED_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
