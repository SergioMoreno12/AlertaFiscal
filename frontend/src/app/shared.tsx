import { Info } from "lucide-react";
import { Badge, Btn } from "./ui";
import { tr, type Lang } from "../i18n";
import { type Pagination } from "../api/fiscal.api";

// ─── Types ───────────────────────────────────────────────────────────────────
export type Screen =
  | "login" | "empresas" | "resumen" | "ingresos" | "gastos"
  | "proyecciones" | "planificacion" | "escenarios" | "obligaciones"
  | "alertas" | "alerta-detalle" | "historial" | "contexto" | "datos" | "equipo" | "cuenta";

export type AlertPriority = "alta" | "media" | "baja";
export type AlertStatus = "pendiente" | "en-revision" | "revisada";
export type AlertOrigin = "erp" | "plan" | "proyeccion" | "configuracion";
export type PlanStep = 1 | 2 | 3;
export type PlanDraft = {
  projected_income: string;
  projected_expenses: string;
  period: string;
  assumptions: Record<string, unknown>;
  sourceForecastId?: number;
  methodLabel?: string;
};
export type BackendState = { online: boolean; database: string | null; checked: boolean };

// ─── Constants & Demo Data ────────────────────────────────────────────────────
export const downloadCsv = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const content = [headers.map(tr), ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const alertStatusUi = (status: string): AlertStatus =>
  status === "reviewed" ? "revisada" : status === "in_review" ? "en-revision" : "pendiente";

export const obligationStatusLabel = (status: string) =>
  ({ pending: "Pending", filed: "Filed", paid: "Paid", void: "Void" } as Record<string, string>)[status] ?? status;

export const toMoneyString = (raw: string) => {
  const parsed = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "0.00";
};

export const EMPRESAS = [
  { id: 1, nombre: "Andean Trading S.A.S.", nit: "900.456.123-1", sector: "Retail", tamaño: "Small", periodo: "Oct 2026", estado: "plan-actualizado" },
  { id: 2, nombre: "Bogota Services Ltda.", nit: "830.912.045-2", sector: "Services", tamaño: "Small", periodo: "Oct 2026", estado: "por-revisar" },
  { id: 3, nombre: "Narino Construction S.A.S.", nit: "901.234.567-0", sector: "Construction", tamaño: "Small", periodo: "Oct 2026", estado: "parametros-pendientes" },
  { id: 4, nombre: "El Trigal Bakery", nit: "10.234.567-8", sector: "Food", tamaño: "Micro", periodo: "Oct 2026", estado: "sin-registros" },
];

export const ESTADO_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  "plan-actualizado": { label: "Plan updated", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" },
  "por-revisar": { label: "To review", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" },
  "parametros-pendientes": { label: "Parameters pending", color: "#C9A227", bg: "#FBF4E2", border: "#E9D49C" },
  "sin-registros": { label: "No records", color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" },
};

export const HISTORICO = [
  { mes: "May", ingresos: 42000000, gastos: 28000000 },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000 },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000 },
  { mes: "Aug", ingresos: 62300000, gastos: 41000000 },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000 },
  { mes: "Oct*", ingresos: 35000000, gastos: 23000000, proyIngreso: 55000000, proyGasto: 37000000 },
];

export const PROYECCION_DATA = [
  { mes: "May", ingresos: 42000000, gastos: 28000000, tipo: "obs" },
  { mes: "Jun", ingresos: 51000000, gastos: 34000000, tipo: "obs" },
  { mes: "Jul", ingresos: 48500000, gastos: 32000000, tipo: "obs" },
  { mes: "Aug", ingresos: 62300000, gastos: 41000000, tipo: "obs" },
  { mes: "Sep", ingresos: 57800000, gastos: 38500000, tipo: "obs" },
  { mes: "Oct", ingresos: null, gastos: null, proyIngreso: 55000000, proyGasto: 37000000, tipo: "proy" },
  { mes: "Nov", ingresos: null, gastos: null, proyIngreso: 58000000, proyGasto: 39000000, tipo: "proy" },
];

