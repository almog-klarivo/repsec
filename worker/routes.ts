import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ensureSeed } from "./seed";
import {
  appPath,
  clearSession,
  consumeMagicLink,
  createSession,
  readSession,
  requestMagicLink,
  type AppEnv,
  type AuthedUser,
} from "./auth";
import type { Context, Next } from "hono";
import { runEngine } from "../collectors/run";
import { buildAudit, computePosture } from "../collectors/posture";
import { logActivity, upsertFinding } from "../collectors/findings";
import { playbookFor } from "../collectors/playbooks";
import { defaultTrack, riskScore } from "../collectors/scoring";
import type { Engine, ResponseTrack, ThreatBucket } from "../shared/types";

export const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  await ensureSeed(c.env);
  await next();
});

api.post("/public/audit-request", async (c) => {
  const body = await c.req.json<{ email?: string; brand_name?: string; domain?: string; note?: string }>();
  if (!body.email) throw new HTTPException(400, { message: "email required" });
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO audit_requests (id, email, brand_name, domain, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'new', ?)`,
  )
    .bind(id, body.email, body.brand_name ?? null, body.domain ?? null, body.note ?? null, new Date().toISOString())
    .run();
  return c.json({ id, ok: true });
});

api.post("/auth/request", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  if (!body.email) throw new HTTPException(400, { message: "email required" });
  const result = await requestMagicLink(c.env, body.email, c.req.url);
  return c.json(result);
});

api.get("/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) throw new HTTPException(400, { message: "token required" });
  const user = await consumeMagicLink(c.env, token);
  await createSession(c, user);
  return c.redirect(appPath(c.req.url, "/"));
});

api.get("/auth/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user });
});

api.post("/auth/logout", async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

api.use("/brands/*", requireUser);
api.use("/ops/*", requireOperator);

api.get("/brands", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare("SELECT * FROM brands WHERE organization_id = ? ORDER BY name")
    .bind(user.organizationId)
    .all();
  return c.json({ brands: rows.results ?? [] });
});

api.get("/brands/:id", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const queries = await c.env.DB.prepare("SELECT * FROM queries WHERE brand_id = ?").bind(brand.id).all();
  const prompts = await c.env.DB.prepare("SELECT * FROM prompts WHERE brand_id = ?").bind(brand.id).all();
  return c.json({ brand, queries: queries.results ?? [], prompts: prompts.results ?? [] });
});

api.get("/brands/:id/posture", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const current = await computePosture(c.env.DB, brand.id);
  const history = await c.env.DB.prepare(
    "SELECT * FROM posture_snapshots WHERE brand_id = ? ORDER BY captured_at DESC LIMIT 30",
  )
    .bind(brand.id)
    .all();
  return c.json({ current, history: history.results ?? [] });
});

api.get("/brands/:id/findings", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const status = c.req.query("status");
  const bucket = c.req.query("bucket");
  let sql = "SELECT * FROM findings WHERE brand_id = ?";
  const binds: Array<string> = [brand.id];
  if (status) {
    sql += " AND status = ?";
    binds.push(status);
  }
  if (bucket) {
    sql += " AND threat_bucket = ?";
    binds.push(bucket);
  }
  sql += " ORDER BY risk DESC, last_seen DESC LIMIT 200";
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json({ findings: rows.results ?? [] });
});

api.get("/brands/:id/serp", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM serp_results WHERE brand_id = ? AND run_id = (
       SELECT id FROM collection_runs WHERE brand_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1
     ) ORDER BY query, position`,
  )
    .bind(brand.id, brand.id)
    .all();
  return c.json({ results: rows.results ?? [] });
});

api.get("/brands/:id/answers", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM ai_answers WHERE brand_id = ? ORDER BY captured_at DESC LIMIT 50",
  )
    .bind(brand.id)
    .all();
  return c.json({ answers: rows.results ?? [] });
});

api.get("/brands/:id/activity", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM activity_log WHERE brand_id = ? ORDER BY created_at DESC LIMIT 80",
  )
    .bind(brand.id)
    .all();
  return c.json({ activity: rows.results ?? [] });
});

api.get("/brands/:id/audit", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  return c.json(await buildAudit(c.env, brand.id));
});

