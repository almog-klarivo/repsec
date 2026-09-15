import { upsertFinding, type BrandRow, parseJsonList } from "./findings";
import { putSnapshot, readLimited } from "./http";

type Candidate = {
  kind: "domain" | "handle" | "app";
  value: string;
  url: string;
  title: string;
  excerpt: string;
  live: boolean;
};

export async function runImpersonation(
  env: Cloudflare.Env,
  brand: BrandRow,
  runId: string,
): Promise<{ candidates: number; live: number }> {
  const domains = parseJsonList(brand.domains);
  const aliases = [brand.name, ...parseJsonList(brand.aliases)].filter(Boolean);
  const now = new Date().toISOString();
  const candidates = [
    ...domainCandidates(domains),
    ...handleCandidates(aliases),
    ...appCandidates(aliases),
    ...(await ctCandidates(domains)),
  ];

  let live = 0;
  const resolved: Candidate[] = [];
  const deadline = Date.now() + 22_000;
  for (let i = 0; i < candidates.length; i += 6) {
    if (Date.now() > deadline) break;
    const batch = await Promise.all(candidates.slice(i, i + 6).map((candidate) => inspectCandidate(candidate)));
    resolved.push(...batch);
    live += batch.filter((item) => item.live).length;
  }

  const snapshotKey = `impersonation/${brand.id}/${runId}.json`;
  await putSnapshot(env, snapshotKey, JSON.stringify({ resolved, captured_at: now }));

  for (const candidate of resolved) {
    await upsertFinding(env.DB, {
      brandId: brand.id,
      family: "impersonation",
      sourceType: candidate.kind === "domain" ? "domain" : candidate.kind === "app" ? "appstore" : "handle",
      url: candidate.url,
      title: candidate.title,
      excerpt: candidate.excerpt,
      position: candidate.live ? 1 : null,
      proximity: 0.95,
      owned: false,
      rawRef: snapshotKey,
      now,
    });
  }

  return { candidates: resolved.length, live };
}

function domainCandidates(domains: string[]): Candidate[] {
  const out: Candidate[] = [];
  const tlds = ["com", "net", "org", "io", "ai", "co", "app", "security"];
  for (const domain of domains) {
    const [name, ...rest] = domain.split(".");
    const baseTld = rest.join(".") || "com";
    const mutations = permute(name);
    for (const mutation of mutations) {
      const hosts = new Set<string>([`${mutation}.${baseTld}`]);
      for (const tld of tlds) hosts.add(`${name}.${tld}`);
      hosts.add(`${name}-${baseTld}.com`);
      for (const host of hosts) {
        if (host === domain) continue;
        out.push({
          kind: "domain",
          value: host,
          url: `https://${host}`,
          title: `Lookalike domain ${host}`,
          excerpt: `Permutation of ${domain}`,
          live: false,
        });
      }
    }
  }
  return out.slice(0, 18);
}

function handleCandidates(aliases: string[]): Candidate[] {
  const platforms = [
    { id: "x", url: (h: string) => `https://x.com/${h}` },
    { id: "tiktok", url: (h: string) => `https://www.tiktok.com/@${h}` },
    { id: "youtube", url: (h: string) => `https://www.youtube.com/@${h}` },
    { id: "instagram", url: (h: string) => `https://www.instagram.com/${h}/` },
    { id: "github", url: (h: string) => `https://github.com/${h}` },
  ];
  const out: Candidate[] = [];
  for (const alias of aliases) {
    const handle = slug(alias);
    if (!handle) continue;
    for (const platform of platforms) {
      out.push({
        kind: "handle",
        value: `${platform.id}:${handle}`,
        url: platform.url(handle),
        title: `${platform.id} /${handle}`,
        excerpt: `Handle collision check for ${alias}`,
        live: false,
      });
    }
  }
  return out.slice(0, 8);
}

