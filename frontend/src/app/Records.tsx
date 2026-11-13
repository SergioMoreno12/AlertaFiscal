/**
 * Pieces for correcting data after it was saved: confirm-before-delete dialog, row actions,
 * import of monthly totals from a file, the account screen (password), the company form and
 * the helpers of the obligations screen (yearly template and calendar).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, FileUp, Pencil, Trash2, X } from "lucide-react";
import { ApiError } from "../api/client";
import { changePassword } from "../api/auth.api";
import { COMPANY_SECTORS, COMPANY_SIZES, updateCompany, type Company, type Obligation } from "../api/fiscal.api";
import { Badge, Btn, Card, Field, InlineError, SectionHeader, currentPeriod, errorMessage, fmt, fmtDate, inputStyle, num } from "./ui";
import { uiLocale } from "../i18n";

// ─── Confirm dialog and row actions ──────────────────────────────────────────

export const Modal = ({ children, onClose, width = 520 }: { children: React.ReactNode; onClose: () => void; width?: number }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "28px 30px", width: "100%", maxWidth: width, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
        {children}
      </div>
    </div>
  );
};

export const ConfirmDialog = ({
  title,
  detail,
  confirmLabel = "Delete",
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <Modal onClose={onCancel} width={440}>
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#FBECEA", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <AlertTriangle size={18} color="#B3261E" />
      </div>
      <div>
        <h3 style={{ fontWeight: 700, fontSize: 16, color: "#33433B", margin: "0 0 6px" }}>{title}</h3>
        <p style={{ fontSize: 13, color: "#66786F", margin: 0, lineHeight: 1.5 }}>{detail}</p>
      </div>
    </div>
    <p style={{ fontSize: 12, color: "#8A6400", backgroundColor: "#FBF4E2", borderRadius: 8, padding: "8px 12px", margin: "0 0 16px" }}>This cannot be undone. The change is written to the company history.</p>
    {error && <InlineError message={error} />}
    <div style={{ display: "flex", gap: 10 }}>
      <Btn variant="ghost" onClick={onCancel} fullWidth disabled={busy}>Cancel</Btn>
      <Btn variant="danger" onClick={onConfirm} fullWidth disabled={busy} icon={<Trash2 size={13} />}>{busy ? "Deleting…" : confirmLabel}</Btn>
    </div>
  </Modal>
);

const iconButton: React.CSSProperties = { background: "none", border: "1px solid #DCE5E0", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#33433B", padding: 0 };

export const RowActions = ({ label, onEdit, onDelete }: { label: string; onEdit?: () => void; onDelete?: () => void }) => (
  <span style={{ display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}>
    {onEdit && (
      <button type="button" onClick={onEdit} title="Edit" aria-label={`Edit ${label}`} style={iconButton}><Pencil size={13} /></button>
    )}
    {onDelete && (
      <button type="button" onClick={onDelete} title="Delete" aria-label={`Delete ${label}`} style={{ ...iconButton, color: "#B3261E", borderColor: "#F2C9C4" }}><Trash2 size={13} /></button>
    )}
  </span>
);

// ─── Import of monthly totals (CSV file or cells pasted from a spreadsheet) ──

export type ImportedMonth = { month: string; income: string; expenses: string };
export type ImportResult = { months: ImportedMonth[]; problems: string[] };

const MONTH_NAMES: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

const period = (year: number, month: number) =>
  year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : null;

const fullYear = (raw: string) => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));

/** "2025-03", "03/2025", "15/03/2025", "mar 2025", "marzo de 2025", "mar-25" → "2025-03". */
export const parseMonthCell = (raw: string): string | null => {
  const text = raw.trim().toLowerCase().replace(/\.$/, "");
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(text);
  if (m) return period(Number(m[1]), Number(m[2]));
  m = /^(?:\d{1,2}[-/])?(\d{1,2})[-/](\d{4})$/.exec(text);
  if (m) return period(Number(m[2]), Number(m[1]));
  m = /^([a-zñ]+)\.?(?:\s+de)?[\s\-/]+(\d{4}|\d{2})$/.exec(text);
  if (m && MONTH_NAMES[m[1]]) return period(fullYear(m[2]), MONTH_NAMES[m[1]]);
  m = /^(\d{4})[\s\-/]+([a-zñ]+)$/.exec(text);
  if (m && MONTH_NAMES[m[2]]) return period(Number(m[1]), MONTH_NAMES[m[2]]);
  return null;
};

