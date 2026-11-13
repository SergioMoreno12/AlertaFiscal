import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { MlBadge, MlNote } from "../ui";
import { Badge, Btn, Card, InlineError, SectionHeader, errorMessage, fmt, fmtDate, num } from "../ui";
import {
  getPlan, getMonitoring, listAudit, listForecasts, listPlans, type AuditEvent, type MonitoringStatus,
  type MonitoringView, type ForecastRun, type PlanDetail,
} from "../../api/fiscal.api";

// HISTORIAL
export const DEMO_PLAN_DETAILS: PlanDetail[] = [
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

export const DEMO_FORECAST_RUNS: ForecastRun[] = [
  { id: 3, method: "promedio_manual", horizon_months: 3, cutoff_date: "2026-10-19", projected_income: "165000000.00", projected_expenses: "111000000.00", model_version: null, created_at: "2026-10-19T09:00:00Z" },
  { id: 2, method: "promedio_manual", horizon_months: 3, cutoff_date: "2026-09-30", projected_income: "156000000.00", projected_expenses: "108000000.00", model_version: null, created_at: "2026-09-30T09:00:00Z" },
];

export const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  { id: 5, action: "plan.review", resource: "plan:2", detail: { version: 1 }, actor_id: 1, request_id: null, created_at: "2026-09-30T10:00:00Z" },
  { id: 4, action: "plan.create", resource: "plan:2", detail: {}, actor_id: 1, request_id: null, created_at: "2026-09-28T09:00:00Z" },
  { id: 3, action: "expense.update", resource: "expense:14", detail: { reviewed: true }, actor_id: 1, request_id: null, created_at: "2026-09-27T15:00:00Z" },
];