api.get("/brands/:id/cases", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM cases WHERE brand_id = ? ORDER BY created_at DESC",
  )
    .bind(brand.id)
    .all();
  return c.json({ cases: rows.results ?? [] });
});

api.post("/ops/brands/:id/run", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const body = await c.req.json<{ engine?: Engine }>().catch(() => ({ engine: "full" as Engine }));
  const engine = body.engine ?? "full";
  const runId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO collection_runs (id, brand_id, engine, status, created_at) VALUES (?, ?, ?, 'queued', ?)`,
  )
    .bind(runId, brand.id, engine, new Date().toISOString())
    .run();

  try {
    if (engine === "full" && c.env.BRAND_RUN) {
      await c.env.BRAND_RUN.create({ params: { brandId: brand.id, runId } });
    } else {
      c.executionCtx.waitUntil(runEngine(c.env, brand.id, engine, runId));
    }
  } catch {
    c.executionCtx.waitUntil(runEngine(c.env, brand.id, engine, runId));
  }

  await logActivity(c.env.DB, {
    organizationId: brand.organization_id,
    brandId: brand.id,
    actorId: c.get("user").id,
    entityType: "run",
    entityId: runId,
    action: "queued",
    detail: engine,
  });
  return c.json({ runId, status: "queued" });
});

api.get("/ops/runs", async (c) => {
  const brandId = c.req.query("brand_id");
  const sql = brandId
    ? "SELECT * FROM collection_runs WHERE brand_id = ? ORDER BY created_at DESC LIMIT 40"
    : "SELECT * FROM collection_runs ORDER BY created_at DESC LIMIT 40";
  const rows = brandId ? await c.env.DB.prepare(sql).bind(brandId).all() : await c.env.DB.prepare(sql).all();
  return c.json({ runs: rows.results ?? [] });
});

api.get("/ops/inbox", async (c) => {
  const brandId = c.req.query("brand_id");
  const sql = brandId
    ? `SELECT * FROM findings WHERE brand_id = ? AND classification_confirmed = 0 ORDER BY risk DESC LIMIT 100`
    : `SELECT * FROM findings WHERE classification_confirmed = 0 ORDER BY risk DESC LIMIT 100`;
  const rows = brandId ? await c.env.DB.prepare(sql).bind(brandId).all() : await c.env.DB.prepare(sql).all();
  return c.json({ findings: rows.results ?? [] });
});

api.get("/ops/findings/:id", async (c) => {
  const finding = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!finding) throw new HTTPException(404, { message: "not found" });
  return c.json({ finding });
});

api.patch("/ops/findings/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    threat_bucket?: ThreatBucket;
    status?: string;
    response_track?: ResponseTrack | null;
    reach?: number;
    persistence?: number;
    commercial_proximity?: number;
    sla_due_at?: string | null;
  }>();
  const existing = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?").bind(id).first<{
    reach: number;
    persistence: number;
    commercial_proximity: number;
    brand_id: string;
  }>();
  if (!existing) throw new HTTPException(404, { message: "not found" });
  const reach = body.reach ?? existing.reach;
  const persistence = body.persistence ?? existing.persistence;
  const proximity = body.commercial_proximity ?? existing.commercial_proximity;
  const risk = riskScore(reach, persistence, proximity);
  await c.env.DB.prepare(
    `UPDATE findings SET
      threat_bucket = COALESCE(?, threat_bucket),
      status = COALESCE(?, status),
      response_track = COALESCE(?, response_track),
      reach = ?, persistence = ?, commercial_proximity = ?, risk = ?,
      sla_due_at = COALESCE(?, sla_due_at),
      updated_at = ?
    WHERE id = ?`,
  )
    .bind(
      body.threat_bucket ?? null,
      body.status ?? null,
      body.response_track ?? null,
      reach,
      persistence,
      proximity,
      risk,
      body.sla_due_at ?? null,
      new Date().toISOString(),
      id,
    )
    .run();
  await logActivity(c.env.DB, {
    brandId: existing.brand_id,
    actorId: c.get("user").id,
    entityType: "finding",
    entityId: id,
    action: "updated",
    detail: JSON.stringify(body),
  });
  const finding = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?").bind(id).first();
  return c.json({ finding });
});

api.post("/ops/findings/:id/classify", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    threat_bucket: ThreatBucket;
    response_track?: ResponseTrack;
    status?: string;
  }>();
  const existing = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?").bind(id).first<{
    brand_id: string;
  }>();
  if (!existing) throw new HTTPException(404, { message: "not found" });
  const track = body.response_track ?? defaultTrack(body.threat_bucket);
  await c.env.DB.prepare(
    `UPDATE findings SET
      threat_bucket = ?,
      response_track = ?,
      status = COALESCE(?, 'triaged'),
      classification_confirmed = 1,
      updated_at = ?
    WHERE id = ?`,
  )
    .bind(body.threat_bucket, track, body.status ?? null, new Date().toISOString(), id)
    .run();
  await logActivity(c.env.DB, {
    brandId: existing.brand_id,
    actorId: c.get("user").id,
    entityType: "finding",
    entityId: id,
    action: "classified",
    detail: JSON.stringify(body),
  });
  const finding = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?").bind(id).first();
  return c.json({ finding });
});

api.post("/ops/findings/manual", async (c) => {
  const body = await c.req.json<{
    brand_id: string;
    url: string;
    title?: string;
    excerpt?: string;
    source_type?: string;
  }>();
  if (!body.brand_id || !body.url) throw new HTTPException(400, { message: "brand_id and url required" });
  const id = await upsertFinding(c.env.DB, {
    brandId: body.brand_id,
    family: "manual",
    sourceType: body.source_type ?? "other",
    url: body.url,
    title: body.title ?? body.url,
    excerpt: body.excerpt ?? "Manual intake",
    proximity: 0.7,
    now: new Date().toISOString(),
  });
  await logActivity(c.env.DB, {
    brandId: body.brand_id,
    actorId: c.get("user").id,
    entityType: "finding",
    entityId: id,
    action: "manual_intake",
    detail: body.url,
  });
  const finding = await c.env.DB.prepare("SELECT * FROM findings WHERE id = ?").bind(id).first();
  return c.json({ finding });
});

api.get("/ops/cases", async (c) => {
  const brandId = c.req.query("brand_id");
  const sql = brandId
    ? "SELECT * FROM cases WHERE brand_id = ? ORDER BY created_at DESC"
    : "SELECT * FROM cases ORDER BY created_at DESC LIMIT 100";
  const rows = brandId ? await c.env.DB.prepare(sql).bind(brandId).all() : await c.env.DB.prepare(sql).all();
  return c.json({ cases: rows.results ?? [] });
});

api.post("/ops/cases", async (c) => {
  const body = await c.req.json<{
    brand_id: string;
    title: string;
    track: ResponseTrack;
    finding_ids?: string[];
    sla_due_at?: string;
  }>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO cases (id, brand_id, title, track, playbook, status, assignee_id, sla_due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.brand_id,
      body.title,
      body.track,
      JSON.stringify(playbookFor(body.track)),
      c.get("user").id,
      body.sla_due_at ?? null,
      now,
      now,
    )
    .run();
  for (const findingId of body.finding_ids ?? []) {
    await c.env.DB.prepare("INSERT OR IGNORE INTO case_findings (case_id, finding_id) VALUES (?, ?)")
      .bind(id, findingId)
      .run();
    await c.env.DB.prepare(
      "UPDATE findings SET assigned_case_id = ?, status = 'in_response', updated_at = ? WHERE id = ?",
    )
      .bind(id, now, findingId)
      .run();
  }
  await logActivity(c.env.DB, {
    brandId: body.brand_id,
    actorId: c.get("user").id,
    entityType: "case",
    entityId: id,
    action: "created",
    detail: body.title,
  });
  const created = await c.env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  return c.json({ case: created });
});

api.get("/ops/cases/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(c.req.param("id")).first();
  if (!row) throw new HTTPException(404, { message: "not found" });
  const findings = await c.env.DB.prepare(
    `SELECT f.* FROM findings f JOIN case_findings cf ON cf.finding_id = f.id WHERE cf.case_id = ?`,
  )
    .bind(c.req.param("id"))
    .all();
  const activity = await c.env.DB.prepare(
    "SELECT * FROM activity_log WHERE entity_type = 'case' AND entity_id = ? ORDER BY created_at DESC",
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ case: row, findings: findings.results ?? [], activity: activity.results ?? [] });
});

api.patch("/ops/cases/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    status?: string;
    playbook?: unknown;
    sla_due_at?: string | null;
    title?: string;
  }>();
  const existing = await c.env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first<{
    brand_id: string;
    status: string;
  }>();
  if (!existing) throw new HTTPException(404, { message: "not found" });
  const now = new Date().toISOString();
  const closed = body.status === "closed" ? now : null;
  await c.env.DB.prepare(
    `UPDATE cases SET
      status = COALESCE(?, status),
      playbook = COALESCE(?, playbook),
      sla_due_at = COALESCE(?, sla_due_at),
      title = COALESCE(?, title),
      updated_at = ?,
      closed_at = COALESCE(?, closed_at)
    WHERE id = ?`,
  )
    .bind(
      body.status ?? null,
      body.playbook ? JSON.stringify(body.playbook) : null,
      body.sla_due_at ?? null,
      body.title ?? null,
      now,
      closed,
      id,
    )
    .run();
  if (body.status === "closed") {
    await c.env.DB.prepare(
      `UPDATE findings SET status = 'resolved', updated_at = ? WHERE assigned_case_id = ?`,
    )
      .bind(now, id)
      .run();
  }
  await logActivity(c.env.DB, {
    brandId: existing.brand_id,
    actorId: c.get("user").id,
    entityType: "case",
    entityId: id,
    action: "updated",
    detail: JSON.stringify(body),
  });
  const row = await c.env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  return c.json({ case: row });
});

api.post("/ops/cases/:id/activity", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ detail: string }>();
  const row = await c.env.DB.prepare("SELECT brand_id FROM cases WHERE id = ?")
    .bind(id)
    .first<{ brand_id: string }>();
  if (!row) throw new HTTPException(404, { message: "not found" });
  await logActivity(c.env.DB, {
    brandId: row.brand_id,
    actorId: c.get("user").id,
    entityType: "case",
    entityId: id,
    action: "note",
    detail: body.detail,
  });
  return c.json({ ok: true });
});

api.patch("/ops/brands/:id", async (c) => {
  const brand = await brandFor(c, c.req.param("id"));
  const body = await c.req.json<{
    fact_sheet?: string;
    domains?: string[];
    aliases?: string[];
    competitors?: string[];
    legal_name?: string;
  }>();
  await c.env.DB.prepare(
    `UPDATE brands SET
      fact_sheet = COALESCE(?, fact_sheet),
      domains = COALESCE(?, domains),
      aliases = COALESCE(?, aliases),
      competitors = COALESCE(?, competitors),
      legal_name = COALESCE(?, legal_name)
    WHERE id = ?`,
  )
    .bind(
      body.fact_sheet ?? null,
      body.domains ? JSON.stringify(body.domains) : null,
      body.aliases ? JSON.stringify(body.aliases) : null,
      body.competitors ? JSON.stringify(body.competitors) : null,
      body.legal_name ?? null,
      brand.id,
    )
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM brands WHERE id = ?").bind(brand.id).first();
  return c.json({ brand: updated });
});

api.get("/ops/audit-requests", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM audit_requests ORDER BY created_at DESC LIMIT 100").all();
  return c.json({ requests: rows.results ?? [] });
});

api.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  return c.json({ error: err instanceof Error ? err.message : "internal" }, 500);
});

async function requireUser(c: Context<AppEnv>, next: Next) {
  const user = await readSession(c);
  if (!user) throw new HTTPException(401, { message: "sign in required" });
  c.set("user", user);
  await next();
}

async function requireOperator(c: Context<AppEnv>, next: Next) {
  const user = await readSession(c);
  if (!user) throw new HTTPException(401, { message: "sign in required" });
  if (user.role !== "operator") throw new HTTPException(403, { message: "operator only" });
  c.set("user", user);
  await next();
}

async function brandFor(c: { env: Cloudflare.Env; get: (k: "user") => AuthedUser }, id: string) {
  const user = c.get("user");
  const brand = await c.env.DB.prepare("SELECT * FROM brands WHERE id = ? AND organization_id = ?")
    .bind(id, user.organizationId)
    .first<{ id: string; organization_id: string; name: string }>();
  if (!brand) throw new HTTPException(404, { message: "brand not found" });
  return brand;
}
