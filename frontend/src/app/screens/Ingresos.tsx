import { useEffect, useState } from "react";
import { CheckCircle, X, Plus, Download, Info } from "lucide-react";
import { ConfirmDialog, RowActions } from "../Records";
import {
  Badge, Btn, Card, Field, InlineError, SectionHeader, errorMessage, fmt, fmtDate, inputStyle, num,
  todayISO,
} from "../ui";
import {
  createIncome, deleteIncome, listCounterparties, listIncome, updateIncome, type Counterparty,
  type Income, type Pagination,
} from "../../api/fiscal.api";
import { DemoBanner, downloadCsv, INGRESOS_TABLE, Pager, toMoneyString } from "../shared";

// INGRESOS
export type IncomeDisplayRow = {
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

export const DEMO_INCOME_ROWS: IncomeDisplayRow[] = INGRESOS_TABLE.map((row) => ({
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

export const IngresosScreen = ({
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
  const [rows, setRows] = useState<Income[]>([]);
  const [editing, setEditing] = useState<Income | null>(null);
  const [toDelete, setToDelete] = useState<Income | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const showActions = !demoMode && canManage;
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
      ? { color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" }
      : status === "Void"
        ? { color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" }
        : { color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" };

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
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (row: Income) => {
    setForm({
      doc_number: row.doc_number,
      issue_date: row.issue_date,
      party: "",
      counterparty_id: row.counterparty_id ? String(row.counterparty_id) : "",
      description: row.description,
      subtotal: String(num(row.subtotal)),
      tax_amount: String(num(row.tax_amount)),
      status: row.status === "collected" ? "collected" : "pending",
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
      await deleteIncome(companyId, toDelete.id);
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
      const payload = {
        doc_number: form.doc_number.trim(),
        issue_date: form.issue_date,
        description: form.description.trim(),
        counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null,
        subtotal,
        tax_amount: tax,
        total,
        status: form.status,
      };
      if (editing) await updateIncome(companyId, editing.id, payload);
      else await createIncome(companyId, payload);
      setConfirmed(true);
      if (!editing) setPage(1);
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

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading income…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Recorded total (base)", value: fmt(baseTotal), note: demoMode ? "Sum of the listed records" : "Sum of the records on this page" },
          { label: "Recorded VAT generated", value: fmt(taxTotal), note: "Record summary" },
          { label: "Recorded sales", value: `${demoMode ? displayRows.length : pageInfo?.total ?? displayRows.length} sales`, note: demoMode ? "Sample data" : "All the records of the company" },
        ].map((item) => (
          <Card key={item.label} style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#66786F", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1B5E3F" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "#9AABA2" }}>{item.note}</div>
          </Card>
        ))}
      </div>

      <div style={{ backgroundColor: "#E3F1E8", border: "1px solid #9CCDB1", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#1B5E3F", display: "flex", gap: 8, alignItems: "center" }}>
        <Info size={14} /> VAT generated {fmt(taxTotal)}. This is a summary of records, not an official VAT assessment.
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: "#33433B" }}>Sales records</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F8F6" }}>
                {["Date", "Client", "Document", "Description", "VAT base", "VAT", "Total", "Collection status", ...(showActions ? [""] : [])].map((header) => (
                  <th key={header} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", whiteSpace: "nowrap", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const style = statusStyle(row.status);
                return (
                  <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                    <td style={{ padding: "13px 16px", color: "#66786F", whiteSpace: "nowrap" }}>{row.date}</td>
                    <td style={{ padding: "13px 16px", fontWeight: 600, color: "#33433B" }}>{row.party}</td>
                    <td style={{ padding: "13px 16px", color: "#66786F", fontFamily: "monospace", fontSize: 12 }}>{row.doc}</td>
                    <td style={{ padding: "13px 16px", color: "#33433B" }}>{row.description}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", color: "#33433B" }}>{fmt(row.subtotal)}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", color: "#66786F" }}>{fmt(row.tax)}</td>
                    <td style={{ padding: "13px 16px", textAlign: "right", fontWeight: 700, color: "#1B5E3F" }}>{fmt(row.total)}</td>
                    <td style={{ padding: "13px 16px" }}><Badge label={row.status} color={style.color} bg={style.bg} border={style.border} /></td>
                    {showActions && (
                      <td style={{ padding: "13px 16px" }}>
                        {row.doc.startsWith("MONTH-")
                          ? <span style={{ fontSize: 11, color: "#9AABA2", whiteSpace: "nowrap" }}>In Monthly data</span>
                          : (() => {
                              const raw = rows.find((item) => item.id === row.id);
                              return raw ? <RowActions label={row.doc} onEdit={raw.status === "void" ? undefined : () => openEdit(raw)} onDelete={() => { setDeleteError(null); setToDelete(raw); }} /> : null;
                            })()}
                      </td>
                    )}
                  </tr>
                );
              })}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>
                    No income recorded for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!demoMode && <Pager info={pageInfo} onPage={setPage} noun="sales" />}
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
          Recorded sales do not mean the money was collected. The collection status is reported by the user.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            {confirmed ? (
              <div style={{ textAlign: "center" }}>
                <CheckCircle size={48} color="#2E8A5C" style={{ margin: "0 auto 16px" }} />
                <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: "0 0 8px" }}>{editing ? "Changes saved" : "Record confirmed"}</h3>
                <p style={{ fontSize: 13, color: "#66786F" }}>
                  {demoMode ? "The income was recorded only in this demo view." : editing ? "The income record was updated." : "The income was recorded in the database."}
                </p>
                {demoMode && <DemoBanner />}
                <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => setShowForm(false)} fullWidth>Close</Btn></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>{editing ? "Edit income" : "Record income or sale"}</h3>
                  <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
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
                    <div style={{ ...inputStyle, backgroundColor: "#F5F8F6", fontWeight: 700, color: "#1B5E3F" }}>{fmt(totalPreview)}</div>
                  </Field>
                </div>

                <div style={{ backgroundColor: "#FBF4E2", borderRadius: 8, padding: "10px 12px", marginBottom: 20, fontSize: 11, color: "#8A6400" }}>
                  This record does not create official tax documents. It is not certified electronic invoicing.
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
          title="Delete this income record?"
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
