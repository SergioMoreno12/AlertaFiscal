import { useEffect, useState } from "react";
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
  type Company,
  type Counterparty,
  type Dashboard,
  type Expense,
  type FiscalParameter,
  type ForecastResult,
  type ForecastRun,
  type Income,
  type Obligation,
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
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

const fmtM = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)} M COP`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)} K COP`;
  return fmt(n);
};

const roleLabel = (role: string) =>
  ({ admin: "Administrador de empresa", contador: "Contador", auxiliar: "Auxiliar contable" } as Record<string, string>)[role] ?? role;

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
  return date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
};

const shortMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString("es-CO", { month: "short" });
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "No se pudo completar la operación.";

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
  ({ pending: "Pendiente", filed: "Presentada", paid: "Pagada", void: "Anulada" } as Record<string, string>)[status] ?? status;

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
        <button onClick={onRetry} style={{ border: "none", background: "none", color: "#C62828", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>reintentar</button>
      </>
    )}
  </div>
);

const EMPRESAS = [
  { id: 1, nombre: "Comercializadora Andina S.A.S.", nit: "900.456.123-1", sector: "Comercio", tamaño: "Pequeña", periodo: "Oct 2026", estado: "plan-actualizado" },
  { id: 2, nombre: "Servicios Bogotá Ltda.", nit: "830.912.045-2", sector: "Servicios", tamaño: "Pequeña", periodo: "Oct 2026", estado: "por-revisar" },
  { id: 3, nombre: "Constructora Nariño S.A.S.", nit: "901.234.567-0", sector: "Construcción", tamaño: "Pequeña", periodo: "Oct 2026", estado: "parametros-pendientes" },
  { id: 4, nombre: "Panadería El Trigal", nit: "10.234.567-8", sector: "Alimentos", tamaño: "Micro", periodo: "Oct 2026", estado: "sin-registros" },
];

const ESTADO_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  "plan-actualizado": { label: "Plan actualizado", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" },
  "por-revisar": { label: "Por revisar", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" },
  "parametros-pendientes": { label: "Parámetros pendientes", color: "#FBC02D", bg: "#FFF8E1", border: "#FFE082" },
  "sin-registros": { label: "Sin registros", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" },
};

const HISTORICO = [
  { mes: "May", ingresos: 42000000, gastos: 28000000 },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000 },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000 },
  { mes: "Ago", ingresos: 62300000, gastos: 41000000 },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000 },
  { mes: "Oct*", ingresos: 35000000, gastos: 23000000, proyIngreso: 55000000, proyGasto: 37000000 },
];

const PROYECCION_DATA = [
  { mes: "May", ingresos: 42000000, gastos: 28000000, tipo: "obs" },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000, tipo: "obs" },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000, tipo: "obs" },
  { mes: "Ago", ingresos: 62300000, gastos: 41000000, tipo: "obs" },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000, tipo: "obs" },
  { mes: "Oct", ingresos: null, gastos: null, proyIngreso: 55000000, proyGasto: 37000000, tipo: "proy" },
  { mes: "Nov", ingresos: null, gastos: null, proyIngreso: 58000000, proyGasto: 39000000, tipo: "proy" },
];

const INGRESOS_TABLE = [
  { id: 1, fecha: "02/10/2026", cliente: "Ferretería Central", doc: "FE-2026-1101", desc: "Venta mercancía", base: 5000000, iva: 950000, total: 5950000, estado: "Cobrada" },
  { id: 2, fecha: "05/10/2026", cliente: "Distribuidora Norte", doc: "FE-2026-1102", desc: "Venta productos", base: 8400000, iva: 1596000, total: 9996000, estado: "Pendiente" },
  { id: 3, fecha: "10/10/2026", cliente: "Comercial Sur", doc: "FE-2026-1103", desc: "Venta al por mayor", base: 12000000, iva: 2280000, total: 14280000, estado: "Cobrada" },
  { id: 4, fecha: "14/10/2026", cliente: "Minimarket Express", doc: "FE-2026-1104", desc: "Venta surtido", base: 3800000, iva: 722000, total: 4522000, estado: "Cobrada" },
  { id: 5, fecha: "17/10/2026", cliente: "Tiendas Andina", doc: "FE-2026-1105", desc: "Venta mayorista", base: 5800000, iva: 1102000, total: 6902000, estado: "Pendiente" },
];

const GASTOS_TABLE = [
  { id: 1, fecha: "01/10/2026", proveedor: "Importadora Andina", doc: "FC-20261001", cat: "Mercancía", base: 9500000, iva: 1805000, total: 11305000, pago: "Pagada", revision: "Revisada" },
  { id: 2, fecha: "05/10/2026", proveedor: "Servicios Logísticos S.A.", doc: "FC-20261042", cat: "Logística", base: 2100000, iva: 399000, total: 2499000, pago: "Pendiente", revision: "Sin revisar" },
  { id: 3, fecha: "08/10/2026", proveedor: "Arrendadora Central", doc: "RC-20261008", cat: "Arrendamiento", base: 3500000, iva: 0, total: 3500000, pago: "Pagada", revision: "Revisada" },
  { id: 4, fecha: "12/10/2026", proveedor: "Servicios Públicos", doc: "SV-20261012", cat: "Servicios", base: 450000, iva: 0, total: 450000, pago: "Pagada", revision: "Sin revisar" },
  { id: 5, fecha: "15/10/2026", proveedor: "Papelería y Oficinas", doc: "FC-20261055", cat: "Gastos Adm.", base: 280000, iva: 53200, total: 333200, pago: "Pagada", revision: "Sin revisar" },
];

