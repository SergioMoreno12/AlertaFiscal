import { useEffect, useState } from "react";
import { ResponsiveContainer, XAxis, YAxis, Tooltip, Line, CartesianGrid, Legend, ComposedChart, Area } from "recharts";
import { Calculator, AlertCircle, Download, RefreshCw, Edit3, Info, BarChart2, Printer } from "lucide-react";
import { MlBadge, MlNote } from "../ui";
import { Badge, Btn, Card, Field, SectionHeader, errorMessage, fmt, fmtDate, fmtM, inputStyle, num, shortMonth } from "../ui";
import { tr, uiLocale } from "../../i18n";
import {
  createModelForecast, getDashboard, getMonthlyTotals, listForecasts, type ForecastResult,
  type ForecastRun, 
} from "../../api/fiscal.api";
import { downloadCsv, type Screen } from "../shared";

// PROYECCIONES
export const modelLabel = (name: string) =>
  ({ seasonal_naive: "Seasonal naive (lag-12)", linear_regression: "Linear regression", random_forest: "Random Forest" } as Record<string, string>)[name] ?? name;

// Typical error of the global model on companies it never saw, as a share of the company's
// average month (Phase 4 official run, holdout test, median normalized MAE:
// docs/04_evaluation_report.md). Half of the evaluated companies had a smaller error.
export const TYPICAL_ERROR_PCT = { income: 12.34, expenses: 11.75 };

/** "nov. 26": the forecast crosses the year, so a month alone is ambiguous. */
export const monthWithYear = (period: string) => `${shortMonth(period)} ${period.slice(2, 4)}`;

export const longMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Date(year, month - 1, 1).toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
};

export const pct1 = (value: number) => value.toLocaleString(uiLocale(), { maximumFractionDigits: 1 });

