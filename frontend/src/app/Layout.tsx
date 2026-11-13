import { useEffect, useState } from "react";
import {
  LayoutDashboard, Bell, ShoppingCart, TrendingUp, Calculator, Calendar, Building2, User, Menu, X,
  Layers, BarChart2, LogOut, BookOpen, Database, KeyRound,
} from "lucide-react";
import { type Lang } from "../i18n";
import { type BackendState, DemoBanner, LanguageToggle, type Screen } from "./shared";

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────
export const NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType; badge?: number }[] = [
  { id: "resumen", label: "Overview", icon: LayoutDashboard },
  { id: "empresas", label: "Companies", icon: Building2 },
  { id: "ingresos", label: "Income and sales", icon: TrendingUp },
  { id: "gastos", label: "Expenses and purchases", icon: ShoppingCart },
  { id: "datos", label: "Monthly data", icon: Layers },
  { id: "proyecciones", label: "Forecasts", icon: BarChart2 },
  { id: "planificacion", label: "Tax planning", icon: Calculator },
  { id: "obligaciones", label: "Obligations and calendar", icon: Calendar },
  { id: "alertas", label: "Alerts and follow-up", icon: Bell },
  { id: "historial", label: "History", icon: BookOpen },
];

// Secondary section: public reference information, separate from the
// operational flow. It creates no alerts or tasks.
export const SECONDARY_NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType }[] = [
  { id: "equipo", label: "Team", icon: User },
  { id: "cuenta", label: "My account", icon: KeyRound },
  { id: "contexto", label: "Context and sources", icon: Database },
];

// The menu follows the order of use: record data, forecast and plan, then follow up.
export const navItem = (id: Screen) => [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].find((item) => item.id === id)!;
export const NAV_GROUPS: { title?: string; items: { id: Screen; label: string; icon: React.ElementType; badge?: number }[] }[] = [
  { items: [navItem("resumen")] },
  { title: "1 · Your data", items: [navItem("datos"), navItem("ingresos"), navItem("gastos")] },
  { title: "2 · Forecast and plan", items: [navItem("proyecciones"), navItem("planificacion"), navItem("obligaciones")] },
  { title: "3 · Follow-up", items: [navItem("alertas"), navItem("historial")] },
  { title: "Settings and reference", items: [navItem("empresas"), navItem("equipo"), navItem("cuenta"), navItem("contexto")] },
];

// Below this width the sidebar floats over the content instead of pushing it.
export const NARROW_QUERY = "(max-width: 900px)";

export const useIsNarrow = () => {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
};

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
export const Sidebar = ({ open, overlay, onClose, screen, onNav, userName, userRole, apiOnline }: { open: boolean; overlay: boolean; onClose: () => void; screen: Screen; onNav: (s: Screen) => void; userName: string; userRole: string; apiOnline: boolean }) => (
  <>
    {open && overlay && <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", zIndex: 9 }} />}
    <aside aria-label="Main navigation" style={{ width: 240, minWidth: 240, background: "linear-gradient(180deg, #154D33 0%, #0F3B27 100%)", display: "flex", flexDirection: "column", height: "100vh", position: "fixed", top: 0, left: 0, zIndex: 10, transform: open ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", boxShadow: open ? "4px 0 20px rgba(0,0,0,0.12)" : "none" }}>
      <div style={{ padding: "20px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Calculator size={18} color="#fff" />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15, lineHeight: 1, letterSpacing: "-0.3px" }}>AlertaFiscal</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 3 }}>Tax planning</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close menu" style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
          <X size={14} />
        </button>
      </div>

      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title ?? "top"}>
            {group.title && <div style={{ margin: "14px 12px 8px", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase" }}>{group.title}</div>}
            {group.items.map((item) => {
              const active = item.id === screen;
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => { onNav(item.id); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", borderRadius: 9, marginBottom: 2, border: "none", cursor: "pointer", backgroundColor: active ? "rgba(255,255,255,0.14)" : "transparent", color: active ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: active ? 600 : 400, fontSize: 13, textAlign: "left", transition: "background-color 0.15s", fontFamily: "inherit" }}>
                  <Icon size={16} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge !== undefined && (
                    <span style={{ backgroundColor: "#C9A227", color: "#1B5E3F", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700, lineHeight: "18px" }}>{item.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <User size={14} color="rgba(255,255,255,0.85)" />
        </div>
        <div style={{ overflow: "hidden" }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>{userRole}</div>
        </div>
      </div>
      {!apiOnline && (
        <div role="status" style={{ padding: "10px 18px 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.75)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#C9A227", display: "inline-block" }} />
          No connection to the server
        </div>
      )}
    </aside>
  </>
);

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
export const Topbar = ({ sidebarOpen, onToggle, empresa, companySubtitle, backend, demoMode, onLogout, compact, lang, onLang }: { sidebarOpen: boolean; onToggle: () => void; empresa: string; companySubtitle: string; backend: BackendState; demoMode: boolean; onLogout: () => void; compact: boolean; lang: Lang; onLang: (lang: Lang) => void }) => (
  <header style={{ backgroundColor: "#fff", borderBottom: "1px solid rgba(0,0,0,0.07)", padding: compact ? "10px 14px" : "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, position: "sticky", top: 0, zIndex: 5 }}>
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 10 : 14, minWidth: 0 }}>
      <button onClick={onToggle} aria-label={sidebarOpen ? "Close menu" : "Open menu"} style={{ flexShrink: 0, background: sidebarOpen ? "#E3F1E8" : "#1B5E3F", border: "none", borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sidebarOpen ? "#1B5E3F" : "#fff" }}>
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#1B5E3F", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{empresa}</div>
        {!compact && <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>{companySubtitle}</div>}
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      {!compact && backend.checked && !backend.online && <span
        role="status"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #E9D49C", backgroundColor: "#FBF4E2", color: "#8A6400", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#C9A227", display: "inline-block" }} />
        No connection to the server
      </span>}
      {demoMode && !compact && <DemoBanner />}
      <LanguageToggle lang={lang} onChange={onLang} />
      <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#66786F", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
        <LogOut size={12} /> {compact ? "" : "Sign out"}
      </button>
    </div>
  </header>
);
