export type Role = "operator" | "client";

export type QueryIntent =
  | "branded"
  | "login"
  | "support"
  | "review"
  | "scam"
  | "vs"
  | "alternatives";

export type SourceFamily = "search" | "ai" | "impersonation" | "manual";

export type ThreatBucket =
  | "impersonation"
  | "organic_negative"
  | "coordinated"
  | "machine_distortion"
  | "benign"
  | "unknown";

export type FindingStatus =
  | "new"
  | "triaged"
  | "in_response"
  | "waiting"
  | "resolved"
  | "accepted_risk"
  | "monitoring";

export type ResponseTrack = "remove" | "displace" | "occupy" | "narrative";

export type CaseStatus = "open" | "in_progress" | "waiting" | "closed";

export type Engine = "search" | "ai" | "impersonation" | "classify" | "full";

export type Citation = {
  url: string;
  title?: string;
};

export type PlaybookItem = {
  id: string;
  label: string;
  done: boolean;
};

export type PostureScores = {
  serp_control: number | null;
  sentiment: number | null;
  share_of_voice: number | null;
  ai_accuracy: number | null;
  open_threat_count: number;
  time_to_resolution_hours: number | null;
};