async function ctCandidates(domains: string[]): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const domain of domains.slice(0, 2)) {
    try {
      const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const text = await readLimited(res, 48_000);
      const parsed = JSON.parse(text.startsWith("[") ? text.replace(/,\s*$/, "") : "[]") as Array<{
        name_value?: string;
      }>;
      const names = new Set<string>();
      for (const row of parsed.slice(0, 30)) {
        for (const name of (row.name_value ?? "").split("\n")) {
          const host = name.trim().replace(/^\*\./, "");
          if (host && host !== domain && host.endsWith(domain)) names.add(host);
        }
      }
      for (const host of [...names].slice(0, 8)) {
        out.push({
          kind: "domain",
          value: host,
          url: `https://${host}`,
          title: `Certificate for ${host}`,
          excerpt: `Observed in Certificate Transparency for ${domain}`,
          live: true,
        });
      }
    } catch {
      // crt.sh is best-effort
    }
  }
  return out;
}

function appCandidates(aliases: string[]): Candidate[] {
  return aliases.slice(0, 3).map((alias) => ({
    kind: "app" as const,
    value: alias,
    url: `https://itunes.apple.com/search?term=${encodeURIComponent(alias)}&entity=software&limit=5`,
    title: `App Store search: ${alias}`,
    excerpt: "Name collision check against the iTunes search API",
    live: false,
  }));
}

async function inspectCandidate(candidate: Candidate): Promise<Candidate> {
  try {
    if (candidate.kind === "domain") {
      const host = new URL(candidate.url).hostname;
      const dns = await resolveDns(host);
      if (!dns) return { ...candidate, excerpt: `${candidate.excerpt} — no DNS`, live: false };
      const http = await fetchSafe(candidate.url);
      return {
        ...candidate,
        live: true,
        excerpt: `${candidate.excerpt} — DNS live${http.title ? `; title “${http.title}”` : ""}`,
      };
    }
    if (candidate.kind === "app") {
      const res = await fetch(candidate.url, { headers: { Accept: "application/json" } });
      if (!res.ok) return candidate;
      const data = (await res.json()) as { resultCount?: number; results?: Array<{ trackName?: string; sellerName?: string }> };
      const live = (data.resultCount ?? 0) > 0;
      const names = (data.results ?? []).map((r) => r.trackName).filter(Boolean).slice(0, 3);
      return {
        ...candidate,
        live,
        excerpt: live ? `Possible app collisions: ${names.join(", ")}` : "No App Store collisions",
      };
    }
    const http = await fetchSafe(candidate.url);
    return {
      ...candidate,
      live: http.ok,
      excerpt: http.ok ? `Handle URL responds ${http.status}` : `Handle URL ${http.status || "unreachable"}`,
    };
  } catch {
    return candidate;
  }
}

async function resolveDns(name: string): Promise<boolean> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", "A");
  const res = await fetch(url, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return false;
  const data = (await res.json()) as { Answer?: Array<{ data: string }> };
  return Boolean(data.Answer?.length);
}

async function fetchSafe(url: string): Promise<{ ok: boolean; status: number; title: string }> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "RepSecBot/1.0 (brand impersonation monitor)" },
    signal: AbortSignal.timeout(4000),
  });
  const status = res.status;
  const ok = res.ok;
  let title = "";
  if (ok) {
    const html = await readLimited(res, 16_000);
    title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 120) ?? "";
  }
  return { ok, status, title };
}

function permute(name: string): string[] {
  const lower = name.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < lower.length; i += 1) {
    out.add(lower.slice(0, i) + lower.slice(i + 1));
    if (i + 1 < lower.length) {
      out.add(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2));
    }
    out.add(`${lower.slice(0, i)}-${lower.slice(i)}`);
  }
  out.add(lower.replace(/o/g, "0"));
  out.add(lower.replace(/l/g, "1"));
  out.add(`${lower}s`);
  out.add(`${lower}-official`);
  out.add(`${lower}-support`);
  out.add(`get${lower}`);
  return [...out].filter((n) => n.length > 2);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
}
