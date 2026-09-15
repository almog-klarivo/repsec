import type { SourceFamily, ThreatBucket } from "../shared/types";
import {
  daysBetween,
  defaultTrack,
  heuristicBucket,
  persistenceFromDays,
  reachFromPosition,
  riskScore,
  slaHoursFor,
  dueAt,
} from "./scoring";

export type BrandRow = {
  id: string;
  organization_id: string;
  name: string;
  legal_name: string | null;
  domains: string;
  aliases: string;
  fact_sheet: string;
};

export type FindingDraft = {
  brandId: string;
  family: SourceFamily;
  sourceType: string;
  url?: string | null;
  title?: string | null;
  excerpt?: string | null;
  position?: number | null;
  proximity: number;
  intent?: string;
  owned?: boolean;
  aiCited?: boolean;
  rawRef?: string | null;
  now: string;
};

export function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function upsertFinding(db: D1Database, draft: FindingDraft): Promise<string> {
  const url = draft.url ?? null;
  const existing = url
    ? await db
        .prepare("SELECT * FROM findings WHERE brand_id = ? AND url = ?")
        .bind(draft.brandId, url)
        .first<Record<string, unknown>>()
    : null;

  const bucket = (existing?.threat_bucket as ThreatBucket | undefined) ??
    heuristicBucket({
      family: draft.family,
      sourceType: draft.sourceType,
      intent: draft.intent,
      title: draft.title ?? undefined,
      excerpt: draft.excerpt ?? undefined,
      owned: draft.owned,
    });

  const firstSeen = (existing?.first_seen as string | undefined) ?? draft.now;
  const days = daysBetween(firstSeen, draft.now);
  const aiCited = Boolean(draft.aiCited) || Boolean(existing?.ai_cited);
  const reach = reachFromPosition(draft.position ?? (existing?.serp_position as number | null), aiCited);
  const persistence = persistenceFromDays(days);
  const proximity = draft.proximity;
  const risk = riskScore(reach, persistence, proximity);
  const confirmed = Number(existing?.classification_confirmed ?? 0);
  const track = (existing?.response_track as string | null) ?? (bucket === "unknown" ? null : defaultTrack(bucket));
  const slaHours = slaHoursFor(bucket, risk);
  const slaDue =
    (existing?.sla_due_at as string | null) ?? (slaHours ? dueAt(draft.now, slaHours) : null);

  if (existing) {
    await db
      .prepare(
        `UPDATE findings SET
          title = COALESCE(?, title),
          excerpt = COALESCE(?, excerpt),
          source_type = ?,
          reach = ?,
          persistence = ?,
          commercial_proximity = ?,
          risk = ?,
          last_seen = ?,
          serp_position = ?,
          ai_cited = ?,
          sla_due_at = ?,
          response_track = COALESCE(response_track, ?),
          raw_ref = COALESCE(?, raw_ref),
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        draft.title ?? null,
        draft.excerpt ?? null,
        draft.sourceType,
        reach,
        persistence,
        proximity,
        risk,
        draft.now,
        draft.position ?? null,
        aiCited ? 1 : 0,
        slaDue,
        track,
        draft.rawRef ?? null,
        draft.now,
        existing.id,
      )
      .run();
    return String(existing.id);
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO findings (
        id, brand_id, source_family, source_type, url, title, excerpt,
        threat_bucket, reach, persistence, commercial_proximity, risk,
        status, response_track, first_seen, last_seen, serp_position, ai_cited,
        sla_due_at, classification_suggested, classification_confirmed,
        assigned_case_id, raw_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      draft.brandId,
      draft.family,
      draft.sourceType,
      url,
      draft.title ?? null,
      draft.excerpt ?? null,
      bucket,
      reach,
      persistence,
      proximity,
      risk,
      track,
      firstSeen,
      draft.now,
      draft.position ?? null,
      aiCited ? 1 : 0,
      slaDue,
      confirmed,
      draft.rawRef ?? null,
      draft.now,
      draft.now,
    )
    .run();
  return id;
}

export async function markCitedUrls(db: D1Database, brandId: string, urls: string[], now: string): Promise<void> {
  for (const url of urls) {
    await db
      .prepare(
        `UPDATE findings SET ai_cited = 1, last_seen = ?, updated_at = ?,
          reach = MIN(1, reach * 1.15),
          risk = MIN(1, reach * persistence * commercial_proximity)
        WHERE brand_id = ? AND url = ?`,
      )
      .bind(now, now, brandId, url)
      .run();
  }
}

export async function logActivity(
  db: D1Database,
  entry: {
    organizationId?: string | null;
    brandId?: string | null;
    actorId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    detail?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO activity_log (id, organization_id, brand_id, actor_id, entity_type, entity_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      entry.organizationId ?? null,
      entry.brandId ?? null,
      entry.actorId ?? null,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.detail ?? null,
      new Date().toISOString(),
    )
    .run();
}
