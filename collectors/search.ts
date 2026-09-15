import { classifyHost, hostnameOf, isOwnedHost } from "./hosts";
import { upsertFinding, type BrandRow, parseJsonList } from "./findings";
import { INTENT_PROXIMITY } from "./scoring";
import { putSnapshot, readLimited } from "./http";
import type { QueryIntent } from "../shared/types";

type SearchHit = {
  position: number;
  url: string;
  title: string;
  snippet: string;
};

type QueryRow = {
  id: string;
  query: string;
  intent: QueryIntent;
  proximity_weight: number;
};

export async function runSearch(
  env: Cloudflare.Env,
  brand: BrandRow,
  runId: string,
): Promise<{ results: number; findings: number }> {
  const queries = await env.DB.prepare(
    "SELECT id, query, intent, proximity_weight FROM queries WHERE brand_id = ? AND active = 1",
  )
    .bind(brand.id)
    .all<QueryRow>();

  const owned = parseJsonList(brand.domains);
  const now = new Date().toISOString();
  let resultCount = 0;
  let findingCount = 0;

  for (const q of queries.results ?? []) {
    const hits = await searchWeb(env, q.query);
    const snapshotKey = `serp/${brand.id}/${runId}/${q.id}.json`;
    await putSnapshot(env, snapshotKey, JSON.stringify({ query: q.query, hits, captured_at: now }));

    for (const hit of hits) {
      resultCount += 1;
      const sourceType = classifyHost(hit.url, owned, hit.title);
      const ownedHit = isOwnedHost(hit.url, owned);
      const rowId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO serp_results (
          id, brand_id, run_id, query_id, query, position, url, domain, title, snippet,
          source_type, owned, r2_key, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          rowId,
          brand.id,
          runId,
          q.id,
          q.query,
          hit.position,
          hit.url,
          hostnameOf(hit.url),
          hit.title,
          hit.snippet,
          sourceType,
          ownedHit ? 1 : 0,
          snapshotKey,
          now,
        )
        .run();

      await upsertFinding(env.DB, {
        brandId: brand.id,
        family: "search",
        sourceType,
        url: hit.url,
        title: hit.title,
        excerpt: hit.snippet,
        position: hit.position,
        proximity: q.proximity_weight || INTENT_PROXIMITY[q.intent] || 0.5,
        intent: q.intent,
        owned: ownedHit,
        rawRef: rowId,
        now,
      });
      findingCount += 1;
    }
  }

  return { results: resultCount, findings: findingCount };
}

async function searchWeb(env: Cloudflare.Env, query: string): Promise<SearchHit[]> {
  if (env.SERPAPI_KEY) return searchSerpApi(env.SERPAPI_KEY, query);
  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) {
    return searchDataForSeo(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD, query);
  }
  if (env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_ID) {
    return searchGoogleCse(env.GOOGLE_CSE_KEY, env.GOOGLE_CSE_ID, query);
  }
  return searchPublicSurfaces(query);
}

async function searchSerpApi(key: string, query: string): Promise<SearchHit[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("num", "10");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = (await res.json()) as {
    organic_results?: Array<{ position: number; link: string; title: string; snippet?: string }>;
  };
  return (data.organic_results ?? []).map((r) => ({
    position: r.position,
    url: r.link,
    title: r.title,
    snippet: r.snippet ?? "",
  }));
}

async function searchDataForSeo(login: string, password: string, query: string): Promise<SearchHit[]> {
  const auth = btoa(`${login}:${password}`);
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/regular", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ language_code: "en", location_code: 2840, keyword: query, depth: 10 }]),
  });
  if (!res.ok) throw new Error(`DataForSEO ${res.status}`);
  const data = (await res.json()) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{ type: string; rank_absolute?: number; url?: string; title?: string; description?: string }>;
      }>;
    }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((item) => item.type === "organic" && item.url)
    .map((item, i) => ({
      position: item.rank_absolute ?? i + 1,
      url: item.url ?? "",
      title: item.title ?? "",
      snippet: item.description ?? "",
    }));
}

async function searchGoogleCse(key: string, cx: string, query: string): Promise<SearchHit[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google CSE ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ link: string; title: string; snippet?: string }>;
  };
  return (data.items ?? []).map((item, i) => ({
    position: i + 1,
    url: item.link,
    title: item.title,
    snippet: item.snippet ?? "",
  }));
}

async function searchPublicSurfaces(query: string): Promise<SearchHit[]> {
  const parsed = parseSiteQuery(query);
  const jobs: Array<Promise<SearchHit[]>> = [];
  if (!parsed.site || parsed.site.includes("reddit")) jobs.push(searchReddit(parsed.q));
  if (!parsed.site || parsed.site.includes("news") || parsed.site.includes("wikipedia")) {
    jobs.push(searchNewsRss(parsed.q));
  }
  if (!parsed.site) {
    jobs.push(searchHn(parsed.q));
    jobs.push(searchWikipedia(parsed.q));
  }
  if (parsed.site?.includes("wikipedia")) jobs.push(searchWikipedia(parsed.q));
  const chunks = await Promise.all(jobs);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const chunk of chunks) {
    for (const hit of chunk) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      hits.push({ ...hit, position: hits.length + 1 });
      if (hits.length >= 10) return hits;
    }
  }
  return hits;
}

function parseSiteQuery(query: string): { q: string; site: string | null } {
  const match = query.match(/^site:(\S+)\s+(.*)$/i);
  if (!match) return { q: query, site: null };
  return { q: match[2] ?? query, site: (match[1] ?? "").toLowerCase() };
}

async function searchReddit(query: string): Promise<SearchHit[]> {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("sort", "relevance");
  const res = await fetch(url, {
    headers: { "User-Agent": "RepSecBot/1.0 (reputation security monitor)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { children?: Array<{ data?: { title?: string; permalink?: string; selftext?: string; url?: string } }> };
  };
  return (data.data?.children ?? []).flatMap((child) => {
    const post = child.data;
    if (!post?.permalink) return [];
    return [{
      position: 0,
      url: `https://www.reddit.com${post.permalink}`,
      title: post.title ?? "Reddit thread",
      snippet: (post.selftext || post.url || "").slice(0, 240),
    }];
  });
}

async function searchHn(query: string): Promise<SearchHit[]> {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("hitsPerPage", "5");
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    hits?: Array<{ title?: string; url?: string; objectID?: string; story_text?: string }>;
  };
  return (data.hits ?? []).flatMap((hit) => {
    const href = hit.url || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : "");
    if (!href) return [];
    return [{
      position: 0,
      url: href,
      title: hit.title ?? "Hacker News",
      snippet: (hit.story_text ?? "").slice(0, 240),
    }];
  });
}

async function searchNewsRss(query: string): Promise<SearchHit[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const xml = await readLimited(res, 40_000);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 5);
  return items.flatMap((item, i) => {
    const block = item[1] ?? "";
    const title = stripTags(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = stripTags(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const snippet = stripTags(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "");
    if (!link.startsWith("http")) return [];
    return [{ position: i + 1, url: link, title: title || link, snippet }];
  });
}

async function searchWikipedia(query: string): Promise<SearchHit[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "3");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = (await res.json()) as [string, string[], string[], string[]];
  const titles = data[1] ?? [];
  const snippets = data[2] ?? [];
  const links = data[3] ?? [];
  return titles.flatMap((title, i) => {
    const href = links[i];
    if (!href) return [];
    return [{ position: i + 1, url: href, title, snippet: snippets[i] ?? "" }];
  });
}

function stripTags(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}
