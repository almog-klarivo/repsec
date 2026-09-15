import { runSearch } from "./search";
import { runAiProbe } from "./ai";
import { runImpersonation } from "./impersonation";
import { runClassify } from "./classify";
import { snapshotPosture } from "./posture";
import { logActivity, type BrandRow } from "./findings";
import type { Engine } from "../shared/types";

export async function runEngine(env: Cloudflare.Env, brandId: string, engine: Engine, runId?: string) {
  const id = runId ?? crypto.randomUUID();
  const brand = await env.DB.prepare("SELECT * FROM brands WHERE id = ?").bind(brandId).first<BrandRow>();
  if (!brand) throw new Error(`Unknown brand ${brandId}`);

  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM collection_runs WHERE id = ?").bind(id).first();
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO collection_runs (id, brand_id, engine, status, created_at, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    )
      .bind(id, brandId, engine, now, now)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE collection_runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?",
    )
      .bind(now, id)
      .run();
  }

  const coverage: Record<string, unknown> = {};
  try {
    if (engine === "search" || engine === "full") coverage.search = await runSearch(env, brand, id);
    if (engine === "ai" || engine === "full") coverage.ai = await runAiProbe(env, brand, id);
    if (engine === "impersonation" || engine === "full") {
      coverage.impersonation = await runImpersonation(env, brand, id);
    }
    if (engine === "classify" || engine === "full") coverage.classify = await runClassify(env, brandId);
    if (engine === "classify" || engine === "full") coverage.posture = await snapshotPosture(env, brandId);

    await env.DB.prepare(
      `UPDATE collection_runs SET status = 'completed', coverage = ?, finished_at = ?, error = NULL WHERE id = ?`,
    )
      .bind(JSON.stringify(coverage), new Date().toISOString(), id)
      .run();
    await logActivity(env.DB, {
      organizationId: brand.organization_id,
      brandId,
      entityType: "run",
      entityId: id,
      action: "completed",
      detail: JSON.stringify({ engine, coverage }),
    });
    return { runId: id, coverage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE collection_runs SET status = 'failed', error = ?, finished_at = ?, coverage = ? WHERE id = ?`,
    )
      .bind(message, new Date().toISOString(), JSON.stringify(coverage), id)
      .run();
    await logActivity(env.DB, {
      organizationId: brand.organization_id,
      brandId,
      entityType: "run",
      entityId: id,
      action: "failed",
      detail: message,
    });
    throw error;
  }
}
