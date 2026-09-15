import { defaultTrack, heuristicBucket, slaHoursFor, dueAt } from "./scoring";
import type { ThreatBucket } from "../shared/types";

type FindingRow = {
  id: string;
  source_family: string;
  source_type: string;
  title: string | null;
  excerpt: string | null;
  threat_bucket: ThreatBucket;
  risk: number;
  classification_confirmed: number;
};

export async function runClassify(env: Cloudflare.Env, brandId: string): Promise<{ suggested: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, source_family, source_type, title, excerpt, threat_bucket, risk, classification_confirmed
     FROM findings WHERE brand_id = ? AND classification_confirmed = 0`,
  )
    .bind(brandId)
    .all<FindingRow>();

  let suggested = 0;
  for (const finding of rows.results ?? []) {
    const heuristic = heuristicBucket({
      family: finding.source_family,
      sourceType: finding.source_type,
      title: finding.title ?? undefined,
      excerpt: finding.excerpt ?? undefined,
    });
    const llm = await suggestWithModel(env, finding);
    const bucket = llm?.bucket ?? heuristic;
    const payload = {
      heuristic,
      llm,
      at: new Date().toISOString(),
    };
    const track = defaultTrack(bucket);
    const hours = slaHoursFor(bucket, finding.risk);
    const sla = hours ? dueAt(new Date().toISOString(), hours) : null;
    await env.DB.prepare(
      `UPDATE findings SET
        classification_suggested = ?,
        threat_bucket = CASE WHEN classification_confirmed = 1 THEN threat_bucket ELSE ? END,
        response_track = COALESCE(response_track, ?),
        sla_due_at = COALESCE(sla_due_at, ?),
        updated_at = ?
      WHERE id = ?`,
    )
      .bind(JSON.stringify(payload), bucket, track, sla, new Date().toISOString(), finding.id)
      .run();
    suggested += 1;
  }
  return { suggested };
}

async function suggestWithModel(
  env: Cloudflare.Env,
  finding: FindingRow,
): Promise<{ bucket: ThreatBucket; reason: string } | null> {
  if (!env.AI) return null;
  try {
    const result = (await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content:
            'Classify a reputation finding. Reply with JSON only: {"bucket":"impersonation|organic_negative|coordinated|machine_distortion|benign|unknown","reason":"..."}.',
        },
        {
          role: "user",
          content: `family=${finding.source_family} type=${finding.source_type}\ntitle=${finding.title}\nexcerpt=${finding.excerpt}`,
        },
      ],
    })) as { response?: string };
    const text = result.response ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { bucket?: ThreatBucket; reason?: string };
    if (!parsed.bucket) return null;
    return { bucket: parsed.bucket, reason: parsed.reason ?? "" };
  } catch {
    return null;
  }
}
