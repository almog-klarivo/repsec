import type { QueryIntent, ThreatBucket } from "../shared/types";

export const INTENT_PROXIMITY: Record<QueryIntent, number> = {
  branded: 0.45,
  login: 0.95,
  support: 0.85,
  review: 0.8,
  scam: 0.95,
  vs: 0.7,
  alternatives: 0.75,
};

export function reachFromPosition(position: number | null, aiCited: boolean): number {
  let reach = 0.25;
  if (position != null) {
    if (position <= 3) reach = 1;
    else if (position <= 6) reach = 0.7;
    else if (position <= 10) reach = 0.4;
    else reach = 0.2;
  }
  if (aiCited) reach = Math.min(1, reach * 1.4);
  return round4(reach);
}

export function persistenceFromDays(daysSeen: number): number {
  return round4(Math.min(1, 0.4 + (daysSeen / 30) * 0.6));
}

export function riskScore(reach: number, persistence: number, proximity: number): number {
  return round4(reach * persistence * proximity);
}

export function slaHoursFor(bucket: ThreatBucket, risk: number): number | null {
  if (risk < 0.2 && bucket !== "impersonation") return null;
  switch (bucket) {
    case "impersonation":
      return 24;
    case "coordinated":
      return 48;
    case "organic_negative":
    case "machine_distortion":
      return 72;
    default:
      return risk >= 0.35 ? 96 : null;
  }
}

export function dueAt(fromIso: string, hours: number): string {
  return new Date(Date.parse(fromIso) + hours * 3600 * 1000).toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Math.max(0, Math.floor(ms / 86400000));
}

export function defaultTrack(bucket: ThreatBucket): "remove" | "displace" | "occupy" | "narrative" {
  switch (bucket) {
    case "impersonation":
      return "remove";
    case "machine_distortion":
      return "occupy";
    case "coordinated":
      return "displace";
    case "organic_negative":
      return "displace";
    default:
      return "narrative";
  }
}

export function heuristicBucket(input: {
  family: string;
  sourceType: string;
  intent?: string;
  title?: string;
  excerpt?: string;
  owned?: boolean;
}): ThreatBucket {
  if (input.family === "impersonation") return "impersonation";
  if (input.family === "ai") return "machine_distortion";
  if (input.owned || input.sourceType === "owned") return "benign";
  const text = `${input.title ?? ""} ${input.excerpt ?? ""}`.toLowerCase();
  if (input.sourceType === "competitor_seo" || input.intent === "alternatives") {
    return "coordinated";
  }
  if (
    input.intent === "scam" ||
    /\b(scam|fraud|lawsuit|complaint|refund|terrible|avoid)\b/.test(text)
  ) {
    return "organic_negative";
  }
  if (input.intent === "review" && /\b(1 star|ripoff|worst)\b/.test(text)) {
    return "organic_negative";
  }
  if (input.sourceType === "wikipedia" || input.sourceType === "linkedin") {
    return "benign";
  }
  return "unknown";
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
