import { useEffect, useState } from "react";
import { ChevronRight, CheckCircle, Plus, Download, Save, ArrowLeft, Info, Flag, Layers, Printer } from "lucide-react";
import { MlNote } from "../ui";
import {
  Badge, Btn, Card, Field, InlineError, SectionHeader, currentPeriod, errorMessage, fmt, fmtDate,
  inputStyle, num, todayISO,
} from "../ui";
import { tr, uiLocale } from "../../i18n";
import {
  createPlan, createPlanVersion, createReserve, getDashboard, getPlan, listFiscalParameters,
  listForecasts, listObligations, listPlans, listReserves, reviewPlanVersion, 
  type Dashboard, type ForecastRun, type Obligation, type Plan, type PlanDetail,
} from "../../api/fiscal.api";
import { downloadCsv, type PlanDraft, type PlanStep, type Screen, toMoneyString } from "../shared";

// TAX PLANNING
export type ParameterRow = {
  id: number;
  label: string;
  value: string;
  unit: string;
  source: string;
  reviewed: boolean;
};

export const DEMO_PARAMETERS: ParameterRow[] = [
  { id: 1, label: "General VAT rate", value: "19.0000", unit: "percent", source: "Sample parameter pending validation", reviewed: false },
  { id: 2, label: "VAT period", value: "2.0000", unit: "months", source: "Sample parameter", reviewed: false },
  { id: 3, label: "Withholding tax", value: "0.0000", unit: "percent", source: "To be defined with the accountant", reviewed: false },
];

export const DEMO_OBLIGATIONS: Obligation[] = [
  { id: 1, name: "Bimonthly VAT", period: "Sep-Oct 2026", due_date: "2026-10-28", estimated_amount: "2550000.00", status: "pending", notes: "Date recorded manually." },
  { id: 2, name: "Withholding tax", period: "Oct 2026", due_date: "2026-11-12", estimated_amount: null, status: "pending", notes: "Amount pending." },
  { id: 3, name: "Annual ICA", period: "2026", due_date: "2027-03-15", estimated_amount: null, status: "pending", notes: "Estimate pending." },
];

export const unitLabel = (unit: string) => ({ percent: "Percent", cop: "COP", months: "Months", count: "Count" } as Record<string, string>)[unit] ?? unit;

export const parameterValue = (row: ParameterRow) => {
  if (row.unit === "percent") return `${Number(row.value).toLocaleString(uiLocale(), { maximumFractionDigits: 2 })}%`;
  if (row.unit === "cop") return fmt(Number(row.value));
  if (row.unit === "months") return `${Number(row.value).toLocaleString(uiLocale())} months`;
  return Number(row.value).toLocaleString(uiLocale());
};

