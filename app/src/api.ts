export type Role = "operator" | "client";

export type User = {
  id: string;
  email: string;
  name: string | null;
  organizationId: string;
  role: Role;
};

export type Brand = {
  id: string;
  name: string;
  legal_name: string | null;
  domains: string;
  aliases: string;
  competitors: string;
  fact_sheet: string;
};

export type Finding = {
  id: string;
  brand_id: string;
  source_family: string;
  source_type: string;
  url: string | null;
  title: string | null;
  excerpt: string | null;
  threat_bucket: string;
  reach: number;
  persistence: number;
  commercial_proximity: number;
  risk: number;
  status: string;
  response_track: string | null;
  first_seen: string;
  last_seen: string;
  serp_position: number | null;
  ai_cited: number;
  sla_due_at: string | null;
  classification_suggested: string | null;
  classification_confirmed: number;
  assigned_case_id: string | null;
};

export type CaseRow = {
  id: string;
  brand_id: string;
  title: string;
  track: string;
  playbook: string | null;
  status: string;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type Posture = {
  serp_control: number | null;
  sentiment: number | null;
  share_of_voice: number | null;
  ai_accuracy: number | null;
  open_threat_count: number;
  time_to_resolution_hours: number | null;
};

export type SerpRow = {
  id: string;
  query: string;
  position: number;
  url: string;
  title: string;
  snippet: string;
  source_type: string;
  owned: number;
};

export type AnswerRow = {
  id: string;
  model: string;
  prompt: string;
  answer: string;
  citations: string;
  accuracy_score: number | null;
  accuracy_notes: string | null;
  captured_at: string;
};

export type ActivityRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: string | null;
  created_at: string;
};

export type RunRow = {
  id: string;
  brand_id: string;
  engine: string;
  status: string;
  coverage: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => req<{ user: User | null }>("/auth/me"),
  requestLink: (email: string) => req<{ delivered: boolean; devLink?: string }>("/auth/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  brands: () => req<{ brands: Brand[] }>("/brands"),
  brand: (id: string) => req<{ brand: Brand; queries: unknown[]; prompts: unknown[] }>(`/brands/${id}`),
  posture: (id: string) => req<{ current: Posture; history: Array<Posture & { captured_at: string }> }>(`/brands/${id}/posture`),
  findings: (id: string, qs = "") => req<{ findings: Finding[] }>(`/brands/${id}/findings${qs}`),
  serp: (id: string) => req<{ results: SerpRow[] }>(`/brands/${id}/serp`),
  answers: (id: string) => req<{ answers: AnswerRow[] }>(`/brands/${id}/answers`),
  activity: (id: string) => req<{ activity: ActivityRow[] }>(`/brands/${id}/activity`),
  audit: (id: string) => req<Record<string, unknown>>(`/brands/${id}/audit`),
  cases: (id: string) => req<{ cases: CaseRow[] }>(`/brands/${id}/cases`),
  run: (id: string, engine = "full") =>
    req<{ runId: string }>(`/ops/brands/${id}/run`, { method: "POST", body: JSON.stringify({ engine }) }),
  runs: (brandId: string) => req<{ runs: RunRow[] }>(`/ops/runs?brand_id=${brandId}`),
  inbox: (brandId: string) => req<{ findings: Finding[] }>(`/ops/inbox?brand_id=${brandId}`),
  finding: (id: string) => req<{ finding: Finding }>(`/ops/findings/${id}`),
  patchFinding: (id: string, body: Record<string, unknown>) =>
    req<{ finding: Finding }>(`/ops/findings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  classify: (id: string, body: Record<string, unknown>) =>
    req<{ finding: Finding }>(`/ops/findings/${id}/classify`, { method: "POST", body: JSON.stringify(body) }),
  manual: (body: Record<string, unknown>) =>
    req<{ finding: Finding }>("/ops/findings/manual", { method: "POST", body: JSON.stringify(body) }),
  opsCases: (brandId: string) => req<{ cases: CaseRow[] }>(`/ops/cases?brand_id=${brandId}`),
  createCase: (body: Record<string, unknown>) =>
    req<{ case: CaseRow }>("/ops/cases", { method: "POST", body: JSON.stringify(body) }),
  caseDetail: (id: string) =>
    req<{ case: CaseRow; findings: Finding[]; activity: ActivityRow[] }>(`/ops/cases/${id}`),
  patchCase: (id: string, body: Record<string, unknown>) =>
    req<{ case: CaseRow }>(`/ops/cases/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  noteCase: (id: string, detail: string) =>
    req<{ ok: boolean }>(`/ops/cases/${id}/activity`, { method: "POST", body: JSON.stringify({ detail }) }),
  patchBrand: (id: string, body: Record<string, unknown>) =>
    req<{ brand: Brand }>(`/ops/brands/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  auditRequests: () => req<{ requests: Array<{ id: string; email: string; brand_name: string; domain: string; note: string; created_at: string }> }>("/ops/audit-requests"),
};

export function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}`;
}

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
