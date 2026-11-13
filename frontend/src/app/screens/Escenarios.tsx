import { useEffect, useState } from "react";
import { ArrowLeft, BarChart2 } from "lucide-react";
import { MlBadge, MlNote } from "../ui";
import { Btn, Card, Field, InlineError, SectionHeader, errorMessage, fmt, num } from "../ui";
import { getDashboard, type Dashboard } from "../../api/fiscal.api";
import { type Screen } from "../shared";

// ESCENARIOS
export const EscenariosScreen = ({ companyId, companyName, onNav }: { companyId: number | null; companyName: string; onNav: (s: Screen) => void }) => {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incomeDelta, setIncomeDelta] = useState(-10);
  const [expenseDelta, setExpenseDelta] = useState(10);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    setLoading(true);
    getDashboard(companyId)
      .then((data) => alive && setDashboard(data))
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [companyId]);

  const forecast = dashboard?.latest_forecast ?? null;
  const baseIncome = forecast ? num(forecast.projected_income) : 0;
  const baseExpenses = forecast ? num(forecast.projected_expenses) : 0;
  const target = num(dashboard?.reserve.target);
  const reserved = num(dashboard?.reserve.reserved);
  const scenarios = [
    { key: "base", label: "Base (model forecast)", income: baseIncome, expenses: baseExpenses },
    { key: "income", label: `Income ${incomeDelta >= 0 ? "+" : ""}${incomeDelta} %`, income: baseIncome * (1 + incomeDelta / 100), expenses: baseExpenses },
    { key: "expenses", label: `Expenses ${expenseDelta >= 0 ? "+" : ""}${expenseDelta} %`, income: baseIncome, expenses: baseExpenses * (1 + expenseDelta / 100) },
  ];

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Planning scenario comparison"
        subtitle={`${companyName} · based on the latest model forecast`}
        actions={<Btn variant="ghost" small icon={<ArrowLeft size={13} />} onClick={() => onNav("planificacion")}>Back to planning</Btn>}
      />
      {error && <InlineError message={error} />}
      {loading && <div style={{ fontSize: 12, color: "#66786F" }}>Loading…</div>}

      {!loading && !forecast && (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <BarChart2 size={40} color="#9CCDB1" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "#33433B", marginBottom: 6 }}>There is no forecast yet</div>
          <p style={{ fontSize: 13, color: "#66786F", margin: "0 0 18px" }}>Scenarios start from the model forecast. Generate one first (it needs at least 6 closed months).</p>
          <Btn onClick={() => onNav("proyecciones")}>Go to forecasts</Btn>
        </Card>
      )}

      {!loading && forecast && (
        <>
          <MlNote>
            {`The base scenario is the latest forecast of the model (${forecast.horizon_months} months, version ${forecast.model_version ?? "—"}). The other two apply your own percentage to it; they are a sensitivity check, not a new prediction.`}
          </MlNote>

          <Card style={{ marginBottom: 20, padding: "18px 22px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <Field label={`Change in income: ${incomeDelta} %`}>
                <input type="range" min={-50} max={50} step={5} value={incomeDelta} onChange={(e) => setIncomeDelta(Number(e.target.value))} style={{ width: "100%", accentColor: "#1B5E3F" }} />
              </Field>
              <Field label={`Change in expenses: ${expenseDelta} %`}>
                <input type="range" min={-50} max={50} step={5} value={expenseDelta} onChange={(e) => setExpenseDelta(Number(e.target.value))} style={{ width: "100%", accentColor: "#1B5E3F" }} />
              </Field>
            </div>
          </Card>

          <Card style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#F2F8F4" }}>
                    {["Scenario", "Projected income", "Projected expenses", "Income − expenses"].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: h === "Scenario" ? "left" : "right", fontSize: 11, fontWeight: 700, color: "#66786F" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((row) => {
                    const result = row.income - row.expenses;
                    return (
                      <tr key={row.key} style={{ borderTop: "1px solid #EEF2F0" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#33433B" }}>
                          {row.label} {row.key === "base" && <MlBadge size="sm" />}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>{fmt(row.income)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>{fmt(row.expenses)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: result < 0 ? "#B3261E" : "#1B5E3F" }}>{fmt(result)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#33433B", marginBottom: 12 }}>Recorded reserve</div>
            {dashboard?.reserve.has_target ? (
              [
                { label: "Reserve target of the current plan", value: fmt(target) },
                { label: "Reserve recorded", value: fmt(reserved) },
                { label: "Missing", value: fmt(Math.max(0, target - reserved)) },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize: 13, color: "#66786F" }}>{row.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>{row.value}</span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 13, color: "#66786F" }}>No reserve target yet. Set it in Tax planning.</div>
            )}
            <div style={{ fontSize: 11, color: "#66786F", marginTop: 12 }}>Income minus expenses is not a tax. The reserve target is always set by the accountant.</div>
          </Card>
        </>
      )}
    </div>
  );
};
