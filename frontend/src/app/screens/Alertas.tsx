import { useEffect, useState } from "react";
import {
  Clock, CheckCircle, AlertCircle, X, Plus, Eye, ArrowLeft, Info, MessageSquare, ExternalLink,
} from "lucide-react";
import { MlBadge } from "../ui";
import { Btn, Card, Field, InlineError, SectionHeader, errorMessage, fmtDate, inputStyle } from "../ui";
import {
  addAlertComment, createAlert, evaluateAlerts, getAlert, listAlerts, updateAlert,
  type Alert as ApiAlert, 
} from "../../api/fiscal.api";
import {
  ALERTAS_DATA, type AlertOrigin, type AlertPriority, type AlertStatus, alertStatusUi, PriorityBadge,
  type Screen, StatusBadge,
} from "../shared";

// ALERTAS
export const DEMO_ALERTS: ApiAlert[] = ALERTAS_DATA.map((alert) => ({
  id: alert.id,
  title: alert.titulo,
  description: alert.desc,
  priority: alert.prioridad,
  origin: alert.origen,
  status: alert.estado === "revisada" ? "reviewed" : alert.estado === "en-revision" ? "in_review" : "pending",
  due_date: null,
  created_at: `2026-10-${String(19 - alert.id).padStart(2, "0")}T09:00:00Z`,
}));

export const ALERT_ORIGIN_LABEL: Record<string, string> = {
  erp: "ERP data",
  plan: "Comparison with the plan",
  proyeccion: "Estimated forecast",
  configuracion: "Configuration pending",
};

