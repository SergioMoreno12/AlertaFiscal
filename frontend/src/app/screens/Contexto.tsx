import { useEffect, useState } from "react";
import { RefreshCw, Info, Database, ExternalLink } from "lucide-react";
import { Badge, Btn, Card, InlineError, SectionHeader, errorMessage, fmt, fmtDate, num } from "../ui";
import { uiLocale } from "../../i18n";
import {
  getContextSummary, type ContextBenchmark, type ContextSource, type ContextSummary,
  type ContextTaxSummary,
} from "../../api/context.api";

// ─── CONTEXT AND SOURCES (SECONDARY SECTION) ─────────────────────────────────

export const licenseUi = (status: ContextSource["license"]["status"]) =>
  ({
    verified: { label: "License verified", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" },
    uncertain: { label: "License not verified", color: "#8A6400", bg: "#FBF4E2", border: "#E9D49C" },
    restricted: { label: "Restricted use", color: "#B3261E", bg: "#FBECEA", border: "#F2C9C4" },
  })[status];

export const ContextoSourceCard = ({ source }: { source: ContextSource }) => {
  const license = licenseUi(source.license.status);
  const version = source.current_version;
  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1B5E3F" }}>{source.name}</div>
          <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>{source.publisher}</div>
        </div>
        <Badge {...license} />
      </div>

      <p style={{ fontSize: 12, color: "#4E5F57", margin: "10px 0 12px", lineHeight: 1.5 }}>{source.description}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 11, color: "#66786F" }}>
        <div><strong style={{ color: "#33433B" }}>Cadence:</strong> {source.cadence}</div>
        <div><strong style={{ color: "#33433B" }}>License:</strong> {source.license.name || "Not declared"}</div>
        <div><strong style={{ color: "#33433B" }}>Current version:</strong> {version?.version_label ?? "Not loaded"}</div>
        <div><strong style={{ color: "#33433B" }}>Acquired:</strong> {version ? fmtDate(version.acquired_at) : "—"}</div>
        <div><strong style={{ color: "#33433B" }}>Cutoff:</strong> {version?.cutoff_date ? fmtDate(version.cutoff_date) : "—"}</div>
        <div><strong style={{ color: "#33433B" }}>Source rows:</strong> {version ? version.row_count.toLocaleString(uiLocale()) : "—"}</div>
      </div>

      {version && (version.is_partial || version.is_preliminary) && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#8A6400", backgroundColor: "#FBF4E2", border: "1px solid #E9D49C", borderRadius: 8, padding: "6px 10px" }}>
          {version.is_partial ? "Partial period. " : ""}
          {version.is_preliminary ? "Preliminary figures, subject to review by the publisher." : ""}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11 }}>
        <a href={source.source_url} target="_blank" rel="noreferrer" style={{ color: "#24714D", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
          <ExternalLink size={12} /> Official source
        </a>
        {source.license.url && (
          <a href={source.license.url} target="_blank" rel="noreferrer" style={{ color: "#24714D", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", fontWeight: 600 }}>
            <ExternalLink size={12} /> License terms
          </a>
        )}
        <span style={{ color: "#9AABA2" }}>Attribution: {source.attribution || "—"}</span>
      </div>
      {source.license.evidence_path && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#9AABA2" }}>Local evidence: {source.license.evidence_path}</div>
      )}
    </Card>
  );
};

export const ContextoScreen = ({ demoMode }: { demoMode: boolean }) => {
  const [summary, setSummary] = useState<ContextSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (demoMode) {
      setSummary(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getContextSummary()
      .then((data) => {
        if (alive) setSummary(data);
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
  }, [demoMode, reloadKey]);

  const tax = summary && "annual" in summary.tax ? (summary.tax as ContextTaxSummary) : null;
  const benchmarks: ContextBenchmark[] = summary?.benchmarks ?? [];
  const benchmarkYear = benchmarks[0]?.year;
  const monthName = tax?.monthly
    ? new Date(tax.monthly.year, tax.monthly.month - 1, 1).toLocaleDateString(uiLocale(), { month: "long" })
    : "";

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Context and sources"
        subtitle="Aggregated public reference information · not part of the company's operations"
        actions={<Btn variant="ghost" icon={<RefreshCw size={13} />} small onClick={() => setReloadKey((key) => key + 1)}>Refresh</Btn>}
      />

      <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, backgroundColor: "#EDF7F0", border: "1px solid #C8E4D3", color: "#24714D", fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10 }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          These figures are <strong>labeled external context</strong>. They are not tax obligations of the company,
          they are not joined by NIT and <strong>they do not feed the forecast or create alerts or tasks</strong>. DIAN collection
          is a national or departmental aggregate; Supersociedades describes the 10,000 largest companies and does not
          represent all companies.
        </div>
      </div>

      {demoMode && (
        <Card style={{ textAlign: "center", padding: "40px 24px" }}>
          <Database size={36} color="#9CCDB1" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "#33433B", marginBottom: 6 }}>Context not available in the demo</div>
          <p style={{ fontSize: 12, color: "#66786F", margin: 0 }}>
            This section uses public sources loaded in the backend. No simulated figures are shown, so they are not
            confused with real data. Sign in with a connected account to see it.
          </p>
        </Card>
      )}

      {!demoMode && loading && <div style={{ marginBottom: 16, fontSize: 12, color: "#66786F" }}>Loading context and sources…</div>}
      {!demoMode && error && <InlineError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!demoMode && !loading && !error && summary && (
        <>
          {summary.sources.length === 0 ? (
            <Card style={{ textAlign: "center", padding: "40px 24px" }}>
              <Database size={36} color="#9CCDB1" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#33433B", marginBottom: 6 }}>No sources loaded</div>
              <p style={{ fontSize: 12, color: "#66786F", margin: 0 }}>
                Run the acquisition and the manifest load to enable this section. Missing data is not an
                ERP error: the sources are loaded explicitly and outside the application startup.
              </p>
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 24 }}>
                {summary.sources.map((source) => (
                  <ContextoSourceCard key={source.code} source={source} />
                ))}
              </div>

              {tax && (
                <Card style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>DIAN collection · national reference</div>
                      <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>Version {tax.version_label} · original unit: millions of COP · shown in current pesos (COP)</div>
                    </div>
                    {(tax.annual.is_preliminary || tax.monthly?.is_preliminary) && (
                      <Badge label="Preliminary" color="#8A6400" bg="#FBF4E2" border="#E9D49C" />
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                    <div style={{ backgroundColor: "#F5F8F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#66786F", fontWeight: 600 }}>Annual total {tax.annual.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.annual.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#9AABA2", marginTop: 2 }}>Aggregated gross collection, not an individual obligation</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F8F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#66786F", fontWeight: 600 }}>
                        {tax.monthly ? `Latest published month · ${monthName} ${tax.monthly.year}` : "Latest published month"}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>
                        {tax.monthly ? fmt(num(tax.monthly.total_cop)) : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#9AABA2", marginTop: 2 }}>National monthly series</div>
                    </div>
                    <div style={{ backgroundColor: "#F5F8F6", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, color: "#66786F", fontWeight: 600 }}>Regional offices {tax.departments.year}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#1B5E3F", marginTop: 4 }}>{fmt(num(tax.departments.total_cop))}</div>
                      <div style={{ fontSize: 10, color: "#9AABA2", marginTop: 2 }}>Sum of regional offices</div>
                    </div>
                  </div>
                </Card>
              )}

              {benchmarks.length > 0 && (
                <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
                  <div style={{ padding: "18px 22px 12px" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1B5E3F" }}>Supersociedades sector reference · {benchmarkYear}</div>
                    <div style={{ fontSize: 11, color: "#66786F", marginTop: 2 }}>
                      Aggregate of the 10,000 largest companies. A biased sample; it is not an average of all companies.
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F5F8F6" }}>
                          {["Metric", "Sample", "Total", "Median", "Mean", "At zero", "Negative"].map((header) => (
                            <th key={header} style={{ padding: "10px 14px", textAlign: header === "Metric" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#66786F", borderBottom: "1px solid rgba(0,0,0,0.06)", whiteSpace: "nowrap" }}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {benchmarks.map((row) => (
                          <tr key={row.metric}>
                            <td style={{ padding: "10px 14px", fontWeight: 600, color: "#33433B" }}>{row.metric_label}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#66786F" }}>{row.sample_size.toLocaleString(uiLocale())}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(row.total_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(row.median_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#33433B" }}>{fmt(num(row.mean_cop))}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#66786F" }}>{row.zero_count.toLocaleString(uiLocale())}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#66786F" }}>{row.negative_count.toLocaleString(uiLocale())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "10px 22px", fontSize: 10, color: "#9AABA2", borderTop: "1px solid rgba(0,0,0,0.06)", backgroundColor: "#FAFCFB" }}>
                    Values converted from trillions (10¹² COP) to pesos. No precision is added beyond the published one.
                  </div>
                </Card>
              )}

              <div style={{ fontSize: 11, color: "#8A9A92", lineHeight: 1.6 }}>
                The original and processed files are kept outside git; the versioned manifests record the hash,
                cutoff date, period and status. To reproduce: <code>python -m ml.company_trainer.sources.acquire</code> and{" "}
                <code>python -m ml.company_trainer.sources.build_context</code>, then <code>flask context-load</code>. See
                <code> docs/erp/sources.md</code> and <code>docs/erp/data-dictionary.md</code>.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
