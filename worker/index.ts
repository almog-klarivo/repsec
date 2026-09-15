import { api } from "./routes";
import { BrandRunWorkflow } from "./workflow";
import { runEngine } from "../collectors/run";
import { ensureSeed } from "./seed";
import type { Engine } from "../shared/types";

export { BrandRunWorkflow };

type CollectMessage = {
  type: Engine;
  brandId: string;
  runId?: string;
};

async function serveAsset(env: Cloudflare.Env, request: Request, path: string): Promise<Response> {
  const url = new URL(path, request.url);
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

async function handleFetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    const apiUrl = new URL(url.pathname.replace(/^\/api/, "") + url.search, url.origin);
    return api.fetch(
      new Request(apiUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      }),
      env,
      ctx,
    );
  }

  const appHost = url.hostname === "app.repsec.ai" || url.hostname.startsWith("app.");
  if (appHost) {
    const assetPath = url.pathname === "/" ? "/app/index.html" : `/app${url.pathname}`;
    const asset = await serveAsset(env, request, assetPath);
    if (asset.status === 404) return serveAsset(env, request, "/app/index.html");
    return asset;
  }

  if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
    const asset = await serveAsset(env, request, url.pathname);
    if (asset.status === 404) return serveAsset(env, request, "/app/index.html");
    return asset;
  }

  return env.ASSETS.fetch(request);
}

async function enqueueBrandRuns(env: Cloudflare.Env): Promise<void> {
  await ensureSeed(env);
  const brands = await env.DB.prepare("SELECT id FROM brands").all<{ id: string }>();
  for (const brand of brands.results ?? []) {
    const runId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO collection_runs (id, brand_id, engine, status, created_at) VALUES (?, ?, 'full', 'queued', ?)`,
    )
      .bind(runId, brand.id, new Date().toISOString())
      .run();
    try {
      if (env.COLLECT) {
        await env.COLLECT.send({ type: "full", brandId: brand.id, runId });
      } else {
        await runEngine(env, brand.id, "full", runId);
      }
    } catch (error) {
      console.error(JSON.stringify({ enqueueError: String(error), brandId: brand.id }));
    }
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Cloudflare.Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(enqueueBrandRuns(env));
  },

  async queue(batch: MessageBatch<CollectMessage>, env: Cloudflare.Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body;
        await runEngine(env, body.brandId, body.type, body.runId);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ queueError: String(error) }));
        message.retry();
      }
    }
  },
};
