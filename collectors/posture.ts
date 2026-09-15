import type { PostureScores } from "../shared/types";

export async function snapshotPosture(env: Cloudflare.Env, brandId: string): Promise<PostureScores> {
  const scores = await computePosture(env.DB, brandId);
  await env.DB.prepare(
    `INSERT INTO posture_snapshots (
      id, brand_id, captured_at, serp_control, sentiment, share_of_voice,
      ai_accuracy, open_threat_count, time_to_resolution_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      brandId,
      new Date().toISOString(),
      scores.serp_control,
      scores.sentiment,
      scores.share_of_voice,
      scores.ai_accuracy,
      scores.open_threat_count,
      scores.time_to_resolution_hours,
    )
    .run();
  return scores;
}

export async function computePosture(db: D1Database, brandId: string): Promise<PostureScores> {
  const serp = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN owned = 1 OR source_type IN ('owned','wikipedia','linkedin') THEN 1 ELSE 0 END) AS controlled,
         SUM(CASE WHEN owned = 1 THEN 1 ELSE 0 END) AS owned
       FROM serp_results
       WHERE brand_id = ? AND run_id = (
         SELECT id FROM collection_runs WHERE brand_id = ? AND engine IN ('search','full') AND status = 'completed'
         ORDER BY finished_at DESC LIMIT 1
       )`,
    )
    .bind(brandId, brandId)
    .first<{ total: number; controlled: number; owned: number }>();

  const threats = await db
    .prepare(
      `SELECT
         COUNT(*) AS open_count,
         SUM(CASE WHEN threat_bucket IN ('organic_negative','coordinated','impersonation','machine_distortion') AND commercial_proximity >= 0.6 THEN 1 ELSE 0 END) AS negative,
         COUNT(*) AS all_high
       FROM findings
       WHERE brand_id = ? AND status NOT IN ('resolved','accepted_risk') AND risk >= 0.15`,
    )
    .bind(brandId)
    .first<{ open_count: number; negative: number; all_high: number }>();

  const allHigh = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM findings WHERE brand_id = ? AND commercial_proximity >= 0.6`,
    )
    .bind(brandId)
    .first<{ n: number }>();

  const ai = await db
    .prepare(
      `SELECT AVG(accuracy_score) AS avg_acc FROM ai_answers WHERE brand_id = ? AND accuracy_score IS NOT NULL`,
    )
    .bind(brandId)
    .first<{ avg_acc: number | null }>();

  const ttr = await db
    .prepare(
      `SELECT AVG(
         (julianday(closed_at) - julianday(created_at)) * 24
       ) AS hours
       FROM cases
       WHERE brand_id = ? AND closed_at IS NOT NULL`,
    )
    .bind(brandId)
    .first<{ hours: number | null }>();

  const total = Number(serp?.total ?? 0);
  const controlled = Number(serp?.controlled ?? 0);
  const owned = Number(serp?.owned ?? 0);
  const high = Number(allHigh?.n ?? 0);
  const negative = Number(threats?.negative ?? 0);

  return {
    serp_control: total ? controlled / total : null,
    share_of_voice: total ? owned / total : null,
    sentiment: high ? Math.max(0, 1 - negative / high) : null,
    ai_accuracy: ai?.avg_acc ?? null,
    open_threat_count: Number(threats?.open_count ?? 0),
    time_to_resolution_hours: ttr?.hours ?? null,
  };
}

export async function buildAudit(env: Cloudflare.Env, brandId: string) {
  const brand = await env.DB.prepare("SELECT * FROM brands WHERE id = ?").bind(brandId).first();
  const posture = await computePosture(env.DB, brandId);
  const findings = await env.DB.prepare(
    `SELECT id, source_family, source_type, url, title, threat_bucket, risk, status, response_track, serp_position, ai_cited
     FROM findings WHERE brand_id = ? ORDER BY risk DESC LIMIT 40`,
  )
    .bind(brandId)
    .all();
  const answers = await env.DB.prepare(
    `SELECT model, prompt, answer, accuracy_score, citations, captured_at
     FROM ai_answers WHERE brand_id = ? ORDER BY captured_at DESC LIMIT 12`,
  )
    .bind(brandId)
    .all();
  const serp = await env.DB.prepare(
    `SELECT query, position, url, title, source_type, owned
     FROM serp_results WHERE brand_id = ? AND run_id = (
       SELECT id FROM collection_runs
       WHERE brand_id = ? AND engine IN ('search', 'full') AND status = 'completed'
       ORDER BY finished_at DESC LIMIT 1
     ) ORDER BY query, position`,
  )
    .bind(brandId, brandId)
    .all();
  const runs = await env.DB.prepare(
    `SELECT engine, status, coverage, started_at, finished_at FROM collection_runs
     WHERE brand_id = ? ORDER BY created_at DESC LIMIT 8`,
  )
    .bind(brandId)
    .all();

  return {
    generated_at: new Date().toISOString(),
    brand,
    posture,
    findings: findings.results ?? [],
    answers: answers.results ?? [],
    serp: serp.results ?? [],
    runs: runs.results ?? [],
  };
}