export const INGRESOS_TABLE = [
  { id: 1, fecha: "02/10/2026", cliente: "Central Hardware", doc: "FE-2026-1101", desc: "Sale of goods", base: 5000000, iva: 950000, total: 5950000, estado: "Collected" },
  { id: 2, fecha: "05/10/2026", cliente: "North Distribution", doc: "FE-2026-1102", desc: "Sale of products", base: 8400000, iva: 1596000, total: 9996000, estado: "Pending" },
  { id: 3, fecha: "10/10/2026", cliente: "South Trading", doc: "FE-2026-1103", desc: "Wholesale", base: 12000000, iva: 2280000, total: 14280000, estado: "Collected" },
  { id: 4, fecha: "14/10/2026", cliente: "Minimarket Express", doc: "FE-2026-1104", desc: "Assorted sale", base: 3800000, iva: 722000, total: 4522000, estado: "Collected" },
  { id: 5, fecha: "17/10/2026", cliente: "Andean Stores", doc: "FE-2026-1105", desc: "Wholesale sale", base: 5800000, iva: 1102000, total: 6902000, estado: "Pending" },
];

export const GASTOS_TABLE = [
  { id: 1, fecha: "01/10/2026", proveedor: "Andean Imports", doc: "FC-20261001", cat: "Goods", base: 9500000, iva: 1805000, total: 11305000, pago: "Paid", revision: "Reviewed" },
  { id: 2, fecha: "05/10/2026", proveedor: "Logistics Services S.A.", doc: "FC-20261042", cat: "Logistics", base: 2100000, iva: 399000, total: 2499000, pago: "Pending", revision: "Not reviewed" },
  { id: 3, fecha: "08/10/2026", proveedor: "Arrendadora Central", doc: "RC-20261008", cat: "Rent", base: 3500000, iva: 0, total: 3500000, pago: "Paid", revision: "Reviewed" },
  { id: 4, fecha: "12/10/2026", proveedor: "Utilities", doc: "SV-20261012", cat: "Services", base: 450000, iva: 0, total: 450000, pago: "Paid", revision: "Not reviewed" },
  { id: 5, fecha: "15/10/2026", proveedor: "Office Supplies", doc: "FC-20261055", cat: "Admin. expenses", base: 280000, iva: 53200, total: 333200, pago: "Paid", revision: "Not reviewed" },
];

