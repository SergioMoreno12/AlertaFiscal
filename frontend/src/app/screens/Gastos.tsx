import { useEffect, useState } from "react";
import { CheckCircle, X, Plus, Download, Info } from "lucide-react";
import { ConfirmDialog, RowActions } from "../Records";
import {
  Badge, Btn, Card, Field, InlineError, SectionHeader, errorMessage, fmt, fmtDate, inputStyle, num,
  todayISO,
} from "../ui";
import {
  createExpense, deleteExpense, listCounterparties, listExpenses, updateExpense, type Counterparty,
  type Expense, type Pagination,
} from "../../api/fiscal.api";
import { DemoBanner, downloadCsv, GASTOS_TABLE, Pager, toMoneyString } from "../shared";

// GASTOS
export type ExpenseDisplayRow = {
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

export const DEMO_EXPENSE_ROWS: ExpenseDisplayRow[] = GASTOS_TABLE.map((row) => ({
  id: row.id,
  date: row.fecha,
  party: row.proveedor,
  doc: row.doc,
  category: row.cat,
  description: "Operating purchase",
  subtotal: row.base,
  tax: row.iva,
  total: row.total,
  paid: row.pago === "Paid",
  reviewed: row.revision === "Reviewed",
}));

export const GastosScreen = ({
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
  const [rows, setRows] = useState<Expense[]>([]);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toDelete, setToDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const showActions = !demoMode && canManage;
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
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (row: Expense) => {
    setForm({
      doc_number: row.doc_number,
      issue_date: row.issue_date,
      party: "",
      counterparty_id: row.counterparty_id ? String(row.counterparty_id) : "",
      category: row.category || "Other",
      description: row.description,
      subtotal: String(num(row.subtotal)),
      tax_amount: String(num(row.tax_amount)),
      status: row.status === "paid" ? "paid" : "pending",
    });
    setFormError(null);
    setConfirmed(false);
    setEditing(row);
    setShowForm(true);
  };

  const confirmDelete = async () => {
    if (!companyId || !toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteExpense(companyId, toDelete.id);
      setToDelete(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
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
          description: form.description || "Recorded purchase",
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
      const payload = {
        doc_number: form.doc_number.trim(),
        issue_date: form.issue_date,
        category: form.category,
        description: form.description.trim(),
        counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null,
        subtotal,
        tax_amount: tax,
        total,
        status: form.status,
      };
      if (editing) await updateExpense(companyId, editing.id, payload);
      else await createExpense(companyId, payload);
      setConfirmed(true);
      if (!editing) setPage(1);
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

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading expenses…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded total (base)", value: fmt(baseTotal), note: demoMode ? "Sum of the listed records" : "Sum of the records on this page", color: "#33433B" },
          { label: "Recorded deductible VAT", value: fmt(taxTotal), note: "Record summary", color: "#33433B" },
          { label: "Expenses to review", value: `${demoMode ? pendingReview : unreviewedTotal ?? pendingReview} records`, note: "Pending accounting review (all pages)", color: "#8A6400" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#66786F", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#9AABA2" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#8A6400", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> Recording an expense does not make it deductible. The accountant must review the classification.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B" }}>Expense records</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F8F6" }}>
                {["Date", "Supplier", "Document", "Category", "Description", "VAT base", "VAT", "Total", "Payment", "Review", ""].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", whiteSpace: "nowrap", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                  <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{row.date}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#33433B" }}>{row.party}</td>
                  <td style={{ padding: "12px 14px", color: "#66786F", fontFamily: "monospace", fontSize: 12 }}>{row.doc}</td>
                  <td style={{ padding: "12px 14px", color: "#33433B" }}>{row.category}</td>
                  <td style={{ padding: "12px 14px", color: "#66786F" }}>{row.description}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{fmt(row.subtotal)}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", color: "#66786F" }}>{row.tax > 0 ? fmt(row.tax) : "—"}</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: "#33433B" }}>{fmt(row.total)}</td>
                  <td style={{ padding: "12px 14px" }}><Badge label={row.paid ? "Paid" : "Pending"} color={row.paid ? "#1B5E3F" : "#8A6400"} bg={row.paid ? "#E3F1E8" : "#FBF4E2"} border={row.paid ? "#9CCDB1" : "#E9D49C"} /></td>
                  <td style={{ padding: "12px 14px" }}><Badge label={row.reviewed ? "Reviewed" : "To review"} color={row.reviewed ? "#1B5E3F" : "#66786F"} bg={row.reviewed ? "#E3F1E8" : "#EEF2F0"} border={row.reviewed ? "#9CCDB1" : "#D3DDD8"} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <button onClick={() => toggleReviewed(row)} disabled={busyId === row.id} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: busyId === row.id ? 0.5 : 1 }}>
                      {row.reviewed ? "Reopen" : "Review"}
                    </button>
                    {showActions && !row.doc.startsWith("MONTH-") && (() => {
                      const raw = rows.find((item) => item.id === row.id);
                      return raw ? <span style={{ marginLeft: 8 }}><RowActions label={row.doc} onEdit={raw.status === "void" ? undefined : () => openEdit(raw)} onDelete={() => { setDeleteError(null); setToDelete(raw); }} /></span> : null;
                    })()}
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>
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
                <CheckCircle size={48} color="#2E8A5C" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: "0 0 8px" }}>{editing ? "Changes saved" : "Expense recorded"}</h3>
                <p style={{ fontSize: 13, color: "#66786F", marginBottom: 16 }}>
                  {demoMode ? "The expense was recorded only in this demo view." : editing ? "The expense record was updated." : "The expense was recorded. Pending accounting review."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Close</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>{editing ? "Edit expense" : "Record expense or purchase"}</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
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
                  <div style={{ ...inputStyle, backgroundColor: "#F5F8F6", fontWeight: 700, color: "#33433B" }}>{fmt(totalPreview)}</div>
                </Field>

                <div style={{ backgroundColor: "#FBF4E2", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#8A6400" }}>
                  A record pending review is not included in tax estimates until the accountant reviews it.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="ghost" onClick={() => setShowForm(false)} fullWidth>Cancel</Btn>
                  <Btn variant="primary" onClick={save} fullWidth disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save record"}</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete this expense record?"
          detail={`${toDelete.doc_number} · ${fmtDate(toDelete.issue_date)} · ${fmt(num(toDelete.total))}`}
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
};