export const AlertasScreen = ({
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

      <div style={{ backgroundColor: "#EDF7F0", border: "1px solid #9CCDB1", borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: "#24714D", display: "flex", gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>These alerts are internal planning notices. They do not predict penalties or DIAN actions.</span>
      </div>

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading alerts…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["todas", "pendiente", "en-revision", "revisada"] as const).map((option) => (
          <button key={option} onClick={() => setFilter(option)} style={{ padding: "8px 16px", borderRadius: 20, border: filter === option ? "none" : "1px solid #D3DDD8", backgroundColor: filter === option ? "#1B5E3F" : "#fff", color: filter === option ? "#fff" : "#66786F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {option === "todas" ? `All (${source.length})` : option === "pendiente" ? "Pending" : option === "en-revision" ? "In review" : "Resolved"}
          </button>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F8F6" }}>
                {["Title", "Priority", "Origin", "Date", "Status", "Action"].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((alert, index) => (
                <tr key={alert.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#33433B", maxWidth: 320 }}>{alert.title}</td>
                  <td style={{ padding: "12px 14px" }}><PriorityBadge p={alert.priority} /></td>
                  <td style={{ padding: "12px 14px", fontSize: 12, color: "#66786F" }}>
                    {alert.origin === "proyeccion" ? <MlBadge size="sm" detail="Rule of the ERP applied to the model forecast" /> : null}{" "}
                    {alert.origin_label ?? ALERT_ORIGIN_LABEL[alert.origin] ?? alert.origin}
                  </td>
                  <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{fmtDate(alert.created_at)}</td>
                  <td style={{ padding: "12px 14px" }}><StatusBadge s={alertStatusUi(alert.status)} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <button onClick={() => onViewDetail(alert.id)} style={{ background: "none", border: "none", color: "#1B5E3F", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontFamily: "inherit" }}>
                        <Eye size={13} /> View
                      </button>
                      {alert.action && (
                        <button onClick={() => onNav(alert.action!.screen as Screen)} style={{ background: "none", border: "none", color: "#24714D", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          {alert.action.label}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>
                    No alerts match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
          Marking an alert as reviewed does not change amounts, reserves or estimates.
        </div>
      </Card>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: 0 }}>New follow-up alert</h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#66786F" }}><X size={18} /></button>
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
export type AlertCommentRow = { id: number; body: string; user_id: number | null; created_at: string };

export const AlertaDetalleScreen = ({
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
          <AlertCircle size={40} color="#B3261E" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#33433B" }}>Alert not found</div>
          <p style={{ fontSize: 12, color: "#66786F" }}>{error ?? "The alert does not exist or does not belong to this company."}</p>
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
        {loading && <div style={{ marginBottom: 12, fontSize: 12, color: "#66786F" }}>Loading alert…</div>}
        {displayed && (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1B5E3F", margin: "0 0 8px" }}>{displayed.title}</h1>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <PriorityBadge p={displayed.priority} />
                <StatusBadge s={alertStatusUi(displayedStatus)} />
                <span style={{ fontSize: 12, color: "#66786F" }}>{fmtDate(displayed.created_at)} · {companyName}</span>
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
              <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B", marginBottom: 12 }}>Description</div>
              <p style={{ fontSize: 14, color: "#33433B", lineHeight: 1.7, margin: 0, whiteSpace: "pre-line" }}>{displayed.description || "No description recorded."}</p>
            </Card>

            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B", marginBottom: 12 }}>Review suggestion</div>
              <div style={{ backgroundColor: "#F5F8F6", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#33433B", lineHeight: 1.7 }}>
                Check the related record, document the decision in a comment and confirm with the accountant when needed. Marking the alert as reviewed does not change amounts, reserves or estimates.
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B", marginBottom: 16 }}>Comment history</div>
              {displayedComments.length === 0 && (
                <div style={{ fontSize: 12, color: "#66786F", marginBottom: 12 }}>No comments recorded yet.</div>
              )}
              {displayedComments.map((item) => (
                <div key={item.id} style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#1B5E3F", flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <div style={{ fontSize: 11, color: "#66786F" }}>{fmtDate(item.created_at)}</div>
                    <div style={{ fontSize: 13, color: "#33433B", marginTop: 2 }}>{item.body}</div>
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
                <Btn variant="primary" icon={<MessageSquare size={13} />} onClick={postComment}>{posting ? "Saving…" : "Add"}</Btn>
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card style={{ padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#33433B", marginBottom: 14 }}>Actions</div>
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
                    style={{ padding: "10px 14px", borderRadius: 9, border: "1.5px solid #1B5E3F", backgroundColor: "#E3F1E8", color: "#1B5E3F", fontSize: 13, fontWeight: 600, cursor: statusBusy ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <CheckCircle size={13} /> {statusBusy ? "Saving…" : "Mark as resolved"}
                  </button>
                )}
                {displayedStatus === "reviewed" && (
                  <div style={{ backgroundColor: "#E3F1E8", border: "1px solid #9CCDB1", borderRadius: 9, padding: "10px 14px", fontSize: 12, color: "#1B5E3F", fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                    <CheckCircle size={13} /> Alert resolved
                  </div>
                )}
              </div>
              {displayedStatus === "reviewed" && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#66786F", lineHeight: 1.5 }}>
                  Marking as resolved does not change amounts, reserves or estimates. The alert stays in the history.
                </div>
              )}
              {!canManage && !demoMode && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#9AABA2", lineHeight: 1.5 }}>
                  Only an Administrator or Accountant can change the status.
                </div>
              )}
            </Card>

            <Card style={{ padding: "18px 20px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#33433B", marginBottom: 10 }}>Information</div>
              {[
                { label: "Company", value: companyName },
                { label: "Origin", value: displayed.origin_label ?? ALERT_ORIGIN_LABEL[displayed.origin] ?? displayed.origin },
                { label: "Priority", value: ({ alta: "High", media: "Medium", baja: "Low" } as Record<string, string>)[displayed.priority] ?? displayed.priority },
                { label: "Created", value: fmtDate(displayed.created_at) },
                { label: "Due date", value: displayed.due_date ? fmtDate(displayed.due_date) : "Not recorded" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 10, color: "#9AABA2" }}>{row.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#33433B", textTransform: row.label === "Priority" ? "capitalize" : undefined }}>{row.value}</div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