export const PlanificacionScreen = ({
  onNav,
  companyId,
  companyName,
  demoMode,
  draft,
  initialStep,
}: {
  onNav: (s: Screen) => void;
  companyId: number | null;
  companyName: string;
  demoMode: boolean;
  draft: PlanDraft | null;
  initialStep: PlanStep;
}) => {
  const [step, setStep] = useState<PlanStep>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [parameters, setParameters] = useState<ParameterRow[]>(demoMode ? DEMO_PARAMETERS : []);
  const [obligations, setObligations] = useState<Obligation[]>(demoMode ? DEMO_OBLIGATIONS : []);
  const [planDetail, setPlanDetail] = useState<PlanDetail | null>(null);
  const [forecast, setForecast] = useState<ForecastRun | null>(null);
  const [reservesTotal, setReservesTotal] = useState(0);

  const [form, setForm] = useState({
    name: `Tax plan ${currentPeriod()}`,
    period: currentPeriod(),
    projected_income: demoMode ? "55000000" : "",
    projected_expenses: demoMode ? "37000000" : "",
    estimated_reserve: demoMode ? "4500000" : "",
    notes: "",
  });
  const [reserveForm, setReserveForm] = useState({ amount: "", reserved_on: todayISO(), note: "" });

  const [saving, setSaving] = useState(false);
  const [savedPlan, setSavedPlan] = useState<Plan | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reserveSaving, setReserveSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || demoMode) {
      setDashboard(null);
      setParameters(DEMO_PARAMETERS);
      setObligations(DEMO_OBLIGATIONS);
      setPlanDetail(null);
      setForecast(null);
      setReservesTotal(3000000);
      setForm((current) => ({
        ...current,
        projected_income: current.projected_income || "55000000",
        projected_expenses: current.projected_expenses || "37000000",
        estimated_reserve: current.estimated_reserve || "4500000",
      }));
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getDashboard(companyId),
      listFiscalParameters(companyId),
      listObligations(companyId),
      listPlans(companyId),
      listForecasts(companyId),
      listReserves(companyId),
    ])
      .then(async ([summary, parameterResponse, obligationResponse, planResponse, forecastResponse, reserveResponse]) => {
        if (!alive) return;
        setDashboard(summary);
        setParameters(parameterResponse.items.map((item) => ({ id: item.id, label: item.label, value: item.value, unit: item.unit, source: item.source, reviewed: item.reviewed })));
        setObligations(obligationResponse.items);
        setReservesTotal(num(reserveResponse.total));

        const latestForecast = forecastResponse.items[0] ?? null;
        setForecast(latestForecast);

        const currentPlan = planResponse.items[0] ?? null;
        let detail: PlanDetail | null = null;
        if (currentPlan) {
          detail = await getPlan(companyId, currentPlan.id);
          if (!alive) return;
          setPlanDetail(detail);
        } else {
          setPlanDetail(null);
        }

        const currentVersion = detail?.versions?.[0];
        const latestMonth = summary.monthly[summary.monthly.length - 1];
        const fallbackIncome = latestMonth ? num(latestMonth.income) : num(summary.totals.income);
        const fallbackExpenses = latestMonth ? num(latestMonth.expenses) : num(summary.totals.expenses);
        // A plan covers one month. Without a saved version it starts from the forecast of
        // that month (or the first forecast month), never from the total of the whole horizon.
        const planPeriod = draft?.period ?? currentPlan?.period ?? currentPeriod();
        const forecastMonths = latestForecast?.monthly ?? [];
        const forecastMonth = forecastMonths.find((point) => point.month === planPeriod) ?? forecastMonths[0];
        const projectedIncome = currentVersion
          ? num(currentVersion.projected_income)
          : forecastMonth
            ? num(forecastMonth.projected_income)
            : fallbackIncome;
        const projectedExpenses = currentVersion
          ? num(currentVersion.projected_expenses)
          : forecastMonth
            ? num(forecastMonth.projected_expenses)
            : fallbackExpenses;

        setForm({
          name: currentPlan?.name ?? `Tax plan ${currentPeriod()}`,
          period: draft?.period ?? currentPlan?.period ?? (!currentVersion && forecastMonth ? forecastMonth.month : currentPeriod()),
          projected_income: draft?.projected_income ?? String(Math.round(projectedIncome)),
          projected_expenses: draft?.projected_expenses ?? String(Math.round(projectedExpenses)),
          estimated_reserve: currentVersion ? String(Math.round(num(currentVersion.estimated_reserve))) : "",
          notes: currentVersion?.notes ?? "",
        });
      })
      .catch((err) => {
        if (alive) {
          setError(errorMessage(err));
          setParameters(DEMO_PARAMETERS);
          setObligations(DEMO_OBLIGATIONS);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [companyId, demoMode, reloadKey]);

  useEffect(() => {
    if (!draft) return;
    setForm((current) => ({
      ...current,
      period: draft.period,
      projected_income: draft.projected_income,
      projected_expenses: draft.projected_expenses,
      // The reserve target is not derived from income − expenses and is not
      // overwritten: the accountant sets it.
    }));
    setStep(initialStep);
  }, [draft, initialStep]);

  const observedIncome = dashboard ? num(dashboard.totals.income) : 35000000;
  const observedExpenses = dashboard ? num(dashboard.totals.expenses) : 23000000;
  const projectedIncome = num(form.projected_income);
  const projectedExpenses = num(form.projected_expenses);
  const projectedResult = projectedIncome - projectedExpenses;
  const reserveTargetInput = num(form.estimated_reserve);
  const pendingObligations = obligations.filter((item) => item.status === "pending" || item.status === "filed");
  const latestVersion = planDetail?.versions?.[0] ?? null;
  const versionReviewed = savedPlan?.version?.status === "reviewed" || (!savedPlan && latestVersion?.status === "reviewed");

  const savePlan = async () => {
    setActionError(null);
    setActionMessage(null);
    if (projectedIncome <= 0 || projectedExpenses < 0) {
      setActionError("Enter valid projected values. Income must be greater than zero.");
      return;
    }
    if (reserveTargetInput < 0) {
      setActionError("The reserve target cannot be negative.");
      return;
    }
    if (demoMode) {
      const version = {
        id: Date.now(),
        version: (latestVersion?.version ?? 0) + 1,
        status: "draft" as const,
        assumptions: {},
        projected_income: projectedIncome.toFixed(2),
        projected_expenses: projectedExpenses.toFixed(2),
        estimated_reserve: reserveTargetInput.toFixed(2),
        notes: form.notes,
        created_at: new Date().toISOString(),
      };
      setSavedPlan({
        id: planDetail?.id ?? 1,
        name: form.name,
        period: form.period,
        status: "draft",
        current_version: version.version,
        created_at: new Date().toISOString(),
        version,
      });
      setActionMessage(`Version v${version.version} saved in the demo.`);
      return;
    }
    if (!companyId) return;

    setSaving(true);
    try {
      const assumptions = draft
        ? {
            ...draft.assumptions,
            source: "model_forecast",
            forecast_run_id: draft.sourceForecastId ?? null,
            model_label: draft.methodLabel ?? null,
            notes: form.notes,
          }
        : { source: "manual", notes: form.notes };
      const payload = {
        projected_income: projectedIncome.toFixed(2),
        projected_expenses: projectedExpenses.toFixed(2),
        estimated_reserve: reserveTargetInput.toFixed(2),
        assumptions,
        notes: form.notes,
      };
      const saved = planDetail
        ? await createPlanVersion(companyId, planDetail.id, payload)
        : await createPlan(companyId, {
            name: form.name,
            period: form.period,
            projected_income: payload.projected_income,
            projected_expenses: payload.projected_expenses,
            estimated_reserve: payload.estimated_reserve,
            assumptions: payload.assumptions,
            notes: payload.notes,
          });
      setSavedPlan(saved);
      setActionMessage(`Version v${saved.version?.version ?? saved.current_version} saved. Previous versions are kept.`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reviewSavedPlan = async () => {
    setActionError(null);
    setActionMessage(null);
    if (!savedPlan?.version) {
      setActionError("Save a version before marking it as reviewed.");
      return;
    }
    if (demoMode) {
      setSavedPlan({ ...savedPlan, status: "reviewed", version: { ...savedPlan.version, status: "reviewed" } });
      setActionMessage("Version marked as reviewed in the demo.");
      return;
    }
    if (!companyId) return;
    setReviewing(true);
    try {
      const reviewed = await reviewPlanVersion(companyId, savedPlan.id, savedPlan.version.id);
      setSavedPlan(reviewed);
      setActionMessage("Version marked as reviewed. It can no longer change.");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReviewing(false);
    }
  };

  const addReserve = async () => {
    setActionError(null);
    setActionMessage(null);
    const amount = toMoneyString(reserveForm.amount);
    if (Number(amount) <= 0) {
      setActionError("The reserve must be greater than zero.");
      return;
    }
    if (demoMode) {
      setReservesTotal((current) => current + Number(amount));
      setReserveForm({ amount: "", reserved_on: todayISO(), note: "" });
      setActionMessage("Reserve recorded in the demo.");
      return;
    }
    if (!companyId) return;
    setReserveSaving(true);
    try {
      await createReserve(companyId, {
        amount,
        reserved_on: reserveForm.reserved_on,
        note: reserveForm.note,
        plan_version_id: savedPlan?.version?.id ?? latestVersion?.id ?? null,
      });
      setReservesTotal((current) => current + Number(amount));
      setReserveForm({ amount: "", reserved_on: todayISO(), note: "" });
      setActionMessage("Reserve recorded.");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReserveSaving(false);
    }
  };

  const exportPlan = () => {
    const pendingReserve = Math.max(reserveTargetInput - reservesTotal, 0);
    downloadCsv(
      `plan-${companyName.toLowerCase().replace(/\s+/g, "-")}-${form.period}.csv`,
      ["Concept", "Value"],
      [
        [tr("Company"), companyName],
        [tr("Plan period"), form.period],
        [tr("Expected income"), Math.round(projectedIncome)],
        [tr("Expected expenses"), Math.round(projectedExpenses)],
        [tr("Expected result"), Math.round(projectedResult)],
        [tr("Reserve target"), Math.round(reserveTargetInput)],
        [tr("Reserved so far"), Math.round(reservesTotal)],
        [tr("Still to reserve"), Math.round(pendingReserve)],
        ...pendingObligations.map((item) => [
          `${tr("Obligation")}: ${item.name} ${item.period}`.trim(),
          `${item.due_date ?? ""}${item.estimated_amount ? ` · ${Math.round(num(item.estimated_amount))}` : ""}`,
        ]),
      ],
    );
  };

  const stepLabels = ["Review information", "Assumptions and parameters", "Reserve plan"];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Tax planning"
        subtitle={`${companyName} · Period ${form.period}`}
        actions={
          <>
            <Btn variant="ghost" icon={<Download size={13} />} small onClick={exportPlan}>Export CSV</Btn>
            <Btn variant="ghost" icon={<Printer size={13} />} small onClick={() => window.print()}>Print or save as PDF</Btn>
            <Btn variant="ghost" icon={<Layers size={13} />} small onClick={() => onNav("escenarios")}>Compare scenarios</Btn>
          </>
        }
      />

      {loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading planning information…</div>}
      {error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      <div style={{ display: "flex", gap: 0, marginBottom: 32, backgroundColor: "#fff", borderRadius: 12, padding: "4px", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {stepLabels.map((label, index) => {
          const stepNumber = (index + 1) as PlanStep;
          const active = step === stepNumber;
          const done = step > stepNumber;
          return (
            <button key={label} onClick={() => setStep(stepNumber)} style={{ flex: 1, padding: "11px 16px", borderRadius: 9, border: "none", cursor: "pointer", backgroundColor: active ? "#1B5E3F" : "transparent", color: active ? "#fff" : done ? "#1B5E3F" : "#66786F", fontWeight: active ? 700 : 500, fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, backgroundColor: active ? "rgba(255,255,255,0.2)" : done ? "#E3F1E8" : "#F5F8F6", color: active ? "#fff" : done ? "#1B5E3F" : "#66786F" }}>
                {done ? <CheckCircle size={13} /> : stepNumber}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 16 }}>Recorded information</div>
            {[
              { label: "Company", value: companyName },
              { label: "Period", value: form.period },
              { label: "Observed income", value: fmt(observedIncome), note: dashboard ? "Year to date" : "Sample data" },
              { label: "Observed expenses", value: fmt(observedExpenses), note: dashboard ? "Year to date" : "Sample data" },
              { label: "Plan income", value: fmt(projectedIncome), note: "For the month of the plan" },
              { label: "Plan expenses", value: fmt(projectedExpenses), note: "For the month of the plan" },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                <span style={{ fontSize: 13, color: "#66786F" }}>{row.label}</span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#33433B" }}>{row.value}</span>
                  {row.note && <span style={{ display: "block", fontSize: 10, color: "#9AABA2" }}>{row.note}</span>}
                </div>
              </div>
            ))}
            {forecast && (
              <div style={{ marginTop: 14, fontSize: 11, color: "#24714D", backgroundColor: "#EDF7F0", border: "1px solid #9CCDB1", borderRadius: 8, padding: "8px 12px" }}>
                Latest stored forecast: {fmt(num(forecast.projected_income))} of income and {fmt(num(forecast.projected_expenses))} of expenses for {forecast.horizon_months} months.
              </div>
            )}
          </Card>

          <div>
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 12 }}>Pending obligations</div>
              {pendingObligations.map((obligation) => (
                <div key={obligation.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#33433B" }}>{obligation.name}</div>
                  <div style={{ fontSize: 11, color: "#B3261E", marginTop: 2 }}>Due: {fmtDate(obligation.due_date)}</div>
                  <div style={{ fontSize: 11, color: "#66786F" }}>Estimate: {obligation.estimated_amount ? fmt(num(obligation.estimated_amount)) : "To be defined"}</div>
                </div>
              ))}
              {pendingObligations.length === 0 && <div style={{ fontSize: 12, color: "#66786F" }}>No pending obligations recorded.</div>}
            </Card>
            <Btn variant="primary" onClick={() => setStep(2)} fullWidth icon={<ChevronRight size={14} />}>Continue to assumptions</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B" }}>Assumptions and parameters</div>
              <Badge label={parameters.some((item) => item.reviewed) ? "Partially reviewed" : "Review required"} color="#8A6400" bg="#FBF4E2" border="#E9D49C" />
            </div>

            <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#8A6400", lineHeight: 1.6 }}>
              <Info size={13} style={{ display: "inline", marginRight: 5 }} />
              The parameters are configuration values. The accountant must review and confirm them before using this estimate.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#F5F8F6" }}>
                    {["Parameter", "Value", "Unit", "Source / note", "Review"].map((header) => (
                      <th key={header} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.07)", whiteSpace: "nowrap" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parameters.map((row, index) => (
                    <tr key={row.id} style={{ backgroundColor: index % 2 === 0 ? "#fff" : "#FAFCFB" }}>
                      <td style={{ padding: "11px 14px", fontWeight: 600, color: "#33433B" }}>{row.label}</td>
                      <td style={{ padding: "11px 14px", color: "#33433B", fontWeight: 700 }}>{parameterValue(row)}</td>
                      <td style={{ padding: "11px 14px", color: "#66786F" }}>{unitLabel(row.unit)}</td>
                      <td style={{ padding: "11px 14px", color: "#66786F", fontSize: 12 }}>{row.source || "No source recorded"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <Badge label={row.reviewed ? "Reviewed" : "Not reviewed"} color={row.reviewed ? "#1B5E3F" : "#66786F"} bg={row.reviewed ? "#E3F1E8" : "#EEF2F0"} border={row.reviewed ? "#9CCDB1" : "#D3DDD8"} />
                      </td>
                    </tr>
                  ))}
                  {parameters.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#66786F", fontSize: 12 }}>No tax parameters configured. The estimate will stay pending configuration.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ backgroundColor: "#EEF2F0", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontSize: 12, color: "#66786F" }}>
              If configured and reviewed parameters are missing, the estimate is shown as <strong>"pending configuration"</strong>. Obligations are never inferred automatically.
            </div>
          </Card>

          <div style={{ display: "flex", gap: 12 }}>
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn variant="primary" onClick={() => setStep(3)} icon={<ChevronRight size={14} />}>Continue to reserve plan</Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 20 }}>Build plan version</div>

            {draft && (
              <MlNote>
                {`Projected income and expenses come from the model forecast for ${draft.period} (first forecast month). You set the reserve target: income minus expenses is not a tax or a mandatory reserve. Saving creates a new version; reviewed versions never change.`}
              </MlNote>
            )}

            {actionError && <InlineError message={actionError} />}
            {actionMessage && (
              <div style={{ backgroundColor: "#E3F1E8", border: "1px solid #9CCDB1", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <CheckCircle size={18} color="#2E8A5C" />
                <div style={{ fontSize: 12, color: "#1B5E3F", fontWeight: 600 }}>{actionMessage}</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 8 }}>
              <Field label="Plan name">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Period">
                <input value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="2026-10" style={inputStyle} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Projected income for the period *">
                <input type="number" min="0" step="0.01" value={form.projected_income} onChange={(event) => setForm({ ...form, projected_income: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Projected expenses for the period *">
                <input type="number" min="0" step="0.01" value={form.projected_expenses} onChange={(event) => setForm({ ...form, projected_expenses: event.target.value })} style={inputStyle} />
              </Field>
            </div>

            <Field label="Plan reserve target" hint="Value set by the accountant. It is a planning decision, not a computed tax.">
              <input type="number" min="0" step="0.01" value={form.estimated_reserve} onChange={(event) => setForm({ ...form, estimated_reserve: event.target.value })} placeholder="0.00" style={inputStyle} />
            </Field>

            <Field label="Notes" hint="They are saved with the version and kept in the history.">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Assumptions, pending items or notes for the accountant…" style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <div style={{ backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 10, padding: "10px 14px", marginTop: 4, fontSize: 11, color: "#8A6400" }}>
              Guidance plan subject to accounting review. It is not an official tax assessment.
            </div>

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 22, paddingTop: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#33433B", marginBottom: 10 }}>Record reserve</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Reserve amount">
                  <input type="number" min="0" step="0.01" value={reserveForm.amount} onChange={(event) => setReserveForm({ ...reserveForm, amount: event.target.value })} placeholder="0.00" style={inputStyle} />
                </Field>
                <Field label="Date">
                  <input type="date" value={reserveForm.reserved_on} onChange={(event) => setReserveForm({ ...reserveForm, reserved_on: event.target.value })} style={inputStyle} />
                </Field>
              </div>
              <Field label="Note">
                <input value={reserveForm.note} onChange={(event) => setReserveForm({ ...reserveForm, note: event.target.value })} placeholder="Reserve detail" style={inputStyle} />
              </Field>
              <Btn variant="secondary" icon={<Plus size={13} />} onClick={addReserve} small>{reserveSaving ? "Recording…" : "Record reserve"}</Btn>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B", marginBottom: 16 }}>Plan summary</div>
              {[
                { label: "Projected income", value: fmt(projectedIncome), note: "Value entered by the user", color: "#1B5E3F" },
                { label: "Projected expenses", value: fmt(projectedExpenses), note: "Value entered by the user", color: "#33433B" },
                { label: "Projected difference", value: fmt(projectedResult), note: "Reserve base; not an assessed tax", color: projectedResult >= 0 ? "#24714D" : "#B3261E" },
                { label: "Plan reserve target", value: fmt(reserveTargetInput), note: "Set by the accountant", color: "#154D33" },
                { label: "Recorded reserves", value: fmt(reservesTotal), note: "Sum of reserve records", color: "#33433B" },
              ].map((row) => (
                <div key={row.label} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 12, color: "#66786F" }}>{row.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: row.color }}>{row.value}</div>
                  <div style={{ fontSize: 10, color: "#9AABA2" }}>{row.note}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#66786F", marginTop: 10, lineHeight: 1.5 }}>
                These figures are not equivalent to each other. The reserve is a planning decision, not an official assessment.
              </div>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn variant="primary" icon={<Save size={13} />} fullWidth onClick={savePlan}>{saving ? "Saving…" : "Save plan version"}</Btn>
              <Btn
                variant="ghost"
                icon={<Flag size={13} />}
                fullWidth
                onClick={reviewSavedPlan}
                disabled={!savedPlan?.version}
              >
                {reviewing ? "Marking…" : versionReviewed ? "Version already reviewed" : "Mark as reviewed"}
              </Btn>
              <Btn variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => setStep(2)} fullWidth>Back to assumptions</Btn>
            </div>

            {(savedPlan || planDetail) && (
              <Card style={{ padding: "16px 18px" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#33433B", marginBottom: 8 }}>Current version</div>
                <div style={{ fontSize: 12, color: "#66786F", lineHeight: 1.7 }}>
                  Plan: {savedPlan?.name ?? planDetail?.name}<br />
                  Version: v{savedPlan?.version?.version ?? latestVersion?.version ?? planDetail?.current_version}<br />
                  Status: {savedPlan?.version?.status === "reviewed" || latestVersion?.status === "reviewed" ? "Reviewed (read-only)" : "Draft"}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