/** "52.500.000", "52,500,000.50", "$ 52.500.000,5", "52500000" → "52500000.00". Null if not an amount. */
export const parseAmountCell = (raw: string): string | null => {
  let text = raw.replace(/[\s$]|cop/gi, "");
  if (text === "" || text === "-") return "0.00";
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalMark = "";
  if (lastDot >= 0 && lastComma >= 0) {
    decimalMark = lastDot > lastComma ? "." : ",";
  } else {
    const mark = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (mark) {
      const parts = text.split(mark);
      // One separator followed by 1 or 2 digits is a decimal mark; groups of 3 are thousands.
      if (parts.length === 2 && parts[1].length !== 3) decimalMark = mark;
    }
  }
  if (decimalMark) {
    const at = text.lastIndexOf(decimalMark);
    text = `${text.slice(0, at).replace(/[.,]/g, "")}.${text.slice(at + 1)}`;
  } else {
    text = text.replace(/[.,]/g, "");
  }
  const value = Number(text);
  return Number.isFinite(value) ? value.toFixed(2) : null;
};

const splitLine = (line: string, delimiter: string) => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

/** Reads rows of "month, income, expenses". The first row may be a header. */
export const parseMonthlyImport = (text: string): ImportResult => {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const problems: string[] = [];
  const byMonth = new Map<string, ImportedMonth>();
  if (lines.length === 0) return { months: [], problems: ["The file is empty."] };
  const sample = lines.slice(0, 5).join("\n");
  const delimiter = sample.includes("\t") ? "\t" : sample.includes(";") ? ";" : ",";
  const limit = currentPeriod();
  lines.forEach((line, index) => {
    const cells = splitLine(line, delimiter);
    const month = parseMonthCell(cells[0] ?? "");
    if (!month) {
      // A first row without a month is the header; anywhere else it is a problem.
      if (index > 0) problems.push(`Row ${index + 1}: "${cells[0] ?? ""}" is not a month.`);
      return;
    }
    if (cells.length < 3) {
      problems.push(`Row ${index + 1}: three columns are needed (month, income, expenses).`);
      return;
    }
    const income = parseAmountCell(cells[1]);
    const expenses = parseAmountCell(cells[2]);
    if (income === null || expenses === null) {
      problems.push(`Row ${index + 1}: the amounts of ${month} are not valid numbers.`);
      return;
    }
    if (month >= limit) {
      problems.push(`Row ${index + 1}: ${month} has not closed yet and was skipped.`);
      return;
    }
    if (byMonth.has(month)) problems.push(`Row ${index + 1}: ${month} is repeated; the last row is used.`);
    byMonth.set(month, { month, income, expenses });
  });
  if (byMonth.size === 0 && problems.length === 0) problems.push("No rows with a month were found.");
  return { months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), problems };
};

export const ImportMonthsPanel = ({ onApply, onClose }: { onApply: (months: ImportedMonth[]) => void; onClose: () => void }) => {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const result = useMemo(() => (text.trim() ? parseMonthlyImport(text) : null), [text]);

  const readFile = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
      setFileError("Excel files cannot be read directly. In Excel use File > Save as > CSV, or copy the three columns and paste them below.");
      return;
    }
    if (file.size > 1_000_000) {
      setFileError("The file is too large (maximum 1 MB).");
      return;
    }
    file.text().then((content) => {
      setFileName(file.name);
      setText(content);
    }).catch(() => setFileError("The file could not be read."));
  };

  const template = () => {
    const blob = new Blob(["﻿mes;ingresos;gastos\n2025-01;52500000;41200000\n2025-02;48900000;39800000\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "alertafiscal-monthly-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card style={{ marginBottom: 20, padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, color: "#1E2B25", fontSize: 14 }}>Import months from a file</div>
          <div style={{ fontSize: 12.5, color: "#66786F", marginTop: 4, lineHeight: 1.5 }}>Three columns: month, income and expenses. Choose a CSV file or paste the cells copied from Excel. Nothing is saved until you review the table and press Save.</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close import" style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" style={{ display: "none" }} onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = ""; }} />
        <Btn small variant="secondary" icon={<FileUp size={13} />} onClick={() => input.current?.click()}>Choose CSV file</Btn>
        <Btn small variant="ghost" onClick={template}>Download template</Btn>
        {fileName && <span style={{ fontSize: 12, color: "#66786F", alignSelf: "center" }}>{fileName}</span>}
      </div>
      {fileError && <InlineError message={fileError} />}

      <textarea
        aria-label="Rows to import"
        value={text}
        onChange={(event) => { setText(event.target.value); setFileName(null); }}
        placeholder={"2025-01;52500000;41200000\n2025-02;48900000;39800000"}
        rows={5}
        style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
      />

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.months.length > 0 && (
            <div style={{ fontSize: 12.5, color: "#154D33", backgroundColor: "#E3F1E8", border: "1px solid #C8E4D3", borderRadius: 9, padding: "9px 13px", marginBottom: 8 }}>
              {`${result.months.length} month(s) read, from ${result.months[0].month} to ${result.months[result.months.length - 1].month}.`}
            </div>
          )}
          {result.problems.length > 0 && (
            <ul style={{ margin: "0 0 8px", padding: "9px 13px 9px 30px", fontSize: 12, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 9, lineHeight: 1.6 }}>
              {result.problems.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}
              {result.problems.length > 6 && <li>{`And ${result.problems.length - 6} more row(s) with problems.`}</li>}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <Btn small disabled={!result || result.months.length === 0} onClick={() => result && onApply(result.months)}>Load into the table</Btn>
        <Btn small variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Card>
  );
};

