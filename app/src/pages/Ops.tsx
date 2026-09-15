import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmt, parseList, type Brand, type CaseRow, type Finding, type RunRow } from "../api";
import { FindingTable } from "./Client";

export function InboxPage({ brandId }: { brandId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    api.inbox(brandId).then((r) => setFindings(r.findings)).catch(() => setFindings([]));
  }, [brandId]);
  return (
    <section>
      <h1>Inbox</h1>
      <p className="lead">Unconfirmed classifications. The model suggests; an operator confirms.</p>
      <FindingTable findings={findings} />
    </section>
  );
}

export function FindingPage({ brandId }: { brandId: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [bucket, setBucket] = useState("unknown");
  const [track, setTrack] = useState("displace");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!id) return;
    api.finding(id).then((r) => {
      setFinding(r.finding);
      setBucket(r.finding.threat_bucket);
      setTrack(r.finding.response_track ?? "displace");
    }).catch(() => setFinding(null));
  }, [id]);

  if (!finding || !id) return <p className="empty">Finding not found.</p>;
  let suggested: unknown = null;
  try { suggested = finding.classification_suggested ? JSON.parse(finding.classification_suggested) : null; } catch { suggested = finding.classification_suggested; }

  return (
    <section>
      <h1>{finding.title || finding.url}</h1>
      <p className="lead">{finding.excerpt}</p>
      <p>
        {finding.url ? <a href={finding.url} target="_blank" rel="noreferrer">{finding.url}</a> : null}
      </p>
      <div className="stats">
        <div className="stat"><b>{fmt(finding.risk)}</b><span>Risk</span></div>
        <div className="stat"><b>{fmt(finding.reach)}</b><span>Reach</span></div>
        <div className="stat"><b>{fmt(finding.persistence)}</b><span>Persistence</span></div>
        <div className="stat"><b>{fmt(finding.commercial_proximity)}</b><span>Proximity</span></div>
      </div>
      {suggested ? <pre className="panel muted">{JSON.stringify(suggested, null, 2)}</pre> : null}
      <div className="row">
        <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
          {["impersonation", "organic_negative", "coordinated", "machine_distortion", "benign", "unknown"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value)}>
          {["remove", "displace", "occupy", "narrative"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <button className="primary" onClick={() => api.classify(id, { threat_bucket: bucket, response_track: track }).then((r) => setFinding(r.finding))}>
          Confirm classification
        </button>
        <button onClick={() => api.createCase({
          brand_id: brandId,
          title: finding.title || finding.url,
          track,
          finding_ids: [id],
          sla_due_at: finding.sla_due_at,
        }).then((r) => navigate(`/ops/cases/${r.case.id}`))}>
          Open case
        </button>
      </div>
      <h2>Manual intake note</h2>
      <div className="stack">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <button disabled={!note} onClick={() => api.patchFinding(id, { status: "monitoring" })}>Keep monitoring</button>
      </div>
    </section>
  );
}

export function CasesPage({ brandId }: { brandId: string }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  useEffect(() => {
    api.opsCases(brandId).then((r) => setCases(r.cases)).catch(() => setCases([]));
  }, [brandId]);
  return (
    <section>
      <h1>Cases</h1>
      <p className="lead">Remove, displace, occupy, narrative. Humans execute; software keeps the SLA.</p>
      <table>
        <thead><tr><th>Case</th><th>Track</th><th>Status</th><th>SLA</th></tr></thead>
        <tbody>
          {cases.map((row) => (
            <tr key={row.id}>
              <td><Link to={`/ops/cases/${row.id}`}>{row.title}</Link></td>
              <td>{row.track}</td>
              <td>{row.status}</td>
              <td className="muted">{row.sla_due_at?.replace("T", " ").slice(0, 16) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cases.length === 0 ? <p className="empty">No cases yet.</p> : null}
    </section>
  );
}

export function CasePage() {
  const { id } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.caseDetail>> | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!id) return;
    api.caseDetail(id).then(setData).catch(() => setData(null));
  }, [id]);

  if (!data || !id) return <p className="empty">Case not found.</p>;
  const caseId = id;
  const current = data;
  let playbook: Array<{ id: string; label: string; done: boolean }> = [];
  try { playbook = current.case.playbook ? JSON.parse(current.case.playbook) : []; } catch { playbook = []; }

  async function toggle(itemId: string) {
    const next = playbook.map((item) => item.id === itemId ? { ...item, done: !item.done } : item);
    const updated = await api.patchCase(caseId, { playbook: next });
    setData({ ...current, case: updated.case });
  }

  return (
    <section>
      <h1>{data.case.title}</h1>
      <p className="lead">{data.case.track} · {data.case.status}</p>
      <div className="stack">
        {playbook.map((item) => (
          <label key={item.id} className="row">
            <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} style={{ width: "auto" }} />
            {item.label}
          </label>
        ))}
      </div>
      <h2>Linked findings</h2>
      <FindingTable findings={data.findings} />
      <h2>Notes</h2>
      <div className="stack">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="primary" disabled={!note} onClick={async () => {
          await api.noteCase(caseId, note);
          setNote("");
          setData(await api.caseDetail(caseId));
        }}>Add note</button>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={() => api.patchCase(caseId, { status: "in_progress" }).then((r) => setData({ ...current, case: r.case }))}>In progress</button>
        <button onClick={() => api.patchCase(caseId, { status: "waiting" }).then((r) => setData({ ...current, case: r.case }))}>Waiting</button>
        <button className="primary" onClick={() => api.patchCase(caseId, { status: "closed" }).then((r) => setData({ ...current, case: r.case }))}>Close case</button>
      </div>
      <h2>Activity</h2>
      <table>
        <tbody>
          {data.activity.map((row) => (
            <tr key={row.id}>
              <td className="muted">{row.created_at.replace("T", " ").slice(0, 16)}</td>
              <td>{row.action}</td>
              <td>{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function CollectorsPage({ brandId }: { brandId: string }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState(false);
  async function load() {
    const r = await api.runs(brandId);
    setRuns(r.runs);
  }
  useEffect(() => { load().catch(() => setRuns([])); }, [brandId]);

  return (
    <section>
      <h1>Collectors</h1>
      <p className="lead">Search, AI probe, impersonation. Full perimeter, thinner on each pass.</p>
      <div className="row">
        {(["full", "search", "ai", "impersonation", "classify"] as const).map((engine) => (
          <button
            key={engine}
            className={engine === "full" ? "primary" : ""}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.run(brandId, engine);
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            Run {engine}
          </button>
        ))}
      </div>
      <table>
        <thead><tr><th>When</th><th>Engine</th><th>Status</th><th>Coverage</th></tr></thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="muted">{run.created_at.replace("T", " ").slice(0, 16)}</td>
              <td>{run.engine}</td>
              <td>{run.status}{run.error ? ` — ${run.error}` : ""}</td>
              <td className="muted">{run.coverage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function BrandPage({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [fact, setFact] = useState("");
  const [domains, setDomains] = useState("");
  const [aliases, setAliases] = useState("");
  useEffect(() => {
    api.brand(brandId).then((r) => {
      setBrand(r.brand);
      setFact(r.brand.fact_sheet);
      setDomains(parseList(r.brand.domains).join(", "));
      setAliases(parseList(r.brand.aliases).join(", "));
    }).catch(() => setBrand(null));
  }, [brandId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const updated = await api.patchBrand(brandId, {
      fact_sheet: fact,
      domains: domains.split(",").map((s) => s.trim()).filter(Boolean),
      aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setBrand(updated.brand);
  }

  if (!brand) return <p className="empty">Brand not found.</p>;
  return (
    <section>
      <h1>{brand.name}</h1>
      <form className="stack" onSubmit={save}>
        <label>Domains<input value={domains} onChange={(e) => setDomains(e.target.value)} /></label>
        <label>Aliases<input value={aliases} onChange={(e) => setAliases(e.target.value)} /></label>
        <label>Fact sheet<textarea value={fact} onChange={(e) => setFact(e.target.value)} /></label>
        <button className="primary" type="submit">Save</button>
      </form>
    </section>
  );
}

export function IntakePage({ brandId }: { brandId: string }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  return (
    <section>
      <h1>Manual intake</h1>
      <p className="lead">Paste a URL. It becomes a finding and enters the same scoring and routing path.</p>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const result = await api.manual({ brand_id: brandId, url, title, excerpt });
        setCreated(result.finding.id);
        setUrl(""); setTitle(""); setExcerpt("");
      }}>
        <input required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="Why this matters" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        <button className="primary" type="submit">Create finding</button>
      </form>
      {created ? <p><Link to={`/ops/findings/${created}`}>Open finding</Link></p> : null}
    </section>
  );
}

export function AuditRequestsPage() {
  const [rows, setRows] = useState<Array<{ id: string; email: string; brand_name: string; domain: string; note: string; created_at: string }>>([]);
  useEffect(() => {
    api.auditRequests().then((r) => setRows(r.requests)).catch(() => setRows([]));
  }, []);
  return (
    <section>
      <h1>Audit requests</h1>
      <table>
        <thead><tr><th>When</th><th>Email</th><th>Brand</th><th>Domain</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="muted">{row.created_at.replace("T", " ").slice(0, 16)}</td>
              <td>{row.email}</td>
              <td>{row.brand_name}</td>
              <td>{row.domain}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
