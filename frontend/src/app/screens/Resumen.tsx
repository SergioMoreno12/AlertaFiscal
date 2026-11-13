import { useEffect, useState } from "react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import {
  ShoppingCart, TrendingUp, Calculator, AlertTriangle, ChevronRight, CheckCircle, RefreshCw, Info,
  BarChart2,
} from "lucide-react";
import { MlBadge } from "../ui";
import { Btn, Card, SectionHeader, errorMessage, fmt, fmtDate, fmtM, num, shortMonth } from "../ui";
import { uiLocale } from "../../i18n";
import {
  evaluateAlerts, getDashboard, getMonthlyTotals, listAlerts, listObligations, type Alert as ApiAlert,
  type Dashboard, 
} from "../../api/fiscal.api";
import {
  ALERTAS_DATA, type AlertPriority, alertStatusUi, HISTORICO, OBLIGACIONES_DATA, type Screen,
  StatusBadge,
} from "../shared";
import { ALERT_ORIGIN_LABEL } from "./Alertas";

// RESUMEN
export const ResumenScreen = ({
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
  const [setup, setSetup] = useState<{ closedMonths: number | null; obligations: number | null }>({ closedMonths: null, obligations: null });
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
    // Evaluating rules is an explicit action: the dashboard GET never writes
    // alerts. If the role cannot evaluate, the existing state is shown.
    evaluateAlerts(companyId)
      .catch(() => null)
      .then(() => Promise.all([
        getDashboard(companyId),
        listAlerts(companyId),
        // Only used by the first-steps list: a failure here must not hide the overview.
        getMonthlyTotals(companyId).then((data) => data.closed_months).catch(() => null),
        listObligations(companyId).then((data) => data.items.length).catch(() => null),
      ]))
      .then(([summary, alerts, closedMonths, obligations]) => {
        if (!alive) return;
        setDashboard(summary);
        setApiAlerts(alerts.items.slice(0, 3));
        setSetup({ closedMonths, obligations });
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

  // First steps of a new company, in the order the app is meant to be used.
  const closedMonths = setup.closedMonths ?? dashboard?.monthly.length ?? 0;
  const firstSteps: Array<{ title: string; detail: string; action: string; screen: Screen; done: boolean }> = [
    { title: "Load the history of the company", detail: `${Math.min(closedMonths, 6)} of 6 closed months recorded. The model needs at least 6.`, action: "Enter monthly data", screen: "datos", done: closedMonths >= 6 },
    { title: "Generate the forecast", detail: "The model estimates the income and expenses of the next 6 months.", action: "Go to forecasts", screen: "proyecciones", done: Boolean(latestForecast) },
    { title: "Create the reserve plan", detail: "Start from the forecast and set how much to set aside for taxes.", action: "Go to tax planning", screen: "planificacion", done: Boolean(plan) },
    { title: "Record the tax obligations", detail: "Write down the due dates you want to follow up.", action: "Go to obligations", screen: "obligaciones", done: (setup.obligations ?? dashboard?.obligations.length ?? 0) > 0 },
  ];
  const stepsDone = firstSteps.filter((item) => item.done).length;
  const nextStep = firstSteps.findIndex((item) => !item.done);

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
        actionLabel: "View alert",
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
            actionLabel: alert.action?.label ?? "View alert",
            screen: (alert.action?.screen ?? "alertas") as Screen,
          })));

  const obligationItems = demoMode
    ? OBLIGACIONES_DATA.filter((o) => o.presentacion === "Pending").slice(0, 4).map((o) => ({
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
        estimado: item.estimated_amount ? fmt(num(item.estimated_amount)) : "To be defined",
        fuente: `Period ${item.period || "not set"}`,
      }));

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader title="Overview" subtitle={`${companyName} · Cutoff: ${new Date().toLocaleDateString(uiLocale())}`}
        actions={
          <>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Refresh</Btn>
            <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onNav("planificacion")}>View planning</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading company data…</div>}
      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, backgroundColor: "#FBECEA", border: "1px solid #F2C9C4", color: "#B3261E", fontSize: 12 }}>
          {error} · <button onClick={() => setReloadKey((key) => key + 1)} style={{ border: "none", background: "none", color: "#B3261E", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Retry</button>
        </div>
      )}

      {dashboard && firstSteps.some((item) => !item.done) && (
        <Card style={{ marginBottom: 24, border: "1.5px solid #C8E4D3", background: "linear-gradient(135deg, #F2F8F4, #FFFFFF)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#1E2B25" }}>First steps</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1B5E3F" }}>{`${stepsDone} of ${firstSteps.length} done`}</div>
          </div>
          <div style={{ height: 6, borderRadius: 99, backgroundColor: "#E3F1E8", overflow: "hidden", margin: "10px 0 6px" }}>
            <div style={{ width: `${(stepsDone / firstSteps.length) * 100}%`, height: "100%", backgroundColor: "#1B5E3F", transition: "width .3s" }} />
          </div>
          {firstSteps.map((item, index) => {
            const isNext = index === nextStep;
            return (
              <div key={item.title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: index ? "1px solid #E6EEE9" : "none", flexWrap: "wrap" }}>
                <div aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, backgroundColor: item.done ? "#1B5E3F" : isNext ? "#E3F1E8" : "#F0F4F2", color: item.done ? "#fff" : isNext ? "#1B5E3F" : "#9AABA2", border: isNext ? "1.5px solid #1B5E3F" : "none" }}>
                  {item.done ? <CheckCircle size={15} /> : index + 1}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: item.done ? "#66786F" : "#1E2B25", textDecoration: item.done ? "line-through" : "none" }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "#66786F", marginTop: 2 }}>{item.detail}</div>
                </div>
                {item.done
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: "#1B5E3F" }}>Done</span>
                  : <Btn small variant={isNext ? "primary" : "ghost"} onClick={() => onNav(item.screen)}>{item.action} <ChevronRight size={12} /></Btn>}
              </div>
            );
          })}
        </Card>
      )}

      {/* KPI Row */}
      <div className="af-kpi-grid">
        {[
          { label: "Recorded income", value: fmtM(income), sub: demoMode ? "Records of the current period" : "Year to date", color: "#1B5E3F", bg: "#E3F1E8", icon: <TrendingUp size={18} color="#1B5E3F" />, note: "Observed" },
          { label: "Recorded expenses", value: fmtM(expenses), sub: demoMode ? "Records of the current period" : "Year to date", color: "#33433B", bg: "#EEF2F0", icon: <ShoppingCart size={18} color="#33433B" />, note: "Observed" },
          { label: "Projected income", value: plan || demoMode ? fmtM(projectedIncome) : "—", sub: plan ? `${plan.name} · v${plan.version}` : "No current plan", color: "#24714D", bg: "#EDF7F0", icon: <BarChart2 size={18} color="#24714D" />, note: "Estimate" },
          { label: "Projected expenses", value: plan || demoMode ? fmtM(projectedExpenses) : "—", sub: plan ? `${plan.name} · v${plan.version}` : "No current plan", color: "#154D33", bg: "#E3F1E8", icon: <BarChart2 size={18} color="#154D33" />, note: "Estimate" },
        ].map((kpi) => (
          <Card key={kpi.label} style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ backgroundColor: kpi.bg, borderRadius: 10, padding: 10 }}>{kpi.icon}</div>
              <span style={{ fontSize: 10, color: "#66786F", fontWeight: 600, backgroundColor: "#F5F8F6", padding: "2px 8px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.07)" }}>{kpi.note}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color, letterSpacing: "-0.5px" }}>{kpi.value}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#33433B", marginTop: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>{kpi.sub}</div>
          </Card>
        ))}
      </div>

      {latestForecast && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Latest model forecast <MlBadge /></div>
              <div style={{ fontSize: 12, color: "#66786F", marginTop: 3 }}>
                {latestForecast.method_label} · {latestForecast.horizon_months} months from {latestForecast.cutoff_date?.slice(0, 10)} · version {latestForecast.model_version ?? "no version"}
              </div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("proyecciones")}>View forecasts <ChevronRight size={12} /></Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            {[
              { label: "Projected income", value: fmtM(num(latestForecast.projected_income)), color: "#24714D" },
              { label: "Projected expenses", value: fmtM(num(latestForecast.projected_expenses)), color: "#154D33" },
              { label: "Income − expenses", value: fmtM(num(latestForecast.projected_result)), color: "#1B5E3F" },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: "#66786F" }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {latestForecast.is_demo && (
              <span style={{ fontSize: 11, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "6px 10px" }}>
                The model was trained and evaluated on semi-synthetic data: its accuracy for a real company is not proven yet.
              </span>
            )}
            {latestForecast.stale_inputs && (
              <span style={{ fontSize: 11, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "6px 10px" }}>
                The inputs changed after the latest forecast. Run a new one to update it.
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 10 }}>
            Planning estimate for guidance only. Income minus expenses is not a tax or a mandatory reserve.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginBottom: 24 }}>
        {/* Chart */}
        <Card>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B" }}>Historical income and expenses</div>
            <div style={{ fontSize: 12, color: "#66786F", marginTop: 3 }}>Last 6 months with recorded movements</div>
          </div>
          {chartData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#66786F", backgroundColor: "#FAFCFB", borderRadius: 10 }}>
              No movements recorded in the last 6 months.
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
              <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#66786F" }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(0)}M`} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#66786F" }} width={45} />
              <Tooltip formatter={(v: number) => fmt(v)} labelStyle={{ fontWeight: 700 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ingresos" name="Income" fill="#1B5E3F" radius={[4, 4, 0, 0]} />
              <Bar dataKey="gastos" name="Expenses" fill="#9CCDB1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </Card>

        {/* Reserve card */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 4 }}>Reserve plan</div>
          <div style={{ fontSize: 12, color: "#66786F", marginBottom: 20 }}>{plan ? `${plan.period} · v${plan.version}` : "No current plan"}</div>

          {!plan && !demoMode ? (
            <div style={{ fontSize: 12, color: "#66786F", backgroundColor: "#F5F8F6", borderRadius: 8, padding: "14px 16px", lineHeight: 1.6 }}>
              There is no current reserve plan for this company yet. Create it in{" "}
              <button onClick={() => onNav("planificacion")} style={{ border: "none", background: "none", color: "#1B5E3F", fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 12 }}>Tax planning</button>.
            </div>
          ) : (
          <>
          {[
            { label: "Reserve target (plan)", value: fmtM(reserveTarget), note: "Entered by the accountant", color: "#33433B" },
            { label: "Recorded reserve", value: fmtM(reserved), note: "Reported by the user", color: "#1B5E3F" },
            { label: "Missing", value: fmtM(pendingReserve), note: "To cover", color: "#B3261E" },
          ].map((r) => (
            <div key={r.label} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 12, color: "#66786F" }}>{r.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: r.color }}>{r.value}</div>
              <div style={{ fontSize: 11, color: "#9AABA2" }}>{r.note}</div>
            </div>
          ))}

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#66786F", marginBottom: 6 }}>
              <span>Reserve coverage</span><span style={{ fontWeight: 700, color: coverage >= 80 ? "#1B5E3F" : "#C9A227" }}>{coverage.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, backgroundColor: "#EEF2F0", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(coverage, 100)}%`, height: "100%", backgroundColor: coverage >= 80 ? "#2E8A5C" : "#C9A227", borderRadius: 4, transition: "width 0.6s" }} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#66786F", backgroundColor: "#F5F8F6", borderRadius: 8, padding: "10px 12px", marginTop: 14, lineHeight: 1.5 }}>
            <Info size={12} style={{ display: "inline", marginRight: 4 }} />
            The reserve target is a planning value. It is not an assessed tax.
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
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B" }}>What to check now</div>
              <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>Open alerts ordered by priority</div>
            </div>
            <Btn variant="ghost" small onClick={() => onNav("alertas")}>View all <ChevronRight size={12} /></Btn>
          </div>
          {reviewItems.map((a) => {
            const pCfg = { alta: { icon: "#B3261E", bg: "#FBECEA", border: "#F2C9C4" }, media: { icon: "#C9A227", bg: "#FBF4E2", border: "#E9D49C" }, baja: { icon: "#2E8A5C", bg: "#E3F1E8", border: "#9CCDB1" } }[a.priority as AlertPriority] || { icon: "#C9A227", bg: "#FBF4E2", border: "#E9D49C" };
            return (
              <div key={a.id} style={{ backgroundColor: pCfg.bg, border: `1px solid ${pCfg.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <AlertTriangle size={15} color={pCfg.icon} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#33433B", lineHeight: 1.3 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: "#66786F", marginTop: 3 }}>
                    {a.originLabel} · <StatusBadge s={a.status} />
                  </div>
                </div>
                <Btn variant="secondary" small onClick={() => onNav(a.screen)}>{a.actionLabel}</Btn>
              </div>
            );
          })}
          {reviewItems.length === 0 && <div style={{ fontSize: 12, color: "#66786F" }}>No open alerts pending review.</div>}
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B" }}>Upcoming obligations</div>
            <Btn variant="ghost" small onClick={() => onNav("obligaciones")}>View calendar <ChevronRight size={12} /></Btn>
          </div>
          {obligationItems.map((o) => (
            <div key={o.id} style={{ padding: "12px 14px", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#33433B", lineHeight: 1.3, flex: 1 }}>{o.obligacion}</div>
                <span style={{ fontSize: 11, color: "#B3261E", fontWeight: 700, backgroundColor: "#FBECEA", padding: "2px 8px", borderRadius: 6, border: "1px solid #F2C9C4", whiteSpace: "nowrap", marginLeft: 8 }}>{o.vencimiento}</span>
              </div>
              <div style={{ fontSize: 11, color: "#66786F", marginTop: 4 }}>Estimated amount: {o.estimado}</div>
              <div style={{ fontSize: 10, color: "#9AABA2", marginTop: 2 }}>{o.fuente}</div>
            </div>
          ))}
          {obligationItems.length === 0 && <div style={{ fontSize: 12, color: "#66786F" }}>No pending obligations.</div>}
          <div style={{ fontSize: 11, color: "#66786F", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "8px 12px" }}>
            Dates recorded manually. Check the applicable calendar with the accountant.
          </div>
        </Card>
      </div>
    </div>
  );
};