// ─── Account (password) ──────────────────────────────────────────────────────

export const AccountScreen = ({ userName, userEmail, demoMode }: { userName: string; userEmail: string; demoMode: boolean }) => {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 10) return setError("The new password must have at least 10 characters.");
    if (next !== repeat) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "wrong_password" ? "The current password is not correct." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const type = show ? "text" : "password";
  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="My account" subtitle="Your sign-in data" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 18, alignItems: "start" }}>
        <Card>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Profile</div>
          <div style={{ fontSize: 12, color: "#66786F" }}>Name</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#33433B", marginBottom: 12 }}>{userName || "—"}</div>
          <div style={{ fontSize: 12, color: "#66786F" }}>Email</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#33433B", wordBreak: "break-all" }}>{userEmail || "—"}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Change password</div>
          {demoMode ? (
            <p style={{ fontSize: 13, color: "#66786F", margin: 0 }}>The password cannot be changed in the demo session.</p>
          ) : (
            <form onSubmit={submit}>
              {error && <InlineError message={error} />}
              {done && (
                <div role="status" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#E3F1E8", border: "1px solid #C8E4D3", color: "#154D33", fontSize: 12.5, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                  <CheckCircle size={14} /> Password changed. Your other open sessions were closed.
                </div>
              )}
              <Field label="Current password">
                <input type={type} autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required style={inputStyle} />
              </Field>
              <Field label="New password" hint="At least 10 characters.">
                <input type={type} autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={10} style={inputStyle} />
              </Field>
              <Field label="Repeat the new password">
                <input type={type} autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required style={inputStyle} />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#66786F", marginBottom: 16, cursor: "pointer" }}>
                <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} /> Show passwords
              </label>
              <Btn type="submit" disabled={busy || !current || !next || !repeat}>{busy ? "Saving…" : "Change password"}</Btn>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};

// ─── Company data ────────────────────────────────────────────────────────────

export const EditCompanyModal = ({
  company,
  onSaved,
  onClose,
}: {
  company: { id: number; name: string; nit: string; sector: string; size: string };
  onSaved: (company: Company) => void;
  onClose: () => void;
}) => {
  const [form, setForm] = useState({ name: company.name, nit: company.nit, sector: company.sector, size: company.size });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateCompany(company.id, { name: form.name.trim(), nit: form.nit.trim(), sector: form.sector, size: form.size }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const sectors = COMPANY_SECTORS.includes(form.sector as (typeof COMPANY_SECTORS)[number]) ? COMPANY_SECTORS : [form.sector, ...COMPANY_SECTORS];
  const sizes = COMPANY_SIZES.includes(form.size as (typeof COMPANY_SIZES)[number]) ? COMPANY_SIZES : [form.size, ...COMPANY_SIZES];
  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>Edit company data</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
        </div>
        {error && <InlineError message={error} />}
        <Field label="Company name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={200} style={inputStyle} />
        </Field>
        <Field label="NIT" hint="Digits, dots and a dash. Example: 900123456-7">
          <input value={form.nit} onChange={(event) => setForm({ ...form, nit: event.target.value })} required style={inputStyle} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Sector">
            <select value={form.sector} onChange={(event) => setForm({ ...form, sector: event.target.value })} style={inputStyle}>
              {sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
            </select>
          </Field>
          <Field label="Size">
            <select value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} style={inputStyle}>
              {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Btn variant="ghost" onClick={onClose} fullWidth disabled={busy}>Cancel</Btn>
          <Btn type="submit" fullWidth disabled={busy}>{busy ? "Saving…" : "Save changes"}</Btn>
        </div>
      </form>
    </Modal>
  );
};

// ─── Obligations: yearly template and calendar ───────────────────────────────

export type ObligationDraft = { name: string; period: string; due_date: string };

const TEMPLATES = [
  { key: "iva-2", label: "VAT, every two months", name: "IVA", periods: ["Jan-Feb", "Mar-Apr", "May-Jun", "Jul-Aug", "Sep-Oct", "Nov-Dec"].map((p, i) => ({ label: p, code: `B${i + 1}` })) },
  { key: "iva-4", label: "VAT, every four months", name: "IVA", periods: ["Jan-Apr", "May-Aug", "Sep-Dec"].map((p, i) => ({ label: p, code: `C${i + 1}` })) },
  { key: "rete", label: "Withholding tax, monthly", name: "Retención en la fuente", periods: Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1).padStart(2, "0"), code: `M${String(i + 1).padStart(2, "0")}` })) },
  { key: "renta", label: "Income tax, yearly", name: "Renta", periods: [{ label: "Year", code: "A" }] },
] as const;

