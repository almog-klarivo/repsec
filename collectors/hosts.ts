export type SourceType =
  | "owned"
  | "reddit"
  | "g2"
  | "trustpilot"
  | "glassdoor"
  | "wikipedia"
  | "youtube"
  | "news"
  | "linkedin"
  | "x"
  | "tiktok"
  | "facebook"
  | "appstore"
  | "playstore"
  | "marketplace"
  | "competitor_seo"
  | "forum"
  | "domain"
  | "handle"
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "ai_overview"
  | "workers_ai"
  | "other";

const HOST_MAP: Array<{ test: RegExp; type: SourceType }> = [
  { test: /(^|\.)reddit\.com$/i, type: "reddit" },
  { test: /(^|\.)g2\.com$/i, type: "g2" },
  { test: /(^|\.)trustpilot\.com$/i, type: "trustpilot" },
  { test: /(^|\.)glassdoor\.com$/i, type: "glassdoor" },
  { test: /(^|\.)wikipedia\.org$/i, type: "wikipedia" },
  { test: /(^|\.)(youtube\.com|youtu\.be)$/i, type: "youtube" },
  { test: /(^|\.)linkedin\.com$/i, type: "linkedin" },
  { test: /(^|\.)(x\.com|twitter\.com)$/i, type: "x" },
  { test: /(^|\.)tiktok\.com$/i, type: "tiktok" },
  { test: /(^|\.)facebook\.com$/i, type: "facebook" },
  { test: /(^|\.)(apps\.apple\.com|itunes\.apple\.com)$/i, type: "appstore" },
  { test: /(^|\.)play\.google\.com$/i, type: "playstore" },
  { test: /(^|\.)(amazon\.com|ebay\.com)$/i, type: "marketplace" },
  {
    test:
      /(^|\.)(nytimes|wsj|reuters|bloomberg|forbes|techcrunch|theverge|wired|cnn|bbc|cnbc|businessinsider|ft)\./i,
    type: "news",
  },
  {
    test: /(^|\.)(news\.ycombinator\.com|stackoverflow\.com|quora\.com|medium\.com)$/i,
    type: "forum",
  },
];

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifyHost(
  url: string,
  ownedDomains: string[],
  title = "",
): SourceType {
  const host = hostnameOf(url);
  if (!host) return "other";
  if (ownedDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
    return "owned";
  }
  for (const entry of HOST_MAP) {
    if (entry.test.test(host)) return entry.type;
  }
  if (/\b(alternative|vs\.?|competitor|compared)\b/i.test(`${title} ${url}`)) {
    return "competitor_seo";
  }
  return "other";
}

export function isOwnedHost(url: string, ownedDomains: string[]): boolean {
  return classifyHost(url, ownedDomains) === "owned";
}