export const ALERTAS_DATA = [
  { id: 1, titulo: "$1,500,000 missing to cover the reserve target", prioridad: "alta" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "19/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "The recorded reserve ($3,000,000) does not yet cover the target set by the accountant ($4,500,000). Missing: $1,500,000 (33.3%).", valores: [{ label: "Reserve target", valor: "$4,500,000" }, { label: "Recorded reserve", valor: "$3,000,000" }, { label: "Missing", valor: "$1,500,000" }], sugerencia: "Check whether funds are available to complete the reserve before the period closes. Adjust the plan if the business cannot cover the target on the planned dates." },
  { id: 2, titulo: "VAT obligation close to its recorded date", prioridad: "media" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "18/10/2026", responsable: "Maria Gomez", estado: "en-revision" as AlertStatus, desc: "The bimonthly VAT obligation has a recorded due date of October 28, 2026. 9 days are left according to the cutoff date.", valores: [{ label: "VAT arithmetic difference", valor: "$2,550,000" }, { label: "Recorded due date", valor: "28/10/2026" }], sugerencia: "Check with the accountant whether the filing period applies to this company and confirm the official date in the tax calendar." },
  { id: 3, titulo: "Expenses pending accounting review", prioridad: "baja" as AlertPriority, origen: "erp" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "17/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "There are 3 expense records marked as 'Not reviewed'. They cannot be included in estimates until the accountant reviews them.", valores: [{ label: "Expenses not reviewed", valor: "3 records" }, { label: "Total amount not reviewed", valor: "$3,282,200" }], sugerencia: "Review the pending expenses and mark them as reviewed, or add a note about how to treat them." },
  { id: 4, titulo: "Recorded income differs from the planned scenario", prioridad: "media" as AlertPriority, origen: "plan" as AlertOrigin, empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", fecha: "15/10/2026", responsable: "Maria Gomez", estado: "pendiente" as AlertStatus, desc: "Income recorded at the cutoff ($35,000,000) is 63.6% of the closing forecast ($55,000,000). 36.4% of the month is still to be recorded.", valores: [{ label: "Recorded at cutoff", valor: "$35,000,000" }, { label: "Forecast at close", valor: "$55,000,000" }], sugerencia: "Check whether there are sales still to record. If the forecast close looks hard to reach, consider updating the forecast." },
];

export const OBLIGACIONES_DATA = [
  { id: 1, obligacion: "Bimonthly VAT (Sep-Oct 2026)", periodo: "Sep-Oct 2026", vencimiento: "28/10/2026", fuente: "Recorded by the accountant", estimado: "$2,550,000", presentacion: "Pending", pago: "Pending", revision: "In review" },
  { id: 2, obligacion: "Withholding tax (Oct 2026)", periodo: "Oct 2026", vencimiento: "12/11/2026", fuente: "Recorded by the accountant", estimado: "To be defined", presentacion: "Pending", pago: "Pending", revision: "Not reviewed" },
  { id: 3, obligacion: "ICA (Bogota - annual)", periodo: "2026", vencimiento: "15/03/2027", fuente: "Recorded by the accountant", estimado: "Estimate pending", presentacion: "Pending", pago: "Pending", revision: "Not reviewed" },
  { id: 4, obligacion: "Bimonthly VAT (Jul-Aug 2026)", periodo: "Jul-Aug 2026", vencimiento: "28/08/2026", fuente: "Recorded by the accountant", estimado: "$3.200.000", presentacion: "Filed", pago: "Paid", revision: "Reviewed" },
];

export const HISTORIAL_DATA = [
  { id: 1, fecha: "19/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Tax plan", version: "v2", origen: "Manual", responsable: "Maria Gomez", estado: "Draft" },
  { id: 2, fecha: "15/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Forecast", version: "v1", origen: "Simulated forecast", responsable: "Maria Gomez", estado: "Generated" },
  { id: 3, fecha: "10/10/2026", empresa: "Andean Trading S.A.S.", periodo: "Oct 2026", tipo: "Tax plan", version: "v1", origen: "Manual", responsable: "Maria Gomez", estado: "Reviewed" },
  { id: 4, fecha: "30/09/2026", empresa: "Andean Trading S.A.S.", periodo: "Sep 2026", tipo: "Tax plan", version: "v1", origen: "Manual", responsable: "Maria Gomez", estado: "Reviewed" },
];

// ─── UI Primitives ────────────────────────────────────────────────────────────
export const PriorityBadge = ({ p }: { p: AlertPriority }) => {
  const cfg = { alta: { label: "High", color: "#B3261E", bg: "#FBECEA", border: "#F2C9C4" }, media: { label: "Medium", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" }, baja: { label: "Low", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" } }[p];
  return <Badge {...cfg} />;
};

export const StatusBadge = ({ s }: { s: AlertStatus }) => {
  const cfg = { pendiente: { label: "Pending", color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" }, "en-revision": { label: "In review", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" }, revisada: { label: "Resolved", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" } }[s];
  return <Badge {...cfg} />;
};

export const LanguageToggle = ({ lang, onChange, onDark }: { lang: Lang; onChange: (lang: Lang) => void; onDark?: boolean }) => {
  const next: Lang = lang === "es" ? "en" : "es";
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={next === "es" ? "Switch to Spanish" : "Switch to English"}
      title={next === "es" ? "Switch to Spanish" : "Switch to English"}
      style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", border: onDark ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(0,0,0,0.1)", backgroundColor: onDark ? "rgba(255,255,255,0.08)" : "#fff" }}
    >
      {(["es", "en"] as const).map((option) => (
        <span key={option} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.3px", backgroundColor: option === lang ? "#1B5E3F" : "transparent", color: option === lang ? "#fff" : onDark ? "rgba(255,255,255,0.7)" : "#66786F" }}>
          {option.toUpperCase()}
        </span>
      ))}
    </button>
  );
};

export const DemoBanner = () => (
  <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "7px 14px", fontSize: 11, color: "#8A6400", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
    <Info size={13} /> Demo environment · Simulated data
  </div>
);

export const Pager = ({ info, onPage, noun }: { info: Pagination | null; onPage: (page: number) => void; noun: string }) => {
  if (!info || info.total === 0) return null;
  const first = (info.page - 1) * info.page_size + 1;
  const last = Math.min(info.page * info.page_size, info.total);
  return (
    <div style={{ padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 12, color: "#66786F" }}>
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
