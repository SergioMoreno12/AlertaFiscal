import { useEffect, useRef, useState } from "react";
import { Calculator, Building2 } from "lucide-react";
import { logout as apiLogout, me as apiMe, type SessionUser } from "../api/auth.api";
import { backendStatus } from "../api/system.api";
import PublicSite from "./PublicSite";
import { MonthlyDataScreen, TeamScreen } from "./Workspace";
import { AccountScreen } from "./Records";
import { Btn, Card, currentPeriod, roleLabel } from "./ui";
import { onUnauthorized } from "../api/client";
import { getLang, setLang, type Lang } from "../i18n";
import { getCompanies, type Company, type ForecastResult } from "../api/fiscal.api";
import { type BackendState, EMPRESAS, type PlanDraft, type PlanStep, type Screen } from "./shared";
import { NARROW_QUERY, Sidebar, Topbar, useIsNarrow } from "./Layout";
import { EmpresasScreen } from "./screens/Empresas";
import { ResumenScreen } from "./screens/Resumen";
import { IngresosScreen } from "./screens/Ingresos";
import { GastosScreen } from "./screens/Gastos";
import { ProyeccionesScreen } from "./screens/Proyecciones";
import { PlanificacionScreen } from "./screens/Planificacion";
import { EscenariosScreen } from "./screens/Escenarios";
import { ObligacionesScreen } from "./screens/Obligaciones";
import { AlertaDetalleScreen, AlertasScreen } from "./screens/Alertas";
import { HistorialScreen } from "./screens/Historial";
import { ContextoScreen } from "./screens/Contexto";

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
type CompanyCard = { id: number; nombre: string; nit: string; sector: string; tamaño: string; role?: string; estado?: string };

const toCompanyCards = (items: Company[]): CompanyCard[] =>
  items.map((item) => ({
    id: item.id,
    nombre: item.name,
    nit: item.nit,
    sector: item.sector,
    tamaño: item.size,
    role: item.role,
  }));

const PLACE_KEY = "af_place";
const SAVED_SCREENS: Screen[] = ["empresas", "resumen", "ingresos", "gastos", "datos", "proyecciones", "planificacion", "escenarios", "obligaciones", "alertas", "historial", "contexto", "equipo", "cuenta"];

