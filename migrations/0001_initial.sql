CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'client')),
  UNIQUE (user_id, organization_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  domains TEXT NOT NULL DEFAULT '[]',
  aliases TEXT NOT NULL DEFAULT '[]',
  marks TEXT NOT NULL DEFAULT '[]',
  executives TEXT NOT NULL DEFAULT '[]',
  products TEXT NOT NULL DEFAULT '[]',
  competitors TEXT NOT NULL DEFAULT '[]',
  locales TEXT NOT NULL DEFAULT '["en-US"]',
  fact_sheet TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE queries (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  query TEXT NOT NULL,
  intent TEXT NOT NULL,
  proximity_weight REAL NOT NULL DEFAULT 0.5,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  intent TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE serp_results (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  query_id TEXT,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  domain TEXT,
  title TEXT,
  snippet TEXT,
  source_type TEXT,
  owned INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE ai_answers (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt_id TEXT,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  accuracy_score REAL,
  accuracy_notes TEXT,
  flagged_claims TEXT NOT NULL DEFAULT '[]',
  captured_at TEXT NOT NULL
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  source_family TEXT NOT NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  title TEXT,
  excerpt TEXT,
  threat_bucket TEXT NOT NULL DEFAULT 'unknown',
  reach REAL NOT NULL DEFAULT 0.5,
  persistence REAL NOT NULL DEFAULT 0.5,
  commercial_proximity REAL NOT NULL DEFAULT 0.5,
  risk REAL NOT NULL DEFAULT 0.125,
  status TEXT NOT NULL DEFAULT 'new',
  response_track TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  serp_position INTEGER,
  ai_cited INTEGER NOT NULL DEFAULT 0,
  sla_due_at TEXT,
  classification_suggested TEXT,
  classification_confirmed INTEGER NOT NULL DEFAULT 0,
  assigned_case_id TEXT,
  raw_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_findings_brand_url ON findings (brand_id, url) WHERE url IS NOT NULL;
CREATE INDEX idx_findings_brand_status ON findings (brand_id, status);
CREATE INDEX idx_findings_brand_risk ON findings (brand_id, risk DESC);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  title TEXT NOT NULL,
  track TEXT NOT NULL,
  playbook TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assignee_id TEXT,
  sla_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE case_findings (
  case_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  PRIMARY KEY (case_id, finding_id)
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  brand_id TEXT,
  actor_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_activity_brand ON activity_log (brand_id, created_at DESC);

CREATE TABLE posture_snapshots (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  serp_control REAL,
  sentiment REAL,
  share_of_voice REAL,
  ai_accuracy REAL,
  open_threat_count INTEGER,
  time_to_resolution_hours REAL
);

CREATE INDEX idx_posture_brand ON posture_snapshots (brand_id, captured_at DESC);

CREATE TABLE audit_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  brand_name TEXT,
  domain TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