/**
 * Builds the obligations of one tax for a year. The due dates are not guessed: they depend on
 * the NIT and on the calendar the DIAN publishes each year, so the user types them.
 */
export const ObligationTemplateModal = ({ onCreate, onClose }: { onCreate: (rows: ObligationDraft[]) => Promise<void>; onClose: () => void }) => {
  const [templateKey, setTemplateKey] = useState<(typeof TEMPLATES)[number]["key"]>("iva-2");
  const [year, setYear] = useState(new Date().getFullYear());
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = TEMPLATES.find((item) => item.key === templateKey) ?? TEMPLATES[0];
  const filled = template.periods.filter((item) => dates[`${templateKey}:${item.code}`]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(filled.map((item) => ({ name: template.name, period: `${year}-${item.code}`, due_date: dates[`${templateKey}:${item.code}`] })));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>Add the obligations of a year</h3>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
      </div>
      <p style={{ fontSize: 12.5, color: "#66786F", lineHeight: 1.5, margin: "0 0 16px" }}>Choose the tax and write the due date of each period. The dates depend on your NIT and on the calendar the DIAN publishes each year, so AlertaFiscal does not fill them in for you. Periods left without a date are not created.</p>
      {error && <InlineError message={error} />}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="Tax and frequency">
          <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as typeof templateKey)} style={inputStyle}>
            {TEMPLATES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())} style={inputStyle} />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        {template.periods.map((item) => (
          <label key={item.code} style={{ fontSize: 12, fontWeight: 600, color: "#33433B" }}>
            <span style={{ display: "block", marginBottom: 4 }}>{`Period ${item.label}`}</span>
            <input type="date" aria-label={`Due date · period ${item.label}`} value={dates[`${templateKey}:${item.code}`] ?? ""} onChange={(event) => setDates({ ...dates, [`${templateKey}:${item.code}`]: event.target.value })} style={inputStyle} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="ghost" onClick={onClose} fullWidth disabled={busy}>Cancel</Btn>
        <Btn onClick={submit} fullWidth disabled={busy || filled.length === 0}>{busy ? "Saving…" : `Create ${filled.length} obligation(s)`}</Btn>
      </div>
    </Modal>
  );
};

const STATUS_COLORS: Record<Obligation["status"], { color: string; bg: string; border: string; label: string }> = {
  pending: { color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C", label: "Pending" },
  filed: { color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1", label: "Filed" },
  paid: { color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1", label: "Paid" },
  void: { color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8", label: "Void" },
};

/** The obligations of the year, month by month. */
export const ObligationCalendar = ({ rows, today }: { rows: Obligation[]; today: string }) => {
  const years = useMemo(() => {
    const set = new Set(rows.map((row) => (row.due_date ?? "").slice(0, 4)).filter(Boolean));
    set.add(today.slice(0, 4));
    return [...set].sort();
  }, [rows, today]);
  const [year, setYear] = useState(today.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B" }}>Calendar of the year</div>
        <select aria-label="Year" value={year} onChange={(event) => setYear(event.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
        {months.map((month) => {
          const due = rows.filter((row) => (row.due_date ?? "").startsWith(month)).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
          const isCurrent = today.startsWith(month);
          const name = new Date(Number(year), Number(month.slice(5)) - 1, 1).toLocaleDateString(uiLocale(), { month: "long" });
          return (
            <div key={month} style={{ border: `1px solid ${isCurrent ? "#1B5E3F" : "#DCE5E0"}`, borderRadius: 10, padding: "10px 12px", minHeight: 84, backgroundColor: isCurrent ? "#F2F8F4" : "#fff" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isCurrent ? "#1B5E3F" : "#66786F", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{name}</div>
              {due.length === 0 && <div style={{ fontSize: 11.5, color: "#9AABA2" }}>—</div>}
              {due.map((row) => {
                const style = STATUS_COLORS[row.status];
                const overdue = row.status === "pending" && (row.due_date ?? "") < today;
                return (
                  <div key={row.id} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#33433B", lineHeight: 1.3 }}>{row.name}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: overdue ? "#B3261E" : "#66786F", fontWeight: overdue ? 700 : 400 }}>{fmtDate(row.due_date)}</span>
                      {overdue
                        ? <Badge label="Overdue" color="#B3261E" bg="#FBECEA" border="#F2C9C4" />
                        : <Badge label={style.label} color={style.color} bg={style.bg} border={style.border} />}
                    </div>
                    {row.estimated_amount !== null && num(row.estimated_amount) > 0 && <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>{fmt(num(row.estimated_amount))}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
};
