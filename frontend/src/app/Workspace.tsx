/**
 * Screens added for working with real data: monthly totals (the quickest way to give the model
 * a history), the company team and the new-company form.
 */
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Building2, CheckCircle, FileUp, Plus, RefreshCw, Save, UserPlus, Users } from "lucide-react";
import {
  COMPANY_SECTORS,
  COMPANY_SIZES,
  addMember,
  createCompany,
  deleteMonthlyTotal,
  getMonthlyTotals,
  listMembers,
  saveMonthlyTotals,
  updateMember,
  type Company,
  type Member,
  type MonthlyTotal,
} from "../api/fiscal.api";
import { Badge, Btn, Card, Field, InlineError, MlBadge, SectionHeader, currentPeriod, errorMessage, fmt, inputStyle, num, roleLabel, shortMonth } from "./ui";

import { ConfirmDialog, ImportMonthsPanel, RowActions, type ImportedMonth } from "./Records";

const MIN_MONTHS = 6;

const addMonths = (period: string, delta: number) => {
  const [y, m] = period.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (period: string) => {
  const label = `${shortMonth(period)} ${period.slice(0, 4)}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const cleanAmount = (raw: string) => raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");

/** "52500000" → "52.500.000" (Colombian grouping; the comma is the decimal mark). */
const groupAmount = (raw: string) => {
  if (!raw) return "";
  const [whole, decimals] = raw.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals === undefined ? grouped : `${grouped},${decimals}`;
};

// ─── Monthly data ────────────────────────────────────────────────────────────

type Row = { month: string; income: string; expenses: string; locked: boolean; saved?: MonthlyTotal };
type Draft = Record<string, { income: string; expenses: string }>;

// Unsaved months are kept for the browser session, so a failed save, a reload or a change
// of screen does not throw away what the user typed.
const draftKey = (companyId: number) => `af_monthly_draft_${companyId}`;

const readDraft = (companyId: number): Draft => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(draftKey(companyId)) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Draft) : {};
  } catch {
    return {};
  }
};

const writeDraft = (companyId: number, draft: Draft) => {
  try {
    if (Object.keys(draft).length === 0) sessionStorage.removeItem(draftKey(companyId));
    else sessionStorage.setItem(draftKey(companyId), JSON.stringify(draft));
  } catch {
    // Storage can be unavailable (private window): the form still works without the draft.
  }
};

export const MonthlyDataScreen = ({ companyId, companyName, onNav, canManage }: { companyId: number | null; companyName: string; onNav: (screen: "proyecciones") => void; canManage: boolean }) => {
  const [items, setItems] = useState<MonthlyTotal[]>([]);
  const [closedMonths, setClosedMonths] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [extra, setExtra] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getMonthlyTotals(companyId)
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setClosedMonths(data.closed_months);
      })
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [companyId, reloadKey]);

  // The grid shows the last 12 closed months (plus any earlier month already recorded and the
  // extra months the user asks for), newest first.
  useEffect(() => {
    const lastClosed = addMonths(currentPeriod(), -1);
    const byMonth = new Map(items.map((item) => [item.month, item]));
    const draft = companyId ? readDraft(companyId) : {};
    const earliestRecorded = items.length ? items[0].month : lastClosed;
    let first = addMonths(lastClosed, -(11 + extra));
    if (earliestRecorded < first) first = earliestRecorded;
    const next: Row[] = [];
    for (let month = lastClosed; month >= first; month = addMonths(month, -1)) {
      const saved = byMonth.get(month);
      const hasOtherRecords = Boolean(saved && !saved.from_monthly_form && (num(saved.income) > 0 || num(saved.expenses) > 0));
      const typed = hasOtherRecords ? undefined : draft[month];
      next.push({
        month,
        income: typed ? typed.income : saved && (saved.from_monthly_form || hasOtherRecords) ? String(Math.round(num(saved.income))) : "",
        expenses: typed ? typed.expenses : saved && (saved.from_monthly_form || hasOtherRecords) ? String(Math.round(num(saved.expenses))) : "",
        locked: hasOtherRecords,
        saved,
      });
    }
    setRows(next);
  }, [items, extra, companyId, draftVersion]);

  // Imported months go to the table as unsaved values: the user reviews them and presses Save.
  const applyImport = (months: ImportedMonth[]) => {
    if (!companyId || months.length === 0) return;
    const byMonth = new Map(items.map((item) => [item.month, item]));
    const draft = readDraft(companyId);
    let skipped = 0;
    months.forEach((item) => {
      const saved = byMonth.get(item.month);
      if (saved && !saved.from_monthly_form && (num(saved.income) > 0 || num(saved.expenses) > 0)) {
        skipped += 1;
        return;
      }
      draft[item.month] = { income: String(Math.round(num(item.income))), expenses: String(Math.round(num(item.expenses))) };
    });
    writeDraft(companyId, draft);
    // Show enough earlier months for the oldest imported one.
    const lastClosed = addMonths(currentPeriod(), -1);
    const [fy, fm] = months[0].month.split("-").map(Number);
    const [ly, lm] = lastClosed.split("-").map(Number);
    const span = (ly - fy) * 12 + (lm - fm);
    setExtra((current) => Math.max(current, span - 11));
    setDraftVersion((version) => version + 1);
    setImporting(false);
    setError(null);
    setNotice(
      skipped
        ? `${months.length - skipped} month(s) loaded into the table. ${skipped} month(s) with individual records were skipped. Review them and press Save.`
        : `${months.length} month(s) loaded into the table. Review them and press Save.`,
    );
  };

  const confirmDelete = async () => {
    if (!companyId || !toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const data = await deleteMonthlyTotal(companyId, toDelete);
      const draft = readDraft(companyId);
      delete draft[toDelete];
      writeDraft(companyId, draft);
      setItems(data.items);
      setClosedMonths(data.closed_months);
      setNotice(`${monthLabel(toDelete)} was deleted from the history.`);
      setToDelete(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const update = (month: string, field: "income" | "expenses", value: string) =>
    setRows((current) => current.map((row) => (row.month === month ? { ...row, [field]: cleanAmount(value) } : row)));

  const dirty = rows.filter((row) => {
    if (row.locked) return false;
    if (row.income === "" && row.expenses === "") return false;
    const before = row.saved?.from_monthly_form ? row.saved : null;
    return !before || Math.round(num(before.income)) !== Math.round(num(row.income)) || Math.round(num(before.expenses)) !== Math.round(num(row.expenses));
  });

  const dirtyKey = dirty.map((row) => `${row.month}:${row.income}:${row.expenses}`).join("|");
  useEffect(() => {
    if (!companyId || loading || rows.length === 0) return;
    writeDraft(companyId, Object.fromEntries(dirty.map((row) => [row.month, { income: row.income, expenses: row.expenses }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, loading, dirtyKey]);

  const save = async () => {
    if (!companyId || dirty.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await saveMonthlyTotals(
        companyId,
        dirty.map((row) => ({ month: row.month, income: row.income || "0", expenses: row.expenses || "0" })),
      );
      writeDraft(companyId, {});
      setItems(data.items);
      setClosedMonths(data.closed_months);
      setNotice(`${dirty.length} month(s) saved. They are part of the company history now.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const chart = useMemo(
    () => items.filter((item) => item.month < currentPeriod()).slice(-12).map((item) => ({ mes: monthLabel(item.month), Income: num(item.income), Expenses: num(item.expenses) })),
    [items],
  );

  const ready = closedMonths >= MIN_MONTHS;
  const progress = Math.min(100, Math.round((closedMonths / MIN_MONTHS) * 100));

  if (!companyId) return null;

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Monthly data"
        subtitle={`Total income and expenses per month · ${companyName}`}
        actions={<Btn variant="ghost" small icon={<RefreshCw size={13} />} onClick={() => setReloadKey((k) => k + 1)}>Refresh</Btn>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 20 }}>
        <Card style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.06em" }}>History for the model</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 10px" }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: "#1B5E3F" }}>{closedMonths}</span>
            <span style={{ fontSize: 13, color: "#66786F" }}>{`closed months recorded · minimum ${MIN_MONTHS}`}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, backgroundColor: "#E3F1E8", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", backgroundColor: ready ? "#1B5E3F" : "#5BAA80", transition: "width .3s" }} />
          </div>
          <div style={{ marginTop: 12, fontSize: 12.5, color: ready ? "#1B5E3F" : "#66786F", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {ready ? (
              <>
                <CheckCircle size={14} /> Ready: the model can forecast this company.
                <Btn small onClick={() => onNav("proyecciones")} icon={<ArrowRight size={13} />}>Go to forecasts</Btn>
              </>
            ) : (
              <>{`Enter ${MIN_MONTHS - closedMonths} more closed month(s) so the model can forecast.`}</>
            )}
          </div>
        </Card>
        <Card style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>How it is used</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#33433B", lineHeight: 1.7 }}>
            <li>Each month is saved as one income record and one expense record of the company.</li>
            <li>The forecast reads these months; the month in progress is not used until it closes. <MlBadge size="sm" /></li>
            <li>Months recorded document by document are shown locked: edit them in Income and Expenses.</li>
          </ul>
        </Card>
      </div>

      {importing && <ImportMonthsPanel onApply={applyImport} onClose={() => setImporting(false)} />}

      {error && <InlineError message={error} onRetry={dirty.length ? save : () => setReloadKey((k) => k + 1)} />}
      {!error && !loading && dirty.length > 0 && (
        <div role="status" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", color: "#8A6400", fontSize: 12.5, fontWeight: 600 }}>{`${dirty.length} month(s) not saved yet. Press Save to add them to the history.`}</div>
      )}
      {notice && (
        <div role="status" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#E3F1E8", border: "1px solid #C8E4D3", color: "#154D33", fontSize: 12.5, fontWeight: 600 }}>{notice}</div>
      )}

      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 22px", borderBottom: "1px solid #DCE5E0", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, color: "#1E2B25", fontSize: 14 }}>Monthly totals (COP)</div>
            <div style={{ fontSize: 12, color: "#66786F", marginTop: 2 }}>Write the totals of each closed month and save. Saving a month again replaces its values.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="secondary" small icon={<FileUp size={13} />} onClick={() => setImporting(true)}>Import from a file</Btn>
            <Btn variant="secondary" small icon={<Plus size={13} />} onClick={() => setExtra((n) => n + 6)}>Add 6 earlier months</Btn>
            <Btn small icon={<Save size={13} />} onClick={save} disabled={saving || dirty.length === 0}>{saving ? "Saving…" : `Save${dirty.length ? ` (${dirty.length})` : ""}`}</Btn>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F2F8F4" }}>
                {["Month", "Income", "Expenses", "Result", "Source", ...(canManage ? [""] : [])].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: h === "Month" || h === "Source" ? "left" : "right", fontSize: 11, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#66786F" }}>Loading…</td></tr>
              )}
              {rows.map((row) => {
                const result = num(row.income) - num(row.expenses);
                const filled = row.income !== "" || row.expenses !== "";
                const cellInput: React.CSSProperties = { ...inputStyle, textAlign: "right", maxWidth: 190, marginLeft: "auto", display: "block", backgroundColor: row.locked ? "#F5F8F6" : "#fff" };
                return (
                  <tr key={row.month} style={{ borderTop: "1px solid #EEF2F0" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 600, color: "#1E2B25", whiteSpace: "nowrap" }}>{monthLabel(row.month)}</td>
                    <td style={{ padding: "6px 14px" }}>
                      <input aria-label={`Income · ${monthLabel(row.month)}`} inputMode="decimal" value={groupAmount(row.income)} disabled={row.locked} placeholder="0" onChange={(e) => update(row.month, "income", e.target.value)} style={cellInput} />
                    </td>
                    <td style={{ padding: "6px 14px" }}>
                      <input aria-label={`Expenses · ${monthLabel(row.month)}`} inputMode="decimal" value={groupAmount(row.expenses)} disabled={row.locked} placeholder="0" onChange={(e) => update(row.month, "expenses", e.target.value)} style={cellInput} />
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 600, color: !filled ? "#9AABA2" : result < 0 ? "#B3261E" : "#1B5E3F", whiteSpace: "nowrap" }}>{filled ? fmt(result) : "—"}</td>
                    <td style={{ padding: "8px 14px", fontSize: 12, color: "#66786F", whiteSpace: "nowrap" }}>
                      {row.locked ? "Individual records" : row.saved?.from_monthly_form ? "Monthly form" : "Not recorded"}
                    </td>
                    {canManage && (
                      <td style={{ padding: "8px 14px", textAlign: "right" }}>
                        {row.saved?.from_monthly_form && <RowActions label={monthLabel(row.month)} onDelete={() => { setDeleteError(null); setToDelete(row.month); }} />}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {chart.length > 0 && (
        <Card>
          <div style={{ fontWeight: 700, color: "#1E2B25", fontSize: 14, marginBottom: 4 }}>Recorded history</div>
          <div style={{ fontSize: 12, color: "#66786F", marginBottom: 14 }}>Your data, as the model will read it (last 12 closed months).</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F0" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#66786F" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#66786F" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1_000_000)}M`} width={48} />
                <Tooltip formatter={(value) => fmt(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Income" fill="#1B5E3F" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#9CCDB1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete the totals of this month?"
          detail={`${monthLabel(toDelete)}: the income and expense totals entered in this form are removed from the history the model reads.`}
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
};

// ─── Team ────────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "admin", label: "Company administrator" },
  { value: "contador", label: "Accountant" },
  { value: "auxiliar", label: "Accounting assistant" },
];

export const TeamScreen = ({ companyId, companyName, isAdmin, currentUserId }: { companyId: number | null; companyName: string; isAdmin: boolean; currentUserId: number | null }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("contador");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!companyId || !isAdmin) return;
    let alive = true;
    setLoading(true);
    setError(null);
    listMembers(companyId)
      .then((data) => alive && setMembers(data.items))
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [companyId, isAdmin, reloadKey]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const member = await addMember(companyId, { email: email.trim(), role });
      setMembers((current) => [...current.filter((m) => m.id !== member.id), member]);
      setEmail("");
      setNotice(`${member.full_name} now has access to the company.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const change = async (member: Member, payload: { role?: string; is_active?: boolean }) => {
    if (!companyId) return;
    setError(null);
    setNotice(null);
    try {
      const updated = await updateMember(companyId, member.id, payload);
      setMembers((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!companyId) return null;

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Team" subtitle={`People with access to ${companyName}`} actions={isAdmin ? <Btn variant="ghost" small icon={<RefreshCw size={13} />} onClick={() => setReloadKey((k) => k + 1)}>Refresh</Btn> : undefined} />

      {!isAdmin ? (
        <Card style={{ textAlign: "center", padding: "40px 24px" }}>
          <Users size={34} color="#9CCDB1" style={{ margin: "0 auto 10px", display: "block" }} />
          <div style={{ fontWeight: 700, color: "#1E2B25", marginBottom: 6 }}>Only the company administrator manages the team</div>
          <div style={{ fontSize: 13, color: "#66786F" }}>Ask the administrator to add people or change roles.</div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {error && <div style={{ padding: "14px 18px 0" }}><InlineError message={error} /></div>}
            {notice && <div role="status" style={{ margin: "14px 18px 0", padding: "10px 14px", borderRadius: 9, backgroundColor: "#E3F1E8", color: "#154D33", fontSize: 12.5, fontWeight: 600 }}>{notice}</div>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#F2F8F4" }}>
                    {["Person", "Role", "Access"].map((h) => (
                      <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && members.length === 0 && <tr><td colSpan={3} style={{ padding: 24, textAlign: "center", color: "#66786F" }}>Loading…</td></tr>}
                  {members.map((member) => {
                    const self = member.user_id === currentUserId;
                    return (
                      <tr key={member.id} style={{ borderTop: "1px solid #EEF2F0", opacity: member.is_active ? 1 : 0.55 }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontWeight: 600, color: "#1E2B25" }}>{self ? `${member.full_name} (you)` : member.full_name}</div>
                          <div style={{ fontSize: 12, color: "#66786F" }}>{member.email}</div>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <select aria-label={`Role of ${member.full_name}`} value={member.role} onChange={(e) => change(member, { role: e.target.value })} style={{ ...inputStyle, width: "auto", padding: "7px 10px" }}>
                            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {self ? (
                            <span style={{ fontSize: 12, color: "#66786F" }}>—</span>
                          ) : member.is_active ? (
                            <Btn variant="ghost" small onClick={() => change(member, { is_active: false })}>Remove access</Btn>
                          ) : (
                            <Btn variant="secondary" small onClick={() => change(member, { is_active: true })}>Restore access</Btn>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#1E2B25", marginBottom: 4 }}><UserPlus size={16} color="#1B5E3F" /> Add a person</div>
            <p style={{ fontSize: 12, color: "#66786F", margin: "0 0 14px", lineHeight: 1.5 }}>The person must create an account first (Create account on the home page). Then add them here with their email.</p>
            <form onSubmit={add}>
              <Field label="Email">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="name@company.com" />
              </Field>
              <Field label="Role">
                <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              <Btn type="submit" fullWidth disabled={busy} icon={<UserPlus size={14} />}>{busy ? "Adding…" : "Add to the company"}</Btn>
            </form>
            <div style={{ marginTop: 16, fontSize: 11.5, color: "#66786F", lineHeight: 1.6 }}>
              <strong style={{ color: "#33433B" }}>Roles:</strong> the administrator manages the team; the accountant reviews plans, alerts and obligations; the assistant records income and expenses.
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── New company ─────────────────────────────────────────────────────────────

export const NewCompanyCard = ({ onCreated, onCancel }: { onCreated: (company: Company) => void; onCancel?: () => void }) => {
  const [name, setName] = useState("");
  const [nit, setNit] = useState("");
  const [sector, setSector] = useState<string>("Retail");
  const [size, setSize] = useState<string>("Small");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createCompany({ name: name.trim(), nit: nit.trim(), sector, size }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20, border: "1.5px solid #C8E4D3" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#E3F1E8", display: "flex", alignItems: "center", justifyContent: "center" }}><Building2 size={18} color="#1B5E3F" /></div>
        <div>
          <div style={{ fontWeight: 700, color: "#1E2B25" }}>New company</div>
          <div style={{ fontSize: 12, color: "#66786F" }}>You will be its administrator.</div>
        </div>
      </div>
      {error && <InlineError message={error} />}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Company name">
            <input required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="NIT" hint="Digits, dots and a dash. Example: 900123456-7">
            <input required pattern="[0-9][0-9.\-]{4,19}" value={nit} onChange={(e) => setNit(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Sector">
            <select value={sector} onChange={(e) => setSector(e.target.value)} style={inputStyle}>
              {COMPANY_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Size">
            <select value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle}>
              {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {onCancel && <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>}
          <Btn type="submit" disabled={busy} icon={<Plus size={14} />}>{busy ? "Creating…" : "Create company"}</Btn>
        </div>
      </form>
    </Card>
  );
};

export const RoleBadge = ({ role }: { role?: string }) => (
  <Badge label={role ? roleLabel(role) : "Active"} color="#1B5E3F" bg="#E3F1E8" border="#C8E4D3" />
);
