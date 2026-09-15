import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmt, pct, type AnswerRow, type Finding, type Posture, type SerpRow, type ActivityRow } from "../api";

export function PosturePage({ brandId }: { brandId: string }) {
  const [data, setData] = useState<Posture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.posture(brandId).then((r) => setData(r.current)).catch((e) => setError(String(e.message)));
  }, [brandId]);

  return (
    <section>
      <h1>Posture</h1>
      <p className="lead">Reputation as a security score. Empty until a collection run produces findings.</p>
      {error ? <p className="muted">{error}</p> : null}
      <div className="stats">
        <Stat label="SERP control" value={pct(data?.serp_control)} />
        <Stat label="Sentiment" value={pct(data?.sentiment)} />
        <Stat label="Share of voice" value={pct(data?.share_of_voice)} />
        <Stat label="AI answer accuracy" value={pct(data?.ai_accuracy)} />
        <Stat label="Open threats" value={data ? String(data.open_threat_count) : "—"} />
        <Stat label="Time to resolution (h)" value={fmt(data?.time_to_resolution_hours, 1)} />
      </div>
    </section>
  );
}

export function ThreatsPage({ brandId }: { brandId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    api.findings(brandId).then((r) => setFindings(r.findings)).catch(() => setFindings([]));
  }, [brandId]);

  return (
    <section>
      <h1>Threats</h1>
      <p className="lead">Open and historical findings, scored reach × persistence × commercial proximity.</p>
      <FindingTable findings={findings} />
    </section>
  );
}

export function SerpPage({ brandId }: { brandId: string }) {
  const [results, setResults] = useState<SerpRow[]>([]);
  useEffect(() => {
    api.serp(brandId).then((r) => setResults(r.results)).catch(() => setResults([]));
  }, [brandId]);
  const grouped = useMemo(() => {
    const map = new Map<string, SerpRow[]>();
    for (const row of results) {
      const list = map.get(row.query) ?? [];
      list.push(row);
      map.set(row.query, list);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <section>
      <h1>Branded SERP</h1>
      <p className="lead">First screen on the brand’s own name. Owned properties are marked.</p>
      {grouped.length === 0 ? <p className="empty">No SERP capture yet. Run collection from Ops.</p> : null}
      {grouped.map(([query, rows]) => (
        <div key={query}>
          <h2>{query}</h2>
          <table>
            <thead>
              <tr><th>#</th><th>Result</th><th>Surface</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.position}</td>
                  <td>
                    <a href={row.url} target="_blank" rel="noreferrer">{row.title || row.url}</a>
                    <div className="muted">{row.snippet}</div>
                  </td>
                  <td>
                    <span className={`pill ${row.owned ? "ok" : ""}`}>{row.owned ? "owned" : row.source_type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

export function AnswersPage({ brandId }: { brandId: string }) {
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  useEffect(() => {
    api.answers(brandId).then((r) => setAnswers(r.answers)).catch(() => setAnswers([]));
  }, [brandId]);

  return (
    <section>
      <h1>AI answers</h1>
      <p className="lead">There is no position two. Each probe is the verdict a buyer gets, plus the citations that produced it.</p>
      {answers.length === 0 ? <p className="empty">No probes yet.</p> : null}
      {answers.map((row) => {
        let citations: Array<{ url: string; title?: string }> = [];
        try { citations = JSON.parse(row.citations) as typeof citations; } catch { citations = []; }
        return (
          <article key={row.id} className="panel" style={{ marginBottom: 12 }}>
            <div className="spread">
              <strong>{row.model}</strong>
              <span className="pill">{row.accuracy_score == null ? "unscored" : `accuracy ${pct(row.accuracy_score)}`}</span>
            </div>
            <p className="muted">{row.prompt}</p>
            <p className="answer">{row.answer}</p>
            {citations.length ? (
              <div>
                <h2>Citations</h2>
                <ul>
                  {citations.map((c) => (
                    <li key={c.url}><a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {row.accuracy_notes ? <p className="muted">{row.accuracy_notes}</p> : null}
          </article>
        );
      })}
    </section>
  );
}

export function ActivityPage({ brandId }: { brandId: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  useEffect(() => {
    api.activity(brandId).then((r) => setRows(r.activity)).catch(() => setRows([]));
  }, [brandId]);
  return (
    <section>
      <h1>Activity</h1>
      <p className="lead">Remediation throughput — what was queued, classified, and closed.</p>
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="muted">{row.created_at.replace("T", " ").slice(0, 16)}</td>
              <td>{row.action}</td>
              <td>{row.entity_type}</td>
              <td className="muted">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="empty">No activity yet.</p> : null}
    </section>
  );
}

export function AuditPage({ brandId }: { brandId: string }) {
  const [audit, setAudit] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api.audit(brandId).then(setAudit).catch(() => setAudit(null));
  }, [brandId]);
  const posture = (audit?.posture ?? null) as Posture | null;
  const findings = (audit?.findings ?? []) as Finding[];
  return (
    <section>
      <h1>Baseline audit</h1>
      <p className="lead">The sellable artifact: one collection pass, scored and routed. This is the continuous dashboard, frozen.</p>
      <div className="stats">
        <Stat label="SERP control" value={pct(posture?.serp_control)} />
        <Stat label="AI accuracy" value={pct(posture?.ai_accuracy)} />
        <Stat label="Open threats" value={posture ? String(posture.open_threat_count) : "—"} />
      </div>
      <FindingTable findings={findings} />
      {audit ? (
        <p className="muted">Generated {String(audit.generated_at ?? "")}</p>
      ) : (
        <p className="empty">Run a collection to generate the audit.</p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function FindingTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <p className="empty">No findings on file.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Risk</th><th>Finding</th><th>Bucket</th><th>Track</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((f) => (
          <tr key={f.id}>
            <td>{fmt(f.risk)}</td>
            <td>
              {f.url ? <Link to={`/ops/findings/${f.id}`}>{f.title || f.url}</Link> : (f.title || "Untitled")}
              <div className="muted">{f.source_type}{f.ai_cited ? " · cited" : ""}</div>
            </td>
            <td><span className={`pill ${f.threat_bucket === "benign" ? "ok" : "bad"}`}>{f.threat_bucket}</span></td>
            <td>{f.response_track ?? "—"}</td>
            <td>{f.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