const ALERTAS_DATA = [
  { id: 1, titulo: "Faltan $1.500.000 para cubrir la meta de reserva", prioridad: "alta" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", fecha: "19/10/2026", responsable: "María Gómez", estado: "pendiente" as AlertStatus, desc: "La reserva registrada ($3.000.000) no cubre aún la meta definida por el contador ($4.500.000). Diferencia pendiente: $1.500.000 (33,3%).", valores: [{ label: "Meta de reserva", valor: "$4.500.000" }, { label: "Reserva registrada", valor: "$3.000.000" }, { label: "Diferencia pendiente", valor: "$1.500.000" }], sugerencia: "Revisar si hay disponibilidad de recursos para completar la reserva antes del cierre del período. Ajustar el plan si el negocio no puede cubrir la meta en las fechas previstas." },
  { id: 2, titulo: "Obligación de IVA próxima a fecha registrada", prioridad: "media" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", fecha: "18/10/2026", responsable: "María Gómez", estado: "en-revision" as AlertStatus, desc: "La obligación de IVA bimestral tiene fecha de vencimiento registrada el 28 de octubre de 2026. Faltan 9 días según la fecha de corte.", valores: [{ label: "Diferencia aritmética IVA", valor: "$2.550.000" }, { label: "Fecha vencimiento registrada", valor: "28/10/2026" }], sugerencia: "Verificar con el contador si el período de presentación aplica para esta empresa y confirmar la fecha oficial en el calendario tributario." },
  { id: 3, titulo: "Gastos pendientes de revisión contable", prioridad: "baja" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", fecha: "17/10/2026", responsable: "María Gómez", estado: "pendiente" as AlertStatus, desc: "Hay 3 registros de gastos marcados como 'Sin revisar'. No se pueden incluir en estimaciones hasta que el contador los revise.", valores: [{ label: "Gastos sin revisar", valor: "3 registros" }, { label: "Valor total sin revisar", valor: "$3.282.200" }], sugerencia: "Revisar los gastos pendientes y marcarlos como revisados o agregar una observación sobre su tratamiento." },
  { id: 4, titulo: "Ingresos registrados difieren del escenario planeado", prioridad: "media" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", fecha: "15/10/2026", responsable: "María Gómez", estado: "pendiente" as AlertStatus, desc: "Los ingresos registrados al corte ($35.000.000) representan el 63,6% de la proyección de cierre ($55.000.000). Queda el 36,4% del mes por registrar.", valores: [{ label: "Registrado al corte", valor: "$35.000.000" }, { label: "Proyectado al cierre", valor: "$55.000.000" }], sugerencia: "Verificar si hay ventas por registrar. Si el cierre proyectado parece difícil de alcanzar, considerar actualizar la proyección." },
];

const OBLIGACIONES_DATA = [
  { id: 1, obligacion: "IVA bimestral (Sep-Oct 2026)", periodo: "Sep-Oct 2026", vencimiento: "28/10/2026", fuente: "Registrada por contador", estimado: "$2.550.000", presentacion: "Pendiente", pago: "Pendiente", revision: "En revisión" },
  { id: 2, obligacion: "Retención en la fuente (Oct 2026)", periodo: "Oct 2026", vencimiento: "12/11/2026", fuente: "Registrada por contador", estimado: "Por definir", presentacion: "Pendiente", pago: "Pendiente", revision: "Sin revisar" },
  { id: 3, obligacion: "ICA (Bogotá - anual)", periodo: "2026", vencimiento: "15/03/2027", fuente: "Registrada por contador", estimado: "Estimación pendiente", presentacion: "Pendiente", pago: "Pendiente", revision: "Sin revisar" },
  { id: 4, obligacion: "IVA bimestral (Jul-Ago 2026)", periodo: "Jul-Ago 2026", vencimiento: "28/08/2026", fuente: "Registrada por contador", estimado: "$3.200.000", presentacion: "Presentada", pago: "Pagada", revision: "Revisada" },
];

const HISTORIAL_DATA = [
  { id: 1, fecha: "19/10/2026", empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", tipo: "Plan fiscal", version: "v2", origen: "Manual", responsable: "María Gómez", estado: "Borrador" },
  { id: 2, fecha: "15/10/2026", empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", tipo: "Proyección", version: "v1", origen: "Proyección simulada", responsable: "María Gómez", estado: "Generada" },
  { id: 3, fecha: "10/10/2026", empresa: "Comercializadora Andina S.A.S.", periodo: "Oct 2026", tipo: "Plan fiscal", version: "v1", origen: "Manual", responsable: "María Gómez", estado: "Revisado" },
  { id: 4, fecha: "30/09/2026", empresa: "Comercializadora Andina S.A.S.", periodo: "Sep 2026", tipo: "Plan fiscal", version: "v1", origen: "Manual", responsable: "María Gómez", estado: "Revisado" },
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
  const cfg = { alta: { label: "Alta", color: "#E53935", bg: "#FFEBEE", border: "#FFCDD2" }, media: { label: "Media", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" }, baja: { label: "Baja", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" } }[p];
  return <Badge {...cfg} />;
};

const StatusBadge = ({ s }: { s: AlertStatus }) => {
  const cfg = { pendiente: { label: "Pendiente", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" }, "en-revision": { label: "En revisión", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" }, revisada: { label: "Resuelta", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" } }[s];
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
    <Info size={13} /> Entorno de demostración · Datos simulados
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

// ─── NAV CONFIG ───────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType; badge?: number }[] = [
  { id: "resumen", label: "Resumen", icon: LayoutDashboard },
  { id: "empresas", label: "Empresas", icon: Building2 },
  { id: "ingresos", label: "Ingresos y ventas", icon: TrendingUp },
  { id: "gastos", label: "Gastos y compras", icon: ShoppingCart },
  { id: "proyecciones", label: "Proyecciones", icon: BarChart2 },
  { id: "planificacion", label: "Planificación fiscal", icon: Calculator },
  { id: "obligaciones", label: "Obligaciones y calendario", icon: Calendar },
  { id: "alertas", label: "Alertas y seguimiento", icon: Bell },
  { id: "historial", label: "Historial", icon: BookOpen },
];

// Sección secundaria: información pública de referencia, separada del flujo
// operativo. No genera alertas ni tareas.
const SECONDARY_NAV_ITEMS: { id: Screen; label: string; icon: React.ElementType }[] = [
  { id: "contexto", label: "Contexto y fuentes", icon: Database },
];

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const Sidebar = ({ open, onClose, screen, onNav, userName, userRole, apiOnline }: { open: boolean; onClose: () => void; screen: Screen; onNav: (s: Screen) => void; userName: string; userRole: string; apiOnline: boolean }) => (
  <>
    {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", zIndex: 9, display: "none" }} className="mobile-backdrop" />}
    <aside style={{ width: 240, minWidth: 240, backgroundColor: "#1B5E3F", display: "flex", flexDirection: "column", height: "100vh", position: "fixed", top: 0, left: 0, zIndex: 10, transform: open ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", boxShadow: open ? "4px 0 20px rgba(0,0,0,0.12)" : "none" }}>
      <div style={{ padding: "20px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Calculator size={18} color="#fff" />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15, lineHeight: 1, letterSpacing: "-0.3px" }}>AlertaFiscal</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 3 }}>Planificación fiscal</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
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
          Referencia
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
        {apiOnline ? "API conectada" : "Sin conexión con la API"}
      </div>
    </aside>
  </>
);

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
const Topbar = ({ sidebarOpen, onToggle, empresa, companySubtitle, backend, demoMode, onLogout }: { sidebarOpen: boolean; onToggle: () => void; empresa: string; companySubtitle: string; backend: BackendState; demoMode: boolean; onLogout: () => void }) => (
  <header style={{ backgroundColor: "#fff", borderBottom: "1px solid rgba(0,0,0,0.07)", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 5 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <button onClick={onToggle} style={{ background: sidebarOpen ? "#E8F5E9" : "#1B5E3F", border: "none", borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sidebarOpen ? "#1B5E3F" : "#fff" }}>
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </button>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#1B5E3F", lineHeight: 1 }}>{empresa}</div>
        <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>{companySubtitle}</div>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        title={backend.online ? "Backend y base de datos responden" : "Backend no disponible"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${backend.online ? "#A5D6A7" : "#FFE082"}`, backgroundColor: backend.online ? "#E8F5E9" : "#FFF8E1", color: backend.online ? "#1B5E3F" : "#B26A00", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: backend.online ? "#43A047" : "#FBC02D", display: "inline-block" }} />
        {backend.checked ? (backend.online ? `API · ${backend.database ?? "ok"}` : "API no disponible") : "Verificando API"}
      </span>
      {demoMode && <DemoBanner />}
      <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#78909C", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
        <LogOut size={12} /> Salir
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
  const [email, setEmail] = useState("maria.gomez@contaduria.co");
  const [pass, setPass] = useState("demo2026");
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
            ? "No se pudo conectar con el servidor. Puedes explorar la demo visual."
            : error.message,
        );
      } else {
        setErrorMsg("No se pudo iniciar sesión.");
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
          <p style={{ fontSize: 13, color: "#78909C", margin: 0 }}>Planificación fiscal para pequeñas empresas</p>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle} htmlFor="email">Correo electrónico</label>
            <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} type="email" autoComplete="username" required />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle} htmlFor="password">Contraseña</label>
            <input id="password" value={pass} onChange={(e) => setPass(e.target.value)} style={inputStyle} type="password" autoComplete="current-password" required />
          </div>

          {errorMsg && (
            <div role="alert" style={{ marginBottom: 18, padding: "10px 12px", borderRadius: 9, backgroundColor: "#FFEBEE", border: "1px solid #FFCDD2", color: "#C62828", fontSize: 12, fontWeight: 600 }}>
              {errorMsg}
            </div>
          )}

          <button type="submit" disabled={loading} style={{ width: "100%", backgroundColor: "#1B5E3F", color: "#fff", border: "none", borderRadius: 11, padding: "14px", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.75 : 1 }}>
            <LogIn size={16} /> {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <button onClick={onDemo} type="button" style={{ marginTop: 12, width: "100%", backgroundColor: "transparent", color: "#1B5E3F", border: "1.5px solid #1B5E3F", borderRadius: 11, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          Explorar demo visual (datos de ejemplo)
        </button>

        <div style={{ marginTop: 24, padding: "14px 16px", backgroundColor: "#FFF8E1", borderRadius: 10, border: "1px solid #FFE082" }}>
          <div style={{ fontSize: 11, color: "#E65100", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}><Info size={12} /> Entorno de demostración</div>
          <p style={{ fontSize: 11, color: "#78909C", margin: 0, lineHeight: 1.6 }}>
            Credenciales demo: maria.gomez@contaduria.co / demo2026. Los datos son ficticios y el ingreso real usa una sesión del servidor.
          </p>
        </div>

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: backend.online ? "#1B5E3F" : "#B26A00" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: backend.online ? "#43A047" : "#FBC02D", display: "inline-block" }} />
          {backend.checked ? (backend.online ? `API conectada · ${backend.database ?? "base de datos"}` : "API no disponible · solo demo visual") : "Verificando conexión..."}
        </div>

        <p style={{ fontSize: 11, color: "#B0BEC5", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
          Proyecto académico independiente. Sin afiliación con la DIAN.
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
      <SectionHeader title="Empresas" subtitle="Selecciona una empresa para consultar su planificación fiscal" />

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#78909C" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa..." style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 9, border: "1.5px solid #CFD8DC", fontSize: 13, fontFamily: "inherit", color: "#37474F", backgroundColor: "#fff", boxSizing: "border-box", outline: "none" }} />
        </div>
        <Btn variant="ghost" icon={<Filter size={14} />}>Filtrar</Btn>
      </div>

      {filtered.length === 0 && (
        <Card style={{ padding: "32px 24px", textAlign: "center", color: "#78909C", fontSize: 13 }}>
          {companies.length === 0
            ? "Tu usuario no tiene empresas activas. Contacta al administrador para que te asigne una."
            : "No hay empresas que coincidan con la búsqueda."}
        </Card>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {filtered.map((emp) => {
          const st = emp.estado
            ? ESTADO_CONFIG[emp.estado] ?? ESTADO_CONFIG["por-revisar"]
            : { label: emp.role ? roleLabel(emp.role) : "Activa", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" };
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
                <Btn variant="primary" small onClick={() => onSelect(emp.id)}>Seleccionar</Btn>
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
    // Evaluar reglas es una acción explícita: el GET del dashboard no escribe
    // alertas. Si el rol no permite evaluar, se muestra el estado existente.
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
        actionLabel: "Ver alerta",
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
            actionLabel: alert.action?.label ?? "Ver alerta",
            screen: (alert.action?.screen ?? "alertas") as Screen,
          })));

  const obligationItems = demoMode
    ? OBLIGACIONES_DATA.filter((o) => o.presentacion === "Pendiente").slice(0, 4).map((o) => ({
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
        estimado: item.estimated_amount ? fmt(num(item.estimated_amount)) : "Por definir",
        fuente: `Período ${item.period || "sin definir"}`,
      }));

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Resumen" subtitle={`${companyName} · Corte: ${new Date().toLocaleDateString("es-CO")}`}
        actions={
          <>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Actualizar</Btn>
            <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onNav("planificacion")}>Ver planificación</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando datos de la empresa…</div>}
      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FFEBEE", border: "1px solid #FFCDD2", color: "#C62828", fontSize: 12 }}>
          {error} · <button onClick={() => setReloadKey((key) => key + 1)} style={{ border: "none", background: "none", color: "#C62828", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>reintentar</button>
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Ingresos registrados", value: fmtM(income), sub: demoMode ? "Registros del período actual" : "Acumulado del año en curso", color: "#1B5E3F", bg: "#E8F5E9", icon: <TrendingUp size={18} color="#1B5E3F" />, note: "Observado" },
          { label: "Gastos registrados", value: fmtM(expenses), sub: demoMode ? "Registros del período actual" : "Acumulado del año en curso", color: "#37474F", bg: "#ECEFF1", icon: <ShoppingCart size={18} color="#37474F" />, note: "Observado" },
          { label: "Ingresos proyectados", value: fmtM(projectedIncome), sub: plan ? `${plan.name} · v${plan.version}` : "Sin plan vigente", color: "#1565C0", bg: "#E3F2FD", icon: <BarChart2 size={18} color="#1565C0" />, note: "Estimación" },
          { label: "Gastos proyectados", value: fmtM(projectedExpenses), sub: plan ? `${plan.name} · v${plan.version}` : "Sin plan vigente", color: "#6A1B9A", bg: "#F3E5F5", icon: <BarChart2 size={18} color="#6A1B9A" />, note: "Estimación" },
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
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Última proyección del modelo</div>
              <div style={{ fontSize: 12, color: "#78909C", marginTop: 3 }}>
                {latestForecast.method_label} · {latestForecast.horizon_months} meses desde {latestForecast.cutoff_date?.slice(0, 10)} · versión {latestForecast.model_version ?? "sin versión"}
              </div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("proyecciones")}>Ver proyecciones <ChevronRight size={12} /></Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            {[
              { label: "Ingresos proyectados", value: fmtM(num(latestForecast.projected_income)), color: "#1565C0" },
              { label: "Gastos proyectados", value: fmtM(num(latestForecast.projected_expenses)), color: "#6A1B9A" },
              { label: "Diferencia ingresos − gastos", value: fmtM(num(latestForecast.projected_result)), color: "#1B5E3F" },
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
                Datos de demostración: la proyección no valida el comportamiento de una empresa real.
              </span>
            )}
            {latestForecast.stale_inputs && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "6px 10px" }}>
                Las entradas cambiaron después de la última proyección. Genera una nueva para actualizarla.
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 10 }}>
            Estimación orientativa de planificación. Ingresos menos gastos no es un impuesto ni una reserva obligatoria.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginBottom: 24 }}>
        {/* Chart */}
        <Card>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Ingresos y gastos históricos</div>
            <div style={{ fontSize: 12, color: "#78909C", marginTop: 3 }}>{demoMode ? "Vista de demostración · Mayo–Octubre 2026" : "Últimos 6 meses con movimientos registrados"}</div>
          </div>
          {chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#78909C", backgroundColor: "#FAFAFA", borderRadius: 10 }}>
              Sin movimientos registrados en los últimos 6 meses.
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
              <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#78909C" }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(0)}M`} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#78909C" }} width={45} />
              <Tooltip formatter={(v: number) => fmt(v)} labelStyle={{ fontWeight: 700 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ingresos" name="Ingresos" fill="#1B5E3F" radius={[4, 4, 0, 0]} />
              <Bar dataKey="gastos" name="Gastos" fill="#90CAF9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </Card>

        {/* Reserve card */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>Plan de reserva</div>
          <div style={{ fontSize: 12, color: "#78909C", marginBottom: 20 }}>{plan ? `${plan.period} · v${plan.version}` : "Sin plan vigente"}</div>

          {!plan && !demoMode ? (
            <div style={{ fontSize: 12, color: "#78909C", backgroundColor: "#F5F7F6", borderRadius: 8, padding: "14px 16px", lineHeight: 1.6 }}>
              Aún no hay un plan de reserva vigente para esta empresa. Créalo desde{" "}
              <button onClick={() => onNav("planificacion")} style={{ border: "none", background: "none", color: "#1B5E3F", fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 12 }}>Planificación fiscal</button>.
            </div>
          ) : (
          <>
          {[
            { label: "Meta de reserva (plan)", value: fmtM(reserveTarget), note: "Ingresada por el contador", color: "#37474F" },
            { label: "Reserva registrada", value: fmtM(reserved), note: "Informada por el usuario", color: "#1B5E3F" },
            { label: "Diferencia pendiente", value: fmtM(pendingReserve), note: "Por cubrir", color: "#E53935" },
          ].map((r) => (
            <div key={r.label} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 12, color: "#78909C" }}>{r.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: r.color }}>{r.value}</div>
              <div style={{ fontSize: 11, color: "#B0BEC5" }}>{r.note}</div>
            </div>
          ))}

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78909C", marginBottom: 6 }}>
              <span>Cobertura de reserva</span><span style={{ fontWeight: 700, color: coverage >= 80 ? "#1B5E3F" : "#FBC02D" }}>{coverage.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, backgroundColor: "#ECEFF1", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(coverage, 100)}%`, height: "100%", backgroundColor: coverage >= 80 ? "#4CAF50" : "#FBC02D", borderRadius: 4, transition: "width 0.6s" }} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#78909C", backgroundColor: "#F5F7F6", borderRadius: 8, padding: "10px 12px", marginTop: 14, lineHeight: 1.5 }}>
            <Info size={12} style={{ display: "inline", marginRight: 4 }} />
            La meta de reserva es un valor de planificación. No equivale a un impuesto liquidado.
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
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Qué revisar ahora</div>
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>Alertas abiertas priorizadas por criticidad</div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("alertas")}>Ver todas <ChevronRight size={12} /></Btn>
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
          {reviewItems.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No hay alertas abiertas pendientes de revisión.</div>}
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Próximas obligaciones</div>
            <Btn variant="ghost" small onClick={() => onNav("obligaciones")}>Ver calendario <ChevronRight size={12} /></Btn>
          </div>
          {obligationItems.map((o) => (
            <div key={o.id} style={{ padding: "12px 14px", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", lineHeight: 1.3, flex: 1 }}>{o.obligacion}</div>
                <span style={{ fontSize: 11, color: "#E53935", fontWeight: 700, backgroundColor: "#FFEBEE", padding: "2px 8px", borderRadius: 6, border: "1px solid #FFCDD2", whiteSpace: "nowrap", marginLeft: 8 }}>{o.vencimiento}</span>
              </div>
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 4 }}>Valor estimado: {o.estimado}</div>
              <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>{o.fuente}</div>
            </div>
          ))}
          {obligationItems.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No hay obligaciones pendientes.</div>}
          <div style={{ fontSize: 11, color: "#78909C", backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 8, padding: "8px 12px" }}>
            Fechas registradas manualmente. Verificar el calendario aplicable con el contador.
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
    Promise.all([listIncome(companyId), listCounterparties(companyId)])
      .then(([income, parties]) => {
        if (!alive) return;
        setRows(income.items);
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
  }, [companyId, demoMode, reloadKey]);

  const displayRows: IncomeDisplayRow[] = demoMode
    ? [...demoRows, ...DEMO_INCOME_ROWS]
    : rows.map((row) => ({
        id: row.id,
        date: fmtDate(row.issue_date),
        party: counterparties.find((party) => party.id === row.counterparty_id)?.name ?? "Sin tercero",
        doc: row.doc_number,
        description: row.description || "—",
        subtotal: num(row.subtotal),
        tax: num(row.tax_amount),
        total: num(row.total),
        status: row.status === "collected" ? "Cobrada" : row.status === "void" ? "Anulada" : "Pendiente",
      }));

  const baseTotal = displayRows.reduce((sum, row) => sum + row.subtotal, 0);
  const taxTotal = displayRows.reduce((sum, row) => sum + row.tax, 0);

  const statusStyle = (status: string) =>
    status === "Cobrada"
      ? { color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" }
      : status === "Anulada"
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
      setFormError("El número de documento es obligatorio.");
      return;
    }
    if (!form.issue_date) {
      setFormError("La fecha de emisión es obligatoria.");
      return;
    }
    const subtotal = toMoneyString(form.subtotal);
    if (Number(subtotal) <= 0) {
      setFormError("El valor base debe ser mayor que cero.");
      return;
    }
    const tax = toMoneyString(form.tax_amount);
    const total = (Number(subtotal) + Number(tax)).toFixed(2);

    if (demoMode) {
      setDemoRows((current) => [
        {
          id: Date.now(),
          date: fmtDate(form.issue_date),
          party: form.party || "Cliente demo",
          doc: form.doc_number,
          description: form.description || "Venta registrada",
          subtotal: Number(subtotal),
          tax: Number(tax),
          total: Number(total),
          status: form.status === "collected" ? "Cobrada" : "Pendiente",
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
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `ingresos-${companyName.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Fecha", "Cliente", "Documento", "Descripción", "Base", "IVA", "Total", "Estado"],
      displayRows.map((row) => [row.date, row.party, row.doc, row.description, row.subtotal, row.tax, row.total, row.status]),
    );
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Ingresos y ventas"
        subtitle={`Registros observados · ${companyName}`}
        actions={
          <>
            <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportCsv}>Exportar CSV</Btn>
            <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Registrar ingreso</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando ingresos…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total registrado (base)", value: fmt(baseTotal), note: "Suma de registros listados" },
          { label: "IVA generado registrado", value: fmt(taxTotal), note: "Resumen de registros" },
          { label: "Registros listados", value: `${displayRows.length} ventas`, note: demoMode ? "Datos de ejemplo" : "Últimos 20 registros" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1B5E3F" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#B0BEC5" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#1B5E3F", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> IVA generado {fmt(taxTotal)}. Este es un resumen de registros, no una liquidación oficial de IVA.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: "#37474F" }}>Registros de ventas</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Fecha", "Cliente", "Documento", "Descripción", "Base IVA", "IVA", "Total", "Estado cobro"].map((header) => (
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
                    No hay ingresos registrados para esta empresa.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Las ventas registradas no implican cobros efectivamente realizados. Los estados de cobro son informados por el usuario.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            {confirmed ? (
              <div style={{ textAlign: "center" }}>
                <CheckCircle size={48} color="#4CAF50" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Registro confirmado</h3>
                <p style={{ fontSize: 13, color: "#78909C" }}>
                  {demoMode ? "El ingreso quedó registrado solo en esta vista de demostración." : "El ingreso fue registrado en la base de datos."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Cerrar</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Registrar ingreso o venta</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
                </div>

                {formError && <InlineError message={formError} />}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Documento *">
                    <input value={form.doc_number} onChange={(event) => setForm({ ...form, doc_number: event.target.value })} placeholder="FV-2026-0001" style={inputStyle} />
                  </Field>
                  <Field label="Fecha de emisión *">
                    <input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} style={inputStyle} />
                  </Field>
                </div>

                <Field label="Cliente">
                  {demoMode ? (
                    <input value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })} placeholder="Nombre del cliente" style={inputStyle} />
                  ) : (
                    <select value={form.counterparty_id} onChange={(event) => setForm({ ...form, counterparty_id: event.target.value })} style={inputStyle}>
                      <option value="">Sin tercero registrado</option>
                      {counterparties.filter((party) => party.kind === "client").map((party) => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  )}
                </Field>

                <Field label="Descripción">
                  <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descripción de la venta" style={inputStyle} />
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Valor base (antes IVA) *">
                    <input type="number" min="0" step="0.01" value={form.subtotal} onChange={(event) => setForm({ ...form, subtotal: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                  <Field label="IVA registrado">
                    <input type="number" min="0" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Estado de cobro">
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "collected" })} style={inputStyle}>
                      <option value="pending">Pendiente</option>
                      <option value="collected">Cobrada</option>
                    </select>
                  </Field>
                  <Field label="Total calculado">
                    <div style={{ ...inputStyle, backgroundColor: "#F5F7F6", fontWeight: 700, color: "#1B5E3F" }}>{fmt(totalPreview)}</div>
                  </Field>
                </div>

                <div style={{ backgroundColor: "#FFF8E1", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#E65100" }}>
                  Este registro no genera documentos tributarios oficiales. No equivale a facturación electrónica certificada.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancelar</Btn>
                  <Btn variant="primary" onClick={save} fullWidth>{saving ? "Guardando…" : "Guardar registro"}</Btn>
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
  paid: row.pago === "Pagada",
  reviewed: row.revision === "Revisada",
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

  const [showForm, setShowForm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    doc_number: "",
    issue_date: todayISO(),
    party: "",
    counterparty_id: "",
    category: "Mercancía",
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
    Promise.all([listExpenses(companyId), listCounterparties(companyId)])
      .then(([expenses, parties]) => {
        if (!alive) return;
        setRows(expenses.items);
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
  }, [companyId, demoMode, reloadKey]);

  const displayRows: ExpenseDisplayRow[] = demoMode
    ? demoRows
    : rows.map((row) => ({
        id: row.id,
        date: fmtDate(row.issue_date),
        party: counterparties.find((party) => party.id === row.counterparty_id)?.name ?? "Sin tercero",
        doc: row.doc_number,
        category: row.category || "Otros",
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
      category: "Mercancía",
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
      setFormError("El número de documento es obligatorio.");
      return;
    }
    if (!form.issue_date) {
      setFormError("La fecha de emisión es obligatoria.");
      return;
    }
    const subtotal = toMoneyString(form.subtotal);
    if (Number(subtotal) <= 0) {
      setFormError("El valor base debe ser mayor que cero.");
      return;
    }
    const tax = toMoneyString(form.tax_amount);
    const total = (Number(subtotal) + Number(tax)).toFixed(2);

    if (demoMode) {
      setDemoRows((current) => [
        {
          id: Date.now(),
          date: fmtDate(form.issue_date),
          party: form.party || "Proveedor demo",
          doc: form.doc_number,
          category: form.category || "Otros",
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
      `gastos-${companyName.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Fecha", "Proveedor", "Documento", "Categoría", "Descripción", "Base", "IVA", "Total", "Pago", "Revisión"],
      displayRows.map((row) => [row.date, row.party, row.doc, row.category, row.description, row.subtotal, row.tax, row.total, row.paid ? "Pagada" : "Pendiente", row.reviewed ? "Revisada" : "Por revisar"]),
    );
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Gastos y compras"
        subtitle={`Registros observados · ${companyName}`}
        actions={
          <>
            <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportCsv}>Exportar CSV</Btn>
            <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Registrar gasto</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando gastos…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total registrado (base)", value: fmt(baseTotal), note: "Suma de registros listados", color: "#37474F" },
          { label: "IVA descontable registrado", value: fmt(taxTotal), note: "Resumen de registros", color: "#37474F" },
          { label: "Gastos por revisar", value: `${pendingReview} registros`, note: "Pendientes de revisión contable", color: "#E65100" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#B0BEC5" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#E65100", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> El registro de un gasto no implica que sea deducible. La clasificación debe ser revisada por el contador.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F" }}>Registros de gastos</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Fecha", "Proveedor", "Documento", "Categoría", "Descripción", "Base IVA", "IVA", "Total", "Pago", "Revisión", ""].map((header) => (
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
                  <td style={{ padding: "12px 14px" }}><Badge label={row.paid ? "Pagada" : "Pendiente"} color={row.paid ? "#1B5E3F" : "#E65100"} bg={row.paid ? "#E8F5E9" : "#FFF3E0"} border={row.paid ? "#A5D6A7" : "#FFCC80"} /></td>
                  <td style={{ padding: "12px 14px" }}><Badge label={row.reviewed ? "Revisada" : "Por revisar"} color={row.reviewed ? "#1B5E3F" : "#78909C"} bg={row.reviewed ? "#E8F5E9" : "#ECEFF1"} border={row.reviewed ? "#A5D6A7" : "#CFD8DC"} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <button onClick={() => toggleReviewed(row)} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: busyId === row.id ? 0.5 : 1 }}>
                      {row.reviewed ? "Reabrir" : "Revisar"}
                    </button>
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>
                    No hay gastos registrados para esta empresa.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            {confirmed ? (
              <div style={{ textAlign: "center" }}>
                <CheckCircle size={48} color="#4CAF50" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Gasto registrado</h3>
                <p style={{ fontSize: 13, color: "#78909C", marginBottom: 16 }}>
                  {demoMode ? "El gasto quedó registrado solo en esta vista de demostración." : "El gasto fue registrado. Pendiente de revisión contable."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Cerrar</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Registrar gasto o compra</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
                </div>

                {formError && <InlineError message={formError} />}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Documento *">
                    <input value={form.doc_number} onChange={(event) => setForm({ ...form, doc_number: event.target.value })} placeholder="FC-2026-0001" style={inputStyle} />
                  </Field>
                  <Field label="Fecha de emisión *">
                    <input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} style={inputStyle} />
                  </Field>
                </div>

                <Field label="Proveedor">
                  {demoMode ? (
                    <input value={form.party} onChange={(event) => setForm({ ...form, party: event.target.value })} placeholder="Nombre del proveedor" style={inputStyle} />
                  ) : (
                    <select value={form.counterparty_id} onChange={(event) => setForm({ ...form, counterparty_id: event.target.value })} style={inputStyle}>
                      <option value="">Sin tercero registrado</option>
                      {counterparties.filter((party) => party.kind === "supplier").map((party) => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  )}
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Categoría">
                    <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Mercancía" style={inputStyle} />
                  </Field>
                  <Field label="Estado de pago">
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "paid" })} style={inputStyle}>
                      <option value="pending">Pendiente</option>
                      <option value="paid">Pagada</option>
                    </select>
                  </Field>
                </div>

                <Field label="Descripción">
                  <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descripción de la compra" style={inputStyle} />
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Valor base (antes IVA) *">
                    <input type="number" min="0" step="0.01" value={form.subtotal} onChange={(event) => setForm({ ...form, subtotal: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                  <Field label="IVA registrado">
                    <input type="number" min="0" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                  </Field>
                </div>

                <Field label="Total calculado">
                  <div style={{ ...inputStyle, backgroundColor: "#F5F7F6", fontWeight: 700, color: "#37474F" }}>{fmt(totalPreview)}</div>
                </Field>

                <div style={{ backgroundColor: "#FFF8E1", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#E65100" }}>
                  El registro pendiente de revisión no se incluye en estimaciones fiscales hasta ser revisado por el contador.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancelar</Btn>
                  <Btn variant="primary" onClick={save} fullWidth>{saving ? "Guardando…" : "Guardar registro"}</Btn>
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
  ({ seasonal_naive: "Seasonal naive (lag-12)", linear_regression: "Regresión lineal", random_forest: "Random Forest" } as Record<string, string>)[name] ?? name;

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
          // Mostrar la última corrida guardada. No se recalcula ni se entrena.
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
            disclaimer: "Proyección orientativa de planificación. No es una liquidación oficial.",
          });
          setEstado((current) => (current === "idle" ? "done" : current));
        }
      })
      .catch(() => {
        // El historial y la última corrida son contexto; no impiden proyectar.
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
        "La demostración visual no ejecuta el modelo entrenado. Inicia sesión con una empresa para generar una proyección real desde el artefacto.",
      );
      return;
    }
    if (!companyId) {
      setError("Selecciona una empresa antes de proyectar.");
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
    ...history.map((point) => ({ mes: point.mes, ingresos: point.ingresos, gastos: point.gastos, tipo: "Registrado" })),
    ...monthly.map((point) => ({
      mes: shortMonth(point.month),
      ingresos: num(point.projected_income),
      gastos: num(point.projected_expenses),
      tipo: "Pronóstico",
    })),
  ];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Proyecciones"
        subtitle={`${companyName} · Modelo entrenado offline sobre el historial del ERP`}
        actions={
          estado === "done" && result?.available ? (
            <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onUseForecast(result)}>
              Usar esta proyección en mi planificación
            </Btn>
          ) : undefined
        }
      />

      <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#1565C0", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          La proyección se genera con un modelo ya entrenado y guardado en un artefacto. Flask no entrena ni simula:
          prepara las entradas actuales, ejecuta la predicción y guarda la corrida con su versión. Es una estimación
          orientativa, no una liquidación oficial de impuestos.
        </span>
      </div>

      <Card style={{ marginBottom: 24, padding: "14px 18px", backgroundColor: "#F5F7F6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Cómo se aplica el ML</div>
            <p style={{ fontSize: 11, color: "#546E7A", margin: 0, lineHeight: 1.65 }}>
              El entrenamiento y la evaluación con partición temporal se ejecutan offline con <code>ml/train.py</code>{" "}
              (seasonal naive, regresión lineal y Random Forest). El backend lee el artefacto JSON de esta empresa,
              valida las entradas esperadas y predice sin scikit-learn. No se entrena al cargar el dashboard ni en
              consultas. El modelo, las entradas y la versión viven en el artefacto y en los supuestos de la corrida,
              separados de la interfaz.
            </p>
          </div>
          <Field label="Horizonte (meses)">
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
            Corridas guardadas: {savedRuns.length}. La más reciente es la que se muestra al abrir la pantalla.
          </div>
        )}
      </Card>

      {loadingContext && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando historial y última corrida…</div>}

      {estado === "idle" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <BarChart2 size={48} color="#90CAF9" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Generar proyección</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Se usarán los ingresos y gastos registrados en el ERP como entradas del modelo entrenado. Si falta el
            artefacto o el historial mínimo, verás un error explícito y podrás continuar con planificación manual.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn variant="primary" icon={<RefreshCw size={13} />} onClick={runProjection}>Generar proyección con el modelo</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Planificación manual</Btn>
          </div>
        </Card>
      )}

      {estado === "loading" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid #E8F5E9", borderTopColor: "#1B5E3F", margin: "0 auto 24px", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#37474F" }}>Preparando entradas y ejecutando el modelo…</div>
          <p style={{ fontSize: 12, color: "#78909C", marginTop: 8 }}>No se reentrena el modelo ni se consultan fuentes externas.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </Card>
      )}

      {estado === "error" && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#E53935" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>No fue posible generar la proyección</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>{error}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <Btn variant="secondary" onClick={runProjection}>Reintentar</Btn>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Usar planificación manual</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && !result.available && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#FBC02D" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: "0 0 8px" }}>Modelo o historial no disponible</h3>
          <p style={{ fontSize: 13, color: "#78909C", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>
            {result.reason ?? "No hay un modelo entrenado o historial suficiente para esta empresa."}
          </p>
          <p style={{ fontSize: 12, color: "#B0BEC5" }}>
            {result.code === "insufficient_history"
              ? `Meses disponibles: ${result.history_months ?? 0}.`
              : "No se sustituye la predicción con datos ficticios."}
          </p>
          <div style={{ marginTop: 20 }}>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Continuar con planificación manual</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && result.available && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
            {[
              { label: `Ingresos proyectados (${months} meses)`, value: fmt(projectedIncome), color: "#1B5E3F" },
              { label: `Gastos proyectados (${months} meses)`, value: fmt(projectedExpenses), color: "#37474F" },
              { label: "Diferencia ingresos − gastos", value: fmt(num(result.projected_result)), color: projectedIncome - projectedExpenses >= 0 ? "#1565C0" : "#E53935" },
            ].map((item) => (
              <Card key={item.label} style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#78909C", marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: item.color }}>{item.value}</div>
                <span style={{ display: "inline-block", marginTop: 8, fontSize: 10, fontWeight: 700, color: "#1565C0", backgroundColor: "#E3F2FD", padding: "2px 8px", borderRadius: 6, border: "1px solid #90CAF9" }}>Estimación del modelo</span>
              </Card>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {result.is_demo && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "7px 11px" }}>
                Datos de demostración: las métricas y proyecciones no validan el comportamiento de una empresa real.
              </span>
            )}
            {result.stale_inputs && (
              <span style={{ fontSize: 11, color: "#E65100", backgroundColor: "#FFF3E0", border: "1px solid #FFCC80", borderRadius: 8, padding: "7px 11px" }}>
                Las entradas cambiaron después del entrenamiento. La corrida queda registrada; vuelve a generar para usar las entradas actuales.
              </span>
            )}
            <span style={{ fontSize: 11, color: "#546E7A", backgroundColor: "#ECEFF1", borderRadius: 8, padding: "7px 11px" }}>
              Corrida #{result.id ?? "—"} · versión {result.model_version ?? "sin versión"} · corte {fmtDate(result.cutoff_date)} · guardada {fmtDate(result.created_at)}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24, marginBottom: 24 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>Historial registrado vs pronóstico</div>
              <div style={{ fontSize: 12, color: "#78909C", marginBottom: 16 }}>
                {result.history_period ? `Historial ${result.history_period.from} a ${result.history_period.to}` : "Historial del ERP"} · pronóstico {months} meses
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: "#F5F7F6" }}>
                      {["Mes", "Ingresos", "Gastos", "Tipo"].map((header) => (
                        <th key={header} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.07)", whiteSpace: "nowrap" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr key={`${row.tipo}-${row.mes}-${index}`} style={{ backgroundColor: row.tipo === "Pronóstico" ? "#E3F2FD" : index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, color: "#37474F" }}>{row.mes}</td>
                        <td style={{ padding: "9px 12px", color: "#37474F" }}>{fmt(row.ingresos)}</td>
                        <td style={{ padding: "9px 12px", color: "#37474F" }}>{fmt(row.gastos)}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <Badge label={row.tipo} color={row.tipo === "Pronóstico" ? "#1565C0" : "#546E7A"} bg={row.tipo === "Pronóstico" ? "#E3F2FD" : "#ECEFF1"} border={row.tipo === "Pronóstico" ? "#90CAF9" : "#CFD8DC"} />
                        </td>
                      </tr>
                    ))}
                    {tableRows.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#78909C", fontSize: 12 }}>Sin historial ni pronóstico para mostrar.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Detalle del cálculo</div>
              {[
                { label: "Método (ingresos)", value: models.income?.label ?? result.method_label ?? "—" },
                { label: "Método (gastos)", value: models.expenses?.label ?? "—" },
                { label: "Versión del modelo", value: result.model_version ?? "sin versión" },
                { label: "Entrenado", value: fmtDate(result.trained_at) },
                { label: "Corte del historial", value: fmtDate(result.cutoff_date) },
                { label: "Meses de historial", value: String(result.history_months ?? "—") },
                { label: "Horizonte", value: `${months} meses` },
                { label: "Evaluación", value: result.assumptions?.evaluation?.method === "temporal_holdout" ? `Validación temporal para selección (${result.assumptions.evaluation.test_months ?? "—"} meses); error a un mes con lags reales. El horizonte recursivo completo no está evaluado` : "No declarada" },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize: 12, color: "#78909C" }}>{item.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#37474F", textAlign: "right" }}>{item.value}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 12, lineHeight: 1.5 }}>
                El modelo, las entradas y la versión se guardan con la corrida. Cambiar la interfaz no cambia el modelo.
              </div>
            </Card>
          </div>

          <Card style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 4 }}>Métricas del modelo (validación temporal)</div>
            <div style={{ fontSize: 12, color: "#78909C", marginBottom: 16 }}>
              Error a un mes sobre los meses usados para selección (lags reales). El horizonte recursivo completo no está evaluado. Menor MAE es mejor. No son probabilidades ni promesas de ahorro.
            </div>
            {Object.entries(models).map(([target, info]) => (
              <div key={target} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#37474F" }}>
                  {target === "income" ? "Ingresos" : "Gastos"} · modelo seleccionado: {info.label}
                </div>
                <div style={{ fontSize: 12, color: "#546E7A", marginTop: 4 }}>
                  MAE {fmt(info.metrics.mae)} · RMSE {fmt(info.metrics.rmse)} · MAPE {info.metrics.mape_percent != null ? `${info.metrics.mape_percent}%` : "no calculable"}
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
            {Object.keys(models).length === 0 && (
              <div style={{ fontSize: 12, color: "#78909C" }}>La corrida no incluye métricas declaradas.</div>
            )}
          </Card>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Btn variant="primary" icon={<Calculator size={13} />} onClick={() => onUseForecast(result)}>Usar esta proyección en mi planificación</Btn>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={runProjection}>Generar otra corrida</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Planificación manual</Btn>
          </div>

          <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", fontSize: 12, color: "#E65100" }}>
            <Info size={13} style={{ display: "inline", marginRight: 5 }} />
            {result.disclaimer ?? "Estimación orientativa de planificación. No es una liquidación oficial."} Ingresos menos gastos no es un impuesto ni una reserva obligatoria.
          </div>
        </>
      )}
    </div>
  );
};

// PLANIFICACIÓN FISCAL
type ParameterRow = {
  id: number;
  label: string;
  value: string;
  unit: string;
  source: string;
  reviewed: boolean;
};

const DEMO_PARAMETERS: ParameterRow[] = [
  { id: 1, label: "Tarifa IVA general", value: "19.0000", unit: "percent", source: "Parámetro de ejemplo pendiente de validación", reviewed: false },
  { id: 2, label: "Periodicidad IVA", value: "2.0000", unit: "months", source: "Parámetro de ejemplo", reviewed: false },
  { id: 3, label: "Retención en la fuente", value: "0.0000", unit: "percent", source: "Por definir con el contador", reviewed: false },
];

const DEMO_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "IVA bimestral", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Fecha registrada manualmente." },
  { id: 2, name: "Retención en la fuente", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Valor pendiente de definir." },
  { id: 3, name: "ICA anual", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimación pendiente." },
];

const unitLabel = (unit: string) => ({ percent: "Porcentaje", cop: "COP", months: "Meses", count: "Cantidad" } as Record<string, string>)[unit] ?? unit;

const parameterValue = (row: ParameterRow) => {
  if (row.unit === "percent") return `${Number(row.value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}%`;
  if (row.unit === "cop") return fmt(Number(row.value));
  if (row.unit === "months") return `${Number(row.value).toLocaleString("es-CO")} meses`;
  return Number(row.value).toLocaleString("es-CO");
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
      // La meta de reserva no se deriva de ingresos − gastos ni se
      // sobrescribe: la define el contador.
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
      setActionError("Ingresa valores proyectados válidos. Los ingresos deben ser mayores que cero.");
      return;
    }
    if (reserveTargetInput < 0) {
      setActionError("La meta de reserva no puede ser negativa.");
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
      setActionMessage(`Versión v${version.version} guardada en la demostración.`);
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
      setActionMessage(`Versión v${saved.version?.version ?? saved.current_version} guardada. Las versiones anteriores se conservan.`);
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
      setActionError("Guarda una versión antes de marcarla como revisada.");
      return;
    }
    if (demoMode) {
      setSavedPlan({ ...savedPlan, status: "reviewed", version: { ...savedPlan.version, status: "reviewed" } });
      setActionMessage("Versión marcada como revisada en la demostración.");
      return;
    }
    if (!companyId) return;
    setReviewing(true);
    try {
      const reviewed = await reviewPlanVersion(companyId, savedPlan.id, savedPlan.version.id);
      setSavedPlan(reviewed);
      setActionMessage("Versión marcada como revisada. Queda inmutable.");
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
      setActionError("La reserva debe ser mayor que cero.");
      return;
    }
    if (demoMode) {
      setReservesTotal((current) => current + Number(amount));
      setReserveForm({ amount: "", reserved_on: todayISO(), note: "" });
      setActionMessage("Reserva registrada en la demostración.");
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
      setActionMessage("Reserva registrada.");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReserveSaving(false);
    }
  };

  const stepLabels = ["Revisar información", "Supuestos y parámetros", "Plan de reserva"];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Planificación fiscal"
        subtitle={`${companyName} · Período ${form.period}`}
        actions={<Btn variant="ghost" icon={<Layers size={13} />} small onClick={() => onNav("escenarios")}>Comparar escenarios</Btn>}
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando información de planificación…</div>}
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
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Información registrada</div>
            {[
              { label: "Empresa", value: companyName },
              { label: "Período", value: form.period },
              { label: "Ingresos observados", value: fmt(observedIncome), note: dashboard ? "Acumulado del año" : "Datos de ejemplo" },
              { label: "Gastos observados", value: fmt(observedExpenses), note: dashboard ? "Acumulado del año" : "Datos de ejemplo" },
              { label: "Ingresos del plan", value: fmt(projectedIncome), note: "Proyección de planificación" },
              { label: "Gastos del plan", value: fmt(projectedExpenses), note: "Proyección de planificación" },
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
                Última proyección guardada: {fmt(num(forecast.projected_income))} de ingresos y {fmt(num(forecast.projected_expenses))} de gastos para {forecast.horizon_months} meses.
              </div>
            )}
          </Card>

          <div>
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 12 }}>Obligaciones pendientes</div>
              {pendingObligations.map((obligation) => (
                <div key={obligation.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#37474F" }}>{obligation.name}</div>
                  <div style={{ fontSize: 11, color: "#E53935", marginTop: 2 }}>Vence: {fmtDate(obligation.due_date)}</div>
                  <div style={{ fontSize: 11, color: "#78909C" }}>Estimado: {obligation.estimated_amount ? fmt(num(obligation.estimated_amount)) : "Por definir"}</div>
                </div>
              ))}
              {pendingObligations.length === 0 && <div style={{ fontSize: 12, color: "#78909C" }}>No hay obligaciones pendientes registradas.</div>}
            </Card>
            <Btn variant="primary" onClick={() => setStep(2)} fullWidth icon={<ChevronRight size={14} />}>Continuar a supuestos</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F" }}>Supuestos y parámetros</div>
              <Badge label={parameters.some((item) => item.reviewed) ? "Revisión parcial" : "Revisión requerida"} color="#E65100" bg="#FFF3E0" border="#FFCC80" />
            </div>

            <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#E65100", lineHeight: 1.6 }}>
              <Info size={13} style={{ display: "inline", marginRight: 5 }} />
              Los parámetros son valores de configuración. El contador debe revisarlos y confirmarlos antes de usar esta estimación.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#F5F7F6" }}>
                    {["Parámetro", "Valor", "Unidad", "Fuente / observación", "Revisión"].map((header) => (
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
                      <td style={{ padding: "11px 14px", color: "#78909C", fontSize: 12 }}>{row.source || "Sin fuente registrada"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <Badge label={row.reviewed ? "Revisado" : "Sin revisar"} color={row.reviewed ? "#1B5E3F" : "#78909C"} bg={row.reviewed ? "#E8F5E9" : "#ECEFF1"} border={row.reviewed ? "#A5D6A7" : "#CFD8DC"} />
                      </td>
                    </tr>
                  ))}
                  {parameters.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No hay parámetros fiscales configurados. La estimación quedará pendiente de configuración.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ backgroundColor: "#ECEFF1", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontSize: 12, color: "#78909C" }}>
              Si faltan parámetros configurados y revisados, la estimación se muestra como <strong>"pendiente de configuración"</strong>. No se infieren obligaciones automáticamente.
            </div>
          </Card>

          <div style={{ display: "flex", gap: 12 }}>
            <Btn variant="ghost" onClick={() => setStep(1)}>Volver</Btn>
            <Btn variant="primary" onClick={() => setStep(3)} icon={<ChevronRight size={14} />}>Continuar a plan de reserva</Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 20 }}>Construir versión del plan</div>

            {draft && (
              <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "#1565C0", lineHeight: 1.6 }}>
                <Info size={13} style={{ display: "inline", marginRight: 5 }} />
                Borrador creado desde la proyección {draft.methodLabel ?? "del modelo"} para el período {draft.period}
                (primer mes pronosticado). La meta de reserva la defines tú: ingresos menos gastos no es un impuesto ni
                una reserva obligatoria. Al guardar se crea una versión nueva; las versiones revisadas no se modifican.
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
              <Field label="Nombre del plan">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Período">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="2026-10" style={inputStyle} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Ingresos proyectados del período *">
                <input type="number" min="0" step="0.01" value={form.projected_income} onChange={(event) => setForm({ ...form, projected_income: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Gastos proyectados del período *">
                <input type="number" min="0" step="0.01" value={form.projected_expenses} onChange={(event) => setForm({ ...form, projected_expenses: event.target.value })} style={inputStyle} />
              </Field>
            </div>

            <Field label="Meta de reserva del plan" hint="Valor definido por el contador. Es una decisión de planificación, no un impuesto calculado.">
              <input type="number" min="0" step="0.01" value={form.estimated_reserve} onChange={(event) => setForm({ ...form, estimated_reserve: event.target.value })} placeholder="0.00" style={inputStyle} />
            </Field>

            <Field label="Observaciones" hint="Se guardan con la versión y quedan en el historial.">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Supuestos, pendientes o notas para el contador…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 14px", marginTop: 4, fontSize: 11, color: "#E65100" }}>
              Plan orientativo sujeto a revisión contable. No constituye una liquidación oficial de impuestos.
            </div>

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 22, paddingTop: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#37474F", marginBottom: 10 }}>Registrar reserva</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Monto de la reserva">
                  <input type="number" min="0" step="0.01" value={reserveForm.amount} onChange={(event) => setReserveForm({ ...reserveForm, amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                </Field>
                <Field label="Fecha">
                  <input type="date" value={reserveForm.reserved_on} onChange={(event) => setReserveForm({ ...reserveForm, reserved_on: event.target.value })} style={inputStyle} />
                </Field>
              </div>
              <Field label="Nota">
                <input value={reserveForm.note} onChange={(event) => setReserveForm({ ...reserveForm, note: event.target.value })} placeholder="Detalle de la reserva" style={inputStyle} />
              </Field>
              <Btn variant="secondary" icon={<Plus size={13} />} onClick={addReserve} small>{reserveSaving ? "Registrando…" : "Registrar reserva"}</Btn>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 16 }}>Resumen del plan</div>
              {[
                { label: "Ingresos proyectados", value: fmt(projectedIncome), note: "Valor ingresado por el usuario", color: "#1B5E3F" },
                { label: "Gastos proyectados", value: fmt(projectedExpenses), note: "Valor ingresado por el usuario", color: "#37474F" },
                { label: "Diferencia proyectada", value: fmt(projectedResult), note: "Base de reserva; no es un impuesto liquidado", color: projectedResult >= 0 ? "#1565C0" : "#E53935" },
                { label: "Meta de reserva del plan", value: fmt(reserveTargetInput), note: "Definida por el contador", color: "#6A1B9A" },
                { label: "Reservas registradas", value: fmt(reservesTotal), note: "Suma de registros de reserva", color: "#37474F" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 12, color: "#78909C" }}>{row.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: row.color }}>{row.value}</div>
                  <div style={{ fontSize: 10, color: "#B0BEC5" }}>{row.note}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#78909C", marginTop: 10, lineHeight: 1.5 }}>
                Las cifras no son equivalentes entre sí. La reserva es una decisión de planificación, no una liquidación oficial.
              </div>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn variant="primary" icon={<Save size={13} />} fullWidth onClick={savePlan}>{saving ? "Guardando…" : "Guardar versión del plan"}</Btn>
              <Btn
                variant="ghost"
                icon={<Flag size={13} />}
                fullWidth
                onClick={reviewSavedPlan}
                disabled={!savedPlan?.version}
              >
                {reviewing ? "Marcando…" : versionReviewed ? "Versión ya revisada" : "Marcar como revisada"}
              </Btn>
              <Btn variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => setStep(2)} fullWidth>Volver a supuestos</Btn>
            </div>

            {(savedPlan || planDetail) && (
              <Card style={{ padding: "16px 18px" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", marginBottom: 8 }}>Versión vigente</div>
                <div style={{ fontSize: 12, color: "#78909C", lineHeight: 1.7 }}>
                  Plan: {savedPlan?.name ?? planDetail?.name}<br />
                  Versión: v{savedPlan?.version?.version ?? latestVersion?.version ?? planDetail?.current_version}<br />
                  Estado: {savedPlan?.version?.status === "reviewed" || latestVersion?.status === "reviewed" ? "Revisada (inmutable)" : "Borrador"}
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
    menor: { label: "Menores ingresos", ingresos: 44000000, gastos: 37000000, meta: 4500000, reserva: 3000000 },
    mayor: { label: "Mayores gastos", ingresos: 55000000, gastos: 46000000, meta: 4500000, reserva: 3000000 },
  };

  const sc = scenarioCfg[scenario];
  const diferencia = sc.meta - sc.reserva;

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Comparación de escenarios de planificación" subtitle={`Escenarios ilustrativos · ${companyName} · ${currentPeriod()}`} />

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#E65100", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Los escenarios de esta vista son ilustrativos y no usan los registros de la empresa. Los cambios en ingresos o gastos no recalculan impuestos si no hay una regla fiscal configurada y revisada. No se llama "ahorro fiscal" a una reducción de reserva.</span>
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
          { label: "Ingresos proyectados", value: fmtM(sc.ingresos), note: "Proyección simulada" },
          { label: "Gastos proyectados", value: fmtM(sc.gastos), note: "Proyección simulada" },
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
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Supuestos del escenario</div>
          <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#37474F", lineHeight: 1.8 }}>
            <strong>Escenario:</strong> {sc.label}<br />
            <strong>Ingresos ajustados:</strong> {fmtM(sc.ingresos)}<br />
            <strong>Gastos ajustados:</strong> {fmtM(sc.gastos)}<br />
            <strong>Supuesto:</strong> Cifras ilustrativas de demostración<br />
            <strong>Reglas fiscales configuradas:</strong> No aplicadas en este escenario
          </div>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#37474F", marginBottom: 16 }}>Plan de reserva en este escenario</div>
          {[
            { label: "Meta de reserva definida", value: fmtM(sc.meta), color: "#1B5E3F" },
            { label: "Reserva disponible (registro)", value: fmtM(sc.reserva), color: "#37474F" },
            { label: "Diferencia pendiente", value: fmtM(diferencia), color: diferencia > 0 ? "#E53935" : "#1B5E3F" },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <span style={{ fontSize: 13, color: "#78909C" }}>{row.label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: row.color }}>{row.value}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#78909C", marginTop: 12 }}>La reserva registrada es un dato informado por el usuario. No implica integración bancaria.</div>
        </Card>
      </div>
    </div>
  );
};


// OBLIGACIONES
const DEMO_TRACKED_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "IVA bimestral", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Fecha registrada manualmente." },
  { id: 2, name: "Retención en la fuente", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Valor pendiente de definir." },
  { id: 3, name: "ICA anual", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimación pendiente." },
  { id: 4, name: "IVA bimestral", period: "Jul-Ago 2026", due_date: "2026-08-28", estimated_amount: "3200000.00", status: "paid", notes: "Presentada y pagada." },
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
      setFormError("El nombre de la obligación es obligatorio.");
      return;
    }
    if (!form.due_date) {
      setFormError("La fecha de vencimiento es obligatoria.");
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
      setError("Tu rol permite consultar, pero no modificar obligaciones.");
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
        title="Obligaciones y calendario"
        subtitle={`Fechas registradas manualmente · ${companyName}`}
        actions={canManage && <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Registrar obligación</Btn>}
      />

      <div style={{ backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#E65100", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Las fechas y valores son registrados por el usuario. Verifica el calendario aplicable con el contador. No incluye envío a la DIAN ni pago real.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando obligaciones…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Obligaciones registradas", value: `${displayRows.length}`, note: "Total en el calendario" },
          { label: "Pendientes o presentadas", value: `${pendingCount}`, note: "Requieren seguimiento" },
          { label: "Vencidas según fecha registrada", value: `${displayRows.filter((row) => row.status === "pending" && row.due_date < today).length}`, note: "Comparación con la fecha de hoy" },
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
          Tu rol permite consultar el calendario. Solo Administrador o Contador pueden registrar o cambiar estados.
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F" }}>Calendario registrado</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Obligación", "Período", "Vencimiento", "Estimado", "Estado", "Notas", "Acciones"].map((header) => (
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
                      {overdue && <span style={{ display: "block", fontSize: 10, color: "#E53935", fontWeight: 700 }}>Vencida según fecha registrada</span>}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{row.period || "—"}</td>
                    <td style={{ padding: "12px 14px", color: overdue ? "#E53935" : "#37474F", fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>{fmtDate(row.due_date)}</td>
                    <td style={{ padding: "12px 14px", color: row.estimated_amount ? "#37474F" : "#FBC02D", fontWeight: 600 }}>{row.estimated_amount ? fmt(num(row.estimated_amount)) : "Por definir"}</td>
                    <td style={{ padding: "12px 14px" }}><Badge label={obligationStatusLabel(row.status)} {...style} /></td>
                    <td style={{ padding: "12px 14px", color: "#78909C", fontSize: 12, maxWidth: 220 }}>{row.notes || "—"}</td>
                    <td style={{ padding: "12px 14px" }}>
                      {row.status === "paid" || row.status === "void" ? (
                        <span style={{ fontSize: 11, color: "#B0BEC5" }}>Sin acciones</span>
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
                    No hay obligaciones registradas para esta empresa.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Cambiar el estado no presenta declaraciones ni realiza pagos. Es un registro de seguimiento interno.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Registrar obligación</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
            </div>

            {formError && <InlineError message={formError} />}

            <Field label="Nombre de la obligación *">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="IVA bimestral" style={inputStyle} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Período">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="Sep-Oct 2026" style={inputStyle} />
              </Field>
              <Field label="Vencimiento *">
                <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} style={inputStyle} />
              </Field>
            </div>

            <Field label="Valor estimado" hint="Opcional. Se muestra como estimación, no como liquidación oficial.">
              <input type="number" min="0" step="0.01" value={form.estimated_amount} onChange={(event) => setForm({ ...form, estimated_amount: event.target.value })} placeholder="0.00" style={inputStyle} />
            </Field>

            <Field label="Notas">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observaciones de seguimiento…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancelar</Btn>
              <Btn variant="primary" onClick={save} fullWidth>{saving ? "Guardando…" : "Guardar obligación"}</Btn>
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
  erp: "Dato del ERP",
  plan: "Comparación con el plan",
  proyeccion: "Proyección estimada",
  configuracion: "Configuración pendiente",
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
    // Evaluar reglas es una acción explícita al abrir Alertas; el GET del
    // dashboard no escribe alertas.
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
      setFormError("El título de la alerta es obligatorio.");
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
        title="Alertas y seguimiento"
        subtitle={`Avisos de planificación · ${companyName}`}
        actions={canManage && <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Nueva alerta</Btn>}
      />

      <div style={{ backgroundColor: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#1565C0", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Estas alertas son avisos internos de planificación. No predicen sanciones ni actuaciones de la DIAN.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando alertas…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["todas", "pendiente", "en-revision", "revisada"] as const).map((option) => (
          <button key={option} onClick={() => setFilter(option)} style={{ padding: "8px 16px", borderRadius: 20, border: filter === option ? "none" : "1px solid #CFD8DC", backgroundColor: filter === option ? "#1B5E3F" : "#fff", color: filter === option ? "#fff" : "#78909C", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {option === "todas" ? `Todas (${source.length})` : option === "pendiente" ? "Pendiente" : option === "en-revision" ? "En revisión" : "Resuelta"}
          </button>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F7F6" }}>
                {["Título", "Prioridad", "Origen", "Fecha", "Estado", "Acción"].map((header) => (
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
                        <Eye size={13} /> Ver
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
                    No hay alertas con el filtro seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
          Marcar una alerta como revisada no modifica importes, reservas ni estimaciones.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#37474F", margin: 0 }}>Nueva alerta de seguimiento</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#78909C" }}><X size={18} /></button>
            </div>

            {formError && <InlineError message={formError} />}

            <Field label="Título *">
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Revisar gastos pendientes" style={inputStyle} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prioridad">
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as AlertPriority })} style={inputStyle}>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </Field>
              <Field label="Origen">
                <select value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value as AlertOrigin })} style={inputStyle}>
                  <option value="erp">Dato del ERP</option>
                  <option value="plan">Comparación con el plan</option>
                  <option value="proyeccion">Proyección estimada</option>
                  <option value="configuracion">Configuración pendiente</option>
                </select>
              </Field>
            </div>

            <Field label="Descripción">
              <textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Detalle del hallazgo y qué se debe revisar…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancelar</Btn>
              <Btn variant="primary" onClick={save} fullWidth>{saving ? "Guardando…" : "Crear alerta"}</Btn>
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
      setError("Tu rol permite consultar la alerta, pero no cambiar su estado.");
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
          <ArrowLeft size={16} /> Volver a alertas
        </button>
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <AlertCircle size={40} color="#E53935" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F" }}>Alerta no encontrada</div>
          <p style={{ fontSize: 12, color: "#78909C" }}>{error ?? "La alerta no existe o no pertenece a esta empresa."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px" }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit", marginBottom: 16 }}>
          <ArrowLeft size={16} /> Volver a alertas
        </button>
        {loading && <div style={{ marginBottom: 12, fontSize: 12, color: "#78909C" }}>Cargando alerta…</div>}
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
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 12 }}>Descripción</div>
              <p style={{ fontSize: 14, color: "#37474F", lineHeight: 1.7, margin: 0 }}>{displayed.description || "Sin descripción registrada."}</p>
            </Card>

            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 12 }}>Sugerencia de revisión</div>
              <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#37474F", lineHeight: 1.7 }}>
                Verifica el registro relacionado, documenta la decisión en un comentario y confirma con el contador cuando corresponda. Marcar la alerta como revisada no modifica importes, reservas ni estimaciones.
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#37474F", marginBottom: 16 }}>Historial de comentarios</div>
              {displayedComments.length === 0 && (
                <div style={{ fontSize: 12, color: "#78909C", marginBottom: 12 }}>Aún no hay comentarios registrados.</div>
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
                  placeholder="Registrar observación…"
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                  onKeyDown={(event) => event.key === "Enter" && postComment()}
                />
                <Btn variant="primary" icon={<MessageSquare size={13} />} onClick={postComment}>{posting ? "Guardando…" : "Agregar"}</Btn>
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card style={{ padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#37474F", marginBottom: 14 }}>Acciones</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {displayed.action && (
                  <Btn variant="secondary" icon={<ExternalLink size={13} />} fullWidth onClick={() => onNav(displayed.action!.screen as Screen)}>
                    {displayed.action.label}
                  </Btn>
                )}
                {displayedStatus !== "in_review" && displayedStatus !== "reviewed" && (
                  <Btn variant="ghost" icon={<Clock size={13} />} fullWidth onClick={() => changeStatus("in_review")}>Marcar en revisión</Btn>
                )}
                {displayedStatus !== "reviewed" && (
                  <button
                    onClick={() => changeStatus("reviewed")}
                    disabled={statusBusy}
                    style={{ padding: "10px 14px", borderRadius: 9, border: "1.5px solid #1B5E3F", backgroundColor: "#E8F5E9", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: statusBusy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <CheckCircle size={13} /> {statusBusy ? "Guardando…" : "Marcar como resuelta"}
                  </button>
                )}
                {displayedStatus === "reviewed" && (
                  <div style={{ backgroundColor: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: 9, padding: "10px 14px", fontSize: 12, color: "#1B5E3F", fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                    <CheckCircle size={13} /> Alerta resuelta
                  </div>
                )}
              </div>
              {displayedStatus === "reviewed" && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#78909C", lineHeight: 1.5 }}>
                  Marcar como resuelta no modifica automáticamente importes, reservas ni estimaciones. La alerta se conserva en el historial.
                </div>
              )}
              {!canManage && !demoMode && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#B0BEC5", lineHeight: 1.5 }}>
                  Solo Administrador o Contador pueden cambiar el estado.
                </div>
              )}
            </Card>

            <Card style={{ padding: "18px 20px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#37474F", marginBottom: 10 }}>Información</div>
              {[
                { label: "Empresa", value: companyName },
                { label: "Origen", value: displayed.origin_label ?? ALERT_ORIGIN_LABEL[displayed.origin] ?? displayed.origin },
                { label: "Prioridad", value: displayed.priority },
                { label: "Creada", value: fmtDate(displayed.created_at) },
                { label: "Vencimiento", value: displayed.due_date ? fmtDate(displayed.due_date) : "No registrado" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 10, color: "#B0BEC5" }}>{row.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#37474F", textTransform: row.label === "Prioridad" ? "capitalize" : undefined }}>{row.value}</div>
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
    name: "Plan de reserva Oct 2026",
    period: "2026-10",
    status: "draft",
    current_version: 2,
    created_at: "2026-10-01T09:00:00Z",
    versions: [
      { id: 12, version: 2, status: "draft", assumptions: { source: "manual" }, projected_income: "55000000.00", projected_expenses: "37000000.00", estimated_reserve: "4500000.00", notes: "Ajuste por menores ventas.", created_at: "2026-10-19T09:00:00Z" },
      { id: 11, version: 1, status: "reviewed", assumptions: { source: "manual" }, projected_income: "58000000.00", projected_expenses: "38500000.00", estimated_reserve: "4500000.00", notes: "Versión inicial revisada.", created_at: "2026-10-10T09:00:00Z" },
    ],
  },
  {
    id: 2,
    name: "Plan de reserva Sep 2026",
    period: "2026-09",
    status: "reviewed",
    current_version: 1,
    created_at: "2026-09-28T09:00:00Z",
    versions: [
      { id: 21, version: 1, status: "reviewed", assumptions: {}, projected_income: "52000000.00", projected_expenses: "35000000.00", estimated_reserve: "4200000.00", notes: "Cierre de septiembre.", created_at: "2026-09-30T09:00:00Z" },
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
  if (status === "reviewed") return { label: "Revisada", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" };
  if (status === "archived") return { label: "Archivada", color: "#78909C", bg: "#ECEFF1", border: "#CFD8DC" };
  return { label: "Borrador", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" };
};

const forecastMethodLabel = (run: ForecastRun) =>
  run.method_label ??
  ({
    manual: "Promedio manual",
    promedio_manual: "Promedio manual",
    seasonal_naive: "Seasonal naive (lag-12)",
    linear: "Regresión lineal",
    random_forest: "Random Forest",
    mlp: "MLP",
  } as Record<string, string>)[run.method] ??
  run.method;

// ─── CONTEXTO Y FUENTES (SECCIÓN SECUNDARIA) ─────────────────────────────────

const licenseUi = (status: ContextSource["license"]["status"]) =>
  ({
    verified: { label: "Licencia verificada", color: "#1B5E3F", bg: "#E8F5E9", border: "#A5D6A7" },
    uncertain: { label: "Licencia sin verificar", color: "#E65100", bg: "#FFF3E0", border: "#FFCC80" },
    restricted: { label: "Uso restringido", color: "#C62828", bg: "#FFEBEE", border: "#FFCDD2" },
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
        <div><strong style={{ color: "#37474F" }}>Versión vigente:</strong> {version?.version_label ?? "Sin cargar"}</div>
        <div><strong style={{ color: "#37474F" }}>Adquirida:</strong> {version ? fmtDate(version.acquired_at) : "—"}</div>
        <div><strong style={{ color: "#37474F" }}>Corte:</strong> {version?.cutoff_date ? fmtDate(version.cutoff_date) : "—"}</div>
        <div><strong style={{ color: "#37474F" }}>Filas de origen:</strong> {version ? version.row_count.toLocaleString("es-CO") : "—"}</div>
      </div>

      {version && (version.is_partial || version.is_preliminary) && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#E65100", backgroundColor: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 8, padding: "6px 10px" }}>
          {version.is_partial ? "Período parcial. " : ""}
          {version.is_preliminary ? "Cifras preliminares, sujetas a revisión del publicador." : ""}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
        <a href={source.source_url} target="_blank" rel="noreferrer" style={{ color: "#1565C0", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
          <ExternalLink size={12} /> Fuente oficial
        </a>
        {source.license.url && (
          <a href={source.license.url} target="_blank" rel="noreferrer" style={{ color: "#1565C0", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
            <ExternalLink size={12} /> Términos de licencia
          </a>
        )}
        <span style={{ color: "#B0BEC5" }}>Atribución: {source.attribution || "—"}</span>
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
    ? new Date(tax.monthly.year, tax.monthly.month - 1, 1).toLocaleDateString("es-CO", { month: "long" })
    : "";

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Contexto y fuentes"
        subtitle="Información pública agregada de referencia · no forma parte de la operación de la empresa"
        actions={<Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Actualizar</Btn>}
      />

      <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, backgroundColor: "#E3F2FD", border: "1px solid #BBDEFB", color: "#1565C0", fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10 }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          Estas cifras son <strong>contexto externo etiquetado</strong>. No son obligaciones tributarias de la empresa,
          no se unen por NIT y <strong>no alimentan el pronóstico ni generan alertas o tareas</strong>. El recaudo DIAN
          es un agregado nacional o departamental; Supersociedades describe las 10.000 empresas más grandes y no
          representa al universo empresarial.
        </div>
      </div>

      {demoMode && (
        <Card style={{ textAlign: "center", padding: "40px 24px" }}>
          <Database size={36} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Contexto no disponible en la demostración</div>
          <p style={{ fontSize: 12, color: "#78909C", margin: 0 }}>
            La sección se alimenta de fuentes públicas cargadas en el backend. No se muestran cifras simuladas para no
            confundirlas con datos reales. Inicia sesión con una cuenta conectada para consultarla.
          </p>
        </Card>
      )}

      {!demoMode && loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando contexto y fuentes…</div>}
      {!demoMode && error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!demoMode && !loading && !error && summary && (
        <>
          {summary.sources.length === 0 ? (
            <Card style={{ textAlign: "center", padding: "40px 24px" }}>
              <Database size={36} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Sin fuentes cargadas</div>
              <p style={{ fontSize: 12, color: "#78909C", margin: 0 }}>
                Ejecuta la adquisición y carga de manifiestos para habilitar esta sección. La ausencia de datos no es un
                error del ERP: las fuentes se cargan de forma explícita y fuera del arranque de la aplicación.
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
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>Recaudo DIAN · referencia nacional</div>
                      <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>Versión {tax.version_label} · unidad original: millones de COP · mostrado en pesos corrientes (COP)</div>
                    </div>
                    {(tax.annual.is_preliminary || tax.monthly?.is_preliminary) && (
                      <Badge label="Preliminar" color="#E65100" bg="#FFF3E0" border="#FFCC80" />
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>Total anual {tax.annual.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.annual.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>Recaudo bruto agregado, no obligación individual</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>
                        {tax.monthly ? `Último mes publicado · ${monthName} ${tax.monthly.year}` : "Último mes publicado"}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>
                        {tax.monthly ? fmt(num(tax.monthly.total_cop)) : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>Serie mensual nacional</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F7F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#78909C", fontWeight: 600 }}>Seccionales {tax.departments.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.departments.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#B0BEC5", marginTop: 2 }}>Suma de direcciones seccionales</div>
                    </div>
                  </div>
                </Card>
              )}

              {benchmarks.length > 0 && (
                <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
                  <div style={{ padding: "18px 22px 12px" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>Referencia sectorial Supersociedades · {benchmarkYear}</div>
                    <div style={{ fontSize: 11, color: "#78909C", marginTop: 2 }}>
                      Agregado de las 10.000 empresas más grandes. Muestra sesgada; no es un promedio del universo empresarial.
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F5F7F6" }}>
                          {["Métrica", "Muestra", "Total", "Mediana", "Promedio", "En cero", "Negativas"].map((header) => (
                            <th key={header} style={{ padding: "10px 14px", textAlign: header === "Métrica" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {benchmarks.map((row) => (
                          <tr key={row.metric}>
                            <td style={{ padding: "10px 14px", fontWeight: 600, color: "#37474F" }}>{row.metric_label}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.sample_size.toLocaleString("es-CO")}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.total_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.median_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(row.mean_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.zero_count.toLocaleString("es-CO")}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#78909C" }}>{row.negative_count.toLocaleString("es-CO")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "10px 22px", fontSize: 10, color: "#B0BEC5", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
                    Valores convertidos de billones (10¹² COP) a pesos. No se crea precisión adicional a la publicada.
                  </div>
                </Card>
              )}

              <div style={{ fontSize: 11, color: "#90A4AE", lineHeight: 1.6 }}>
                Los originales y procesados se conservan fuera de git; los manifiestos versionados registran hash,
                fecha de corte, período y estado. Para reproducir: <code>python -m ml.sources.acquire</code> y{" "}
                <code>python -m ml.sources.build_context</code>, seguido de <code>flask context-load</code>. Consulta
                <code> docs/sources.md</code> y <code>docs/data-dictionary.md</code>.
              </div>
            </>
          )}
        </>
      )}
    </div>
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
  const [tab, setTab] = useState<"planes" | "proyecciones" | "seguimiento">("planes");
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
        title="Historial"
        subtitle={`Versiones de planes, proyecciones y seguimiento · ${companyName}`}
        actions={<Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Actualizar</Btn>}
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#78909C" }}>Cargando historial…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["planes", "proyecciones", "seguimiento"] as const).map((option) => (
          <button key={option} onClick={() => setTab(option)} style={{ padding: "9px 18px", borderRadius: 9, border: tab === option ? "none" : "1.5px solid #CFD8DC", backgroundColor: tab === option ? "#1B5E3F" : "#fff", color: tab === option ? "#fff" : "#78909C", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
            {option}
          </button>
        ))}
      </div>

      {tab === "planes" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Plan", "Período", "Versión", "Estado", "Ingresos proyectados", "Gastos proyectados", "Meta de reserva", "Creada"].map((header) => (
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
                  <tr><td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No hay versiones de plan registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
            Las versiones revisadas se conservan en solo lectura. Guardar una versión nueva no sobrescribe las anteriores.
          </div>
        </Card>
      )}

      {tab === "proyecciones" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Fecha", "Método", "Horizonte", "Ingresos proyectados", "Gastos proyectados", "Corte", "Modelo"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#78909C", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedForecasts.map((run, index) => (
                  <tr key={run.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                    <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(run.created_at)}</td>
                    <td style={{ padding: "12px 14px", color: "#37474F" }}>{forecastMethodLabel(run)}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{run.horizon_months} meses</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#1B5E3F", fontWeight: 600 }}>{fmt(num(run.projected_income))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#37474F" }}>{fmt(num(run.projected_expenses))}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C", whiteSpace: "nowrap" }}>{fmtDate(run.cutoff_date)}</td>
                    <td style={{ padding: "12px 14px", color: "#78909C", fontSize: 12 }}>
                      {run.model_version ?? "Sin modelo entrenado"}
                      {run.trained_at && <span style={{ display: "block", fontSize: 10, color: "#B0BEC5" }}>Entrenado {fmtDate(run.trained_at)}</span>}
                    </td>
                  </tr>
                ))}
                {displayedForecasts.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>No hay proyecciones registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#78909C", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFAFA" }}>
            Las proyecciones son estimaciones de planificación y no liquidaciones oficiales de impuestos. La columna
            «Modelo» solo se llena con corridas registradas del modelo entrenado offline; si falta el artefacto, la
            pantalla de Proyecciones muestra un error explícito y no sustituye la predicción con datos ficticios.
          </div>
        </Card>
      )}

      {tab === "seguimiento" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {!auditAvailable && (
            <div style={{ padding: "16px 24px", backgroundColor: "#FFF8E1", borderBottom: "1px solid #FFE082", fontSize: 12, color: "#E65100" }}>
              El historial de auditoría requiere rol Contador o Administrador de empresa.
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F7F6" }}>
                  {["Fecha", "Acción", "Recurso", "Actor", "Detalle"].map((header) => (
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
                    <td style={{ padding: "12px 14px", color: "#78909C" }}>{event.actor_id ? `Usuario #${event.actor_id}` : "Sistema"}</td>
                    <td style={{ padding: "12px 14px", color: "#B0BEC5", fontSize: 11, maxWidth: 280 }}>{Object.keys(event.detail).length > 0 ? JSON.stringify(event.detail) : "—"}</td>
                  </tr>
                ))}
                {displayedAudit.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "28px 24px", textAlign: "center", color: "#78909C", fontSize: 12 }}>{auditAvailable ? "No hay eventos de auditoría registrados." : "Sin acceso al historial de auditoría para tu rol."}</td></tr>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [alertDetailId, setAlertDetailId] = useState<number>(1);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planInitialStep, setPlanInitialStep] = useState<PlanStep>(1);
  const [backend, setBackend] = useState<BackendState>({ online: false, database: null, checked: false });

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const status = await backendStatus();
      if (alive) setBackend({ ...status, checked: true });
    };
    ping();
    const interval = window.setInterval(ping, 60000);
    return () => {
      alive = false;
      window.clearInterval(interval);
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
            // Se conservan las empresas de la sesión si el listado falla.
          }
          setUser(session);
          setCompanies(cards);
          setActiveCompanyId(cards[0]?.id ?? null);
          setLoggedIn(true);
          setScreen("empresas");
        }
      } catch {
        // Sin sesión activa: se muestra el login.
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
      // La sesión local se limpia igualmente.
    }
    setLoggedIn(false);
    setUser(null);
    setDemoMode(false);
    setCompanies([]);
    setActiveCompanyId(null);
    setScreen("login");
  };

  const handleNav = (next: Screen) => {
    // Navegar manualmente a planificación no debe arrastrar un borrador viejo
    // creado desde una proyección anterior.
    if (next === "planificacion") {
      setPlanDraft(null);
      setPlanInitialStep(1);
    }
    setScreen(next);
  };

  const handleUseForecast = (forecast: ForecastResult) => {
    const monthly = forecast.monthly ?? [];
    const firstMonth = monthly[0];
    setPlanDraft({
      // El plan se expresa por período: se usa el primer mes pronosticado.
      // El horizonte completo queda en los supuestos de la versión.
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
        note: "El plan usa el primer mes proyectado. La meta de reserva la define el contador.",
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
  const companyName = activeCompany?.nombre ?? (demoMode ? EMPRESAS[0].nombre : "Selecciona una empresa");
  const companyId = demoMode ? null : activeCompanyId;
  const canManage = demoMode || activeCompany?.role === "admin" || activeCompany?.role === "contador";

  const companySubtitle = activeCompany
    ? `NIT: ${activeCompany.nit} · Rol: ${roleLabel(activeCompany.role ?? "")}${demoMode ? " · Datos de ejemplo" : ""}`
    : demoMode
      ? "Datos de ejemplo · Sesión de demostración"
      : "Sin empresa seleccionada";
  const userName = user?.full_name ?? "María Gómez";
  const userRole = activeCompany?.role ? roleLabel(activeCompany.role) : demoMode ? "Sesión demo" : user ? "Sin empresa activa" : "Invitado";

  const needsCompany = loggedIn && !demoMode && !activeCompany;

  if (booting) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#F5F7F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#E8F5E9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Calculator size={22} color="#1B5E3F" />
        </div>
        <div style={{ fontSize: 13, color: "#78909C" }}>Verificando sesión…</div>
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginScreen onLogin={handleLogin} onDemo={handleDemo} backend={backend} />;
  }

  return (
    <div style={{ height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: "#F5F7F6", overflow: "hidden", position: "relative" }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} screen={screen} onNav={handleNav} userName={userName} userRole={userRole} apiOnline={backend.online} />

      <main style={{ height: "100vh", overflowY: "auto", marginLeft: sidebarOpen ? 240 : 0, transition: "margin-left 0.28s cubic-bezier(0.4,0,0.2,1)", display: "flex", flexDirection: "column" }}>
        <Topbar sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} empresa={needsCompany ? "AlertaFiscal" : companyName} companySubtitle={companySubtitle} backend={backend} demoMode={demoMode} onLogout={handleLogout} />

        <div style={{ flex: 1 }}>
          {screen === "empresas" && <EmpresasScreen companies={companies} onSelect={handleSelectCompany} />}

          {screen !== "empresas" && screen !== "contexto" && needsCompany && (
            <div style={{ padding: "28px 32px" }}>
              <Card style={{ textAlign: "center", padding: "48px 24px" }}>
                <Building2 size={40} color="#90CAF9" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: "#37474F", marginBottom: 6 }}>Selecciona una empresa</div>
                <p style={{ fontSize: 13, color: "#78909C", margin: "0 0 18px" }}>Tu usuario no tiene una empresa activa seleccionada. Elige una para consultar su planificación.</p>
                <Btn variant="primary" onClick={() => setScreen("empresas")}>Ir a empresas</Btn>
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
            ? "Entorno de demostración · Datos simulados · Proyecto académico independiente. Sin afiliación con la DIAN."
            : "Proyecto académico independiente. Sin afiliación con la DIAN. Las cifras son estimaciones de planificación, no liquidaciones oficiales."}
        </footer>
      </main>
    </div>
  );
}