export const ProyeccionesScreen = ({
  onNav,
  companyId,
  companyName,
  demoMode,
  onUseForecast,
}: {
  onNav: (s: Screen) => void;
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  onUseForecast: (forecast: ForecastResult) => void;
}) => {
  const [estado, setEstado] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ month: string; mes: string; ingresos: number; gastos: number }>>([]);
  const [horizon, setHorizon] = useState(6);
  const [savedRuns, setSavedRuns] = useState<ForecastRun[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!companyId || demoMode) {
      setHistory([]);
      setSavedRuns([]);
      return;
    }
    let alive = true;
    setLoadingContext(true);
    // Every recorded month (the dashboard only carries the last six), so the table and the
    // chart show the same history the model read.
    const recorded: Promise<Array<{ month: string; income: string | number; expenses: string | number }>> = getMonthlyTotals(companyId)
      .then((data) => data.items)
      .catch(() => getDashboard(companyId).then((dashboard) => dashboard.monthly));
    Promise.all([recorded, listForecasts(companyId)])
      .then(([points, runs]) => {
        if (!alive) return;
        setHistory(
          points.map((point) => ({
            month: point.month,
            mes: monthWithYear(point.month),
            ingresos: num(point.income),
            gastos: num(point.expenses),
          })),
        );
        setSavedRuns(runs.items);
        const latest = runs.items[0];
        if (latest) {
          // Show the latest stored run. Nothing is recomputed or trained.
          setResult((current) => current ?? {
            available: true,
            id: latest.id,
            method: latest.method,
            method_label: latest.method_label ?? modelLabel(latest.method),
            horizon_months: latest.horizon_months,
            cutoff_date: latest.cutoff_date,
            projected_income: latest.projected_income,
            projected_expenses: latest.projected_expenses,
            projected_result:
              latest.projected_result ??
              (num(latest.projected_income) - num(latest.projected_expenses)).toFixed(2),
            model_version: latest.model_version,
            created_at: latest.created_at,
            assumptions: latest.assumptions,
            monthly: latest.monthly,
            models: latest.models,
            history_months: latest.history_months,
            history_period: latest.history_period,
            trained_at: latest.trained_at,
            stale_inputs: latest.stale_inputs,
            is_demo: latest.is_demo,
            scope: latest.scope,
            artifact_sha256: latest.artifact_sha256,
            data_provenance: latest.data_provenance,
            estimated: true,
            disclaimer: "Planning forecast for guidance only. It is not an official tax assessment.",
          });
          setEstado((current) => (current === "idle" ? "done" : current));
        }
      })
      .catch(() => {
        // The history and the latest run are context; they do not block forecasting.
      })
      .finally(() => {
        if (alive) setLoadingContext(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, demoMode]);

  const runProjection = async () => {
    setError(null);
    if (demoMode) {
      setEstado("error");
      setError(
        "The visual demo does not run the trained model. Sign in with a company to generate a real forecast from the artifact.",
      );
      return;
    }
    if (!companyId) {
      setError("Select a company before forecasting.");
      setEstado("error");
      return;
    }
    setEstado("loading");
    try {
      const forecast = await createModelForecast(companyId, { horizon_months: horizon });
      setResult(forecast);
      setEstado("done");
      if (forecast.available) {
        listForecasts(companyId)
          .then((runs) => setSavedRuns(runs.items))
          .catch(() => null);
      }
    } catch (err) {
      setError(errorMessage(err));
      setEstado("error");
    }
  };

  const projectedIncome = result ? num(result.projected_income) : 0;
  const projectedExpenses = result ? num(result.projected_expenses) : 0;
  const months = result?.horizon_months ?? horizon;
  const monthly = result?.monthly ?? [];
  const models = result?.models ?? {};
  // Only closed months before the forecast start are history; a month in progress would look like a drop.
  const firstForecast = monthly[0]?.month;
  const pastHistory = (firstForecast ? history.filter((point) => point.month < firstForecast) : history).slice(-12);
  // The typical error is a share of the company's average month, so the range has the same
  // width in every forecast month.
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const incomeMargin = (average(pastHistory.map((point) => point.ingresos)) * TYPICAL_ERROR_PCT.income) / 100;
  const expensesMargin = (average(pastHistory.map((point) => point.gastos)) * TYPICAL_ERROR_PCT.expenses) / 100;
  const showRange = result?.scope === "global" && incomeMargin > 0;
  const lastRecorded = pastHistory[pastHistory.length - 1];
  const firstMonth = monthly[0];
  const incomeChange = firstMonth && lastRecorded && lastRecorded.ingresos > 0
    ? ((num(firstMonth.projected_income) - lastRecorded.ingresos) / lastRecorded.ingresos) * 100
    : null;
  const runIndex = result?.id != null ? savedRuns.findIndex((run) => run.id === result.id) : -1;
  const runLabel = runIndex >= 0 ? `Run ${savedRuns.length - runIndex} of this company` : "Latest run";
  const tableRows = [
    ...pastHistory.map((point) => ({ mes: point.mes, ingresos: point.ingresos, gastos: point.gastos, tipo: "Recorded" })),
    ...monthly.map((point) => ({
      mes: monthWithYear(point.month),
      ingresos: num(point.projected_income),
      gastos: num(point.projected_expenses),
      tipo: "Forecast",
    })),
  ];

  const exportForecast = () => {
    downloadCsv(
      `forecast-${companyName.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Month", "Type", "Income", "Expenses", "Result", "Typical income range (±)"],
      tableRows.map((row) => [
        row.mes,
        tr(row.tipo),
        Math.round(row.ingresos),
        Math.round(row.gastos),
        Math.round(row.ingresos - row.gastos),
        showRange && row.tipo === "Forecast" ? Math.round(incomeMargin) : "",
      ]),
    );
  };

  // The last recorded month also starts the dashed forecast lines, so both segments join.
  const chartRows: Array<Record<string, string | number | number[] | null>> = pastHistory.map((point, index) => ({
    mes: point.mes,
    "Recorded income": point.ingresos,
    "Recorded expenses": point.gastos,
    "Forecast income (ML)": index === pastHistory.length - 1 && monthly.length ? point.ingresos : null,
    "Forecast expenses (ML)": index === pastHistory.length - 1 && monthly.length ? point.gastos : null,
  }));
  monthly.forEach((point) => {
    chartRows.push({
      mes: monthWithYear(point.month),
      "Recorded income": null,
      "Recorded expenses": null,
      ...(showRange
        ? { "Typical income range": [Math.max(0, num(point.projected_income) - incomeMargin), num(point.projected_income) + incomeMargin] }
        : {}),
      "Forecast income (ML)": num(point.projected_income),
      "Forecast expenses (ML)": num(point.projected_expenses),
    });
  });

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Forecasts"
        subtitle={`${companyName} · Estimate of the coming months from your recorded history`}
        actions={
          estado === "done" && result?.available ? (
            <>
              <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportForecast}>Export CSV</Btn>
              <Btn variant="ghost" icon={<Printer size={13} />} small onClick={() => window.print()}>Print or save as PDF</Btn>
              <Btn variant="primary" icon={<Calculator size={13} />} small onClick={() => onUseForecast(result)}>
                Use this forecast in my planning
              </Btn>
            </>
          ) : undefined
        }
      />

      <MlNote>
        Every value with this tag is produced by the random forest model, trained offline and applied to the closed months
        recorded for this company (at least 6). Values without the tag are your own records. It is an estimate for planning,
        not an official tax assessment.
      </MlNote>

      <Card style={{ marginBottom: 24, padding: "14px 18px", backgroundColor: "#F5F8F6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <details style={{ flex: 1, minWidth: 240 }}>
            <summary style={{ fontSize: 12, fontWeight: 700, color: "#33433B", cursor: "pointer" }}>Technical detail: how the model is applied</summary>
            <p style={{ fontSize: 11, color: "#4E5F57", margin: "8px 0 0", lineHeight: 1.65 }}>
              Training and evaluation with a time-based split run offline (<code>ml/src/</code> for the global model,{" "}
              <code>ml/company_trainer/train.py</code> for a company model). The backend reads the JSON artifact,
              validates the expected inputs and predicts without scikit-learn. Nothing is trained when the dashboard loads or on
              requests. The model, the inputs and the version live in the artifact and in the run assumptions,
              separate from the interface.
            </p>
          </details>
          <Field label="Months to forecast">
            <select
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value))}
              style={{ ...inputStyle, width: 120 }}
              disabled={estado === "loading"}
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        {savedRuns.length > 0 && (
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 8 }}>
            Stored runs: {savedRuns.length}. The most recent one is shown when the screen opens.
          </div>
        )}
      </Card>

      {loadingContext && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading history and latest run…</div>}

      {estado === "idle" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <BarChart2 size={48} color="#9CCDB1" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: "0 0 8px" }}>Generate forecast</h3>
          <p style={{ fontSize: 13, color: "#66786F", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>
            The model reads the closed months you recorded and estimates the income and expenses of the coming months.
            It needs at least 6 closed months; with fewer, you can still plan by hand.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn variant="primary" icon={<RefreshCw size={13} />} onClick={runProjection}>Generate forecast with the model</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "loading" && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid #E3F1E8", borderTopColor: "#1B5E3F", margin: "0 auto 24px", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#33433B" }}>Preparing inputs and running the model…</div>
          <p style={{ fontSize: 12, color: "#66786F", marginTop: 8 }}>The model is not retrained and no external source is queried.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </Card>
      )}

      {estado === "error" && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#B3261E" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: "0 0 8px" }}>The forecast could not be generated</h3>
          <p style={{ fontSize: 13, color: "#66786F", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>{error}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <Btn variant="secondary" onClick={runProjection}>Retry</Btn>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Use manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && !result.available && (
        <Card style={{ textAlign: "center", padding: "48px 40px" }}>
          <AlertCircle size={48} color="#C9A227" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#33433B", margin: "0 0 8px" }}>Model or history not available</h3>
          <p style={{ fontSize: 13, color: "#66786F", maxWidth: 520, margin: "0 auto 8px", lineHeight: 1.6 }}>
            {result.reason ?? "There is no trained model or not enough history for this company."}
          </p>
          <p style={{ fontSize: 12, color: "#9AABA2" }}>
            {result.code === "insufficient_history"
              ? `Months available: ${result.history_months ?? 0}.`
              : "The prediction is never replaced with fictitious data."}
          </p>
          <div style={{ marginTop: 20 }}>
            <Btn variant="primary" onClick={() => onNav("planificacion")}>Continue with manual planning</Btn>
          </div>
        </Card>
      )}

      {estado === "done" && result && result.available && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
            {[
              { label: `Projected income (${months} months)`, value: fmt(projectedIncome), color: "#1B5E3F" },
              { label: `Projected expenses (${months} months)`, value: fmt(projectedExpenses), color: "#33433B" },
              { label: "Income − expenses", value: fmt(num(result.projected_result)), color: projectedIncome - projectedExpenses >= 0 ? "#24714D" : "#B3261E" },
            ].map((item) => (
              <Card key={item.label} style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#66786F", marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: item.color }}>{item.value}</div>
                <div style={{ marginTop: 8 }}><MlBadge size="sm" /></div>
              </Card>
            ))}
          </div>

          {firstMonth && (
            <Card style={{ marginBottom: 16, padding: "16px 22px", backgroundColor: "#F2F8F4", border: "1px solid #C8E4D3" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1B5E3F", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>In short</div>
              <div style={{ fontSize: 14, color: "#1E2B25", lineHeight: 1.65 }}>
                <div>{`In ${longMonth(firstMonth.month)} the model expects income of ${fmt(num(firstMonth.projected_income))} and expenses of ${fmt(num(firstMonth.projected_expenses))}.`}</div>
                {incomeChange !== null && lastRecorded && (
                  <div>{incomeChange >= 0
                    ? `Income would be ${pct1(incomeChange)} % higher than in ${lastRecorded.mes}, your last recorded month.`
                    : `Income would be ${pct1(-incomeChange)} % lower than in ${lastRecorded.mes}, your last recorded month.`}</div>
                )}
                {showRange && (
                  <div style={{ fontSize: 12.5, color: "#4E5F57", marginTop: 6 }}>{`Typical range for a month: income ± ${fmt(incomeMargin)}, expenses ± ${fmt(expensesMargin)}. It is the error measured on companies the model never saw (half had less, half had more), not a guarantee.`}</div>
                )}
              </div>
            </Card>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {result.is_demo && (
              <span style={{ fontSize: 11, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "7px 11px" }}>
                The model was trained and evaluated on semi-synthetic data: its accuracy for a real company is not proven yet.
              </span>
            )}
            {result.stale_inputs && (
              <span style={{ fontSize: 11, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "7px 11px" }}>
                The inputs changed after training. The run is stored; generate again to use the current inputs.
              </span>
            )}
            <span style={{ fontSize: 11, color: "#4E5F57", backgroundColor: "#EEF2F0", borderRadius: 8, padding: "7px 11px" }}>
              {`${runLabel} · version ${result.model_version ?? "no version"} · cutoff ${fmtDate(result.cutoff_date)} · stored ${fmtDate(result.created_at)}`}
            </span>
          </div>

          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B" }}>Your history and the model forecast</div>
                <div style={{ fontSize: 12, color: "#66786F", marginTop: 2 }}>Solid lines: months you recorded · dashed lines: model forecast <MlBadge size="sm" />{showRange ? " · shaded: typical income range" : ""}</div>
              </div>
            </div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows} margin={{ top: 6, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#66786F" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#66786F" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v) / 1_000_000)}M`} width={48} />
                  <Tooltip formatter={(value) => (value == null ? "—" : Array.isArray(value) ? `${fmt(Number(value[0]))} – ${fmt(Number(value[1]))}` : fmt(Number(value)))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {showRange && <Area type="monotone" dataKey="Typical income range" stroke="none" fill="#1B5E3F" fillOpacity={0.12} connectNulls={false} isAnimationActive={false} />}
                  <Line type="monotone" dataKey="Recorded income" stroke="#1B5E3F" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="Recorded expenses" stroke="#9CCDB1" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="Forecast income (ML)" stroke="#1B5E3F" strokeWidth={2.5} strokeDasharray="6 5" dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="Forecast expenses (ML)" stroke="#5BAA80" strokeWidth={2.5} strokeDasharray="6 5" dot={{ r: 3 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 24, marginBottom: 24 }}>
            <Card style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 4 }}>Recorded history vs forecast</div>
              <div style={{ fontSize: 12, color: "#66786F", marginBottom: 16 }}>
                {`${pastHistory.length} recorded month(s) and ${monthly.length} forecast month(s)`}{showRange ? " · ± is the typical range" : ""}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: "#F5F8F6" }}>
                      {["Month", "Income", "Expenses", "Type"].map((header) => (
                        <th key={header} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.07)", whiteSpace: "nowrap" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr key={`${row.tipo}-${row.mes}-${index}`} style={{ backgroundColor: row.tipo === "Forecast" ? "#F2F8F4" : index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, color: "#33433B" }}>{row.mes}</td>
                        <td style={{ padding: "9px 12px", color: "#33433B", whiteSpace: "nowrap" }}>
                          {fmt(row.ingresos)}
                          {showRange && row.tipo === "Forecast" && <div style={{ fontSize: 10.5, color: "#66786F" }}>{`± ${fmtM(incomeMargin)}`}</div>}
                        </td>
                        <td style={{ padding: "9px 12px", color: "#33433B", whiteSpace: "nowrap" }}>
                          {fmt(row.gastos)}
                          {showRange && row.tipo === "Forecast" && <div style={{ fontSize: 10.5, color: "#66786F" }}>{`± ${fmtM(expensesMargin)}`}</div>}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          {row.tipo === "Forecast" ? <MlBadge size="sm" /> : <Badge label="Your data" color="#4E5F57" bg="#EEF2F0" border="#D3DDD8" />}
                        </td>
                      </tr>
                    ))}
                    {tableRows.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#66786F", fontSize: 12 }}>No history or forecast to show.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 16 }}>Calculation detail</div>
              {[
                { label: "Method (income)", value: models.income?.label ?? result.method_label ?? "—" },
                { label: "Method (expenses)", value: models.expenses?.label ?? "—" },
                { label: "Model", value: result.scope === "global" ? "Global model (425 companies, evaluated in Phase 4)" : result.scope === "company" ? "This company's own model" : "—" },
                { label: "Model version", value: result.model_version ?? "no version" },
                { label: "Artifact SHA-256", value: result.artifact_sha256 ? `${result.artifact_sha256.slice(0, 12)}…` : "—" },
                { label: "Trained", value: fmtDate(result.trained_at) },
                { label: "History cutoff", value: fmtDate(result.cutoff_date) },
                { label: "Months of history", value: String(result.history_months ?? "—") },
                { label: "Horizon", value: `${months} months` },
                { label: "Evaluation", value: result.scope === "global" ? "Evaluated once on test and holdout companies: accepted (docs/04_evaluation_report.md)" : result.assumptions?.evaluation?.method === "temporal_holdout" ? `Time-based validation for selection (${result.assumptions.evaluation.test_months ?? "—"} months); one-month error with real lags. The full recursive horizon is not evaluated` : "Not declared" },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize: 12, color: "#66786F" }}>{item.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#33433B", textAlign: "right" }}>{item.value}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#66786F", marginTop: 12, lineHeight: 1.5 }}>
                The model, the inputs and the version are stored with the run. Changing the interface does not change the model.
              </div>
            </Card>
          </div>

          <Card style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 4 }}>{result.scope === "global" ? "Model evaluation" : "Model metrics (time-based validation)"}</div>
            <div style={{ fontSize: 12, color: "#66786F", marginBottom: 16 }}>
              {result.scope === "global" ? "Six-month recursive forecasts, as the app makes them." : "One-month error on the months used for selection (real lags). The full recursive horizon is not evaluated. Lower MAE is better."} These are not probabilities or promises of savings.
            </div>
            {result.scope === "global" && (
              <div style={{ fontSize: 12, color: "#33433B", lineHeight: 1.7, marginBottom: 8 }}>
                The global model was evaluated once on data nobody used to train or choose it (Phase 4, verdict: accepted).
                Typical error, as a share of a company's monthly income: income 10.2 % and expenses 10.7 % on the temporal test,
                income 12.3 % and expenses 11.8 % on companies never seen in training. The seasonal naive baseline scored 15–17 %.
                The figures come from a semi-synthetic dataset, so they describe the method, not this company.
              </div>
            )}
            {result.scope !== "global" && Object.entries(models).map(([target, info]) => (
              <div key={target} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#33433B" }}>
                  {target === "income" ? "Income" : "Expenses"} · selected model: {info.label}
                </div>
                <div style={{ fontSize: 12, color: "#4E5F57", marginTop: 4 }}>
                  MAE {fmt(info.metrics.mae)} · RMSE {fmt(info.metrics.rmse)} · MAPE {info.metrics.mape_percent != null ? `${info.metrics.mape_percent}%` : "not computable"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {Object.entries(info.all_metrics).map(([name, metric]) => (
                    <span key={name} style={{ fontSize: 10, color: "#4E5F57", backgroundColor: "#F5F8F6", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 6, padding: "4px 8px" }}>
                      {modelLabel(name)}: MAE {fmt(metric.mae)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {result.scope !== "global" && Object.keys(models).length === 0 && (
              <div style={{ fontSize: 12, color: "#66786F" }}>The run declares no metrics.</div>
            )}
          </Card>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Btn variant="primary" icon={<Calculator size={13} />} onClick={() => onUseForecast(result)}>Use this forecast in my planning</Btn>
            <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={runProjection}>Generate another run</Btn>
            <Btn variant="secondary" icon={<Edit3 size={13} />} onClick={() => onNav("planificacion")}>Manual planning</Btn>
          </div>

          <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 10, padding: "10px 16px", fontSize: 12, color: "#8A6400" }}>
            <Info size={13} style={{ display: "inline", marginRight: 5 }} />
            {result.disclaimer ?? "Planning estimate for guidance only. It is not an official tax assessment."} Income minus expenses is not a tax or a mandatory reserve.
          </div>
        </>
      )}
    </div>
  );
};
