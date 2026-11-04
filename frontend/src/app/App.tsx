import { useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import {
  LayoutDashboard, Bell, FileText, ShoppingCart, TrendingUp,
  Calculator, Calendar, AlertTriangle, Clock, Building2,
  ChevronRight, CheckCircle, AlertCircle, User, Menu, X,
  Plus, Download, RefreshCw, Eye, Edit3, Save, ArrowLeft,
  Info, Flag, Layers, Search, Filter, BarChart2, MessageSquare,
  LogOut, LogIn, ChevronDown, BookOpen, Database, ExternalLink,
} from "lucide-react";
import { login as apiLogin, logout as apiLogout, me as apiMe, type SessionUser } from "../api/auth.api";
import { backendStatus } from "../api/system.api";
import { ApiError, onUnauthorized } from "../api/client";
import {
  getContextSummary,
  type ContextBenchmark,
  type ContextSource,
  type ContextSummary,
  type ContextTaxSummary,
} from "../api/context.api";
import {
  addAlertComment,
  createAlert,
  createExpense,
  createForecast,
  createIncome,
  createModelForecast,
  createObligation,
  createPlan,
  createPlanVersion,
  createReserve,
  evaluateAlerts,
  getAlert,
  getCompanies,
  getDashboard,
  getPlan,
  listAlerts,
  getMonitoring,
  listAudit,
  listCounterparties,
  listExpenses,
  listFiscalParameters,
  listForecasts,
  listIncome,
  listObligations,
  listPlans,
  listReserves,
  reviewPlanVersion,
  updateAlert,
  updateExpense,
  updateObligation,
  type Alert as ApiAlert,
  type AuditEvent,
  type MonitoringStatus,
  type MonitoringView,
  type Company,
  type Counterparty,
  type Dashboard,
  type Expense,
  type FiscalParameter,
  type ForecastResult,
  type ForecastRun,
  type Income,
  type Obligation,
  type Pagination,
  type Plan,
  type PlanDetail,
} from "../api/fiscal.api";

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen =
  | "login" | "empresas" | "resumen" | "ingresos" | "gastos"
  | "proyecciones" | "planificacion" | "escenarios" | "obligaciones"
  | "alertas" | "alerta-detalle" | "historial" | "contexto";

type AlertPriority = "alta" | "media" | "baja";
type AlertStatus = "pendiente" | "en-revision" | "revisada";
type AlertOrigin = "erp" | "plan" | "proyeccion" | "configuracion";
type PlanStep = 1 | 2 | 3;
type PlanDraft = {
  projected_income: string;
  projected_expenses: string;
  period: string;
  assumptions: Record<string, unknown>;
  sourceForecastId?: number;
  methodLabel?: string;
};
type BackendState = { online: boolean; database: string | null; checked: boolean };

// ─── Constants & Demo Data ────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

const fmtM = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)} M COP`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)} K COP`;
  return fmt(n);
};

const roleLabel = (role: string) =>
  ({ admin: "Company administrator", contador: "Accountant", auxiliar: "Accounting assistant" } as Record<string, string>)[role] ?? role;

const num = (value: string | number | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
};

const shortMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short" });
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "The operation could not be completed.";

const downloadCsv = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const alertStatusUi = (status: string): AlertStatus =>
  status === "reviewed" ? "revisada" : status === "in_review" ? "en-revision" : "pendiente";

const obligationStatusLabel = (status: string) =>
  ({ pending: "Pending", filed: "Filed", paid: "Paid", void: "Void" } as Record<string, string>)[status] ?? status;

const todayISO = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const currentPeriod = () => todayISO().slice(0, 7);

const toMoneyString = (raw: string) => {
  const parsed = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "0.00";
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1.5px solid #CFD8DC",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
  backgroundColor: "#fff",
  color: "#37474F",
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: "#37474F", display: "block", marginBottom: 5 }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 4 }}>{hint}</div>}
  </div>
);

const InlineError = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FFEBEE", border: "1px solid #FFCDD2", color: "#C62828", fontSize: 12 }}>
    {message}
    {onRetry && (
      <>
        {" · "}
        <button onClick={onRetry} style={{ border: "none", background: "none", color: "#C62828", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>retry</button>
      </>
    )}
  </div>
);

const EMPRESAS = [
  { id: 1, nombre: "Andean Trading S.A.S.", nit: "900.456.123-1", sector: "Retail", tamaño: "Small", periodo: "Oct 2026", estado: "plan-actualizado" },
  { id: 2, nombre: "Bogota Services Ltda.", nit: "830.912.045-2", sector: "Services", tamaño: "Small", periodo: "Oct 2026", estado: "por-revisar" },
  { id: 3, nombre: "Narino Construction S.A.S.", nit: "901.234.567-0", sector: "Construction", tamaño: "Small", periodo: "Oct 2026", estado: "parametros-pendientes" },
  { id: 4, nombre: "El Trigal Bakery", nit: "10.234.567-8", sector: "Food", tamaño: "Micro", periodo: "Oct 2026", estado: "sin-registros" },
];

const ESTADO_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  "plan-actualizado": { label: "Plan updated", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" },
  "por-revisar": { label: "To review", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" },
  "parametros-pendientes": { label: "Parameters pending", color: "#FBC02D", bg: "#FFF8E1", border: "#FFE082" },
  "sin-registros": { label: "No records", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" },
};

const HISTORICO = [
  { mes: "May", ingresos: 42000000, gastos: 28000000 },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000 },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000 },
  { mes: "Aug", ingresos: 62300000, gastos: 41000000 },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000 },
  { mes: "Oct*", ingresos: 35000000, gastos: 23000000, proyIngreso: 55000000, proyGasto: 37000000 },
];

const PROYECCION_DATA = [
  { mes: "May", ingresos: 42000000, gastos: 28000000, tipo: "obs" },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000, tipo: "obs" },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000, tipo: "obs" },
  { mes: "Aug", ingresos: 62300000, gastos: 41000000, tipo: "obs" },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000, tipo: "obs" },
  { mes: "Oct", ingresos: null, gastos: null, proyIngreso: 55000000, proyGasto: 37000000, tipo: "proy" },
  { mes: "Nov", ingresos: null, gastos: null, proyIngreso: 58000000, proyGasto: 39000000, tipo: "proy" },
];

const INGRESOS_TABLE = [
  { id: 1, fecha: "02/10/2026", cliente: "Central Hardware", doc: "FE-2026-1101", desc: "Sale of goods", base: 5000000, iva: 950000, total: 5950000, estado: "Collected" },
  { id: 2, fecha: "05/10/2026", cliente: "North Distribution", doc: "FE-2026-1102", desc: "Sale of products", base: 8400000, iva: 1596000, total: 9996000, estado: "Pending" },
  { id: 3, fecha: "10/10/2026", cliente: "South Trading", doc: "FE-2026-1103", desc: "Wholesale", base: 12000000, iva: 2280000, total: 14280000, estado: "Collected" },
  { id: 4, fecha: "14/10/2026", cliente: "Minimarket Express", doc: "FE-2026-1104", desc: "Venta surtido", base: 3800000, iva: 722000, total: 4522000, estado: "Collected" },
  { id: 5, fecha: "17/10/2026", cliente: "Andean Stores", doc: "FE-2026-1105", desc: "Wholesale sale", base: 5800000, iva: 1102000, total: 6902000, estado: "Pending" },
];

const GASTOS_TABLE = [
  { id: 1, fecha: "01/10/2026", proveedor: "Andean Imports", doc: "FC-20261001", cat: "Goods", base: 9500000, iva: 1805000, total: 11305000, pago: "Paid", revision: "Reviewed" },
  { id: 2, fecha: "05/10/2026", proveedor: "Logistics Services S.A.", doc: "FC-20261042", cat: "Logistics", base: 2100000, iva: 399000, total: 2499000, pago: "Pending", revision: "Not reviewed" },
  { id: 3, fecha: "08/10/2026", proveedor: "Arrendadora Central", doc: "RC-20261008", cat: "Arrendamiento", base: 3500000, iva: 0, total: 3500000, pago: "Paid", revision: "Reviewed" },
  { id: 4, fecha: "12/10/2026", proveedor: "Utilities", doc: "SV-20261012", cat: "Services", base: 450000, iva: 0, total: 450000, pago: "Paid", revision: "Not reviewed" },
  { id: 5, fecha: "15/10/2026", proveedor: "Office Supplies", doc: "FC-20261055", cat: "Admin. expenses", base: 280000, iva: 53200, total: 333200, pago: "Paid", revision: "Not reviewed" },
];

const ALERTAS_DATA = [
  { id: 1, titulo: "$1,500,000 missing to cover the reserve target", prioridad: "alta" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "19/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "The recorded reserve ($3,000,000) does not yet cover the target set by the accountant ($4,500,000). Missing: $1,500,000 (33.3%).", valores: [{ label: "Reserve target", valor: "$4,500,000" }, { label: "Recorded reserve", valor: "$3,000,000" }, { label: "Missing", valor: "$1,500,000" }], sugerencia: "Check whether funds are available to complete the reserve before the period closes. Adjust the plan if the business cannot cover the target on the planned dates." },
  { id: 2, titulo: "VAT obligation close to its recorded date", prioridad: "media" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "18/10/2026", responsable: "Maria Gomez", estado: "en-revision" as AlertStatus, desc: "The bimonthly VAT obligation has a recorded due date of October 28, 2026. 9 days are left according to the cutoff date.", valores: [{ label: "VAT arithmetic difference", valor: "$2,550,000" }, { label: "Recorded due date", valor: "28/10/2026" }], sugerencia: "Check with the accountant whether the filing period applies to this company and confirm the official date in the tax calendar." },
  { id: 3, titulo: "Expenses pending accounting review", prioridad: "baja" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "17/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "There are 3 expense records marked as 'Not reviewed'. They cannot be included in estimates until the accountant reviews them.", valores: [{ label: "Expenses not reviewed", valor: "3 records" }, { label: "Total amount not reviewed", valor: "$3,282,200" }], sugerencia: "Review the pending expenses and mark them as reviewed, or add a note about how to treat them." },
  { id: 4, titulo: "Recorded income differs from the planned scenario", prioridad: "media" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "15/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "Income recorded at the cutoff ($35,000,000) is 63.6% of the closing forecast ($55,000,000). 36.4% of the month is still to be recorded.", valores: [{ label: "Recorded at cutoff", valor: "$35,000,000" }, { label: "Forecast at close", valor: "$55,000,000" }], sugerencia: "Check whether there are sales still to record. If the forecast close looks hard to reach, consider updating the forecast." },
];

const OBLIGACIONES_DATA = [
  { id: 1, obligacion: "Bimonthly VAT (Sep-Oct 2026)", periodo: "Sep-Oct 2026", vencimiento: "28/10/2026", fuente: "Recorded by the accountant", estimado: "$2,550,000", presentacion: "Pending", pago: "Pending", revision: "In review" },
  { id: 2, obligacion: "Withholding tax (Oct 2026)", periodo: "Oct 2026", vencimiento: "12/11/2026", fuente: "Recorded by the accountant", estimado: "To be defined", presentacion: "Pending", pago: "Pending", revision: "Not reviewed" },
  { id: 3, obligacion: "ICA (Bogota - annual)", periodo: "2026", vencimiento: "15/03/2027", fuente: "Recorded by the accountant", estimado: "Estimate pending", presentacion: "Pending", pago: "Pending", revision: "Not reviewed" },
  { id: 4, obligacion: "IVA bimestral (Jul-Ago 2026)", periodo: "Jul-Ago 2026", vencimiento: "28/08/2026", fuente: "Recorded by the accountant", estimado: "$3.200.000", presentacion: "Filed", pago: "Paid", revision: "Reviewed" },
];

const HISTORIAL_DATA = [
  { id: 1, fecha: "19/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Tax plan", version: "v2", origen: "Manual", responsable: "Maria Gomez", estado: "Draft" },
  { id: 2, fecha: "15/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Forecast", version: "v1", origen: "Simulated forecast", responsable: "Maria Gomez", estado: "Generated" },
  { id: 3, fecha: "10/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Tax plan", version: "v1", origen: "Manual", responsable: "Maria Gomez", estado: "Reviewed" },
  { id: 4, fecha: "30/09/2026", empresa: "Andean Trading S.A.S.", periodo: "Sep 2026", tipo: "Tax plan", version: "v1", origen: "Manual", responsable: "Maria Gomez", estado: "Reviewed" },
];

// ─── UI Primitives ────────────────────────────────────────────────────────────
const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "24px 28px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)", ...style }}>
    {children}
  </div>
);

const Badge = ({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, backgroundColor: bg, color, border: `1px solid ${border}`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2px", whiteSpace: "nowrap" }}>
    {label}
  </span>
);

const PriorityBadge = ({ p }: { p: AlertPriority }) => {
  const cfg = { alta: { label: "High", color: "#E53935", bg: "#FFEBEE", border: "#FFCDD2" }, media: { label: "Medium", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" }, baja: { label: "Low", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" } }[p];
  return <Badge {...cfg} />;
};

const StatusBadge = ({ s }: { s: AlertStatus }) => {
  const cfg = { pendiente: { label: "Pending", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" }, "en-revision": { label: "In review", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" }, revisada: { label: "Resolved", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" } }[s];
  return <Badge {...cfg} />;
};

const Btn = ({ children, variant = "primary", onClick, icon, small, fullWidth, disabled }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void; icon?: React.ReactNode; small?: boolean; fullWidth?: boolean; disabled?: boolean }) => {
  const styles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: "#1B5E3F", color: "#fff", border: "none" },
    secondary: { backgroundColor: "transparent", color: "#1B5E3F", border: "1.5px solid #1B5E3F" },
    ghost: { backgroundColor: "transparent", color: "#78909C", border: "1px solid rgba(0,0,0,0.1)" },
    danger: { backgroundColor: "#FFEBEE", color: "#E53935", border: "1px solid #FFCDD2" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], borderRadius: 9, padding: small ? "7px 14px" : "10px 18px", fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", transition: "opacity 0.15s", width: fullWidth ? "100%" : undefined, justifyContent: fullWidth ? "center" : undefined }}>
      {icon}{children}
    </button>
  );
};

const DemoBanner = () => (
  <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 8, padding: "7px 14px", fontSize: 11, color: "#E65100", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
    <Info size={13} /> Demo environment · Simulated data
  </div>
);

const SectionHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1B5E3F", margin: 0, letterSpacing: "-0.3px" }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: "#78909C", margin: "4px 0 0" }}>{subtitle}</p>}
    </div>
    {actions && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
  </div>
);

const Pager = ({ info, onPage, noun }: { info: Pagination | null; onPage: (page: number) => void; noun: string }) => {
  if (!info || info.total === 0) return null;
  const first = (info.page - 1) * info.page_size + 1;
  const last = Math.min(info.page * info.page_size, info.total);
  return (
    <div style={{ padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 12, color: "#78909C" }}>
      <span>{first}–{last} of {info.total} {noun}</span>
      {info.pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn variant="ghost" small disabled={info.page <= 1} onClick={() => onPage(info.page - 1)}>Previous</Btn>
          <span>Page {info.page} of {info.pages}</span>
          <Btn variant="ghost" small disabled={info.page >= info.pages} onClick={() => onPage(info.page + 1)}>Next</Btn>
        </div>
      )}
    </div>
  );
};

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType; badge?: number }[] = [
  { id: "resumen", label: "Overview", icon: LayoutDashboard },
  { id: "empresas", label: "Companies", icon: Building2 },
  { id: "ingresos", label: "Income and sales", icon: TrendingUp },
  { id: "gastos", label: "Expenses and purchases", icon: ShoppingCart },
  { id: "proyecciones", label: "Forecasts", icon: BarChart2 },
  { id: "planificacion", label: "Tax planning", icon: Calculator },
  { id: "obligaciones", label: "Obligations and calendar", icon: Calendar },
  { id: "alertas", label: "Alerts and follow-up", icon: Bell },
  { id: "historial", label: "History", icon: BookOpen },
];

// Secondary section: public reference information, separate from the
// operational flow. It creates no alerts or tasks.
const SECONDARY_NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType }[] = [
  { id: "contexto", label: "Context and sources", icon: Database },
];

// Below this width the sidebar floats over the content instead of pushing it.
const NARROW_QUERY = "(max-width: 900px)";

