/** Shared UI pieces and formatting helpers used by every authenticated screen. */
import { Sparkles } from "lucide-react";
import { ApiError } from "../api/client";
import { uiLocale } from "../i18n";

export const fmt = (n: number) =>
  new Intl.NumberFormat(uiLocale(), { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export const fmtM = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString(uiLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M COP`;
  if (n >= 1_000) return `$${(n / 1_000).toLocaleString(uiLocale(), { maximumFractionDigits: 0 })} K COP`;
  return fmt(n);
};

export const roleLabel = (role: string) =>
  ({ admin: "Company administrator", contador: "Accountant", auxiliar: "Accounting assistant" } as Record<string, string>)[role] ?? role;

export const num = (value: string | number | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const fmtDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(uiLocale(), { day: "2-digit", month: "short", year: "numeric" });
};

export const shortMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString(uiLocale(), { month: "short" });
};

export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "The operation could not be completed.";

export const todayISO = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const currentPeriod = () => todayISO().slice(0, 7);

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1.5px solid #D3DDD8",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
  outline: "none",
  backgroundColor: "#fff",
  color: "#33433B",
};

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: "#33433B", display: "block", marginBottom: 5 }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 10, color: "#9AABA2", marginTop: 4 }}>{hint}</div>}
  </div>
);

export const InlineError = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FBECEA", border: "1px solid #F2C9C4", color: "#B3261E", fontSize: 12 }}>
    {message}
    {onRetry && (
      <>
        {" · "}
        <button onClick={onRetry} style={{ border: "none", background: "none", color: "#B3261E", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Retry</button>
      </>
    )}
  </div>
);

export const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "24px 28px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)", ...style }}>
    {children}
  </div>
);

export const Badge = ({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, backgroundColor: bg, color, border: `1px solid ${border}`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2px", whiteSpace: "nowrap" }}>
    {label}
  </span>
);

export const Btn = ({ children, variant = "primary", onClick, icon, small, fullWidth, disabled, type = "button" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void; icon?: React.ReactNode; small?: boolean; fullWidth?: boolean; disabled?: boolean; type?: "button" | "submit" }) => {
  const styles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: "#1B5E3F", color: "#fff", border: "none" },
    secondary: { backgroundColor: "transparent", color: "#1B5E3F", border: "1.5px solid #1B5E3F" },
    ghost: { backgroundColor: "transparent", color: "#66786F", border: "1px solid rgba(0,0,0,0.1)" },
    danger: { backgroundColor: "#FBECEA", color: "#B3261E", border: "1px solid #F2C9C4" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...styles[variant], borderRadius: 9, padding: small ? "7px 14px" : "10px 18px", fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", transition: "opacity 0.15s", width: fullWidth ? "100%" : undefined, justifyContent: fullWidth ? "center" : undefined }}>
      {icon}{children}
    </button>
  );
};

export const SectionHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1B5E3F", margin: 0, letterSpacing: "-0.3px" }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: "#66786F", margin: "4px 0 0" }}>{subtitle}</p>}
    </div>
    {actions && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
  </div>
);

/**
 * Marks a value produced by the machine learning model. Everything without this tag is data
 * the user recorded or the result of an ERP rule.
 */
export const MlBadge = ({ detail, size = "md" }: { detail?: string; size?: "sm" | "md" }) => (
  <span
    title={detail ?? "Result of the machine learning model"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      backgroundColor: "#1B5E3F",
      color: "#fff",
      borderRadius: 999,
      padding: size === "sm" ? "1px 7px" : "3px 9px",
      fontSize: size === "sm" ? 10 : 11,
      fontWeight: 700,
      whiteSpace: "nowrap",
      letterSpacing: "0.2px",
      verticalAlign: "middle",
    }}
  >
    <Sparkles size={size === "sm" ? 9 : 11} /> Machine learning
  </span>
);

/** Explains, in one line, where the ML values on a screen come from. */
export const MlNote = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, backgroundColor: "#E3F1E8", border: "1px solid #C8E4D3", color: "#154D33", fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>
    <MlBadge size="sm" />
    <span>{children}</span>
  </div>
);