const readSavedPlace = (): { screen: Screen | null; companyId: number | null } => {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(PLACE_KEY) ?? "{}");
    const screen = SAVED_SCREENS.includes(raw.screen) ? (raw.screen as Screen) : null;
    return { screen, companyId: typeof raw.companyId === "number" ? raw.companyId : null };
  } catch {
    return { screen: null, companyId: null };
  }
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [booting, setBooting] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  // The offline demo with sample data was removed: every screen works on real records.
  const demoMode = false;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [companies, setCompanies] = useState<CompanyCard[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
  const narrow = useIsNarrow();
  const [lang, setLangState] = useState<Lang>(getLang());
  // The DOM texts switch at once; the state change re-renders numbers and dates in the new locale.
  const changeLang = (next: Lang) => {
    setLang(next);
    setLangState(next);
  };
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || !window.matchMedia(NARROW_QUERY).matches);
  const mainRef = useRef<HTMLElement | null>(null);
  const [alertDetailId, setAlertDetailId] = useState<number>(1);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planInitialStep, setPlanInitialStep] = useState<PlanStep>(1);
  const [backend, setBackend] = useState<BackendState>({ online: false, database: null, checked: false });

  useEffect(() => {
    if (!loggedIn) return;
    try {
      window.sessionStorage.setItem(PLACE_KEY, JSON.stringify({ screen, companyId: activeCompanyId }));
    } catch {
      // Storage may be blocked; the app still works without it.
    }
  }, [loggedIn, screen, activeCompanyId]);

  // A new screen starts at the top, not at the scroll position of the previous one.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [screen, alertDetailId, activeCompanyId]);

  // Crossing between desktop and phone width resets the menu to its natural state.
  useEffect(() => {
    setSidebarOpen(!narrow);
  }, [narrow]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const ping = async () => {
      const status = await backendStatus();
      if (!alive) return;
      setBackend({ ...status, checked: true });
      timer = window.setTimeout(ping, status.online ? 60000 : 10000);
    };
    ping();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await apiMe();
        if (!alive) return;
        if (session) {
          let cards: CompanyCard[] = session.companies.map((company) => ({
            id: company.id,
            nombre: company.name,
            nit: company.nit,
            sector: "—",
            tamaño: "—",
            role: company.role,
          }));
          try {
            const list = await getCompanies();
            if (!alive) return;
            cards = toCompanyCards(list.items);
          } catch {
            // The session companies are kept if the list fails.
          }
          setUser(session);
          setCompanies(cards);
          // A reload keeps the screen and company the user was working on.
          const saved = readSavedPlace();
          const savedCompany = cards.find((card) => card.id === saved.companyId);
          setActiveCompanyId(savedCompany?.id ?? cards[0]?.id ?? null);
          setLoggedIn(true);
          setScreen(savedCompany && saved.screen ? saved.screen : cards.length ? "resumen" : "empresas");
        }
      } catch {
        // No active session: the login is shown.
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setLoggedIn(false);
      setUser(null);
      setCompanies([]);
      setActiveCompanyId(null);
      setScreen("login");
    });
    return () => onUnauthorized(null);
  }, []);

  const handleLogin = async (sessionUser: SessionUser) => {
    setUser(sessionUser);
    setLoggedIn(true);
    // With a company the overview (and its first steps) is the starting point.
    setScreen(sessionUser.companies.length ? "resumen" : "empresas");
    // Drop "#login" / "#registro" from the address once the user is inside.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      const list = await getCompanies();
      const cards = toCompanyCards(list.items);
      setCompanies(cards);
      setActiveCompanyId(cards[0]?.id ?? null);
    } catch {
      const cards: CompanyCard[] = sessionUser.companies.map((company) => ({
        id: company.id,
        nombre: company.name,
        nit: company.nit,
        sector: "—",
        tamaño: "—",
        role: company.role,
      }));
      setCompanies(cards);
      setActiveCompanyId(cards[0]?.id ?? null);
    }
  };

  const handleLogout = async () => {
    try {
      if (!demoMode) await apiLogout();
    } catch {
      // The local session is cleared anyway.
    }
    try {
      window.sessionStorage.removeItem(PLACE_KEY);
    } catch {
      // Nothing to clear.
    }
    setLoggedIn(false);
    setUser(null);
    setCompanies([]);
    setActiveCompanyId(null);
    setScreen("login");
    // Back to the public home page.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  };

  const handleNav = (next: Screen) => {
    // Navigating to planning by hand must not carry an old draft
    // created from a previous forecast.
    if (next === "planificacion") {
      setPlanDraft(null);
      setPlanInitialStep(1);
    }
    if (narrow) setSidebarOpen(false);
    setScreen(next);
  };

  const handleUseForecast = (forecast: ForecastResult) => {
    const monthly = forecast.monthly ?? [];
    const firstMonth = monthly[0];
    setPlanDraft({
      // The plan is per period: the first forecast month is used.
      // The full horizon stays in the version assumptions.
      projected_income: firstMonth?.projected_income ?? forecast.projected_income ?? "0",
      projected_expenses: firstMonth?.projected_expenses ?? forecast.projected_expenses ?? "0",
      period: firstMonth?.month ?? currentPeriod(),
      assumptions: {
        source: "model_forecast",
        forecast_run_id: forecast.id ?? null,
        method: forecast.method ?? null,
        method_label: forecast.method_label ?? null,
        model_version: forecast.model_version ?? null,
        trained_at: forecast.trained_at ?? null,
        cutoff_date: forecast.cutoff_date ?? null,
        horizon_months: forecast.horizon_months ?? null,
        is_demo: Boolean(forecast.is_demo),
        data_provenance: forecast.data_provenance ?? null,
        monthly,
        note: "The plan uses the first forecast month. The accountant sets the reserve target.",
      },
      sourceForecastId: forecast.id,
      methodLabel: forecast.method_label,
    });
    setPlanInitialStep(3);
    setScreen("planificacion");
  };

  const handleCompanyCreated = (company: Company) => {
    const card: CompanyCard = { id: company.id, nombre: company.name, nit: company.nit, sector: company.sector, tamaño: company.size, role: company.role };
    setCompanies((current) => [...current.filter((c) => c.id !== card.id), card]);
    setActiveCompanyId(card.id);
    // A new company has no history: the next step is to load its monthly data.
    setScreen("datos");
  };

  const handleCompanyUpdated = (company: Company) => {
    setCompanies((current) => current.map((c) => (c.id === company.id ? { ...c, nombre: company.name, nit: company.nit, sector: company.sector, tamaño: company.size } : c)));
  };

  const handleSelectCompany = (id: number) => {
    setActiveCompanyId(id);
    setScreen("resumen");
  };

  const handleViewAlert = (id: number) => {
    setAlertDetailId(id);
    setScreen("alerta-detalle");
  };

  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? null;
  const companyName = activeCompany?.nombre ?? (demoMode ? EMPRESAS[0].nombre : "Select a company");
  const companyId = demoMode ? null : activeCompanyId;
  const canManage = demoMode || activeCompany?.role === "admin" || activeCompany?.role === "contador";

  const companySubtitle = activeCompany
    ? `NIT: ${activeCompany.nit} · Role: ${roleLabel(activeCompany.role ?? "")}${demoMode ? " · Sample data" : ""}`
    : demoMode
      ? "Sample data · Demo session"
      : "No company selected";
  const userName = user?.full_name ?? "Maria Gomez";
  const userRole = activeCompany?.role ? roleLabel(activeCompany.role) : demoMode ? "Demo session" : user ? "No active company" : "Guest";

  const needsCompany = loggedIn && !demoMode && !activeCompany;

  if (booting) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#F5F8F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#E3F1E8", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Calculator size={22} color="#1B5E3F" />
        </div>
        <div style={{ fontSize: 13, color: "#66786F" }}>Checking session…</div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <PublicSite
        lang={lang}
        onLang={changeLang}
        onAuthenticated={handleLogin}
        backendOnline={backend.online}
        backendChecked={backend.checked}
      />
    );
  }

  return (
    <div style={{ height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: "#F5F8F6", overflow: "hidden", position: "relative" }}>
      <Sidebar open={sidebarOpen} overlay={narrow} onClose={() => setSidebarOpen(false)} screen={screen} onNav={handleNav} userName={userName} userRole={userRole} apiOnline={backend.online} />

      <main ref={mainRef} className={narrow ? "af-main af-narrow" : "af-main"} style={{ height: "100vh", overflowY: "auto", marginLeft: sidebarOpen && !narrow ? 240 : 0, transition: "margin-left 0.28s cubic-bezier(0.4,0,0.2,1)", display: "flex", flexDirection: "column" }}>
        <Topbar sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} empresa={needsCompany ? "AlertaFiscal" : companyName} companySubtitle={companySubtitle} backend={backend} demoMode={demoMode} onLogout={handleLogout} compact={narrow} lang={lang} onLang={changeLang} />

        <div style={{ flex: 1 }}>
          {screen === "empresas" && <EmpresasScreen companies={companies} onSelect={handleSelectCompany} onCreated={handleCompanyCreated} onUpdated={handleCompanyUpdated} canEdit={!demoMode} />}

          {screen === "cuenta" && <AccountScreen userName={user?.full_name ?? ""} userEmail={user?.email ?? ""} demoMode={demoMode} />}

          {screen !== "empresas" && screen !== "contexto" && screen !== "cuenta" && needsCompany && (
            <div style={{ padding: "28px 32px" }}>
              <Card style={{ textAlign: "center", padding: "48px 24px" }}>
                <Building2 size={40} color="#9CCDB1" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: "#33433B", marginBottom: 6 }}>Select a company</div>
                <p style={{ fontSize: 13, color: "#66786F", margin: "0 0 18px" }}>Your user has no active company selected. Choose one to see its planning.</p>
                <Btn variant="primary" onClick={() => setScreen("empresas")}>Go to companies</Btn>
              </Card>
            </div>
          )}

          {screen === "resumen" && !needsCompany && <ResumenScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} />}
          {screen === "ingresos" && !needsCompany && <IngresosScreen companyId={companyId} companyName={companyName} demoMode={demoMode} canManage={canManage} />}
          {screen === "gastos" && !needsCompany && <GastosScreen companyId={companyId} companyName={companyName} demoMode={demoMode} canManage={canManage} />}
          {screen === "proyecciones" && !needsCompany && <ProyeccionesScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} onUseForecast={handleUseForecast} />}
          {screen === "planificacion" && !needsCompany && <PlanificacionScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} draft={planDraft} initialStep={planInitialStep} />}
          {screen === "escenarios" && !needsCompany && <EscenariosScreen companyId={companyId} companyName={companyName} onNav={handleNav} />}
          {screen === "obligaciones" && !needsCompany && <ObligacionesScreen companyId={companyId} companyName={companyName} demoMode={demoMode} canManage={canManage} />}
          {screen === "alertas" && !needsCompany && <AlertasScreen companyId={companyId} companyName={companyName} demoMode={demoMode} canManage={canManage} onViewDetail={handleViewAlert} onNav={handleNav} />}
          {screen === "alerta-detalle" && !needsCompany && (
            <AlertaDetalleScreen
              key={alertDetailId}
              companyId={companyId}
              alertId={alertDetailId}
              companyName={companyName}
              demoMode={demoMode}
              canManage={canManage}
              onBack={() => setScreen("alertas")}
              onNav={handleNav}
            />
          )}
          {screen === "historial" && !needsCompany && <HistorialScreen companyId={companyId} companyName={companyName} demoMode={demoMode} />}
          {screen === "contexto" && <ContextoScreen demoMode={demoMode} />}
          {screen === "datos" && !needsCompany && <MonthlyDataScreen key={companyId ?? 0} companyId={companyId} companyName={companyName} onNav={handleNav} canManage={canManage} />}
          {screen === "equipo" && !needsCompany && <TeamScreen key={companyId ?? 0} companyId={companyId} companyName={companyName} isAdmin={activeCompany?.role === "admin"} currentUserId={user?.id ?? null} />}
        </div>

        <footer style={{ padding: "12px 32px", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#9AABA2", textAlign: "center", backgroundColor: "#fff" }}>
          {demoMode
            ? "Demo environment · Simulated data · Independent academic project. Not affiliated with the DIAN."
            : "Independent academic project. Not affiliated with the DIAN. The figures are planning estimates, not official assessments."}
        </footer>
      </main>
    </div>
  );
}