export const planVersionUi = (status: string) => {
  if (status === "reviewed") return { label: "Reviewed", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" };
  if (status === "archived") return { label: "Archived", color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" };
  return { label: "Draft", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" };
};

export const forecastMethodLabel = (run: ForecastRun) =>
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

export const monitoringUi = (status: MonitoringStatus) =>
  ({
    pending: { label: "Pending", color: "#66786F", bg: "#EEF2F0", border: "#D3DDD8" },
    normal: { label: "Normal", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" },
    watch: { label: "Watch", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" },
    degraded: { label: "Degraded", color: "#B3261E", bg: "#FBECEA", border: "#E8A9A2" },
  })[status];

export const MonitoringPanel = ({ view, error, demoMode }: { view: MonitoringView | null; error: string | null; demoMode: boolean }) => {
  if (demoMode) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: "#66786F" }}>
          Monitoring compares stored model forecasts with the real values registered in the ERP, so it is only shown with live data.
        </div>
      </Card>
    );
  }
  if (error) return <InlineError message={error} />;
  if (!view) return <div style={{ fontSize: 12, color: "#66786F" }}>Loading monitoring…</div>;
  const overall = monitoringUi(view.status);
  const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)} %`);
  return (
    <>
      <MlNote>Monitoring compares each month the model forecast with the real value you recorded once the month closes.</MlNote>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#66786F", marginBottom: 8 }}>OVERALL STATUS</div>
          <Badge label={overall.label} color={overall.color} bg={overall.bg} border={overall.border} />
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 10 }}>
            Model {view.model_version ?? "—"}
            {view.last_forecast_at && <span style={{ display: "block" }}>Last forecast {fmtDate(view.last_forecast_at)}</span>}
          </div>
          {view.inputs_changed_since_training && (
            <div style={{ fontSize: 11, color: "#8A6400", marginTop: 8 }}>The company data changed after the model was trained.</div>
          )}
        </Card>
        {(["income", "expenses"] as const).map((target) => {
          const item = view.targets[target];
          const ui = monitoringUi(item.status);
          return (
            <Card key={target}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#66786F", marginBottom: 8 }}>{target === "income" ? "INCOME" : "EXPENSES"}</div>
              <Badge label={ui.label} color={ui.color} bg={ui.bg} border={ui.border} />
              <div style={{ fontSize: 12, color: "#33433B", marginTop: 10 }}>
                Rolling error {pct(item.rolling_normalized_error_pct)} · reference {pct(item.reference_normalized_error_pct)}
              </div>
              <div style={{ fontSize: 11, color: "#66786F", marginTop: 4 }}>
                {item.months_used.length > 0 ? `Months used: ${item.months_used.join(", ")}` : "No resolved months yet"}
                {item.pending_months.length > 0 && (
                  <span style={{ display: "block" }}>Waiting for actual values: {item.pending_months.length} months</span>
                )}
              </div>
            </Card>
          );
        })}
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#66786F", marginBottom: 8 }}>FORECAST SERVICE</div>
          <div style={{ fontSize: 12, color: "#33433B" }}>{view.operations.requests} requests</div>
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 4 }}>
            {Object.entries(view.operations.outcomes).map(([outcome, count]) => `${outcome}: ${count}`).join(" · ") || "No requests yet"}
          </div>
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 4 }}>
            Latency p50 {view.operations.latency_ms.p50 ?? "—"} ms · p95 {view.operations.latency_ms.p95 ?? "—"} ms
          </div>
        </Card>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#F5F8F6" }}>
                {["Month", "Target", "Step", "Predicted", "Actual", "Error", "Normalized error", "Status"].map((header) => (
                  <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row, index) => {
                const ui = monitoringUi(row.status);
                return (
                  <tr key={`${row.forecast_run_id}-${row.target}-${row.forecast_month}`} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                    <td style={{ padding: "12px 14px", color: "#33433B", whiteSpace: "nowrap" }}>{row.forecast_month}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F" }}>{row.target === "income" ? "Income" : "Expenses"}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F" }}>{row.horizon_step}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(row.predicted_value))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{row.actual_value === null ? "—" : fmt(num(row.actual_value))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{row.absolute_error === null ? "—" : fmt(num(row.absolute_error))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{pct(row.normalized_error_pct)}</td>
                    <td style={{ padding: "12px 14px" }}><Badge label={ui.label} color={ui.color} bg={ui.bg} border={ui.border} /></td>
                  </tr>
                );
              })}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>
                    No model forecasts to monitor yet. Run a model forecast first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
          The error is normalized by the mean monthly income of the forecast history and compared with the Phase 4 reference
          ({view.reference}). Normal: {view.thresholds.normal}; watch: {view.thresholds.watch}; degraded: {view.thresholds.degraded}.
          The status uses the last {view.thresholds.rolling_months} resolved months. A month stays pending until it is closed and its
          real values are registered.
        </div>
      </Card>
    </>
  );
};

export const HistorialScreen = ({
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

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading history…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["planes", "proyecciones", "monitoring", "seguimiento"] as const).map((option) => (
          <button key={option} onClick={() => setTab(option)} style={{ padding: "9px 18px", borderRadius: 9, border: tab === option ? "none" : "1.5px solid #D3DDD8", backgroundColor: tab === option ? "#1B5E3F" : "#fff", color: tab === option ? "#fff" : "#66786F", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
            {({ planes: "Plans", proyecciones: "Forecasts", monitoring: "Monitoring", seguimiento: "Audit" } as Record<string, string>)[option] ?? option}
          </button>
        ))}
      </div>

      {tab === "planes" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F8F6" }}>
                  {["Plan", "Period", "Version", "Status", "Projected income", "Projected expenses", "Reserve target", "Created"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versionRows.map(({ plan, version }, index) => {
                  const style = planVersionUi(version.status);
                  return (
                    <tr key={`${plan.id}-${version.id}`} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "#33433B" }}>
                        {plan.name}
                        {version.notes && <span style={{ display: "block", fontSize: 10, color: "#9AABA2", fontWeight: 400 }}>{version.notes}</span>}
                      </td>
                      <td style={{ padding: "12px 14px", color: "#66786F" }}>{plan.period}</td>
                      <td style={{ padding: "12px 14px", fontWeight: 700, color: "#1B5E3F" }}>v{version.version}</td>
                      <td style={{ padding: "12px 14px" }}><Badge label={style.label} color={style.color} bg={style.bg} border={style.border} /></td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(version.projected_income))}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(version.projected_expenses))}</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: "#24714D" }}>{fmt(num(version.estimated_reserve))}</td>
                      <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{fmtDate(version.created_at)}</td>
                    </tr>
                  );
                })}
                {versionRows.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>No plan versions recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
            Reviewed versions are kept read-only. Saving a new version does not overwrite the previous ones.
          </div>
        </Card>
      )}

      {tab === "proyecciones" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F8F6" }}>
                  {["Date", "Method", "Horizon", "Projected income", "Projected expenses", "Cutoff", "Model"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedForecasts.map((run, index) => (
                  <tr key={run.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                    <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{fmtDate(run.created_at)}</td>
                    <td style={{ padding: "12px 14px", color: "#33433B" }}>{forecastMethodLabel(run)} {run.model_version && <MlBadge size="sm" />}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F" }}>{run.horizon_months} months</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#1B5E3F", fontWeight: 600 }}>{fmt(num(run.projected_income))}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(run.projected_expenses))}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{fmtDate(run.cutoff_date)}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F", fontSize: 12 }}>
                      {run.model_version ?? "No trained model"}
                      {run.trained_at && <span style={{ display: "block", fontSize: 10, color: "#9AABA2" }}>Trained {fmtDate(run.trained_at)}</span>}
                    </td>
                  </tr>
                ))}
                {displayedForecasts.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>No forecasts recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 24px", fontSize: 11, color: "#66786F", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
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
            <div style={{ padding: "16px 24px", backgroundColor: "#FBF4E2", borderBottom: "1px solid #E9D49C", fontSize: 12, color: "#8A6400" }}>
              The audit history requires the Accountant or Company administrator role.
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "#F5F8F6" }}>
                  {["Date", "Action", "Resource", "Actor", "Detail"].map((header) => (
                    <th key={header} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedAudit.map((event, index) => (
                  <tr key={event.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                    <td style={{ padding: "12px 14px", color: "#66786F", whiteSpace: "nowrap" }}>{fmtDate(event.created_at)}</td>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "#33433B", fontFamily: "monospace", fontSize: 12 }}>{event.action}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F", fontFamily: "monospace", fontSize: 12 }}>{event.resource}</td>
                    <td style={{ padding: "12px 14px", color: "#66786F" }}>{event.actor_name ?? (event.actor_id ? `User #${event.actor_id}` : "System")}</td>
                    <td style={{ padding: "12px 14px", color: "#9AABA2", fontSize: 11, maxWidth: 280 }}>{Object.keys(event.detail).length > 0 ? JSON.stringify(event.detail) : "—"}</td>
                  </tr>
                ))}
                {displayedAudit.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "28px 24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>{auditAvailable ? "No audit events recorded." : "Your role has no access to the audit history."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
