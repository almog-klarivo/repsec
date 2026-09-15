import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, type Brand, type User } from "./api";
import { Login } from "./pages/Login";
import { ActivityPage, AnswersPage, AuditPage, PosturePage, SerpPage, ThreatsPage } from "./pages/Client";
import {
  AuditRequestsPage,
  BrandPage,
  CasePage,
  CasesPage,
  CollectorsPage,
  FindingPage,
  InboxPage,
  IntakePage,
} from "./pages/Ops";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string>("");

  useEffect(() => {
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.brands().then((r) => {
      setBrands(r.brands);
      setBrandId((current) => current || r.brands[0]?.id || "");
    }).catch(() => setBrands([]));
  }, [user]);

  if (user === undefined) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!user) return <Login />;
  if (!brandId) return <div className="login"><p className="muted">No brands on this organization.</p></div>;

  const ops = user.role === "operator";

  return (
    <div className="shell">
      <aside className="side">
        <div>
          <div className="brand-mark">repsec</div>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Posture</NavLink>
          <NavLink to="/threats">Threats</NavLink>
          <NavLink to="/serp">SERP</NavLink>
          <NavLink to="/answers">AI answers</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink to="/audit">Audit</NavLink>
          {ops ? (
            <>
              <div className="group">Ops</div>
              <NavLink to="/ops">Inbox</NavLink>
              <NavLink to="/ops/cases">Cases</NavLink>
              <NavLink to="/ops/collectors">Collectors</NavLink>
              <NavLink to="/ops/brand">Brand</NavLink>
              <NavLink to="/ops/intake">Intake</NavLink>
              <NavLink to="/ops/requests">Audit requests</NavLink>
            </>
          ) : null}
        </nav>
        <div>
          <div className="muted">{user.email}</div>
          <button onClick={async () => { await api.logout(); setUser(null); }}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<PosturePage brandId={brandId} />} />
          <Route path="/threats" element={<ThreatsPage brandId={brandId} />} />
          <Route path="/serp" element={<SerpPage brandId={brandId} />} />
          <Route path="/answers" element={<AnswersPage brandId={brandId} />} />
          <Route path="/activity" element={<ActivityPage brandId={brandId} />} />
          <Route path="/audit" element={<AuditPage brandId={brandId} />} />
          {ops ? (
            <>
              <Route path="/ops" element={<InboxPage brandId={brandId} />} />
              <Route path="/ops/findings/:id" element={<FindingPage brandId={brandId} />} />
              <Route path="/ops/cases" element={<CasesPage brandId={brandId} />} />
              <Route path="/ops/cases/:id" element={<CasePage />} />
              <Route path="/ops/collectors" element={<CollectorsPage brandId={brandId} />} />
              <Route path="/ops/brand" element={<BrandPage brandId={brandId} />} />
              <Route path="/ops/intake" element={<IntakePage brandId={brandId} />} />
              <Route path="/ops/requests" element={<AuditRequestsPage />} />
            </>
          ) : (
            <Route path="/ops/*" element={<Navigate to="/" replace />} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
