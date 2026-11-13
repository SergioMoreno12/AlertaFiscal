import { useEffect, useState } from "react";
import { X, Plus, Info, CalendarPlus } from "lucide-react";
import {
  ConfirmDialog, ObligationCalendar, ObligationTemplateModal, RowActions, type ObligationDraft,
} from "../Records";
import {
  Badge, Btn, Card, Field, InlineError, SectionHeader, currentPeriod, errorMessage, fmt, fmtDate,
  inputStyle, num, todayISO,
} from "../ui";
import {
  createObligation, deleteObligation, listObligations, updateObligation, type Obligation,
} from "../../api/fiscal.api";
import { obligationStatusLabel, toMoneyString } from "../shared";

// OBLIGACIONES
export const DEMO_TRACKED_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "Bimonthly VAT", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Date recorded manually." },
  { id: 2, name: "Withholding tax", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Amount pending." },
  { id: 3, name: "Annual ICA", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimate pending." },
  { id: 4, name: "Bimonthly VAT", period: "Jul-Aug 2026", due_date: "2026-08-28", estimated_amount: "3200000.00", status: "paid", notes: "Filed and paid." },
];

export const obligationBadgeStyle = (status: string) => {
  if (status === "paid") return { color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" };
  if (status === "filed") return { color: "#24714D", bg: "#EDF7F0", border: "#9CCDB1" };
  if (status === "void") return { color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" };
  return { color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" };
};

export const ObligacionesScreen = ({
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
  const [editing, setEditing] = useState<Obligation | null>(null);
  const [toDelete, setToDelete] = useState<Obligation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const showActions = !demoMode && canManage;

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
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (row: Obligation) => {
    setForm({
      name: row.name,
      period: row.period,
      due_date: row.due_date,
      estimated_amount: row.estimated_amount !== null ? String(num(row.estimated_amount)) : "",
      notes: row.notes,
    });
    setFormError(null);
    setEditing(row);
    setShowForm(true);
  };

  const confirmDelete = async () => {
    if (!companyId || !toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteObligation(companyId, toDelete.id);
      setToDelete(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const createFromTemplate = async (drafts: ObligationDraft[]) => {
    if (!companyId) return;
    try {
      for (const draft of drafts) await createObligation(companyId, draft);
    } finally {
      // Some may have been created before a failure: show what is saved.
      setReloadKey((key) => key + 1);
    }
    setShowTemplate(false);
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
      const payload = {
        name: form.name.trim(),
        period: form.period,
        due_date: form.due_date,
        estimated_amount: estimated,
        notes: form.notes,
      };
      if (editing) await updateObligation(companyId, editing.id, payload);
      else await createObligation(companyId, payload);
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
        actions={canManage && (
          <>
            {!demoMode && <Btn variant="secondary" icon={<CalendarPlus size={13} />} small onClick={() => setShowTemplate(true)}>Add a whole year</Btn>}
            <Btn variant="primary" icon={<Plus size={13} />} small onClick={openForm}>Record obligation</Btn>
          </>
        )}
      />

      <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#8A6400", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Dates and amounts are recorded by the user. Check the applicable calendar with the accountant. Nothing is sent to the DIAN and nothing is paid.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading obligations…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded obligations", value: `${displayRows.length}`, note: "Total in the calendar" },
          { label: "Pending or filed", value: `${pendingCount}`, note: "Need follow-up" },
          { label: "Overdue by recorded date", value: `${displayRows.filter((row) => row.status === "pending" && row.due_date < today).length}`, note: "Compared with today's date" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#66786F", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#33433B" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#9AABA2" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      {!canManage && !demoMode && (
        <div style={{ backgroundColor: "#EEF2F0", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#66786F" }}>
          Your role can view the calendar. Only an Administrator or Accountant can record items or change their status.
        </div>
      )}

      <ObligationCalendar rows={displayRows} today={today} />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B" }}>All the obligations</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F8F6" }}>
                {["Obligation", "Period", "Due date", "Estimate", "Status", "Notes", "Actions", ...(showActions ? [""] : [])].map((header) => (
                  <th key={header} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const overdue = row.status === "pending" && row.due_date < today;
                const style = obligationBadgeStyle(row.status);
                return (
                  <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#33433B" }}>
                      {row.name}
                      {overdue && <span style={{ display: "block", fontSize: 10, color: "#B3261E", fontWeight: 700 }}>Overdue by recorded date</span>}
                    </td>
                    <td style={{ padding: "12px 14px", color: "#66786F" }}>{row.period || "—"}</td>
                    <td style={{ padding: "12px 14px", color: overdue ? "#B3261E" : "#33433B", fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>{fmtDate(row.due_date)}</td>
                    <td style={{ padding: "12px 14px", color: row.estimated_amount ? "#33433B" : "#C9A227", fontWeight: 600 }}>{row.estimated_amount ? fmt(num(row.estimated_amount)) : "To be defined"}</td>
                    <td style={{ padding: "12px 14px" }}><Badge label={obligationStatusLabel(row.status)} {...style} /></td>
                    <td style={{ padding: "12px 14px", color: "#66786F", fontSize: 12, maxWidth: 220 }}>{row.notes || "—"}</td>
                    <td style={{ padding: "12px 14px" }}>
                      {row.status === "paid" || row.status === "void" ? (
                        <span style={{ fontSize: 11, color: "#9AABA2" }}>No actions</span>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {row.status === "pending" && (
                            <button onClick={() => changeStatus(row, "filed")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#24714D", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                              File
                            </button>
                          )}
                          <button onClick={() => changeStatus(row, "paid")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                            Pay
                          </button>
                          <button onClick={() => changeStatus(row, "void")} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#66786F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: busyId === row.id ? 0.5 : 1 }}>
                            Void
                          </button>
                        </div>
                      )}
                    </td>
                    {showActions && (
                      <td style={{ padding: "12px 14px" }}>
                        <RowActions label={row.name} onEdit={() => openEdit(row)} onDelete={() => { setDeleteError(null); setToDelete(row); }} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>
                    No obligations recorded for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
          Changing the status does not file returns or make payments. It is an internal follow-up record.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>{editing ? "Edit obligation" : "Record obligation"}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
            </div>

            {formError && <InlineError message={formError} />}

            <Field label="Obligation name *">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Bimonthly VAT" style={inputStyle} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Period">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="Sep-Oct 2026" style={inputStyle} />
              </Field>
              <Field label="Due date *">
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
              <Btn variant="primary" onClick={save} fullWidth disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save obligation"}</Btn>
            </div>
          </div>
        </div>
      )}

      {showTemplate && <ObligationTemplateModal onCreate={createFromTemplate} onClose={() => setShowTemplate(false)} />}

      {toDelete && (
        <ConfirmDialog
          title="Delete this obligation?"
          detail={`${toDelete.name} · ${toDelete.period || "—"} · ${fmtDate(toDelete.due_date)}`}
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
};
