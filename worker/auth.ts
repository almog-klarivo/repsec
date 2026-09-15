import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { operatorEmails } from "./seed";

export type AuthedUser = {
  id: string;
  email: string;
  name: string | null;
  organizationId: string;
  role: "operator" | "client";
};

export type AppEnv = {
  Bindings: Cloudflare.Env;
  Variables: { user: AuthedUser };
};

export async function requestMagicLink(
  env: Cloudflare.Env,
  email: string,
  requestUrl: string,
): Promise<{ delivered: boolean; devLink?: string }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO magic_links (id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), email.toLowerCase(), hash, expires, new Date().toISOString())
    .run();

  const path = `/api/auth/verify?token=${token}`;
  const absolute = `${appOrigin(env, requestUrl)}${path}`;

  if (env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RepSec <login@repsec.ai>",
        to: [email],
        subject: "Your RepSec sign-in link",
        text: `Sign in: ${absolute}\nThis link expires in 30 minutes.`,
      }),
    });
    return { delivered: true };
  }
  return { delivered: false, devLink: path };
}

export async function consumeMagicLink(env: Cloudflare.Env, token: string): Promise<AuthedUser> {
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT * FROM magic_links WHERE token_hash = ? AND used_at IS NULL`,
  )
    .bind(hash)
    .first<{ id: string; email: string; expires_at: string }>();
  if (!row) throw new Error("Invalid or used link");
  if (Date.parse(row.expires_at) < Date.now()) throw new Error("Link expired");

  await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id)
    .run();

  return upsertUser(env, row.email);
}

export async function upsertUser(env: Cloudflare.Env, emailRaw: string): Promise<AuthedUser> {
  const email = emailRaw.toLowerCase();
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; name: string | null }>();
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email,
      name: email.split("@")[0] ?? email,
    };
    await env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(user.id, email, user.name, new Date().toISOString())
      .run();
  }

  const org = await env.DB.prepare("SELECT id FROM organizations LIMIT 1").first<{ id: string }>();
  if (!org) throw new Error("No organization");

  const operators = operatorEmails(env);
  const role = operators.includes(email) || operators.length === 0 ? "operator" : "client";

  const membership = await env.DB.prepare(
    "SELECT role FROM memberships WHERE user_id = ? AND organization_id = ?",
  )
    .bind(user.id, org.id)
    .first<{ role: "operator" | "client" }>();
  if (!membership) {
    await env.DB.prepare(
      "INSERT INTO memberships (id, user_id, organization_id, role) VALUES (?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), user.id, org.id, role)
      .run();
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: membership?.role ?? role,
  };
}

export async function createSession(c: Context<AppEnv>, user: AuthedUser): Promise<void> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), user.id, hash, expires.toISOString(), new Date().toISOString())
    .run();
  setCookie(c, "repsec_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
    expires,
  });
}

export async function readSession(c: Context<AppEnv>): Promise<AuthedUser | null> {
  const token = getCookie(c, "repsec_session");
  if (!token) return null;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, m.organization_id, m.role, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = u.id
     WHERE s.token_hash = ?
     LIMIT 1`,
  )
    .bind(hash)
    .first<{
      id: string;
      email: string;
      name: string | null;
      organization_id: string;
      role: "operator" | "client";
      expires_at: string;
    }>();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    organizationId: row.organization_id,
    role: row.role,
  };
}

export async function clearSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, "repsec_session");
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  deleteCookie(c, "repsec_session", { path: "/" });
}

export function appOrigin(env: Cloudflare.Env, requestUrl: string): string {
  const url = new URL(requestUrl);
  const production = new Set(["repsec.ai", "www.repsec.ai", "app.repsec.ai"]);
  if (!production.has(url.hostname)) return url.origin;
  if (url.hostname === "app.repsec.ai") return url.origin;
  return env.APP_URL || "https://app.repsec.ai";
}

export function appPath(requestUrl: string, path: string): string {
  const url = new URL(requestUrl);
  const prefix = url.hostname.startsWith("app.") ? "" : "/app";
  return `${prefix}${path}`;
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