const useIsNarrow = () => {
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
const Sidebar = ({ open, overlay, onClose, screen, onNav, userName, userRole, apiOnline }: { open: boolean; overlay: boolean; onClose: () => void; screen: Screen; onNav: (s: Screen) => void; userName: string; userRole: string; apiOnline: boolean }) => (
  <>
    {open && overlay && <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", zIndex: 9 }} />}
    <aside aria-label="Main navigation" style={{ width: 240, minWidth: 240, backgroundColor: "#1B5E3F", display: "flex", flexDirection: "column", height: "100vh", position: "fixed", top: 0, left: 0, zIndex: 10, transform: open ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", boxShadow: open ? "4px 0 20px rgba(0,0,0,0.12)" : "none" }}>
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
        {NAV_ITEMS.map((item) => {
          const active = item.id === screen;
          const Icon = item.icon;
          return (
            <button key={item.id} onClick={() => { onNav(item.id); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", borderRadius: 9, marginBottom: 2, border: "none", cursor: "pointer", backgroundColor: active ? "rgba(255,255,255,0.14)" : "transparent", color: active ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: active ? 600 : 400, fontSize: 13, textAlign: "left", transition: "background-color 0.15s", fontFamily: "inherit" }}>
              <Icon size={16} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge !== undefined && (
                <span style={{ backgroundColor: "#FBC02D", color: "#1B5E3F", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700, lineHeight: "18px" }}>{item.badge}</span>
              )}
            </button>
          );
        })}

        <div style={{ margin: "14px 12px 8px", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase" }}>
          Reference
        </div>
        {SECONDARY_NAV_ITEMS.map((item) => {
          const active = item.id === screen;
          const Icon = item.icon;
          return (
            <button key={item.id} onClick={() => { onNav(item.id); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", borderRadius: 9, marginBottom: 2, border: "none", cursor: "pointer", backgroundColor: active ? "rgba(255,255,255,0.14)" : "transparent", color: active ? "#fff" : "rgba(255,255,255,0.45)", fontWeight: active ? 600 : 400, fontSize: 13, textAlign: "left", transition: "background-color 0.15s", fontFamily: "inherit" }}>
              <Icon size={16} />
              <span style={{ flex: 1 }}>{item.label}</span>
            </button>
          );
        })}
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
      <div style={{ padding: "10px 18px 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.55)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: apiOnline ? "#66BB6A" : "#FBC02D", display: "inline-block" }} />
        {apiOnline ? "API connected" : "No connection to the API"}
      </div>
    </aside>
  </>
);

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
const Topbar = ({ sidebarOpen, onToggle, empresa, companySubtitle, backend, demoMode, onLogout, compact }: { sidebarOpen: boolean; onToggle: () => void; empresa: string; companySubtitle: string; backend: BackendState; demoMode: boolean; onLogout: () => void; compact: boolean }) => (
  <header style={{ backgroundColor: "#fff", borderBottom: "1px solid rgba(0,0,0,0.07)", padding: compact ? "10px 14px" : "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, position: "sticky", top: 0, zIndex: 5 }}>
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 10 : 14, minWidth: 0 }}>
      <button onClick={onToggle} aria-label={sidebarOpen ? "Close menu" : "Open menu"} style={{ flexShrink: 0, background: sidebarOpen ? "#E8F5E9" : "#1B5E3F", border: "none", borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sidebarOpen ? "#1B5E3F" : "#fff" }}>
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#1B5E3F", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{empresa}</div>
        {!compact && <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>{companySubtitle}</div>}
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      {!compact && <span
        title={backend.online ? "Backend and database respond" : "Backend not available"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${backend.online ? "#A5D6A7" : "#FFE082"}`, backgroundColor: backend.online ? "#E8F5E9" : "#FFF8E1", color: backend.online ? "#1B5E3F" : "#B26A00", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: backend.online ? "#43A047" : "#FBC02D", display: "inline-block" }} />
        {backend.checked ? (backend.online ? `API · ${backend.database ?? "ok"}` : "API unavailable") : "Checking API"}
      </span>}
      {demoMode && !compact && <DemoBanner />}
      <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#78909C", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
        <LogOut size={12} /> {compact ? "" : "Sign out"}
      </button>
    </div>
  </header>
);

// ─── SCREENS ──────────────────────────────────────────────────────────────────

// LOGIN
const LoginScreen = ({
  onLogin,
  onDemo,
  backend,
}: {
  onLogin: (user: SessionUser) => void;
  onDemo: () => void;
  backend: BackendState;
}) => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  // The seed credentials exist only in the local SQLite demo database (flask seed-demo).
  const localDemo = backend.online && backend.database === "sqlite-dev";
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = { width: "100%", padding: "11px 14px", borderRadius: 9, border: "1.5px solid #CFD8DC", fontSize: 14, fontFamily: "inherit", color: "#37474F", backgroundColor: "#FAFAFA", boxSizing: "border-box", outline: "none" };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#37474F", marginBottom: 6, display: "block" };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const user = await apiLogin(email.trim(), pass);
      onLogin(user);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMsg(
          error.code === "network_error" || error.code === "timeout"
            ? "Could not connect to the server. It may still be starting: wait a moment and try again, or explore the visual demo."
            : error.message,
        );
      } else {
        setErrorMsg("Could not sign in.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F5F7F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ backgroundColor: "#fff", borderRadius: 20, padding: "48px 44px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, backgroundColor: "#E8F5E9", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Calculator size={26} color="#1B5E3F" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1B5E3F", margin: "0 0 6px", letterSpacing: "-0.5px" }}>AlertaFiscal</h1>
          <p style={{ fontSize: 13, color: "#78909C", margin: 0 }}>Tax planning for small businesses</p>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="email">Email</label>
            <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} type="email" autoComplete="username" required />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle} htmlFor="password">Password</label>
            <input id="password" value={pass} onChange={(e) => setPass(e.target.value)} style={inputStyle} type="password" autoComplete="current-password" required />
          </div>

          {errorMsg && (
            <div role="alert" style={{ marginBottom: 18, padding: "10px 12px", borderRadius: 9, backgroundColor: "#FFEBEE", border: "1px solid #FFCDD2", color: "#C62828", fontSize: 12, fontWeight: 600 }}>
              {errorMsg}
            </div>
          )}

          <button type="submit" disabled={loading} style={{ width: "100%", backgroundColor: "#1B5E3F", color: "#fff", border: "none", borderRadius: 11, padding: "14px", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.75 : 1 }}>
            <LogIn size={16} /> {loading ? (backend.online ? "Signing in…" : "Waking up the server…") : "Sign in"}
          </button>
        </form>

        <button onClick={onDemo} type="button" style={{ marginTop: 12, width: "100%", backgroundColor: "transparent", color: "#1B5E3F", border: "1.5px solid #1B5E3F", borderRadius: 11, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          Explore the visual demo (sample data)
        </button>

        {localDemo && (
          <div style={{ marginTop: 24, padding: "14px 16px", backgroundColor: "#FFF8E1", borderRadius: 10, border: "1px solid #FFE082" }}>
            <div style={{ fontSize: 11, color: "#E65100", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}><Info size={12} /> Local demo database</div>
            <p style={{ fontSize: 11, color: "#78909C", margin: "0 0 8px", lineHeight: 1.6 }}>
              The local seed user is maria.gomez@contaduria.co / demo2026. The data is fictitious.
            </p>
            <button type="button" onClick={() => { setEmail("maria.gomez@contaduria.co"); setPass("demo2026"); }} style={{ border: "none", background: "none", padding: 0, color: "#1B5E3F", fontWeight: 700, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
              Fill in the seed user
            </button>
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: backend.online ? "#1B5E3F" : "#B26A00" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: backend.online ? "#43A047" : "#FBC02D", display: "inline-block" }} />
          {backend.checked
            ? (backend.online ? `API connected · ${backend.database ?? "database"}` : "API not reachable yet · it may be starting (up to a minute)")
            : "Connecting to the server… (the first visit can take up to a minute)"}
        </div>

        <p style={{ fontSize: 11, color: "#B0BEC5", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
          Independent academic project. Not affiliated with the DIAN.
        </p>
      </div>
    </div>
  );
};


// EMPRESAS
const EmpresasScreen = ({
  companies,
  onSelect,
}: {
  companies: Array<{ id: number; nombre: string; nit: string; sector: string; tamaño: string; role?: string; estado?: string }>;
  onSelect: (id: number) => void;
}) => {
  const [search, setSearch] = useState("");
  const filtered = companies.filter((e) => e.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Companies" subtitle="Select a company to see its tax planning" />

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#78909C" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company..." style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 9, border: "1.5px solid #CFD8DC", fontSize: 13, fontFamily: "inherit", color: "#37474F", backgroundColor: "#fff", boxSizing: "border-box", outline: "none" }} />
        </div>
        <Btn variant="ghost" icon={<Filter size={14} />}>Filter</Btn>
      </div>

      {filtered.length === 0 && (
        <Card style={{ padding: "32px 24px", textAlign: "center", color: "#78909C", fontSize: 13 }}>
          {companies.length === 0
            ? "Your user has no active companies. Ask the administrator to assign one."
            : "No company matches the search."}
        </Card>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {filtered.map((emp) => {
          const st = emp.estado
            ? ESTADO_CONFIG[emp.estado] ?? ESTADO_CONFIG["por-revisar"]
            : { label: emp.role ? roleLabel(emp.role) : "Active", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" };
          return (
            <Card key={emp.id} style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <div style={{ width: 44, height: 44, backgroundColor: "#E8F5E9", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Building2 size={22} color="#1B5E3F" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F" }}>{emp.nombre}</div>
                  <div style={{ fontSize: 12, color: "#78909C", marginTop: 3 }}>
                    NIT: {emp.nit} · {emp.sector} · {emp.tamaño}{emp.role ? ` · ${roleLabel(emp.role)}` : ""}
                  </div>
                </div>
                <Badge label={st.label} color={st.color} bg={st.bg} border={st.border} />
                <Btn variant="primary" small onClick={() => onSelect(emp.id)}>Select</Btn>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// RESUMEN
const ResumenScreen = ({
  onNav,
  companyId,
  companyName,
  demoMode,
}: {
  onNav: (s: Screen) => void;
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
}) => {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [apiAlerts, setApiAlerts] = useState<ApiAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!companyId || demoMode) {
      setDashboard(null);
      setApiAlerts([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    // Evaluating rules is an explicit action: the dashboard GET never writes
    // alerts. If the role cannot evaluate, the existing state is shown.
    evaluateAlerts(companyId)
      .catch(() => null)
      .then(() => Promise.all([getDashboard(companyId), listAlerts(companyId)]))
      .then(([summary, alerts]) => {
        if (!alive) return;
        setDashboard(summary);
        setApiAlerts(alerts.items.slice(0, 3));
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  const plan = dashboard?.plan ?? null;
  const latestForecast = dashboard?.latest_forecast ?? null;
  const reserve = dashboard?.reserve ?? null;
  const hasData = Boolean(dashboard);
  const income = hasData ? num(dashboard?.totals.income) : demoMode ? 35000000 : 0;
  const expenses = hasData ? num(dashboard?.totals.expenses) : demoMode ? 23000000 : 0;
  const projectedIncome = plan ? num(plan.projected_income) : demoMode ? 55000000 : 0;
  const projectedExpenses = plan ? num(plan.projected_expenses) : demoMode ? 37000000 : 0;
  const reserveTarget = reserve ? num(reserve.target) : plan ? num(plan.estimated_reserve) : demoMode ? 4500000 : 0;
  const reserved = reserve ? num(reserve.reserved) : plan ? num(plan.reserved) : demoMode ? 3000000 : 0;
  const coverage = reserveTarget > 0 ? (reserved / reserveTarget) * 100 : 0;
  const pendingReserve = reserve ? num(reserve.pending) : Math.max(reserveTarget - reserved, 0);

  const chartData = dashboard && dashboard.monthly.length > 0
    ? dashboard.monthly.map((point) => ({ mes: shortMonth(point.month), ingresos: num(point.income), gastos: num(point.expenses) }))
    : demoMode
      ? HISTORICO
      : [];

  const reviewItems = demoMode
    ? ALERTAS_DATA.slice(0, 3).map((alert) => ({
        id: alert.id,
        title: alert.titulo,
        priority: alert.prioridad,
        originLabel: ALERT_ORIGIN_LABEL[alert.origen] ?? alert.origen,
        status: alert.estado,
        actionLabel: "View alert",
        screen: "alertas" as Screen,
      }))
    : (dashboard?.review_now.length
        ? dashboard.review_now.map((item) => ({
            id: item.id,
            title: item.title,
            priority: item.priority,
            originLabel: item.origin_label,
            status: alertStatusUi(item.status),
            actionLabel: item.action.label,
            screen: item.action.screen as Screen,
          }))
        : apiAlerts.slice(0, 3).map((alert) => ({
            id: alert.id,
            title: alert.title,
            priority: alert.priority,
            originLabel: alert.origin_label ?? ALERT_ORIGIN_LABEL[alert.origin] ?? alert.origin,
            status: alertStatusUi(alert.status),
            actionLabel: alert.action?.label ?? "View alert",
            screen: (alert.action?.screen ?? "alertas") as Screen,
          })));

  const obligationItems = demoMode
    ? OBLIGACIONES_DATA.filter((o) => o.presentacion === "Pending").slice(0, 4).map((o) => ({
        id: o.id,
        obligacion: o.obligacion,
        vencimiento: o.vencimiento,
        estimado: o.estimado,
        fuente: o.fuente,
      }))
    : (dashboard?.obligations ?? []).filter((item) => item.status === "pending" || item.status === "filed").slice(0, 4).map((item) => ({
        id: item.id,
        obligacion: item.name,
        vencimiento: fmtDate(item.due_date),
        estimado: item.estimated_amount ? fmt(num(item.estimated_amount)) : "To be defined",
        fuente: `Period ${item.period || "not set"}`,
      }));

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Overview" subtitle={`${companyName} · Cutoff: ${new Date().toLocaleDateString("en-US")}`}
        actions={
          <>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Refresh</Btn>
            <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onNav("planificacion")}>View planning</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading company data…</div>}
      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FFEBEE", border: "1px solid #FFCDD2", color: "#C62828", fontSize: 12 }}>
          {error} · <button onClick={() => setReloadKey((key) => key + 1)} style={{ border: "none", background: "none", color: "#C62828", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>retry</button>
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded income", value: fmtM(income), sub: demoMode ? "Records of the current period" : "Year to date", color: "#1B5E3F", bg: "#E8F5E9", icon: <TrendingUp size={18} color="#1B5E3F" />, note: "Observed" },
          { label: "Recorded expenses", value: fmtM(expenses), sub: demoMode ? "Records of the current period" : "Year to date", color: "#37474F", bg: "#ECEFF1", icon: <ShoppingCart size={18} color="#37474F" />, note: "Observed" },
          { label: "Projected income", value: plan || demoMode ? fmtM(projectedIncome) : "—", sub: plan ? `${plan.name} · v${plan.version}` : "No current plan", color: "#1565C0", bg: "#E3F2FD", icon: <BarChart2 size={18} color="#1565C0" />, note: "Estimate" },
          { label: "Projected expenses", value: plan || demoMode ? fmtM(projectedExpenses) : "—", sub: plan ? `${plan.name} · v${plan.version}` : "No current plan", color: "#6A1B9A", bg: "#F3E5F5", icon: <BarChart2 size={18} color="#6A1B9A" />, note: "Estimate" },
        ].map((kpi) => (
          <Card key={kpi.label} style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ backgroundColor: kpi.bg, borderRadius: 10, padding: 10 }}>{kpi.icon}</div>
              <span style={{ fontSize: 10, color: "#78909C", fontWeight: 600, backgroundColor: "#F5F7F6", padding: "2px 8px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.07)" }}>{kpi.note}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color, letterSpacing: "-0.5px" }}>{kpi.value}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#37474F", marginTop: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>{kpi.sub}</div>
          </Card>
        ))}
      </div>

      {latestForecast && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Latest model forecast</div>
              <div style={{ fontSize: 12, color: "#78909C", marginTop: 3 }}>
                {latestForecast.method_label} · {latestForecast.horizon_months} months from {latestForecast.cutoff_date?.slice(0, 10)} · version {latestForecast.model_version ?? "no version"}
              </div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("proyecciones")}>View forecasts <ChevronRight size={12} /></Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            {[
              { label: "Projected income", value: fmtM(num(latestForecast.projected_income)), color: "#1565C0" },
              { label: "Projected expenses", value: fmtM(num(latestForecast.projected_expenses)), color: "#6A1B9A" },
              { label: "Income − expenses", value: fmtM(num(latestForecast.projected_result)), color: "#1B5E3F" },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: "#78909C" }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {latestForecast.is_demo && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "6px 10px" }}>
                Demo data: the forecast does not validate the behavior of a real company.
              </span>
            )}
            {latestForecast.stale_inputs && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "6px 10px" }}>
                The inputs changed after the latest forecast. Run a new one to update it.
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 10 }}>
            Planning estimate for guidance only. Income minus expenses is not a tax or a mandatory reserve.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginBottom: 24 }}>
        {/* Chart */}
        <Card>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Historical income and expenses</div>
            <div style={{ fontSize: 12, color: "#78909C", marginTop: 3 }}>{demoMode ? "Demo view · May–October 2026" : "Last 6 months with recorded movements"}</div>
          </div>
          {chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#78909C", backgroundColor: "#FAFAFA", borderRadius: 10 }}>
              No movements recorded in the last 6 months.
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
              <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#78909C" }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(0)}M`} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#78909C" }} width={45} />
              <Tooltip formatter={(v: number) => fmt(v)} labelStyle={{ fontWeight: 700 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ingresos" name="Income" fill="#1B5E3F" radius={[4, 4, 0, 0]} />
              <Bar dataKey="gastos" name="Expenses" fill="#90CAF9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </Card>

        {/* Reserve card */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>Reserve plan</div>
          <div style={{ fontSize: 12, color: "#78909C", marginBottom: 20 }}>{plan ? `${plan.period} · v${plan.version}` : "No current plan"}</div>

          {!plan && !demoMode ? (
            <div style={{ fontSize: 12, color: "#78909C", backgroundColor: "#F5F7F6", borderRadius: 8, padding: "14px 16px", lineHeight: 1.6 }}>
              There is no current reserve plan for this company yet. Create it in{" "}
              <button onClick={() => onNav("planificacion")} style={{ border: "none", background: "none", color: "#1B5E3F", fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 12 }}>Tax planning</button>.
            </div>
          ) : (
          <>
          {[
            { label: "Reserve target (plan)", value: fmtM(reserveTarget), note: "Entered by the accountant", color: "#37474F" },
            { label: "Recorded reserve", value: fmtM(reserved), note: "Reported by the user", color: "#1B5E3F" },
            { label: "Missing", value: fmtM(pendingReserve), note: "To cover", color: "#E53935" },
          ].map((r) => (
            <div key={r.label} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 12, color: "#78909C" }}>{r.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: r.color }}>{r.value}</div>
              <div style={{ fontSize: 11, color: "#B0BEC5" }}>{r.note}</div>
            </div>
          ))}

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78909C", marginBottom: 6 }}>
              <span>Reserve coverage</span><span style={{ fontWeight: 700, color: coverage >= 80 ? "#1B5E3F" : "#FBC02D" }}>{coverage.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, backgroundColor: "#ECEFF1", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(coverage, 100)}%`, height: "100%", backgroundColor: coverage >= 80 ? "#4CAF50" : "#FBC02D", borderRadius: 4, transition: "width 0.6s" }} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#78909C", backgroundColor: "#F5F7F6", borderRadius: 8, padding: "10px 12px", marginTop: 14, lineHeight: 1.5 }}>
            <Info size={12} style={{ display: "inline", marginRight: 4 }} />
            The reserve target is a planning value. It is not an assessed tax.
          </div>
          </>
          )}
        </Card>
      </div>

      {/* Alerts + Obligations row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>What to check now</div>
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>Open alerts ordered by priority</div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("alertas")}>View all <ChevronRight size={12} /></Btn>
          </div>
          {reviewItems.map((a) => {
            const pCfg = { alta: { icon: "#E53935", bg: "#FFEBEE", border: "#FFCDD2" }, media: { icon: "#FBC02D", bg: "#FFF8E1", border: "#FFE082" }, baja: { icon: "#4CAF50", bg: "#E8F5E9", border: "#A5D6A7" } }[a.priority as AlertPriority] || { icon: "#FBC02D", bg: "#FFF8E1", border: "#FFE082" };
            return (
              <div key={a.id} style={{ backgroundColor: pCfg.bg, border: `1px solid ${pCfg.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <AlertTriangle size={15} color={pCfg.icon} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#37474F", lineHeight: 1.3 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: "#78909C", marginTop: 3 }}>
                    {a.originLabel} · <StatusBadge s={a.status} />
                  </div>
                </div>
                <Btn variant="secondary" small onClick={() => onNav(a.screen)}>{a.actionLabel}</Btn>
              </div>
            );
          })}
          {reviewItems.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No open alerts pending review.</div>}
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Upcoming obligations</div>
            <Btn variant="ghost" small onClick={() => onNav("obligaciones")}>View calendar <ChevronRight size={12} /></Btn>
          </div>
          {obligationItems.map((o) => (
            <div key={o.id} style={{ padding: "12px 14px", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", lineHeight: 1.3, flex: 1 }}>{o.obligacion}</div>
                <span style={{ fontSize: 11, color: "#E53935", fontWeight: 700, backgroundColor: "#FFEBEE", padding: "2px 8px", borderRadius: 6, border: "1px solid #FFCDD2", whiteSpace: "nowrap", marginLeft: 8 }}>{o.vencimiento}</span>
              </div>
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 4 }}>Estimated amount: {o.estimado}</div>
              <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>{o.fuente}</div>
            </div>
          ))}
          {obligationItems.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No pending obligations.</div>}
          <div style={{ fontSize: 11, color: "#78909C", backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 8, padding: "8px 12px" }}>
            Dates recorded manually. Check the applicable calendar with the accountant.
          </div>
        </Card>
      </div>
    </div>
  );
};

// INGRESOS
type IncomeDisplayRow = {
  id: number;
  date: string;
  party: string;
  doc: string;
  description: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
};

const DEMO_INCOME_ROWS: IncomeDisplayRow[] = INGRESOS_TABLE.map((row) => ({
  id: row.id,
  date: row.fecha,
  party: row.cliente,
  doc: row.doc,
  description: row.desc,
  subtotal: row.base,
  tax: row.iva,
  total: row.total,
  status: row.estado,
}));

const IngresosScreen = ({
  companyId,
  companyName,
  demoMode,
}: {
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
}) => {
  const [rows, setRows] = useState<Income[]>([]);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<Pagination | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [demoRows, setDemoRows] = useState<IncomeDisplayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    doc_number: "",
    issue_date: todayISO(),
    party: "",
    counterparty_id: "",
    description: "",
    subtotal: "",
    tax_amount: "",
    status: "pending" as "pending" | "collected",
  });

  useEffect(() => {
    if (!companyId || demoMode) {
      setRows([]);
      setCounterparties([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([listIncome(companyId, page), listCounterparties(companyId)])
      .then(([income, parties]) => {
        if (!alive) return;
        setRows(income.items);
        setPageInfo(income.pagination);
        setCounterparties(parties.items);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey, page]);

  const displayRows: IncomeDisplayRow[] = demoMode
    ? [...demoRows, ...DEMO_INCOME_ROWS]
    : rows.map((row) => ({
        id: row.id,
        date: fmtDate(row.issue_date),
        party: counterparties.find((party) => party.id === row.counterparty_id)?.name ?? "No counterparty",
        doc: row.doc_number,
        description: row.description || "—",
        subtotal: num(row.subtotal),
        tax: num(row.tax_amount),
        total: num(row.total),
        status: row.status === "collected" ? "Collected" : row.status === "void" ? "Void" : "Pending",
      }));

  const baseTotal = displayRows.reduce((sum, row) => sum + row.subtotal, 0);
  const taxTotal = displayRows.reduce((sum, row) => sum + row.tax, 0);

  const statusStyle = (status: string) =>
    status === "Collected"
      ? { color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" }
      : status === "Void"
        ? { color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" }
        : { color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" };

  const openForm = () => {
    setForm({
      doc_number: "",
      issue_date: todayISO(),
      party: "",
      counterparty_id: "",
      description: "",
      subtotal: "",
      tax_amount: "",
      status: "pending",
    });
    setFormError(null);
    setConfirmed(false);
    setShowForm(true);
  };

  const totalPreview = num(form.subtotal) + num(form.tax_amount);

  const save = async () => {
    setFormError(null);
    if (!form.doc_number.trim()) {
      setFormError("The document number is required.");
      return;
    }
    if (!form.issue_date) {
      setFormError("The issue date is required.");
      return;
    }
    const subtotal = toMoneyString(form.subtotal);
    if (Number(subtotal) <= 0) {
      setFormError("The base amount must be greater than zero.");
      return;
    }
    const tax = toMoneyString(form.tax_amount);
    const total = (Number(subtotal) + Number(tax)).toFixed(2);

    if (demoMode) {
      setDemoRows((current) => [
        {
          id: Date.now(),
          date: fmtDate(form.issue_date),
          party: form.party || "Demo client",
          doc: form.doc_number,
          description: form.description || "Recorded sale",
          subtotal: Number(subtotal),
          tax: Number(tax),
          total: Number(total),
          status: form.status === "collected" ? "Collected" : "Pending",
        },
        ...current,
      ]);
      setConfirmed(true);
      return;
    }

    if (!companyId) return;
    setSaving(true);
    try {
      await createIncome(companyId, {
        doc_number: form.doc_number.trim(),
        issue_date: form.issue_date,
        description: form.description.trim(),
        counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null,
        subtotal,
        tax_amount: tax,
        total,
        status: form.status,
      });
      setConfirmed(true);
      setPage(1);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `income-${companyName.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Date", "Client", "Document", "Description", "Base", "VAT", "Total", "Status"],
      displayRows.map((row) => [row.date, row.party, row.doc, row.description, row.subtotal, row.tax, row.total, row.status]),
    );
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Income and sales"
        subtitle={`Observed records · ${companyName}`}
        actions={
          <>
            <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportCsv}>Export CSV</Btn>
            <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Record income</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading income…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded total (base)", value: fmt(baseTotal), note: demoMode ? "Sum of the listed records" : "Sum of the records on this page" },
          { label: "Recorded VAT generated", value: fmt(taxTotal), note: "Record summary" },
          { label: "Recorded sales", value: `${demoMode ? displayRows.length : pageInfo?.total ?? displayRows.length} sales`, note: demoMode ? "Sample data" : "All the records of the company" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1B5E3F" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#B0BEC5" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#1B5E3F", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> VAT generated {fmt(taxTotal)}. This is a summary of records, not an official VAT assessment.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: "#37474F" }}>Sales records</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Date", "Client", "Document", "Description", "VAT base", "VAT", "Total", "Collection status"].map((header) => (
                  <th key={header} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", whiteSpace: "nowrap", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const style = statusStyle(row.status);
                return (
                  <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "13px 16px", color: "#78909C", whiteSpace: "nowrap" }}>{row.date}</td>
                    <td style={{ padding: "13px 16px", fontWeight: 600, color: "#37474F" }}>{row.party}</td>
                    <td style={{ padding: "13px 16px", color: "#78909C", fontFamily: "monospace", fontSize: 12 }}>{row.doc}</td>
                    <td style={{ padding: "13px 16px", color: "#37474F" }}>{row.description}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", color: "#37474F" }}>{fmt(row.subtotal)}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", color: "#78909C" }}>{fmt(row.tax)}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", fontWeight: 700, color: "#1B5E3F" }}>{fmt(row.total)}</td>
                    <td style={{ padding: "13px 16px" }}><Badge label={row.status} color={style.color} bg={style.bg} border={style.border} /></td>
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No income recorded for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!demoMode && <Pager info={pageInfo} onPage={setPage} noun="sales" />}
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Recorded sales do not mean the money was collected. The collection status is reported by the user.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            {confirmed ? (
              <div style={{ textAlign: "center" }}>
                <CheckCircle size={48} color="#4CAF50" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Record confirmed</h3>
                <p style={{ fontSize: 13, color: "#78909C" }}>
                  {demoMode ? "The income was recorded only in this demo view." : "The income was recorded in the database."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Close</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Record income or sale</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
                </div>

                {formError && <InlineError message={formError} />}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Document *">
                    <input value={form.doc_number} onChange={(event) => setForm({ ...form, doc_number: event.target.value })} placeholder="FV-2026-0001" style={inputStyle} />
                  </Field>
                  <Field label="Issue date *">
                    <input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} style={inputStyle} />
                  </Field>
                </div>

                <Field label="Client">
                  {demoMode ? (
                    <input value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })} placeholder="Client name" style={inputStyle} />
                  ) : (
                    <select value={form.counterparty_id} onChange={(event) => setForm({ ...form, counterparty_id: event.target.value })} style={inputStyle}>
                      <option value="">No counterparty recorded</option>
                      {counterparties.filter((party) => party.kind === "client").map((party) => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  )}
                </Field>

                <Field label="Description">
                  <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Sale description" style={inputStyle} />
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Base amount (before VAT) *">
                    <input type="number" min="0" step="0.01" value={form.subtotal} onChange={(event) => setForm({ ...form, subtotal: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                  <Field label="Recorded VAT">
                    <input type="number" min="0" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Collection status">
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "collected" })} style={inputStyle}>
                      <option value="pending">Pending</option>
                      <option value="collected">Collected</option>
                    </select>
                  </Field>
                  <Field label="Computed total">
                    <div style={{ ...inputStyle, backgroundColor: "#F5F7F6", fontWeight: 700, color: "#1B5E3F" }}>{fmt(totalPreview)}</div>
                  </Field>
                </div>

                <div style={{ backgroundColor: "#FFF8E1", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#E65100" }}>
                  This record does not create official tax documents. It is not certified electronic invoicing.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancel</Btn>
                  <Btn variant="primary" onClick={save} fullWidth>{saving ? "Saving…" : "Save record"}</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// GASTOS
type ExpenseDisplayRow = {
  id: number;
  date: string;
  party: string;
  doc: string;
  category: string;
  description: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: boolean;
  reviewed: boolean;
};

const DEMO_EXPENSE_ROWS: ExpenseDisplayRow[] = GASTOS_TABLE.map((row) => ({
  id: row.id,
  date: row.fecha,
  party: row.proveedor,
  doc: row.doc,
  category: row.cat,
  description: "Compra operativa",
  subtotal: row.base,
  tax: row.iva,
  total: row.total,
  paid: row.pago === "Paid",
  reviewed: row.revision === "Reviewed",
}));

const GastosScreen = ({
  companyId,
  companyName,
  demoMode,
}: {
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
}) => {
  const [rows, setRows] = useState<Expense[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [demoRows, setDemoRows] = useState<ExpenseDisplayRow[]>(DEMO_EXPENSE_ROWS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<Pagination | null>(null);
  const [unreviewedTotal, setUnreviewedTotal] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    doc_number: "",
    issue_date: todayISO(),
    party: "",
    counterparty_id: "",
    category: "Goods",
    description: "",
    subtotal: "",
    tax_amount: "",
    status: "pending" as "pending" | "paid",
  });

  useEffect(() => {
    if (!companyId || demoMode) {
      setRows([]);
      setCounterparties([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([listExpenses(companyId, page), listCounterparties(companyId), listExpenses(companyId, 1, 1, false)])
      .then(([expenses, parties, toReview]) => {
        if (!alive) return;
        setRows(expenses.items);
        setPageInfo(expenses.pagination);
        setUnreviewedTotal(toReview.pagination.total);
        setCounterparties(parties.items);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey, page]);

  const displayRows: ExpenseDisplayRow[] = demoMode
    ? demoRows
    : rows.map((row) => ({
        id: row.id,
        date: fmtDate(row.issue_date),
        party: counterparties.find((party) => party.id === row.counterparty_id)?.name ?? "No counterparty",
        doc: row.doc_number,
        category: row.category || "Other",
        description: row.description || "—",
        subtotal: num(row.subtotal),
        tax: num(row.tax_amount),
        total: num(row.total),
        paid: row.status === "paid",
        reviewed: row.reviewed,
      }));

  const baseTotal = displayRows.reduce((sum, row) => sum + row.subtotal, 0);
  const taxTotal = displayRows.reduce((sum, row) => sum + row.tax, 0);
  const pendingReview = displayRows.filter((row) => !row.reviewed).length;

  const openForm = () => {
    setForm({
      doc_number: "",
      issue_date: todayISO(),
      party: "",
      counterparty_id: "",
      category: "Goods",
      description: "",
      subtotal: "",
      tax_amount: "",
      status: "pending",
    });
    setFormError(null);
    setConfirmed(false);
    setShowForm(true);
  };

  const totalPreview = num(form.subtotal) + num(form.tax_amount);

  const save = async () => {
    setFormError(null);
    if (!form.doc_number.trim()) {
      setFormError("The document number is required.");
      return;
    }
    if (!form.issue_date) {
      setFormError("The issue date is required.");
      return;
    }
    const subtotal = toMoneyString(form.subtotal);
    if (Number(subtotal) <= 0) {
      setFormError("The base amount must be greater than zero.");
      return;
    }
    const tax = toMoneyString(form.tax_amount);
    const total = (Number(subtotal) + Number(tax)).toFixed(2);

    if (demoMode) {
      setDemoRows((current) => [
        {
          id: Date.now(),
          date: fmtDate(form.issue_date),
          party: form.party || "Demo supplier",
          doc: form.doc_number,
          category: form.category || "Other",
          description: form.description || "Compra registrada",
          subtotal: Number(subtotal),
          tax: Number(tax),
          total: Number(total),
          paid: form.status === "paid",
          reviewed: false,
        },
        ...current,
      ]);
      setConfirmed(true);
      return;
    }

    if (!companyId) return;
    setSaving(true);
    try {
      await createExpense(companyId, {
        doc_number: form.doc_number.trim(),
        issue_date: form.issue_date,
        category: form.category,
        description: form.description.trim(),
        counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null,
        subtotal,
        tax_amount: tax,
        total,
        status: form.status,
      });
      setConfirmed(true);
      setPage(1);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleReviewed = async (row: ExpenseDisplayRow) => {
    setError(null);
    if (demoMode) {
      setDemoRows((current) => current.map((item) => item.id === row.id ? { ...item, reviewed: !item.reviewed } : item));
      return;
    }
    if (!companyId) return;
    setBusyId(row.id);
    try {
      await updateExpense(companyId, row.id, { reviewed: !row.reviewed });
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `expenses-${companyName.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Date", "Supplier", "Document", "Category", "Description", "Base", "VAT", "Total", "Payment", "Review"],
      displayRows.map((row) => [row.date, row.party, row.doc, row.category, row.description, row.subtotal, row.tax, row.total, row.paid ? "Paid" : "Pending", row.reviewed ? "Reviewed" : "To review"]),
    );
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Expenses and purchases"
        subtitle={`Observed records · ${companyName}`}
        actions={
          <>
            <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportCsv}>Export CSV</Btn>
            <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Record expense</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading expenses…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded total (base)", value: fmt(baseTotal), note: demoMode ? "Sum of the listed records" : "Sum of the records on this page", color: "#37474F" },
          { label: "Recorded deductible VAT", value: fmt(taxTotal), note: "Record summary", color: "#37474F" },
          { label: "Expenses to review", value: `${demoMode ? pendingReview : unreviewedTotal ?? pendingReview} records`, note: "Pending accounting review (all pages)", color: "#E65100" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#B0BEC5" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#E65100", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> Recording an expense does not make it deductible. The accountant must review the classification.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F" }}>Expense records</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Date", "Supplier", "Document", "Category", "Description", "VAT base", "VAT", "Total", "Payment", "Review", ""].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", whiteSpace: "nowrap", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{row.date}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#37474F" }}>{row.party}</td>
                  <td style={{ padding: "12px 14px", color: "#78909C", fontFamily: "monospace", fontSize: 12 }}>{row.doc}</td>
                  <td style={{ padding: "12px 14px", color: "#37474F" }}>{row.category}</td>
                  <td style={{ padding: "12px 14px", color: "#78909C" }}>{row.description}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(row.subtotal)}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", color: "#78909C" }}>{row.tax > 0 ? fmt(row.tax) : "—"}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: "#37474F" }}>{fmt(row.total)}</td>
                  <td style={{ padding: "12px 14px" }}><Badge label={row.paid ? "Paid" : "Pending"} color={row.paid ? "#1B5E3F" : "#E65100"} bg={row.paid ? "#E8F5E9" : "#FFF3E0"} border={row.paid ? "#A5D6A7" : "#FFCC80"} /></td>
                  <td style={{ padding: "12px 14px" }}><Badge label={row.reviewed ? "Reviewed" : "To review"} color={row.reviewed ? "#1B5E3F" : "#78909C"} bg={row.reviewed ? "#E8F5E9" : "#ECEFF1"} border={row.reviewed ? "#A5D6A7" : "#CFD8DC"} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <button onClick={() => toggleReviewed(row)} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: busyId === row.id ? 0.5 : 1 }}>
                      {row.reviewed ? "Reopen" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No expenses recorded for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!demoMode && <Pager info={pageInfo} onPage={setPage} noun="expenses" />}
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            {confirmed ? (
              <div style={{ textAlign: "center" }}>
                <CheckCircle size={48} color="#4CAF50" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Expense recorded</h3>
                <p style={{ fontSize: 13, color: "#78909C", marginBottom: 16 }}>
                  {demoMode ? "The expense was recorded only in this demo view." : "The expense was recorded. Pending accounting review."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Close</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Record expense or purchase</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
                </div>

                {formError && <InlineError message={formError} />}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Document *">
                    <input value={form.doc_number} onChange={(event) => setForm({ ...form, doc_number: event.target.value })} placeholder="FC-2026-0001" style={inputStyle} />
                  </Field>
                  <Field label="Issue date *">
                    <input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} style={inputStyle} />
                  </Field>
                </div>

                <Field label="Supplier">
                  {demoMode ? (
                    <input value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })} placeholder="Supplier name" style={inputStyle} />
                  ) : (
                    <select value={form.counterparty_id} onChange={(event) => setForm({ ...form, counterparty_id: event.target.value })} style={inputStyle}>
                      <option value="">No counterparty recorded</option>
                      {counterparties.filter((party) => party.kind === "supplier").map((party) => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  )}
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Category">
                    <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Goods" style={inputStyle} />
                  </Field>
                  <Field label="Payment status">
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "paid" })} style={inputStyle}>
                      <option value="pending">Pending</option>
                      <option value="paid">Paid</option>
                    </select>
                  </Field>
                </div>

                <Field label="Description">
                  <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Purchase description" style={inputStyle} />
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Base amount (before VAT) *">
                    <input type="number" min="0" step="0.01" value={form.subtotal} onChange={(event) => setForm({ ...form, subtotal: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                  <Field label="Recorded VAT">
                    <input type="number" min="0" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                </div>

                <Field label="Computed total">
                  <div style={{ ...inputStyle, backgroundColor: "#F5F7F6", fontWeight: 700, color: "#37474F" }}>{fmt(totalPreview)}</div>
                </Field>

                <div style={{ backgroundColor: "#FFF8E1", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#E65100" }}>
                  A record pending review is not included in tax estimates until the accountant reviews it.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancel</Btn>
                  <Btn variant="primary" onClick={save} fullWidth>{saving ? "Saving…" : "Save record"}</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// PROYECCIONES
const modelLabel = (name: string) =>
  ({ seasonal_naive: "Seasonal naive (lag-12)", linear_regression: "Linear regression", random_forest: "Random Forest" } as Record<string, string>)[name] ?? name;

const ProyeccionesScreen = ({
  onNav,
  companyId,
  companyName,
  demoMode,
  onUseForecast,
}: {
  onNav: (s: Screen) => void;
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  onUseForecast: (forecast: ForecastResult) => void;
}) => {
  const [estado, setEstado] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ mes: string; ingresos: number; gastos: number }>>(demoMode ? HISTORICO : []);
  const [horizon, setHorizon] = useState(3);
  const [savedRuns, setSavedRuns] = useState<ForecastRun[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!companyId || demoMode) {
      setHistory(demoMode ? HISTORICO : []);
      setSavedRuns([]);
      return;
    }
    let alive = true;
    setLoadingContext(true);
    Promise.all([getDashboard(companyId), listForecasts(companyId)])
      .then(([dashboard, runs]) => {
        if (!alive) return;
        setHistory(
          dashboard.monthly.map((point) => ({
            mes: shortMonth(point.month),
            ingresos: num(point.income),
            gastos: num(point.expenses),
          })),
        );
        setSavedRuns(runs.items);
        const latest = runs.items[0];
        if (latest) {
          // Show the latest stored run. Nothing is recomputed or trained.
          setResult((current) => current ?? {
            available: true,
            id: latest.id,
            method: latest.method,
            method_label: latest.method_label ?? modelLabel(latest.method),
            horizon_months: latest.horizon_months,
            cutoff_date: latest.cutoff_date,
            projected_income: latest.projected_income,
            projected_expenses: latest.projected_expenses,
            projected_result:
              latest.projected_result ??
              (num(latest.projected_income) - num(latest.projected_expenses)).toFixed(2),
            model_version: latest.model_version,
            created_at: latest.created_at,
            assumptions: latest.assumptions,
            monthly: latest.monthly,
            models: latest.models,
            history_months: latest.history_months,
            history_period: latest.history_period,
            trained_at: latest.trained_at,
            stale_inputs: latest.stale_inputs,
            is_demo: latest.is_demo,
            data_provenance: latest.data_provenance,
            estimated: true,
            disclaimer: "Planning forecast for guidance only. It is not an official tax assessment.",
          });
          setEstado((current) => (current === "idle" ? "done" : current));
        }
      })
      .catch(() => {
        // The history and the latest run are context; they do not block forecasting.
      })
      .finally(() => {
        if (alive) setLoadingContext(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode]);

  const runProjection = async () => {
    setError(null);
    if (demoMode) {
      setEstado("error");
      setError(
        "The visual demo does not run the trained model. Sign in with a company to generate a real forecast from the artifact.",
      );
      return;
    }
    if (!companyId) {
      setError("Select a company before forecasting.");
      setEstado("error");
      return;
    }
    setEstado("loading");
    try {
      const forecast = await createModelForecast(companyId, { horizon_months: horizon });
      setResult(forecast);
      setEstado("done");
      if (forecast.available) {
        listForecasts(companyId)
          .then((runs) => setSavedRuns(runs.items))
          .catch(() => null);
      }
    } catch (err) {
      setError(errorMessage(err));
      setEstado("error");
    }
  };

  const projectedIncome = result ? num(result.projected_income) : 0;
  const projectedExpenses = result ? num(result.projected_expenses) : 0;
  const months = result?.horizon_months ?? horizon;
  const monthly = result?.monthly ?? [];
  const models = result?.models ?? {};
  const tableRows = [
    ...history.map((point) => ({ mes: point.mes, ingresos: point.ingresos, gastos: point.gastos, tipo: "Recorded" })),
    ...monthly.map((point) => ({
      mes: shortMonth(point.month),
      ingresos: num(point.projected_income),
      gastos: num(point.projected_expenses),
      tipo: "Forecast",
    })),
  ];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Forecasts"
        subtitle={`${companyName} · Model trained offline, applied to the ERP history`}
        actions={
          estado === "done" && result?.available ? (
            <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onUseForecast(result)}>
              Use this forecast in my planning
            </Btn>
          ) : undefined
        }
      />

      <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#1565C0", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          The forecast comes from a model already trained and saved in an artifact. Flask does not train or simulate:
          it prepares the current inputs, runs the prediction and stores the run with its version. It is an estimate
          for guidance, not an official tax assessment.
        </span>
      </div>

      <Card style={{ marginBottom: 24, padding: "14px 18px", backgroundColor: "#F5F7F6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>How the ML is applied</div>
            <p style={{ fontSize: 11, color: "#546E7A", margin: 0, lineHeight: 1.65 }}>
              Training and evaluation with a time-based split run offline (<code>ml/src/</code> for the global model,{" "}
              <code>ml/company_trainer/train.py</code> for a company model). The backend reads the JSON artifact,
              validates the expected inputs and predicts without scikit-learn. Nothing is trained when the dashboard loads or on
              requests. The model, the inputs and the version live in the artifact and in the run assumptions,
              separate from the interface.
            </p>
          </div>
          <Field label="Horizon (months)">
            <select
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value))}
              style={{ ...inputStyle, width: 120 }}
              disabled={estado === "loading"}
            >
              {[1, 2, 3, 4, 6, 12].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        {savedRuns.length > 0 && (
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 8 }}>
            Stored runs: {savedRuns.length}. The most recent one is shown when the screen opens.
          </div>
        )}
      </Card>

      {loadingContext && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading history and latest run…</div>}

      {estado === "idle" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <BarChart2 size={48} color="#90CAF9" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Generate forecast</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>
            The income and expenses recorded in the ERP are the inputs of the trained model. If the
            artifact or the minimum history is missing, you will see an explicit error and can continue with manual planning.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn variant="primary" icon={<RefreshCw size={13} />} onClick={runProjection}>Generate forecast with the model</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "loading" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid #E8F5E9", borderTopColor: "#1B5E3F", margin: "0 auto 24px", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#37474F" }}>Preparing inputs and running the model…</div>
          <p style={{ fontSize: 12, color: "#78909C", marginTop: 8 }}>The model is not retrained and no external source is queried.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </Card>
      )}

      {estado === "error" && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#E53935" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>The forecast could not be generated</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>{error}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <Btn variant="secondary" onClick={runProjection}>Retry</Btn>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Use manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && !result.available && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#FBC02D" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Model or history not available</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>
            {result.reason ?? "There is no trained model or not enough history for this company."}
          </p>
          <p style={{ fontSize: 12, color: "#B0BEC5" }}>
            {result.code === "insufficient_history"
              ? `Months available: ${result.history_months ?? 0}.`
              : "The prediction is never replaced with fictitious data."}
          </p>
          <div style={{ marginTop: 20 }}>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Continue with manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && result.available && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
            {[
              { label: `Projected income (${months} months)`, value: fmt(projectedIncome), color: "#1B5E3F" },
              { label: `Projected expenses (${months} months)`, value: fmt(projectedExpenses), color: "#37474F" },
              { label: "Income − expenses", value: fmt(num(result.projected_result)), color: projectedIncome - projectedExpenses >= 0 ? "#1565C0" : "#E53935" },
            ].map((item) => (
              <Card key={item.label} style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: item.color }}>{item.value}</div>
                <span style={{ display: "inline-block", marginTop: 8, fontSize: 10, fontWeight: 700, color: "#1565C0", backgroundColor: "#E3F2FD", padding: "2px 8px", borderRadius: 6, border: "1px solid #90CAF9" }}>Model estimate</span>
              </Card>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {result.is_demo && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "7px 11px" }}>
                Demo data: the metrics and forecasts do not validate the behavior of a real company.
              </span>
            )}
            {result.stale_inputs && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "7px 11px" }}>
                The inputs changed after training. The run is stored; generate again to use the current inputs.
              </span>
            )}
            <span style={{ fontSize: 11, color: "#546E7A", backgroundColor: "#ECEFF1", borderRadius: 8, padding: "7px 11px" }}>
              Run #{result.id ?? "—"} · version {result.model_version ?? "no version"} · cutoff {fmtDate(result.cutoff_date)} · stored {fmtDate(result.created_at)}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24, marginBottom: 24 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>Recorded history vs forecast</div>
              <div style={{ fontSize: 12, color: "#78909C", marginBottom: 16 }}>
                {result.history_period ? `History ${result.history_period.from} to ${result.history_period.to}` : "ERP history"} · forecast {months} months
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: "#F5F7F6" }}>
                      {["Month", "Income", "Expenses", "Type"].map((header) => (
                        <th key={header} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.07)", whiteSpace: "nowrap" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr key={`${row.tipo}-${row.mes}-${index}`} style={{ backgroundColor: row.tipo === "Forecast" ? "#E3F2FD" : index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, color: "#37474F" }}>{row.mes}</td>
                        <td style={{ padding: "9px 12px", color: "#37474F" }}>{fmt(row.ingresos)}</td>
                        <td style={{ padding: "9px 12px", color: "#37474F" }}>{fmt(row.gastos)}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <Badge label={row.tipo} color={row.tipo === "Forecast" ? "#1565C0" : "#546E7A"} bg={row.tipo === "Forecast" ? "#E3F2FD" : "#ECEFF1"} border={row.tipo === "Forecast" ? "#90CAF9" : "#CFD8DC"} />
                        </td>
                      </tr>
                    ))}
                    {tableRows.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#78909C", fontSize: 12 }}>No history or forecast to show.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Calculation detail</div>
              {[
                { label: "Method (income)", value: models.income?.label ?? result.method_label ?? "—" },
                { label: "Method (expenses)", value: models.expenses?.label ?? "—" },
                { label: "Model", value: result.scope === "global" ? "Global model (425 companies, evaluated in Phase 4)" : result.scope === "company" ? "This company's own model" : "—" },
                { label: "Model version", value: result.model_version ?? "no version" },
                { label: "Artifact SHA-256", value: result.artifact_sha256 ? `${result.artifact_sha256.slice(0, 12)}…` : "—" },
                { label: "Trained", value: fmtDate(result.trained_at) },
                { label: "History cutoff", value: fmtDate(result.cutoff_date) },
                { label: "Months of history", value: String(result.history_months ?? "—") },
                { label: "Horizon", value: `${months} months` },
                { label: "Evaluation", value: result.scope === "global" ? "Evaluated once on test and holdout companies: accepted (docs/04_evaluation_report.md)" : result.assumptions?.evaluation?.method === "temporal_holdout" ? `Time-based validation for selection (${result.assumptions.evaluation.test_months ?? "—"} months); one-month error with real lags. The full recursive horizon is not evaluated` : "Not declared" },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize: 12, color: "#78909C" }}>{item.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#37474F", textAlign: "right" }}>{item.value}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 12, lineHeight: 1.5 }}>
                The model, the inputs and the version are stored with the run. Changing the interface does not change the model.
              </div>
            </Card>
          </div>

          <Card style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>{result.scope === "global" ? "Model evaluation" : "Model metrics (time-based validation)"}</div>
            <div style={{ fontSize: 12, color: "#78909C", marginBottom: 16 }}>
              {result.scope === "global" ? "Six-month recursive forecasts, as the app makes them." : "One-month error on the months used for selection (real lags). The full recursive horizon is not evaluated. Lower MAE is better."} These are not probabilities or promises of savings.
            </div>
            {result.scope === "global" && (
              <div style={{ fontSize: 12, color: "#37474F", lineHeight: 1.7, marginBottom: 8 }}>
                The global model was evaluated once on data nobody used to train or choose it (Phase 4, verdict: accepted).
                Typical error, as a share of a company's monthly income: income 10.2 % and expenses 10.7 % on the temporal test,
                income 12.3 % and expenses 11.8 % on companies never seen in training. The seasonal naive baseline scored 15–17 %.
                The figures come from a semi-synthetic dataset, so they describe the method, not this company.
              </div>
            )}
            {result.scope !== "global" && Object.entries(models).map(([target, info]) => (
              <div key={target} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#37474F" }}>
                  {target === "income" ? "Income" : "Expenses"} · selected model: {info.label}
                </div>
                <div style={{ fontSize: 12, color: "#546E7A", marginTop: 4 }}>
                  MAE {fmt(info.metrics.mae)} · RMSE {fmt(info.metrics.rmse)} · MAPE {info.metrics.mape_percent != null ? `${info.metrics.mape_percent}%` : "not computable"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {Object.entries(info.all_metrics).map(([name, metric]) => (
                    <span key={name} style={{ fontSize: 10, color: "#546E7A", backgroundColor: "#F5F7F6", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 6, padding: "4px 8px" }}>
                      {modelLabel(name)}: MAE {fmt(metric.mae)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {result.scope !== "global" && Object.keys(models).length === 0 && (
              <div style={{ fontSize: 12, color: "#78909C" }}>The run declares no metrics.</div>
            )}
          </Card>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Btn variant="primary" icon={<Calculator size={13} />} onClick={() => onUseForecast(result)}>Use this forecast in my planning</Btn>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={runProjection}>Generate another run</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Manual planning</Btn>
          </div>

          <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", fontSize: 12, color: "#E65100" }}>
            <Info size={13} style={{ display: "inline", marginRight: 5 }} />
            {result.disclaimer ?? "Planning estimate for guidance only. It is not an official tax assessment."} Income minus expenses is not a tax or a mandatory reserve.
          </div>
        </>
      )}
    </div>
  );
};

// TAX PLANNING
type ParameterRow = {
  id: number;
  label: string;
  value: string;
  unit: string;
  source: string;
  reviewed: boolean;
};

const DEMO_PARAMETERS: ParameterRow[] = [
  { id: 1, label: "General VAT rate", value: "19.0000", unit: "percent", source: "Sample parameter pending validation", reviewed: false },
  { id: 2, label: "VAT period", value: "2.0000", unit: "months", source: "Sample parameter", reviewed: false },
  { id: 3, label: "Withholding tax", value: "0.0000", unit: "percent", source: "To be defined with the accountant", reviewed: false },
];

const DEMO_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "Bimonthly VAT", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Date recorded manually." },
  { id: 2, name: "Withholding tax", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Amount pending." },
  { id: 3, name: "Annual ICA", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimate pending." },
];

const unitLabel = (unit: string) => ({ percent: "Percent", cop: "COP", months: "Months", count: "Count" } as Record<string, string>)[unit] ?? unit;

const parameterValue = (row: ParameterRow) => {
  if (row.unit === "percent") return `${Number(row.value).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (row.unit === "cop") return fmt(Number(row.value));
  if (row.unit === "months") return `${Number(row.value).toLocaleString("en-US")} months`;
  return Number(row.value).toLocaleString("en-US");
};

const PlanificacionScreen = ({
  onNav,
  companyId,
  companyName,
  demoMode,
  draft,
  initialStep,
}: {
  onNav: (s: Screen) => void;
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  draft: PlanDraft | null;
  initialStep: PlanStep;
}) => {
  const [step, setStep] = useState<PlanStep>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [parameters, setParameters] = useState<ParameterRow[]>(demoMode ? DEMO_PARAMETERS : []);
  const [obligations, setObligations] = useState<Obligation[]>(demoMode ? DEMO_OBLIGATIONS : []);
  const [planDetail, setPlanDetail] = useState<PlanDetail | null>(null);
  const [forecast, setForecast] = useState<ForecastRun | null>(null);
  const [reservesTotal, setReservesTotal] = useState(0);

  const [form, setForm] = useState({
    name: `Plan fiscal ${currentPeriod()}`,
    period: currentPeriod(),
    projected_income: demoMode ? "55000000" : "",
    projected_expenses: demoMode ? "37000000" : "",
    estimated_reserve: demoMode ? "4500000" : "",
    notes: "",
  });
  const [reserveForm, setReserveForm] = useState({ amount: "", reserved_on: todayISO(), note: "" });

  const [saving, setSaving] = useState(false);
  const [savedPlan, setSavedPlan] = useState<Plan | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reserveSaving, setReserveSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || demoMode) {
      setDashboard(null);
      setParameters(DEMO_PARAMETERS);
      setObligations(DEMO_OBLIGATIONS);
      setPlanDetail(null);
      setForecast(null);
      setReservesTotal(3000000);
      setForm((current) => ({
        ...current,
        projected_income: current.projected_income || "55000000",
        projected_expenses: current.projected_expenses || "37000000",
        estimated_reserve: current.estimated_reserve || "4500000",
      }));
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getDashboard(companyId),
      listFiscalParameters(companyId),
      listObligations(companyId),
      listPlans(companyId),
      listForecasts(companyId),
      listReserves(companyId),
    ])
      .then(async ([summary, parameterResponse, obligationResponse, planResponse, forecastResponse, reserveResponse]) => {
        if (!alive) return;
        setDashboard(summary);
        setParameters(parameterResponse.items.map((item) => ({ id: item.id, label: item.label, value: item.value, unit: item.unit, source: item.source, reviewed: item.reviewed })));
        setObligations(obligationResponse.items);
        setReservesTotal(num(reserveResponse.total));

        const latestForecast = forecastResponse.items[0] ?? null;
        setForecast(latestForecast);

        const currentPlan = planResponse.items[0] ?? null;
        let detail: PlanDetail | null = null;
        if (currentPlan) {
          detail = await getPlan(companyId, currentPlan.id);
          if (!alive) return;
          setPlanDetail(detail);
        } else {
          setPlanDetail(null);
        }

        const currentVersion = detail?.versions?.[0];
        const latestMonth = summary.monthly[summary.monthly.length - 1];
        const fallbackIncome = latestMonth ? num(latestMonth.income) : num(summary.totals.income);
        const fallbackExpenses = latestMonth ? num(latestMonth.expenses) : num(summary.totals.expenses);
        const projectedIncome = currentVersion
          ? num(currentVersion.projected_income)
          : latestForecast
            ? num(latestForecast.projected_income)
            : fallbackIncome;
        const projectedExpenses = currentVersion
          ? num(currentVersion.projected_expenses)
          : latestForecast
            ? num(latestForecast.projected_expenses)
            : fallbackExpenses;

        setForm({
          name: currentPlan?.name ?? `Plan fiscal ${currentPeriod()}`,
          period: draft?.period ?? currentPlan?.period ?? currentPeriod(),
          projected_income: draft?.projected_income ?? String(Math.round(projectedIncome)),
          projected_expenses: draft?.projected_expenses ?? String(Math.round(projectedExpenses)),
          estimated_reserve: currentVersion ? String(Math.round(num(currentVersion.estimated_reserve))) : "",
          notes: currentVersion?.notes ?? "",
        });
      })
      .catch((err) => {
        if (alive) {
          setError(errorMessage(err));
          setParameters(DEMO_PARAMETERS);
          setObligations(DEMO_OBLIGATIONS);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  useEffect(() => {
    if (!draft) return;
    setForm((current) => ({
      ...current,
      period: draft.period,
      projected_income: draft.projected_income,
      projected_expenses: draft.projected_expenses,
      // The reserve target is not derived from income − expenses and is not
      // overwritten: the accountant sets it.
    }));
    setStep(initialStep);
  }, [draft, initialStep]);

  const observedIncome = dashboard ? num(dashboard.totals.income) : 35000000;
  const observedExpenses = dashboard ? num(dashboard.totals.expenses) : 23000000;
  const projectedIncome = num(form.projected_income);
  const projectedExpenses = num(form.projected_expenses);
  const projectedResult = projectedIncome - projectedExpenses;
  const reserveTargetInput = num(form.estimated_reserve);
  const pendingObligations = obligations.filter((item) => item.status === "pending" || item.status === "filed");
  const latestVersion = planDetail?.versions?.[0] ?? null;
  const versionReviewed = savedPlan?.version?.status === "reviewed" || (!savedPlan && latestVersion?.status === "reviewed");

  const savePlan = async () => {
    setActionError(null);
    setActionMessage(null);
    if (projectedIncome <= 0 || projectedExpenses < 0) {
      setActionError("Enter valid projected values. Income must be greater than zero.");
      return;
    }
    if (reserveTargetInput < 0) {
      setActionError("The reserve target cannot be negative.");
      return;
    }
    if (demoMode) {
      const version = {
        id: Date.now(),
        version: (latestVersion?.version ?? 0) + 1,
        status: "draft" as const,
        assumptions: {},
        projected_income: projectedIncome.toFixed(2),
        projected_expenses: projectedExpenses.toFixed(2),
        estimated_reserve: reserveTargetInput.toFixed(2),
        notes: form.notes,
        created_at: new Date().toISOString(),
      };
      setSavedPlan({
        id: planDetail?.id ?? 1,
        name: form.name,
        period: form.period,
        status: "draft",
        current_version: version.version,
        created_at: new Date().toISOString(),
        version,
      });
      setActionMessage(`Version v${version.version} saved in the demo.`);
      return;
    }
    if (!companyId) return;

    setSaving(true);
    try {
      const assumptions = draft
        ? {
            ...draft.assumptions,
            source: "model_forecast",
            forecast_run_id: draft.sourceForecastId ?? null,
            model_label: draft.methodLabel ?? null,
            notes: form.notes,
          }
        : { source: "manual", notes: form.notes };
      const payload = {
        projected_income: projectedIncome.toFixed(2),
        projected_expenses: projectedExpenses.toFixed(2),
        estimated_reserve: reserveTargetInput.toFixed(2),
        assumptions,
        notes: form.notes,
      };
      const saved = planDetail
        ? await createPlanVersion(companyId, planDetail.id, payload)
        : await createPlan(companyId, {
            name: form.name,
            period: form.period,
            projected_income: payload.projected_income,
            projected_expenses: payload.projected_expenses,
            estimated_reserve: payload.estimated_reserve,
            assumptions: payload.assumptions,
            notes: payload.notes,
          });
      setSavedPlan(saved);
      setActionMessage(`Version v${saved.version?.version ?? saved.current_version} saved. Previous versions are kept.`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reviewSavedPlan = async () => {
    setActionError(null);
    setActionMessage(null);
    if (!savedPlan?.version) {
      setActionError("Save a version before marking it as reviewed.");
      return;
    }
    if (demoMode) {
      setSavedPlan({ ...savedPlan, status: "reviewed", version: { ...savedPlan.version, status: "reviewed" } });
      setActionMessage("Version marked as reviewed in the demo.");
      return;
    }
    if (!companyId) return;
    setReviewing(true);
    try {
      const reviewed = await reviewPlanVersion(companyId, savedPlan.id, savedPlan.version.id);
      setSavedPlan(reviewed);
      setActionMessage("Version marked as reviewed. It can no longer change.");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReviewing(false);
    }
  };

  const addReserve = async () => {
    setActionError(null);
    setActionMessage(null);
    const amount = toMoneyString(reserveForm.amount);
    if (Number(amount) <= 0) {
      setActionError("The reserve must be greater than zero.");
      return;
    }
    if (demoMode) {
      setReservesTotal((current) => current + Number(amount));
      setReserveForm({ amount: "", reserved_on: todayISO(), note: "" });
      setActionMessage("Reserve recorded in the demo.");
      return;
    }
    if (!companyId) return;
    setReserveSaving(true);
    try {
      await createReserve(companyId, {
        amount,
        reserved_on: reserveForm.reserved_on,
        note: reserveForm.note,
        plan_version_id: savedPlan?.version?.id ?? latestVersion?.id ?? null,
      });
      setReservesTotal((current) => current + Number(amount));
      setReserveForm({ amount: "", reserved_on: todayISO(), note: "" });
      setActionMessage("Reserve recorded.");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReserveSaving(false);
    }
  };

  const stepLabels = ["Review information", "Assumptions and parameters", "Reserve plan"];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Tax planning"
        subtitle={`${companyName} · Period ${form.period}`}
        actions={<Btn variant="ghost" icon={<Layers size={13} />} small onClick={() => onNav("escenarios")}>Compare scenarios</Btn>}
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading planning information…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 0, marginBottom: 32, backgroundColor: "#fff", borderRadius: 12, padding: "4px", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {stepLabels.map((label, index) => {
          const stepNumber = (index + 1) as PlanStep;
          const active = step === stepNumber;
          const done = step > stepNumber;
          return (
            <button key={label} onClick={() => setStep(stepNumber)} style={{ flex: 1, padding: "11px 16px", borderRadius: 9, border: "none", cursor: "pointer", backgroundColor: active ? "#1B5E3F" : "transparent", color: active ? "#fff" : done ? "#1B5E3F" : "#78909C", fontWeight: active ? 700 : 500, fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, backgroundColor: active ? "rgba(255,255,255,0.2)" : done ? "#E8F5E9" : "#F5F7F6", color: active ? "#fff" : done ? "#1B5E3F" : "#78909C" }}>
                {done ? <CheckCircle size={13} /> : stepNumber}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Recorded information</div>
            {[
              { label: "Company", value: companyName },
              { label: "Period", value: form.period },
              { label: "Observed income", value: fmt(observedIncome), note: dashboard ? "Year to date" : "Sample data" },
              { label: "Observed expenses", value: fmt(observedExpenses), note: dashboard ? "Year to date" : "Sample data" },
              { label: "Plan income", value: fmt(projectedIncome), note: "Planning forecast" },
              { label: "Plan expenses", value: fmt(projectedExpenses), note: "Planning forecast" },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <span style={{ fontSize: 13, color: "#78909C" }}>{row.label}</span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#37474F" }}>{row.value}</span>
                  {row.note && <span style={{ display: "block", fontSize: 10, color: "#B0BEC5" }}>{row.note}</span>}
                </div>
              </div>
            ))}
            {forecast && (
              <div style={{ marginTop: 14, fontSize: 11, color: "#1565C0", backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 8, padding: "8px 12px" }}>
                Latest stored forecast: {fmt(num(forecast.projected_income))} of income and {fmt(num(forecast.projected_expenses))} of expenses for {forecast.horizon_months} months.
              </div>
            )}
          </Card>

          <div>
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 12 }}>Pending obligations</div>
              {pendingObligations.map((obligation) => (
                <div key={obligation.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#37474F" }}>{obligation.name}</div>
                  <div style={{ fontSize: 11, color: "#E53935", marginTop: 2 }}>Vence: {fmtDate(obligation.due_date)}</div>
                  <div style={{ fontSize: 11, color: "#78909C" }}>Estimate: {obligation.estimated_amount ? fmt(num(obligation.estimated_amount)) : "To be defined"}</div>
                </div>
              ))}
              {pendingObligations.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No pending obligations recorded.</div>}
            </Card>
            <Btn variant="primary" onClick={() => setStep(2)} fullWidth icon={<ChevronRight size={14} />}>Continue to assumptions</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Assumptions and parameters</div>
              <Badge label={parameters.some((item) => item.reviewed) ? "Partially reviewed" : "Review required"} color="#E65100" bg="#FFF3E0" border="#FFCC80" />
            </div>

            <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#E65100", lineHeight: 1.6 }}>
              <Info size={13} style={{ display: "inline", marginRight: 5 }} />
              The parameters are configuration values. The accountant must review and confirm them before using this estimate.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#F5F7F6" }}>
                    {["Parameter", "Value", "Unit", "Source / note", "Review"].map((header) => (
                      <th key={header} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.07)", whiteSpace: "nowrap" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parameters.map((row, index) => (
                    <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                      <td style={{ padding: "11px 14px", fontWeight: 600, color: "#37474F" }}>{row.label}</td>
                      <td style={{ padding: "11px 14px", color: "#37474F", fontWeight: 700 }}>{parameterValue(row)}</td>
                      <td style={{ padding: "11px 14px", color: "#78909C" }}>{unitLabel(row.unit)}</td>
                      <td style={{ padding: "11px 14px", color: "#78909C", fontSize: 12 }}>{row.source || "No source recorded"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <Badge label={row.reviewed ? "Reviewed" : "Not reviewed"} color={row.reviewed ? "#1B5E3F" : "#78909C"} bg={row.reviewed ? "#E8F5E9" : "#ECEFF1"} border={row.reviewed ? "#A5D6A7" : "#CFD8DC"} />
                      </td>
                    </tr>
                  ))}
                  {parameters.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No tax parameters configured. The estimate will stay pending configuration.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ backgroundColor: "#ECEFF1", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontSize: 12, color: "#78909C" }}>
              If configured and reviewed parameters are missing, the estimate is shown as <strong>"pending configuration"</strong>. Obligations are never inferred automatically.
            </div>
          </Card>

          <div style={{ display: "flex", gap: 12 }}>
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn variant="primary" onClick={() => setStep(3)} icon={<ChevronRight size={14} />}>Continue to reserve plan</Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 20 }}>Build plan version</div>

            {draft && (
              <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "#1565C0", lineHeight: 1.6 }}>
                <Info size={13} style={{ display: "inline", marginRight: 5 }} />
                Draft created from the {draft.methodLabel ?? "model"} forecast for the period {draft.period}{" "}
                (first forecast month). You set the reserve target: income minus expenses is not a tax or
                a mandatory reserve. Saving creates a new version; reviewed versions never change.
              </div>
            )}

            {actionError && <InlineError message={actionError} />}
            {actionMessage && (
              <div style={{ backgroundColor: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <CheckCircle size={18} color="#4CAF50" />
                <div style={{ fontSize: 12, color: "#1B5E3F", fontWeight: 600 }}>{actionMessage}</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 8 }}>
              <Field label="Plan name">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Period">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="2026-10" style={inputStyle} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Projected income for the period *">
                <input type="number" min="0" step="0.01" value={form.projected_income} onChange={(event) => setForm({ ...form, projected_income: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Projected expenses for the period *">
                <input type="number" min="0" step="0.01" value={form.projected_expenses} onChange={(event) => setForm({ ...form, projected_expenses: event.target.value })} style={inputStyle} />
              </Field>
            </div>

            <Field label="Plan reserve target" hint="Value set by the accountant. It is a planning decision, not a computed tax.">
              <input type="number" min="0" step="0.01" value={form.estimated_reserve} onChange={(event) => setForm({ ...form, estimated_reserve: event.target.value })} placeholder="0.00" style={inputStyle} />
            </Field>

            <Field label="Notes" hint="They are saved with the version and kept in the history.">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Assumptions, pending items or notes for the accountant…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 14px", marginTop: 4, fontSize: 11, color: "#E65100" }}>
              Guidance plan subject to accounting review. It is not an official tax assessment.
            </div>

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 22, paddingTop: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#37474F", marginBottom: 10 }}>Record reserve</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Reserve amount">
                  <input type="number" min="0" step="0.01" value={reserveForm.amount} onChange={(event) => setReserveForm({ ...reserveForm, amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                </Field>
                <Field label="Date">
                  <input type="date" value={reserveForm.reserved_on} onChange={(event) => setReserveForm({ ...reserveForm, reserved_on: event.target.value })} style={inputStyle} />
                </Field>
              </div>
              <Field label="Note">
                <input value={reserveForm.note} onChange={(event) => setReserveForm({ ...reserveForm, note: event.target.value })} placeholder="Reserve detail" style={inputStyle} />
              </Field>
              <Btn variant="secondary" icon={<Plus size={13} />} onClick={addReserve} small>{reserveSaving ? "Recording…" : "Record reserve"}</Btn>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 16 }}>Plan summary</div>
              {[
                { label: "Projected income", value: fmt(projectedIncome), note: "Value entered by the user", color: "#1B5E3F" },
                { label: "Projected expenses", value: fmt(projectedExpenses), note: "Value entered by the user", color: "#37474F" },
                { label: "Projected difference", value: fmt(projectedResult), note: "Reserve base; not an assessed tax", color: projectedResult >= 0 ? "#1565C0" : "#E53935" },
                { label: "Plan reserve target", value: fmt(reserveTargetInput), note: "Set by the accountant", color: "#6A1B9A" },
                { label: "Recorded reserves", value: fmt(reservesTotal), note: "Sum of reserve records", color: "#37474F" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 12, color: "#78909C" }}>{row.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: row.color }}>{row.value}</div>
                  <div style={{ fontSize: 10, color: "#B0BEC5" }}>{row.note}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 10, lineHeight: 1.5 }}>
                These figures are not equivalent to each other. The reserve is a planning decision, not an official assessment.
              </div>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn variant="primary" icon={<Save size={13} />} fullWidth onClick={savePlan}>{saving ? "Saving…" : "Save plan version"}</Btn>
              <Btn
                variant="ghost"
                icon={<Flag size={13} />}
                fullWidth
                onClick={reviewSavedPlan}
                disabled={!savedPlan?.version}
              >
                {reviewing ? "Marking…" : versionReviewed ? "Version already reviewed" : "Mark as reviewed"}
              </Btn>
              <Btn variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => setStep(2)} fullWidth>Back to assumptions</Btn>
            </div>

            {(savedPlan || planDetail) && (
              <Card style={{ padding: "16px 18px" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", marginBottom: 8 }}>Current version</div>
                <div style={{ fontSize: 12, color: "#78909C", lineHeight: 1.7 }}>
                  Plan: {savedPlan?.name ?? planDetail?.name}<br />
                  Version: v{savedPlan?.version?.version ?? latestVersion?.version ?? planDetail?.current_version}<br />
                  Status: {savedPlan?.version?.status === "reviewed" || latestVersion?.status === "reviewed" ? "Reviewed (read-only)" : "Draft"}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// ESCENARIOS
const EscenariosScreen = ({ companyName }: { companyName: string }) => {
  const [scenario, setScenario] = useState<"base" | "menor" | "mayor">("base");

  const scenarioCfg = {
    base: { label: "Base", ingresos: 55000000, gastos: 37000000, meta: 4500000, reserva: 3000000 },
    menor: { label: "Lower income", ingresos: 44000000, gastos: 37000000, meta: 4500000, reserva: 3000000 },
    mayor: { label: "Higher expenses", ingresos: 55000000, gastos: 46000000, meta: 4500000, reserva: 3000000 },
  };

  const sc = scenarioCfg[scenario];
  const diferencia = sc.meta - sc.reserva;

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Planning scenario comparison" subtitle={`Illustrative scenarios · ${companyName} · ${currentPeriod()}`} />

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#E65100", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>The scenarios in this view are illustrative and do not use the company's records. Changes in income or expenses do not recompute taxes unless a configured and reviewed tax rule exists. A lower reserve is never called a "tax saving".</span>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
        {(["base", "menor", "mayor"] as const).map((key) => (
          <button key={key} onClick={() => setScenario(key)} style={{ padding: "10px 20px", borderRadius: 9, border: scenario === key ? "none" : "1.5px solid #CFD8DC", backgroundColor: scenario === key ? "#1B5E3F" : "#fff", color: scenario === key ? "#fff" : "#78909C", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            {scenarioCfg[key].label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginBottom: 28 }}>
        {[
          { label: "Projected income", value: fmtM(sc.ingresos), note: "Simulated forecast" },
          { label: "Projected expenses", value: fmtM(sc.gastos), note: "Simulated forecast" },
          { label: "Diferencia ingr. − gast.", value: fmtM(sc.ingresos - sc.gastos), note: "No equivale a utilidad fiscal ni a impuesto a pagar" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1B5E3F" }}>{item.value}</div>
            <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 4 }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Scenario assumptions</div>
          <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#37474F", lineHeight: 1.8 }}>
            <strong>Escenario:</strong> {sc.label}<br />
            <strong>Adjusted income:</strong> {fmtM(sc.ingresos)}<br />
            <strong>Adjusted expenses:</strong> {fmtM(sc.gastos)}<br />
            <strong>Assumption:</strong> Illustrative demo figures<br />
            <strong>Configured tax rules:</strong> Not applied in this scenario
          </div>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Reserve plan in this scenario</div>
          {[
            { label: "Reserve target set", value: fmtM(sc.meta), color: "#1B5E3F" },
            { label: "Available reserve (recorded)", value: fmtM(sc.reserva), color: "#37474F" },
            { label: "Missing", value: fmtM(diferencia), color: diferencia > 0 ? "#E53935" : "#1B5E3F" },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <span style={{ fontSize: 13, color: "#78909C" }}>{row.label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: row.color }}>{row.value}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 12 }}>The recorded reserve is reported by the user. It does not imply a bank integration.</div>
        </Card>
      </div>
    </div>
  );
};


// OBLIGACIONES
const DEMO_TRACKED_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "Bimonthly VAT", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Date recorded manually." },
  { id: 2, name: "Withholding tax", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Amount pending." },
  { id: 3, name: "Annual ICA", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimate pending." },
  { id: 4, name: "Bimonthly VAT", period: "Jul-Ago 2026", due_date: "2026-08-28", estimated_amount: "3200000.00", status: "paid", notes: "Filed and paid." },
];

const obligationBadgeStyle = (status: string) => {
  if (status === "paid") return { color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" };
  if (status === "filed") return { color: "#1565C0", bg: "#E3F2FD", border: "#90CAF9" };
  if (status === "void") return { color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" };
  return { color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" };
};

const ObligacionesScreen = ({
  companyId,
  companyName,
  demoMode,
  canManage,
}: {
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  canManage: boolean;
}) => {
  const [rows, setRows] = useState<Obligation[]>([]);
  const [demoRows, setDemoRows] = useState<Obligation[]>(DEMO_TRACKED_OBLIGATIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    period: currentPeriod(),
    due_date: todayISO(),
    estimated_amount: "",
    notes: "",
  });

  useEffect(() => {
    if (!companyId || demoMode) {
      setRows([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    listObligations(companyId)
      .then((response) => {
        if (alive) setRows(response.items);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  const displayRows = demoMode ? demoRows : rows;
  const pendingCount = displayRows.filter((row) => row.status === "pending" || row.status === "filed").length;
  const today = todayISO();

  const openForm = () => {
    setForm({ name: "", period: currentPeriod(), due_date: todayISO(), estimated_amount: "", notes: "" });
    setFormError(null);
    setShowForm(true);
  };

  const save = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("The obligation name is required.");
      return;
    }
    if (!form.due_date) {
      setFormError("The due date is required.");
      return;
    }
    const estimated = form.estimated_amount.trim() ? toMoneyString(form.estimated_amount) : null;

    if (demoMode) {
      setDemoRows((current) => [
        {
          id: Date.now(),
          name: form.name.trim(),
          period: form.period,
          due_date: form.due_date,
          estimated_amount: estimated,
          status: "pending",
          notes: form.notes,
        },
        ...current,
      ]);
      setShowForm(false);
      return;
    }
    if (!companyId) return;

    setSaving(true);
    try {
      await createObligation(companyId, {
        name: form.name.trim(),
        period: form.period,
        due_date: form.due_date,
        estimated_amount: estimated,
        notes: form.notes,
      });
      setShowForm(false);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row: Obligation, status: Obligation["status"]) => {
    setError(null);
    if (!canManage) {
      setError("Your role can view obligations but not change them.");
      return;
    }
    if (demoMode) {
      setDemoRows((current) => current.map((item) => (item.id === row.id ? { ...item, status } : item)));
      return;
    }
    if (!companyId) return;
    setBusyId(row.id);
    try {
      await updateObligation(companyId, row.id, { status });
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Obligations and calendar"
        subtitle={`Manually recorded dates · ${companyName}`}
        actions={canManage && <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Record obligation</Btn>}
      />

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#E65100", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Dates and amounts are recorded by the user. Check the applicable calendar with the accountant. Nothing is sent to the DIAN and nothing is paid.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading obligations…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded obligations", value: `${displayRows.length}`, note: "Total in the calendar" },
          { label: "Pending or filed", value: `${pendingCount}`, note: "Need follow-up" },
          { label: "Overdue by recorded date", value: `${displayRows.filter((row) => row.status === "pending" && row.due_date < today).length}`, note: "Compared with today's date" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#37474F" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#B0BEC5" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      {!canManage && !demoMode && (
        <div style={{ backgroundColor: "#ECEFF1", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#78909C" }}>
          Your role can view the calendar. Only an Administrator or Accountant can record items or change their status.
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F" }}>Recorded calendar</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Obligation", "Period", "Due date", "Estimate", "Status", "Notes", "Actions"].map((header) => (
                  <th key={header} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const overdue = row.status === "pending" && row.due_date < today;
                const style = obligationBadgeStyle(row.status);
                return (
                  <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#37474F" }}>
                      {row.name}
                      {overdue && <span style={{ display: "block", fontSize: 10, color: "#E53935", fontWeight: 700 }}>Overdue by recorded date</span>}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{row.period || "—"}</td>
                    <td style={{ padding: "12px 14px", color: overdue ? "#E53935" : "#37474F", fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>{fmtDate(row.due_date)}</td>
                    <td style={{ padding: "12px 14px", color: row.estimated_amount ? "#37474F" : "#FBC02D", fontWeight: 600 }}>{row.estimated_amount ? fmt(num(row.estimated_amount)) : "To be defined"}</td>
                    <td style={{ padding: "12px 14px" }}><Badge label={obligationStatusLabel(row.status)} {...style} /></td>
                    <td style={{ padding: "12px 14px", color: "#78909C", fontSize: 12, maxWidth: 220 }}>{row.notes || "—"}</td>
                    <td style={{ padding: "12px 14px" }}>
                      {row.status === "paid" || row.status === "void" ? (
                        <span style={{ fontSize: 11, color: "#B0BEC5" }}>No actions</span>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {row.status === "pending" && (
                            <button onClick={() => changeStatus(row, "filed")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1565C0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                              Presentar
                            </button>
                          )}
                          <button onClick={() => changeStatus(row, "paid")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                            Pagar
                          </button>
                          <button onClick={() => changeStatus(row, "void")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#78909C", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                            Anular
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No obligations recorded for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Changing the status does not file returns or make payments. It is an internal follow-up record.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Record obligation</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
            </div>

            {formError && <InlineError message={formError} />}

            <Field label="Obligation name *">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Bimonthly VAT" style={inputStyle} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Period">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="Sep-Oct 2026" style={inputStyle} />
              </Field>
              <Field label="Vencimiento *">
                <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} style={inputStyle} />
              </Field>
            </div>

            <Field label="Estimated amount" hint="Optional. Shown as an estimate, not as an official assessment.">
              <input type="number" min="0" step="0.01" value={form.estimated_amount} onChange={(event) => setForm({ ...form, estimated_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
            </Field>

            <Field label="Notes">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Follow-up notes…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancel</Btn>
              <Btn variant="primary" onClick={save} fullWidth>{saving ? "Saving…" : "Save obligation"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// ALERTAS
const DEMO_ALERTS: ApiAlert[] = ALERTAS_DATA.map((alert) => ({
  id: alert.id,
  title: alert.titulo,
  description: alert.desc,
  priority: alert.prioridad,
  origin: alert.origen,
  status: alert.estado === "revisada" ? "reviewed" : alert.estado === "en-revision" ? "in_review" : "pending",
  due_date: null,
  created_at: `2026-10-${String(19 - alert.id).padStart(2, "0")}T09:00:00Z`,
}));

const ALERT_ORIGIN_LABEL: Record<string, string> = {
  erp: "ERP data",
  plan: "Comparison with the plan",
  proyeccion: "Estimated forecast",
  configuracion: "Configuration pending",
};

const AlertasScreen = ({
  companyId,
  companyName,
  demoMode,
  canManage,
  onViewDetail,
  onNav,
}: {
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  canManage: boolean;
  onViewDetail: (id: number) => void;
  onNav: (s: Screen) => void;
}) => {
  const [alerts, setAlerts] = useState<ApiAlert[]>([]);
  const [demoAlerts, setDemoAlerts] = useState<ApiAlert[]>(DEMO_ALERTS);
  const [filter, setFilter] = useState<"todas" | AlertStatus>("todas");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; description: string; priority: AlertPriority; origin: AlertOrigin }>({
    title: "",
    description: "",
    priority: "media",
    origin: "erp",
  });

  useEffect(() => {
    if (!companyId || demoMode) {
      setAlerts([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    // Evaluating rules is an explicit action when Alerts opens; the dashboard
    // GET never writes alerts.
    evaluateAlerts(companyId)
      .catch(() => null)
      .then(() => listAlerts(companyId))
      .then((response) => {
        if (alive) setAlerts(response.items);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  const source = demoMode ? demoAlerts : alerts;
  const filtered = filter === "todas" ? source : source.filter((alert) => alertStatusUi(alert.status) === filter);

  const openForm = () => {
    setForm({ title: "", description: "", priority: "media", origin: "erp" });
    setFormError(null);
    setShowForm(true);
  };

  const save = async () => {
    setFormError(null);
    if (!form.title.trim()) {
      setFormError("The alert title is required.");
      return;
    }
    if (demoMode) {
      setDemoAlerts((current) => [
        {
          id: Date.now(),
          title: form.title.trim(),
          description: form.description,
          priority: form.priority,
          origin: form.origin,
          status: "pending",
          due_date: null,
          created_at: new Date().toISOString(),
        },
        ...current,
      ]);
      setShowForm(false);
      return;
    }
    if (!companyId) return;
    setSaving(true);
    try {
      await createAlert(companyId, {
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        origin: form.origin,
      });
      setShowForm(false);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Alerts and follow-up"
        subtitle={`Planning notices · ${companyName}`}
        actions={canManage && <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>New alert</Btn>}
      />

      <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#1565C0", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>These alerts are internal planning notices. They do not predict penalties or DIAN actions.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading alerts…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["todas", "pendiente", "en-revision", "revisada"] as const).map((option) => (
          <button key={option} onClick={() => setFilter(option)} style={{ padding: "8px 16px", borderRadius: 20, border: filter === option ? "none" : "1px solid #CFD8DC", backgroundColor: filter === option ? "#1B5E3F" : "#fff", color: filter === option ? "#fff" : "#78909C", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {option === "todas" ? `All (${source.length})` : option === "pendiente" ? "Pending" : option === "en-revision" ? "In review" : "Resolved"}
          </button>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Title", "Priority", "Origin", "Date", "Status", "Action"].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((alert, index) => (
                <tr key={alert.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#37474F", maxWidth: 320 }}>{alert.title}</td>
                  <td style={{ padding: "12px 14px" }}><PriorityBadge p={alert.priority} /></td>
                  <td style={{ padding: "12px 14px", fontSize: 12, color: "#78909C" }}>{alert.origin_label ?? ALERT_ORIGIN_LABEL[alert.origin] ?? alert.origin}</td>
                  <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(alert.created_at)}</td>
                  <td style={{ padding: "12px 14px" }}><StatusBadge s={alertStatusUi(alert.status)} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <button onClick={() => onViewDetail(alert.id)} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontFamily: "inherit" }}>
                        <Eye size={13} /> View
                      </button>
                      {alert.action && (
                        <button onClick={() => onNav(alert.action!.screen as Screen)} style={{ background: "none", border: "none", color: "#1565C0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          {alert.action.label}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No alerts match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Marking an alert as reviewed does not change amounts, reserves or estimates.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>New follow-up alert</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
            </div>

            {formError && <InlineError message={formError} />}

            <Field label="Title *">
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Review pending expenses" style={inputStyle} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Priority">
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as AlertPriority })} style={inputStyle}>
                  <option value="alta">High</option>
                  <option value="media">Medium</option>
                  <option value="baja">Low</option>
                </select>
              </Field>
              <Field label="Origin">
                <select value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value as AlertOrigin })} style={inputStyle}>
                  <option value="erp">ERP data</option>
                  <option value="plan">Comparison with the plan</option>
                  <option value="proyeccion">Estimated forecast</option>
                  <option value="configuracion">Configuration pending</option>
                </select>
              </Field>
            </div>

            <Field label="Description">
              <textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Detail of the finding and what to check…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancel</Btn>
              <Btn variant="primary" onClick={save} fullWidth>{saving ? "Saving…" : "Create alert"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// ALERTA DETALLE
type AlertCommentRow = { id: number; body: string; user_id: number | null; created_at: string };

const AlertaDetalleScreen = ({
  companyId,
  alertId,
  companyName,
  demoMode,
  canManage,
  onBack,
  onNav,
}: {
  companyId: number | null;
  alertId: number;
  companyName: string;
  demoMode: boolean;
  canManage: boolean;
  onBack: () => void;
  onNav: (s: Screen) => void;
}) => {
  const demoAlert = demoMode ? DEMO_ALERTS.find((item) => item.id === alertId) ?? null : null;
  const [alert, setAlert] = useState<ApiAlert | null>(null);
  const [comments, setComments] = useState<AlertCommentRow[]>([]);
  const [demoComments, setDemoComments] = useState<AlertCommentRow[]>([]);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    if (!companyId || demoMode) {
      setAlert(null);
      setComments([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getAlert(companyId, alertId)
      .then((response) => {
        if (!alive) return;
        setAlert(response);
        setComments(response.comments ?? []);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode, alertId, reloadKey]);

  const displayed = demoMode ? demoAlert : alert;
  const displayedComments = demoMode ? demoComments : comments;
  const displayedStatus = demoStatus ?? displayed?.status ?? "pending";

  const postComment = async () => {
    const body = comment.trim();
    if (!body || !displayed) return;
    setError(null);
    if (demoMode) {
      setDemoComments((current) => [
        ...current,
        { id: Date.now(), body, user_id: null, created_at: new Date().toISOString() },
      ]);
      setComment("");
      return;
    }
    if (!companyId) return;
    setPosting(true);
    try {
      await addAlertComment(companyId, displayed.id, body);
      setComment("");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const changeStatus = async (status: ApiAlert["status"]) => {
    if (!displayed) return;
    setError(null);
    if (!canManage) {
      setError("Your role can view the alert but not change its status.");
      return;
    }
    if (demoMode) {
      setDemoStatus(status);
      return;
    }
    if (!companyId) return;
    setStatusBusy(true);
    try {
      const updated = await updateAlert(companyId, displayed.id, { status });
      setAlert({ ...displayed, ...updated });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatusBusy(false);
    }
  };

  if (!loading && !displayed) {
    return (
      <div style={{ padding: "28px 32px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit", marginBottom: 20 }}>
          <ArrowLeft size={16} /> Back to alerts
        </button>
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <AlertCircle size={40} color="#E53935" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F" }}>Alert not found</div>
          <p style={{ fontSize: 12, color: "#78909C" }}>{error ?? "The alert does not exist or does not belong to this company."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit", marginBottom: 16 }}>
          <ArrowLeft size={16} /> Back to alerts
        </button>
        {loading && <div style={{ marginBottom: 12, fontSize: 12, color: "#78909C" }}>Loading alert…</div>}
        {displayed && (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1B5E3F", margin: "0 0 8px" }}>{displayed.title}</h1>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <PriorityBadge p={displayed.priority} />
                <StatusBadge s={alertStatusUi(displayedStatus)} />
                <span style={{ fontSize: 12, color: "#78909C" }}>{fmtDate(displayed.created_at)} · {companyName}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <InlineError message={error} />}

      {displayed && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
          <div>
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 12 }}>Description</div>
              <p style={{ fontSize: 14, color: "#37474F", lineHeight: 1.7, margin: 0, whiteSpace: "pre-line" }}>{displayed.description || "No description recorded."}</p>
            </Card>

            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 12 }}>Review suggestion</div>
              <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#37474F", lineHeight: 1.7 }}>
                Check the related record, document the decision in a comment and confirm with the accountant when needed. Marking the alert as reviewed does not change amounts, reserves or estimates.
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 16 }}>Comment history</div>
              {displayedComments.length === 0 && (
                <div style={{ fontSize: 12, color: "#78909C", marginBottom: 12 }}>No comments recorded yet.</div>
              )}
              {displayedComments.map((item) => (
                <div key={item.id} style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#1B5E3F", flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <div style={{ fontSize: 11, color: "#78909C" }}>{fmtDate(item.created_at)}</div>
                    <div style={{ fontSize: 13, color: "#37474F", marginTop: 2 }}>{item.body}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a note…"
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                  onKeyDown={(event) => event.key === "Enter" && postComment()}
                />
                <Btn variant="primary" icon={<MessageSquare size={13} />} onClick={postComment}>{posting ? "Guardando…" : "Add"}</Btn>
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card style={{ padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#37474F", marginBottom: 14 }}>Actions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displayed.action && (
                  <Btn variant="secondary" icon={<ExternalLink size={13} />} fullWidth onClick={() => onNav(displayed.action!.screen as Screen)}>
                    {displayed.action.label}
                  </Btn>
                )}
                {displayedStatus !== "in_review" && displayedStatus !== "reviewed" && (
                  <Btn variant="ghost" icon={<Clock size={13} />} fullWidth onClick={() => changeStatus("in_review")}>Mark as in review</Btn>
                )}
                {displayedStatus !== "reviewed" && (
                  <button
                    onClick={() => changeStatus("reviewed")}
                    disabled={statusBusy}
                    style={{ padding: "10px 14px", borderRadius: 9, border: "1.5px solid #1B5E3F", backgroundColor: "#E8F5E9", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: statusBusy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <CheckCircle size={13} /> {statusBusy ? "Saving…" : "Mark as resolved"}
                  </button>
                )}
                {displayedStatus === "reviewed" && (
                  <div style={{ backgroundColor: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: 9, padding: "10px 14px", fontSize: 12, color: "#1B5E3F", fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                    <CheckCircle size={13} /> Alert resolved
                  </div>
                )}
              </div>
              {displayedStatus === "reviewed" && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#78909C", lineHeight: 1.5 }}>
                  Marking as resolved does not change amounts, reserves or estimates. The alert stays in the history.
                </div>
              )}
              {!canManage && !demoMode && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#B0BEC5", lineHeight: 1.5 }}>
                  Only an Administrator or Accountant can change the status.
                </div>
              )}
            </Card>

            <Card style={{ padding: "18px 20px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", marginBottom: 10 }}>Information</div>
              {[
                { label: "Company", value: companyName },
                { label: "Origin", value: displayed.origin_label ?? ALERT_ORIGIN_LABEL[displayed.origin] ?? displayed.origin },
                { label: "Priority", value: ({ alta: "High", media: "Medium", baja: "Low" } as Record<string, string>)[displayed.priority] ?? displayed.priority },
                { label: "Created", value: fmtDate(displayed.created_at) },
                { label: "Due date", value: displayed.due_date ? fmtDate(displayed.due_date) : "Not recorded" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 10, color: "#B0BEC5" }}>{row.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#37474F", textTransform: row.label === "Priority" ? "capitalize" : undefined }}>{row.value}</div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};


// HISTORIAL
const DEMO_PLAN_DETAILS: PlanDetail[] = [
  {
    id: 1,
    name: "Reserve plan Oct 2026",
    period: "2026-10",
    status: "draft",
    current_version: 2,
    created_at: "2026-10-01T09:00:00Z",
    versions: [
      { id: 12, version: 2, status: "draft", assumptions: { source: "manual" }, projected_income: "55000000.00", projected_expenses: "37000000.00", estimated_reserve: "4500000.00", notes: "Adjustment for lower sales.", created_at: "2026-10-19T09:00:00Z" },
      { id: 11, version: 1, status: "reviewed", assumptions: { source: "manual" }, projected_income: "58000000.00", projected_expenses: "38500000.00", estimated_reserve: "4500000.00", notes: "Initial reviewed version.", created_at: "2026-10-10T09:00:00Z" },
    ],
  },
  {
    id: 2,
    name: "Reserve plan Sep 2026",
    period: "2026-09",
    status: "reviewed",
    current_version: 1,
    created_at: "2026-09-28T09:00:00Z",
    versions: [
      { id: 21, version: 1, status: "reviewed", assumptions: {}, projected_income: "52000000.00", projected_expenses: "35000000.00", estimated_reserve: "4200000.00", notes: "September close.", created_at: "2026-09-30T09:00:00Z" },
    ],
  },
];

const DEMO_FORECAST_RUNS: ForecastRun[] = [
  { id: 3, method: "promedio_manual", horizon_months: 3, cutoff_date: "2026-10-19", projected_income: "165000000.00", projected_expenses: "111000000.00", model_version: null, created_at: "2026-10-19T09:00:00Z" },
  { id: 2, method: "promedio_manual", horizon_months: 3, cutoff_date: "2026-09-30", projected_income: "156000000.00", projected_expenses: "108000000.00", model_version: null, created_at: "2026-09-30T09:00:00Z" },
];

const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  { id: 5, action: "plan.review", resource: "plan:2", detail: { version: 1 }, actor_id: 1, request_id: null, created_at: "2026-09-30T10:00:00Z" },
  { id: 4, action: "plan.create", resource: "plan:2", detail: {}, actor_id: 1, request_id: null, created_at: "2026-09-28T09:00:00Z" },
  { id: 3, action: "expense.update", resource: "expense:14", detail: { reviewed: true }, actor_id: 1, request_id: null, created_at: "2026-09-27T15:00:00Z" },
];

const planVersionUi = (status: string) => {
  if (status === "reviewed") return { label: "Reviewed", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" };
  if (status === "archived") return { label: "Archived", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" };
  return { label: "Draft", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" };
};

const forecastMethodLabel = (run: ForecastRun) =>
  run.method_label ??
  ({
    manual: "Manual average",
    promedio_manual: "Manual average",
    seasonal_naive: "Seasonal naive (lag-12)",
    linear: "Linear regression",
    random_forest: "Random Forest",
    mlp: "MLP",
  } as Record<string, string>)[run.method] ??
  run.method;

// ─── CONTEXT AND SOURCES (SECONDARY SECTION) ─────────────────────────────────

const licenseUi = (status: ContextSource["license"]["status"]) =>
  ({
    verified: { label: "License verified", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" },
    uncertain: { label: "License not verified", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" },
    restricted: { label: "Restricted use", color: "#C62828", bg: "#FFEBEE", border: "#FFCDD2" },
  })[status];

const ContextoSourceCard = ({ source }: { source: ContextSource }) => {
  const license = licenseUi(source.license.status);
  const version = source.current_version;
  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1B5E3F" }}>{source.name}</div>
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>{source.publisher}</div>
        </div>
        <Badge {...license} />
      </div>

      <p style={{ fontSize: 12, color: "#546E7A", margin: "10px 0 12px", lineHeight: 1.5 }}>{source.description}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 11, color: "#78909C" }}>
        <div><strong style={{ color: "#37474F" }}>Cadencia:</strong> {source.cadence}</div>
        <div><strong style={{ color: "#37474F" }}>Licencia:</strong> {source.license.name || "No declarada"}</div>
        <div><strong style={{ color: "#37474F" }}>Current version:</strong> {version?.version_label ?? "Not loaded"}</div>
        <div><strong style={{ color: "#37474F" }}>Adquirida:</strong> {version ? fmtDate(version.acquired_at) : "—"}</div>
        <div><strong style={{ color: "#37474F" }}>Cutoff:</strong> {version?.cutoff_date ? fmtDate(version.cutoff_date) : "—"}</div>
        <div><strong style={{ color: "#37474F" }}>Source rows:</strong> {version ? version.row_count.toLocaleString("en-US") : "—"}</div>
      </div>

      {version && (version.is_partial || version.is_preliminary) && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#E65100", backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 8, padding: "6px 10px" }}>
          {version.is_partial ? "Partial period. " : ""}
          {version.is_preliminary ? "Preliminary figures, subject to review by the publisher." : ""}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
        <a href={source.source_url} target="_blank" rel="noreferrer" style={{ color: "#1565C0", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
          <ExternalLink size={12} /> Official source
        </a>
        {source.license.url && (
          <a href={source.license.url} target="_blank" rel="noreferrer" style={{ color: "#1565C0", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
            <ExternalLink size={12} /> License terms
          </a>
        )}
        <span style={{ color: "#B0BEC5" }}>Attribution: {source.attribution || "—"}</span>
      </div>
      {source.license.evidence_path && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#B0BEC5" }}>Evidencia local: {source.license.evidence_path}</div>
      )}
    </Card>
  );
};

const ContextoScreen = ({ demoMode }: { demoMode: boolean }) => {
  const [summary, setSummary] = useState<ContextSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (demoMode) {
      setSummary(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getContextSummary()
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [demoMode, reloadKey]);

  const tax = summary && "annual" in summary.tax ? (summary.tax as ContextTaxSummary) : null;
  const benchmarks: ContextBenchmark[] = summary?.benchmarks ?? [];
  const benchmarkYear = benchmarks[0]?.year;
  const monthName = tax?.monthly
    ? new Date(tax.monthly.year, tax.monthly.month - 1, 1).toLocaleDateString("en-US", { month: "long" })
    : "";

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Context and sources"
        subtitle="Aggregated public reference information · not part of the company's operations"
        actions={<Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Refresh</Btn>}
      />

      <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, backgroundColor: "#E3F2FD", border: "1px solid #BBDEFB", color: "#1565C0", fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10 }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          These figures are <strong>labeled external context</strong>. They are not tax obligations of the company,
          they are not joined by NIT and <strong>they do not feed the forecast or create alerts or tasks</strong>. DIAN collection
          is a national or departmental aggregate; Supersociedades describes the 10,000 largest companies and does not
          represent all companies.
        </div>
      </div>

      {demoMode && (
        <Card style={{ textAlign: "center", padding: "40px 24px" }}>
          <Database size={36} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Context not available in the demo</div>
          <p style={{ fontSize: 12, color: "#78909C", margin: 0 }}>
            This section uses public sources loaded in the backend. No simulated figures are shown, so they are not
            confused with real data. Sign in with a connected account to see it.
          </p>
        </Card>
      )}

      {!demoMode && loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading context and sources…</div>}
      {!demoMode && error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!demoMode && !loading && !error && summary && (
        <>
          {summary.sources.length === 0 ? (
            <Card style={{ textAlign: "center", padding: "40px 24px" }}>
              <Database size={36} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>No sources loaded</div>
              <p style={{ fontSize: 12, color: "#78909C", margin: 0 }}>
                Run the acquisition and the manifest load to enable this section. Missing data is not an
                ERP error: the sources are loaded explicitly and outside the application startup.
              </p>
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 24 }}>
                {summary.sources.map((source) => (
                  <ContextoSourceCard key={source.code} source={source} />
                ))}
              </div>

              {tax && (
                <Card style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>DIAN collection · national reference</div>
                      <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>Version {tax.version_label} · original unit: millions of COP · shown in current pesos (COP)</div>
                    </div>
                    {(tax.annual.is_preliminary || tax.monthly?.is_preliminary) && (
                      <Badge label="Preliminary" color="#E65100" bg="#FFF3E0" border="#FFCC80" />
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>Annual total {tax.annual.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.annual.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>Aggregated gross collection, not an individual obligation</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>
                        {tax.monthly ? `Latest published month · ${monthName} ${tax.monthly.year}` : "Latest published month"}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>
                        {tax.monthly ? fmt(num(tax.monthly.total_cop)) : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>National monthly series</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>Regional offices {tax.departments.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.departments.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>Sum of regional offices</div>
                    </div>
                  </div>
                </Card>
              )}

              {benchmarks.length > 0 && (
                <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
                  <div style={{ padding: "18px 22px 12px" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>Supersociedades sector reference · {benchmarkYear}</div>
                    <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>
                      Aggregate of the 10,000 largest companies. A biased sample; it is not an average of all companies.
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F5F7F6" }}>
                          {["Metric", "Sample", "Total", "Median", "Mean", "At zero", "Negative"].map((header) => (
                            <th key={header} style={{ padding: "10px 14px", textAlign: header === "Metric" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {benchmarks.map((row) => (
                          <tr key={row.metric}>
                            <td style={{ padding: "10px 14px", fontWeight: 600, color: "#37474F" }}>{row.metric_label}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.sample_size.toLocaleString("en-US")}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.total_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.median_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.mean_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.zero_count.toLocaleString("en-US")}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.negative_count.toLocaleString("en-US")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "10px 22px", fontSize: 10, color: "#B0BEC5", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
                    Values converted from trillions (10¹² COP) to pesos. No precision is added beyond the published one.
                  </div>
                </Card>
              )}

              <div style={{ fontSize: 11, color: "#90A4AE", lineHeight: 1.6 }}>
                The original and processed files are kept outside git; the versioned manifests record the hash,
                cutoff date, period and status. To reproduce: <code>python -m ml.company_trainer.sources.acquire</code> and{" "}
                <code>python -m ml.company_trainer.sources.build_context</code>, then <code>flask context-load</code>. See
                <code> docs/erp/sources.md</code> and <code>docs/erp/data-dictionary.md</code>.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

const monitoringUi = (status: MonitoringStatus) =>
  ({
    pending: { label: "Pending", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" },
    normal: { label: "Normal", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" },
    watch: { label: "Watch", color: "#E65100", bg: "#FFF8E1", border: "#FFE082" },
    degraded: { label: "Degraded", color: "#C62828", bg: "#FFEBEE", border: "#EF9A9A" },
  })[status];

const MonitoringPanel = ({ view, error, demoMode }: { view: MonitoringView | null; error: string | null; demoMode: boolean }) => {
  if (demoMode) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: "#78909C" }}>
          Monitoring compares stored model forecasts with the real values registered in the ERP, so it is only shown with live data.
        </div>
      </Card>
    );
  }
  if (error) return <InlineError message={error} />;
  if (!view) return <div style={{ fontSize: 12, color: "#78909C" }}>Loading monitoring…</div>;
  const overall = monitoringUi(view.status);
  const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)} %`);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#78909C", marginBottom: 8 }}>OVERALL STATUS</div>
          <Badge label={overall.label} color={overall.color} bg={overall.bg} border={overall.border} />
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 10 }}>
            Model {view.model_version ?? "—"}
            {view.last_forecast_at && <span style={{ display: "block" }}>Last forecast {fmtDate(view.last_forecast_at)}</span>}
          </div>
          {view.inputs_changed_since_training && (
            <div style={{ fontSize: 11, color: "#E65100", marginTop: 8 }}>The company data changed after the model was trained.</div>
          )}
        </Card>
        {(["income", "expenses"] as const).map((target) => {
          const item = view.targets[target];
          const ui = monitoringUi(item.status);
          return (
            <Card key={target}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#78909C", marginBottom: 8 }}>{target === "income" ? "INCOME" : "EXPENSES"}</div>
              <Badge label={ui.label} color={ui.color} bg={ui.bg} border={ui.border} />
              <div style={{ fontSize: 12, color: "#37474F", marginTop: 10 }}>
                Rolling error {pct(item.rolling_normalized_error_pct)} · reference {pct(item.reference_normalized_error_pct)}
              </div>
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 4 }}>
                {item.months_used.length > 0 ? `Months used: ${item.months_used.join(", ")}` : "No resolved months yet"}
                {item.pending_months.length > 0 && (
                  <span style={{ display: "block" }}>Waiting for actual values: {item.pending_months.length} months</span>
                )}
              </div>
            </Card>
          );
        })}
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#78909C", marginBottom: 8 }}>FORECAST SERVICE</div>
          <div style={{ fontSize: 12, color: "#37474F" }}>{view.operations.requests} requests</div>
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 4 }}>
            {Object.entries(view.operations.outcomes).map(([outcome, count]) => `${outcome}: ${count}`).join(" · ") || "No requests yet"}
          </div>
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 4 }}>
            Latency p50 {view.operations.latency_ms.p50 ?? "—"} ms · p95 {view.operations.latency_ms.p95 ?? "—"} ms
          </div>
        </Card>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Month", "Target", "Step", "Predicted", "Actual", "Error", "Normalized error", "Status"].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row, index) => {
                const ui = monitoringUi(row.status);
                return (
                  <tr key={`${row.forecast_run_id}-${row.target}-${row.forecast_month}`} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "12px 14px", color: "#37474F", whiteSpace: "nowrap" }}>{row.forecast_month}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{row.target === "income" ? "Income" : "Expenses"}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{row.horizon_step}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.predicted_value))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{row.actual_value === null ? "—" : fmt(num(row.actual_value))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{row.absolute_error === null ? "—" : fmt(num(row.absolute_error))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{pct(row.normalized_error_pct)}</td>
                    <td style={{ padding: "12px 14px" }}><Badge label={ui.label} color={ui.color} bg={ui.bg} border={ui.border} /></td>
                  </tr>
                );
              })}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No model forecasts to monitor yet. Run a model forecast first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          The error is normalized by the mean monthly income of the forecast history and compared with the Phase 4 reference
          ({view.reference}). Normal: {view.thresholds.normal}; watch: {view.thresholds.watch}; degraded: {view.thresholds.degraded}.
          The status uses the last {view.thresholds.rolling_months} resolved months. A month stays pending until it is closed and its
          real values are registered.
        </div>
      </Card>
    </>
  );
};

const HistorialScreen = ({
  companyId,
  companyName,
  demoMode,
}: {
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
}) => {
  const [tab, setTab] = useState<"planes" | "proyecciones" | "monitoring" | "seguimiento">("planes");
  const [monitoring, setMonitoring] = useState<MonitoringView | null>(null);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [planDetails, setPlanDetails] = useState<PlanDetail[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRun[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditAvailable, setAuditAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!companyId || demoMode) {
      setPlanDetails([]);
      setForecasts([]);
      setAuditEvents([]);
      setMonitoring(null);
      setMonitoringError(null);
      setError(null);
      setAuditAvailable(true);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([listPlans(companyId), listForecasts(companyId)])
      .then(async ([plans, forecastResponse]) => {
        const details = await Promise.all(
          plans.items.slice(0, 10).map((plan) => getPlan(companyId, plan.id).catch(() => null)),
        );
        if (!alive) return;
        setPlanDetails(details.filter((item): item is PlanDetail => item !== null));
        setForecasts(forecastResponse.items);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    getMonitoring(companyId)
      .then((view) => {
        if (alive) {
          setMonitoring(view);
          setMonitoringError(null);
        }
      })
      .catch((err) => {
        if (alive) setMonitoringError(errorMessage(err));
      });

    listAudit(companyId)
      .then((response) => {
        if (alive) {
          setAuditEvents(response.items);
          setAuditAvailable(true);
        }
      })
      .catch(() => {
        if (alive) setAuditAvailable(false);
      });

    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  const displayedPlans = demoMode ? DEMO_PLAN_DETAILS : planDetails;
  const displayedForecasts = demoMode ? DEMO_FORECAST_RUNS : forecasts;
  const displayedAudit = demoMode ? DEMO_AUDIT_EVENTS : auditEvents;

  const versionRows = displayedPlans.flatMap((plan) =>
    plan.versions.map((version) => ({ plan, version })),
  );

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="History"
        subtitle={`Plan versions, forecasts and follow-up · ${companyName}`}
        actions={<Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Refresh</Btn>}
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Loading history…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["planes", "proyecciones", "monitoring", "seguimiento"] as const).map((option) => (
          <button key={option} onClick={() => setTab(option)} style={{ padding: "9px 18px", borderRadius: 9, border: tab === option ? "none" : "1.5px solid #CFD8DC", backgroundColor: tab === option ? "#1B5E3F" : "#fff", color: tab === option ? "#fff" : "#78909C", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
            {({ planes: "Plans", proyecciones: "Forecasts", monitoring: "Monitoring", seguimiento: "Audit" } as Record<string, string>)[option] ?? option}
          </button>
        ))}
      </div>

      {tab === "planes" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Plan", "Period", "Version", "Status", "Projected income", "Projected expenses", "Reserve target", "Created"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versionRows.map(({ plan, version }, index) => {
                  const style = planVersionUi(version.status);
                  return (
                    <tr key={`${plan.id}-${version.id}`} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "#37474F" }}>
                        {plan.name}
                        {version.notes && <span style={{ display: "block", fontSize: 10, color: "#B0BEC5", fontWeight: 400 }}>{version.notes}</span>}
                      </td>
                      <td style={{ padding: "12px 14px", color: "#78909C" }}>{plan.period}</td>
                      <td style={{ padding: "12px 14px", fontWeight: 700, color: "#1B5E3F" }}>v{version.version}</td>
                      <td style={{ padding: "12px 14px" }}><Badge label={style.label} color={style.color} bg={style.bg} border={style.border} /></td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(version.projected_income))}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(version.projected_expenses))}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: "#1565C0" }}>{fmt(num(version.estimated_reserve))}</td>
                      <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(version.created_at)}</td>
                    </tr>
                  );
                })}
                {versionRows.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No plan versions recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
            Reviewed versions are kept read-only. Saving a new version does not overwrite the previous ones.
          </div>
        </Card>
      )}

      {tab === "proyecciones" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Date", "Method", "Horizon", "Projected income", "Projected expenses", "Cutoff", "Model"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedForecasts.map((run, index) => (
                  <tr key={run.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(run.created_at)}</td>
                    <td style={{ padding: "12px 14px", color: "#37474F" }}>{forecastMethodLabel(run)}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{run.horizon_months} months</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#1B5E3F", fontWeight: 600 }}>{fmt(num(run.projected_income))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(run.projected_expenses))}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(run.cutoff_date)}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C", fontSize: 12 }}>
                      {run.model_version ?? "No trained model"}
                      {run.trained_at && <span style={{ display: "block", fontSize: 10, color: "#B0BEC5" }}>Trained {fmtDate(run.trained_at)}</span>}
                    </td>
                  </tr>
                ))}
                {displayedForecasts.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No forecasts recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
            Forecasts are planning estimates, not official tax assessments. The
            "Model" column is filled only by stored runs of the model trained offline; if the artifact is missing, the
            Forecasts screen shows an explicit error and never replaces the prediction with fictitious data.
          </div>
        </Card>
      )}

      {tab === "monitoring" && (
        <MonitoringPanel view={demoMode ? null : monitoring} error={demoMode ? null : monitoringError} demoMode={demoMode} />
      )}

      {tab === "seguimiento" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {!auditAvailable && (
            <div style={{ padding: "16px 24px", backgroundColor: "#FFF8E1", borderBottom: "1px solid #FFE082", fontSize: 12, color: "#E65100" }}>
              The audit history requires the Accountant or Company administrator role.
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Date", "Action", "Resource", "Actor", "Detail"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedAudit.map((event, index) => (
                  <tr key={event.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(event.created_at)}</td>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#37474F", fontFamily: "monospace", fontSize: 12 }}>{event.action}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C", fontFamily: "monospace", fontSize: 12 }}>{event.resource}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{event.actor_name ?? (event.actor_id ? `User #${event.actor_id}` : "System")}</td>
                    <td style={{ padding: "12px 14px", color: "#B0BEC5", fontSize: 11, maxWidth: 280 }}>{Object.keys(event.detail).length > 0 ? JSON.stringify(event.detail) : "—"}</td>
                  </tr>
                ))}
                {displayedAudit.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>{auditAvailable ? "No audit events recorded." : "Your role has no access to the audit history."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};


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

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [booting, setBooting] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [companies, setCompanies] = useState<CompanyCard[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
  const narrow = useIsNarrow();
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || !window.matchMedia(NARROW_QUERY).matches);
  const mainRef = useRef<HTMLElement | null>(null);
  const [alertDetailId, setAlertDetailId] = useState<number>(1);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planInitialStep, setPlanInitialStep] = useState<PlanStep>(1);
  const [backend, setBackend] = useState<BackendState>({ online: false, database: null, checked: false });

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
          setActiveCompanyId(cards[0]?.id ?? null);
          setLoggedIn(true);
          setScreen("empresas");
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
      setDemoMode(false);
      setUser(null);
      setCompanies([]);
      setActiveCompanyId(null);
      setScreen("login");
    });
    return () => onUnauthorized(null);
  }, []);

  const handleLogin = async (sessionUser: SessionUser) => {
    setUser(sessionUser);
    setDemoMode(false);
    setLoggedIn(true);
    setScreen("empresas");
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

  const handleDemo = () => {
    setUser(null);
    setDemoMode(true);
    setCompanies(EMPRESAS);
    setActiveCompanyId(EMPRESAS[0].id);
    setLoggedIn(true);
    setScreen("empresas");
  };

  const handleLogout = async () => {
    try {
      if (!demoMode) await apiLogout();
    } catch {
      // The local session is cleared anyway.
    }
    setLoggedIn(false);
    setUser(null);
    setDemoMode(false);
    setCompanies([]);
    setActiveCompanyId(null);
    setScreen("login");
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
      <div style={{ minHeight: "100vh", backgroundColor: "#F5F7F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#E8F5E9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Calculator size={22} color="#1B5E3F" />
        </div>
        <div style={{ fontSize: 13, color: "#78909C" }}>Checking session…</div>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginScreen onLogin={handleLogin} onDemo={handleDemo} backend={backend} />;
  }

  return (
    <div style={{ height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: "#F5F7F6", overflow: "hidden", position: "relative" }}>
      <Sidebar open={sidebarOpen} overlay={narrow} onClose={() => setSidebarOpen(false)} screen={screen} onNav={handleNav} userName={userName} userRole={userRole} apiOnline={backend.online} />

      <main ref={mainRef} className={narrow ? "af-main af-narrow" : "af-main"} style={{ height: "100vh", overflowY: "auto", marginLeft: sidebarOpen && !narrow ? 240 : 0, transition: "margin-left 0.28s cubic-bezier(0.4,0,0.2,1)", display: "flex", flexDirection: "column" }}>
        <Topbar sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} empresa={needsCompany ? "AlertaFiscal" : companyName} companySubtitle={companySubtitle} backend={backend} demoMode={demoMode} onLogout={handleLogout} compact={narrow} />

        <div style={{ flex: 1 }}>
          {screen === "empresas" && <EmpresasScreen companies={companies} onSelect={handleSelectCompany} />}

          {screen !== "empresas" && screen !== "contexto" && needsCompany && (
            <div style={{ padding: "28px 32px" }}>
              <Card style={{ textAlign: "center", padding: "48px 24px" }}>
                <Building2 size={40} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Select a company</div>
                <p style={{ fontSize: 13, color: "#78909C", margin: "0 0 18px" }}>Your user has no active company selected. Choose one to see its planning.</p>
                <Btn variant="primary" onClick={() => setScreen("empresas")}>Go to companies</Btn>
              </Card>
            </div>
          )}

          {screen === "resumen" && !needsCompany && <ResumenScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} />}
          {screen === "ingresos" && !needsCompany && <IngresosScreen companyId={companyId} companyName={companyName} demoMode={demoMode} />}
          {screen === "gastos" && !needsCompany && <GastosScreen companyId={companyId} companyName={companyName} demoMode={demoMode} />}
          {screen === "proyecciones" && !needsCompany && <ProyeccionesScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} onUseForecast={handleUseForecast} />}
          {screen === "planificacion" && !needsCompany && <PlanificacionScreen onNav={handleNav} companyId={companyId} companyName={companyName} demoMode={demoMode} draft={planDraft} initialStep={planInitialStep} />}
          {screen === "escenarios" && !needsCompany && <EscenariosScreen companyName={companyName} />}
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
        </div>

        <footer style={{ padding: "12px 32px", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#B0BEC5", textAlign: "center", backgroundColor: "#fff" }}>
          {demoMode
            ? "Demo environment · Simulated data · Independent academic project. Not affiliated with the DIAN."
            : "Independent academic project. Not affiliated with the DIAN. The figures are planning estimates, not official assessments."}
        </footer>
      </main>
    </div>
  );
}

