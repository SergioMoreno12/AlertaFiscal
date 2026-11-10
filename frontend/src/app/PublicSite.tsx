/**
 * Public site: what the visitor sees before signing in.
 *
 * Three tabs (overview, project phases, PGC) and the sign-in and sign-up forms. The texts are
 * written in both languages here, so this subtree is skipped by the DOM translator
 * (`data-i18n-skip`) and simply re-renders when the language changes.
 */
import { useEffect, useState } from "react";
import {
  ArrowRight, BarChart2, BookOpen, Brain, Building2, Calculator, CheckCircle2, ClipboardList,
  Cpu, Database, FileText, Flag, Layers, LineChart, LogIn, Menu, ShieldCheck, Sparkles,
  Target, UserPlus, Users, X,
} from "lucide-react";
import { login as apiLogin, register as apiRegister, type SessionUser } from "../api/auth.api";
import { ApiError } from "../api/client";
import { COMPANY_SECTORS, COMPANY_SIZES } from "../api/fiscal.api";
import type { Lang } from "../i18n";
import { C, font } from "./theme";

export type PublicView = "home" | "phases" | "pgc" | "login" | "register";

type Props = {
  lang: Lang;
  onLang: (lang: Lang) => void;
  onAuthenticated: (user: SessionUser) => void;
  backendOnline: boolean;
  backendChecked: boolean;
  initialView?: PublicView;
};

const pick = (lang: Lang, en: string, es: string) => (lang === "es" ? es : en);

// ─── Shared pieces ───────────────────────────────────────────────────────────

const Section = ({ children, tone = "white", id }: { children: React.ReactNode; tone?: "white" | "tint" | "dark"; id?: string }) => (
  <section
    id={id}
    className="lp-section"
    style={{
      backgroundColor: tone === "dark" ? C.g900 : tone === "tint" ? C.g50 : C.white,
      color: tone === "dark" ? C.white : C.text,
    }}
  >
    <div className="lp-container">{children}</div>
  </section>
);

const Eyebrow = ({ children, light }: { children: React.ReactNode; light?: boolean }) => (
  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: light ? C.g300 : C.g600, marginBottom: 10 }}>
    {children}
  </div>
);

const H2 = ({ children, light }: { children: React.ReactNode; light?: boolean }) => (
  <h2 style={{ fontSize: "clamp(24px, 3.2vw, 34px)", lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 800, margin: "0 0 14px", color: light ? C.white : C.ink }}>
    {children}
  </h2>
);

const Lead = ({ children, light }: { children: React.ReactNode; light?: boolean }) => (
  <p style={{ fontSize: 16, lineHeight: 1.65, margin: "0 0 8px", color: light ? "rgba(255,255,255,0.78)" : C.muted, maxWidth: 720 }}>{children}</p>
);

const MlTag = ({ lang }: { lang: Lang }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, backgroundColor: C.g700, color: C.white, fontSize: 11, fontWeight: 700, letterSpacing: "0.02em" }}>
    <Sparkles size={11} /> {pick(lang, "Machine learning", "Machine learning")}
  </span>
);

const PrimaryButton = ({ children, onClick, type = "button", disabled, full }: { children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; full?: boolean }) => (
  <button type={type} onClick={onClick} disabled={disabled} className="lp-btn lp-btn-primary" style={{ width: full ? "100%" : undefined, opacity: disabled ? 0.7 : 1, cursor: disabled ? "wait" : "pointer" }}>
    {children}
  </button>
);

const GhostButton = ({ children, onClick, light }: { children: React.ReactNode; onClick?: () => void; light?: boolean }) => (
  <button type="button" onClick={onClick} className={light ? "lp-btn lp-btn-ghost-light" : "lp-btn lp-btn-ghost"}>
    {children}
  </button>
);

// ─── Header ──────────────────────────────────────────────────────────────────

const Header = ({ view, onView, lang, onLang }: { view: PublicView; onView: (v: PublicView) => void; lang: Lang; onLang: (l: Lang) => void }) => {
  const [open, setOpen] = useState(false);
  const tabs: Array<{ id: PublicView; label: string }> = [
    { id: "home", label: pick(lang, "Overview", "Inicio") },
    { id: "phases", label: pick(lang, "Project phases", "Fases del proyecto") },
    { id: "pgc", label: "PGC" },
  ];
  const go = (v: PublicView) => {
    setOpen(false);
    onView(v);
  };
  return (
    <header className="lp-header">
      <div className="lp-container lp-header-row">
        <button type="button" onClick={() => go("home")} className="lp-brand" aria-label="AlertaFiscal">
          <span className="lp-logo"><Calculator size={18} color={C.white} /></span>
          <span>
            <span style={{ display: "block", fontWeight: 800, fontSize: 16, color: C.g800, letterSpacing: "-0.02em", lineHeight: 1 }}>AlertaFiscal</span>
            <span style={{ display: "block", fontSize: 10.5, color: C.muted, marginTop: 3 }}>{pick(lang, "Tax planning with ML", "Planeación fiscal con ML")}</span>
          </span>
        </button>

        <nav className={open ? "lp-tabs lp-tabs-open" : "lp-tabs"} aria-label={pick(lang, "Sections", "Secciones")}>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => go(tab.id)} className={view === tab.id ? "lp-tab lp-tab-active" : "lp-tab"} aria-current={view === tab.id ? "page" : undefined}>
              {tab.label}
            </button>
          ))}
          <div className="lp-tabs-mobile-actions">
            <button type="button" className="lp-tab" onClick={() => go("register")}>{pick(lang, "Create account", "Crear cuenta")}</button>
            <button type="button" className="lp-tab" onClick={() => go("login")}>{pick(lang, "Sign in", "Iniciar sesión")}</button>
          </div>
        </nav>

        <div className="lp-header-actions">
          <div className="lp-lang" role="group" aria-label={pick(lang, "Language", "Idioma")}>
            {(["es", "en"] as const).map((code) => (
              <button key={code} type="button" onClick={() => onLang(code)} aria-pressed={lang === code} className={lang === code ? "lp-lang-btn lp-lang-active" : "lp-lang-btn"}>
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => go("register")} className="lp-btn lp-btn-ghost lp-hide-sm">
            {pick(lang, "Create account", "Crear cuenta")}
          </button>
          <button type="button" onClick={() => go("login")} className="lp-btn lp-btn-primary">
            <LogIn size={15} /> <span className="lp-hide-xs">{pick(lang, "Sign in", "Iniciar sesión")}</span>
          </button>
          <button type="button" className="lp-menu-btn" onClick={() => setOpen((v) => !v)} aria-label={pick(lang, "Menu", "Menú")} aria-expanded={open}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
};

// ─── Overview ────────────────────────────────────────────────────────────────

const HomeView = ({ lang, onView }: { lang: Lang; onView: (v: PublicView) => void }) => {
  const steps = [
    { icon: <Database size={20} />, title: pick(lang, "1. Enter your data", "1. Ingresa tus datos"), text: pick(lang, "Record the income and expenses of each month (at least 6 closed months), one by one or as monthly totals.", "Registra los ingresos y gastos de cada mes (mínimo 6 meses cerrados), uno a uno o como totales mensuales.") },
    { icon: <Brain size={20} />, title: pick(lang, "2. The model forecasts", "2. El modelo pronostica"), text: pick(lang, "A random forest trained offline forecasts income and expenses for the next 6 months.", "Un random forest entrenado offline pronostica ingresos y gastos de los próximos 6 meses.") },
    { icon: <ClipboardList size={20} />, title: pick(lang, "3. You plan the reserve", "3. Planeas la reserva"), text: pick(lang, "The forecast becomes a plan version. The accountant sets the reserve target and reviews it.", "El pronóstico se vuelve una versión del plan. El contador fija la meta de reserva y la revisa.") },
    { icon: <Flag size={20} />, title: pick(lang, "4. Alerts and follow-up", "4. Alertas y seguimiento"), text: pick(lang, "ERP rules compare plan, reserve and history; monitoring compares the forecast with real values.", "Reglas del ERP comparan plan, reserva e historial; el monitoreo compara el pronóstico con los valores reales.") },
  ];
  const stats = [
    { value: "−40 %", label: pick(lang, "income error vs. the seasonal baseline (75 unseen companies)", "error en ingresos frente al baseline estacional (75 empresas no vistas)") },
    { value: "12,3 %", label: pick(lang, "median normalized error in income (criterion ≤ 15 %)", "mediana del error normalizado en ingresos (criterio ≤ 15 %)") },
    { value: "6", label: pick(lang, "months forecast for income and expenses", "meses pronosticados de ingresos y gastos") },
    { value: "12/12", label: pick(lang, "acceptance checks passed in the official evaluation", "comprobaciones de aceptación superadas en la evaluación oficial") },
  ];
  return (
    <>
      <section className="lp-hero">
        <div className="lp-container lp-hero-grid">
          <div>
            <div className="lp-pill"><Sparkles size={13} /> {pick(lang, "Knowledge Management Project · Universidad de Cundinamarca", "Proyecto de Gestión del Conocimiento · Universidad de Cundinamarca")}</div>
            <h1 className="lp-hero-title">
              {pick(lang, "Plan your SME's tax reserve with a 6-month forecast", "Planea la reserva fiscal de tu pyme con un pronóstico a 6 meses")}
            </h1>
            <p className="lp-hero-lead">
              {pick(
                lang,
                "AlertaFiscal is a web ERP that uses machine learning to forecast monthly income and expenses, so the owner and the accountant can set money aside before taxes are due.",
                "AlertaFiscal es un ERP web que usa machine learning para pronosticar los ingresos y gastos mensuales, para que el dueño y el contador separen el dinero antes de que lleguen los impuestos.",
              )}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
              <PrimaryButton onClick={() => onView("register")}><UserPlus size={16} /> {pick(lang, "Create a free account", "Crear cuenta gratis")}</PrimaryButton>
              <GhostButton light onClick={() => onView("phases")}>{pick(lang, "See how it was built", "Ver cómo se construyó")} <ArrowRight size={15} /></GhostButton>
            </div>
          </div>

          <div className="lp-hero-card" aria-hidden="true">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.g800 }}>{pick(lang, "Forecast · next 6 months", "Pronóstico · próximos 6 meses")}</span>
              <MlTag lang={lang} />
            </div>
            <svg viewBox="0 0 320 140" width="100%" height="140" role="presentation">
              {[0, 1, 2, 3].map((i) => <line key={i} x1="0" x2="320" y1={20 + i * 35} y2={20 + i * 35} stroke={C.line} strokeWidth="1" />)}
              <polyline fill="none" stroke={C.g800} strokeWidth="2.5" points="0,92 30,86 60,95 90,80 120,84 150,72" />
              <polyline fill="none" stroke={C.g400} strokeWidth="2.5" strokeDasharray="6 5" points="150,72 180,66 210,70 240,58 270,62 300,50" />
              <circle cx="150" cy="72" r="4" fill={C.g800} />
              <rect x="150" y="10" width="160" height="125" fill={C.g100} opacity="0.45" rx="6" />
            </svg>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginTop: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 3, backgroundColor: C.g800, display: "inline-block" }} /> {pick(lang, "Your recorded data", "Tus datos registrados")}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `3px dashed ${C.g400}`, display: "inline-block" }} /> {pick(lang, "Model result", "Resultado del modelo")}</span>
            </div>
          </div>
        </div>
      </section>

      <Section>
        <Eyebrow>{pick(lang, "How it works", "Cómo funciona")}</Eyebrow>
        <H2>{pick(lang, "From your records to a reserve plan", "De tus registros a un plan de reserva")}</H2>
        <div className="lp-grid-4" style={{ marginTop: 28 }}>
          {steps.map((step) => (
            <div key={step.title} className="lp-card">
              <div className="lp-icon">{step.icon}</div>
              <div style={{ fontWeight: 700, color: C.ink, margin: "14px 0 6px", fontSize: 15 }}>{step.title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: C.muted }}>{step.text}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div className="lp-split">
          <div>
            <Eyebrow>{pick(lang, "What is machine learning here", "Qué es machine learning aquí")}</Eyebrow>
            <H2>{pick(lang, "You always know which numbers come from the model", "Siempre sabes qué cifras vienen del modelo")}</H2>
            <Lead>
              {pick(
                lang,
                "Inside the app, every value produced by the model carries the green Machine learning tag, with the model version and the months of history it used. Everything else is your own data or a rule of the ERP.",
                "Dentro de la app, cada valor producido por el modelo lleva la etiqueta verde Machine learning, con la versión del modelo y los meses de historia que usó. Todo lo demás son tus datos o una regla del ERP.",
              )}
            </Lead>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { tag: <MlTag lang={lang} />, text: pick(lang, "6-month forecast of income and expenses, its use as a plan scenario, and the monitoring of its error.", "Pronóstico de 6 meses de ingresos y gastos, su uso como escenario del plan y el monitoreo de su error.") },
              { tag: <span className="lp-chip">{pick(lang, "Your data", "Tus datos")}</span>, text: pick(lang, "Income, expenses, monthly totals, obligations and plans that you record.", "Ingresos, gastos, totales mensuales, obligaciones y planes que registras.") },
              { tag: <span className="lp-chip">{pick(lang, "ERP rule", "Regla del ERP")}</span>, text: pick(lang, "Alerts: reserve below target, plan vs. forecast gap ≥ 15 %, stale forecast. The model does not predict penalties.", "Alertas: reserva bajo la meta, diferencia plan vs. pronóstico ≥ 15 %, pronóstico desactualizado. El modelo no predice sanciones.") },
            ].map((row, index) => (
              <div key={index} className="lp-card" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, minWidth: 120 }}>{row.tag}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: C.text }}>{row.text}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="dark">
        <Eyebrow light>{pick(lang, "Evaluation", "Evaluación")}</Eyebrow>
        <H2 light>{pick(lang, "Results of the official evaluation", "Resultados de la evaluación oficial")}</H2>
        <Lead light>
          {pick(
            lang,
            "Run once on 75 companies the model never saw, under a protocol fixed before seeing any result. The data is semi-synthetic: it shows that the method works, not that it is equally accurate for every real company.",
            "Corrida una sola vez sobre 75 empresas que el modelo nunca vio, con un protocolo fijado antes de ver resultados. Los datos son semi-sintéticos: muestran que el método funciona, no que tenga la misma precisión en toda empresa real.",
          )}
        </Lead>
        <div className="lp-grid-4" style={{ marginTop: 28 }}>
          {stats.map((stat) => (
            <div key={stat.value} className="lp-stat">
              <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: C.white }}>{stat.value}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.72)", marginTop: 6 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="lp-cta">
          <div>
            <H2>{pick(lang, "Test the model with your own data", "Prueba el modelo con tus propios datos")}</H2>
            <Lead>{pick(lang, "Create an account, register your company and load at least 6 closed months. The forecast is ready in seconds.", "Crea una cuenta, registra tu empresa y carga al menos 6 meses cerrados. El pronóstico está listo en segundos.")}</Lead>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <PrimaryButton onClick={() => onView("register")}><UserPlus size={16} /> {pick(lang, "Create account", "Crear cuenta")}</PrimaryButton>
            <GhostButton onClick={() => onView("login")}>{pick(lang, "I already have an account", "Ya tengo cuenta")}</GhostButton>
          </div>
        </div>
      </Section>
    </>
  );
};

// ─── Project phases ──────────────────────────────────────────────────────────

type Phase = { n: number; crisp: [string, string]; title: [string, string]; goal: [string, string]; done: Array<[string, string]>; result: [string, string]; docs: string };

const PHASES: Phase[] = [
  {
    n: 1, crisp: ["Business and data understanding", "Comprensión del negocio y de los datos"],
    title: ["Business and data understanding", "Comprensión del negocio y de los datos"],
    goal: ["Define the problem, the users, the metric and the success criterion before training anything.", "Definir el problema, los usuarios, la métrica y el criterio de éxito antes de entrenar cualquier modelo."],
    done: [
      ["Users: SME owner and accountant with several clients.", "Usuarios: dueño de la pyme y contador con varios clientes."],
      ["Target: monthly income and expenses, 6 months ahead (regression, not risk classification).", "Objetivo: ingresos y gastos mensuales a 6 meses (regresión, no clasificación de riesgo)."],
      ["Alert rules documented as a consequence of the forecast.", "Reglas de alerta documentadas como consecuencia del pronóstico."],
    ],
    result: ["Criterion: ≥ 10 % better than the seasonal baseline in MAE and median normalized MAE ≤ 15 %.", "Criterio: ≥ 10 % mejor que el baseline estacional en MAE y mediana del MAE normalizado ≤ 15 %."],
    docs: "docs/01_business_and_data.md · docs/03_alert_rules.md",
  },
  {
    n: 2, crisp: ["Data engineering", "Ingeniería de datos"],
    title: ["Data preparation", "Preparación de los datos"],
    goal: ["Build a reproducible dataset, because no public data of monthly SME income exists.", "Construir un dataset reproducible, porque no existen datos públicos de ingresos mensuales de pymes."],
    done: [
      ["Calibrated with Supersociedades (10,000 companies) and DIAN monthly collection.", "Calibrado con Supersociedades (10.000 empresas) y el recaudo mensual de la DIAN."],
      ["500 companies × 36 months = 18,000 rows; SHA-256 per file.", "500 empresas × 36 meses = 18.000 filas; SHA-256 por archivo."],
      ["Split: train months 1–24, validation 25–30, test 31–36, 75 holdout companies.", "División: entrenamiento meses 1–24, validación 25–30, prueba 31–36 y 75 empresas reservadas."],
    ],
    result: ["Semi-synthetic, reproducible dataset that passes 26 of 26 checks.", "Dataset semi-sintético y reproducible que pasa 26 de 26 verificaciones."],
    docs: "docs/02_dataset_report.md · docs/02_dataset_card.md",
  },
  {
    n: 3, crisp: ["Model engineering", "Ingeniería del modelo"],
    title: ["Modeling", "Modelado"],
    goal: ["Compare candidate models on validation only and export the best one.", "Comparar modelos candidatos solo en validación y exportar el mejor."],
    done: [
      ["Features: position in the history, month of the year, lags 1–3; series scaled by the mean of the last 3 months.", "Variables: posición en la historia, mes del año, rezagos 1–3; serie escalada por la media de los últimos 3 meses."],
      ["Candidates: seasonal naive, linear regression, random forest and MLP (40 fits).", "Candidatos: seasonal naive, regresión lineal, random forest y MLP (40 ajustes)."],
      ["Random forest exported to JSON and run in pure Python; 50 parity cases equal to scikit-learn.", "Random forest exportado a JSON y ejecutado en Python puro; 50 casos de paridad iguales a scikit-learn."],
    ],
    result: ["Validation MAE: random forest 17.3 vs. 27.9 baseline, 35.9 linear, 45.5 MLP (millions COP/month).", "MAE en validación: random forest 17,3 vs. 27,9 baseline, 35,9 lineal, 45,5 MLP (millones COP/mes)."],
    docs: "docs/03_model_selection.md",
  },
  {
    n: 4, crisp: ["Model evaluation", "Evaluación del modelo"],
    title: ["Evaluation", "Evaluación"],
    goal: ["Run one official evaluation under a protocol tagged in Git before reading any test row.", "Correr una única evaluación oficial con un protocolo etiquetado en Git antes de leer datos de prueba."],
    done: [
      ["Temporal test (425 companies) and holdout test (75 unseen companies).", "Prueba temporal (425 empresas) y prueba con empresas no vistas (75)."],
      ["Leakage review of every feature and split.", "Revisión de fuga de información en cada variable y división."],
    ],
    result: ["Accepted: 12 of 12 checks. Holdout income MAE 23.7 vs. 39.7 baseline (−40 %); median normalized error 12.3 % / 11.8 %.", "Aceptado: 12 de 12 comprobaciones. MAE de ingresos en no vistas 23,7 vs. 39,7 del baseline (−40 %); error normalizado mediano 12,3 % / 11,8 %."],
    docs: "docs/04_evaluation_protocol.md · docs/04_evaluation_report.md",
  },
  {
    n: 5, crisp: ["Deployment", "Despliegue"],
    title: ["Integration into the ERP", "Integración en el ERP"],
    goal: ["Use the evaluated model inside a web ERP that SMEs and accountants can operate.", "Usar el modelo evaluado dentro de un ERP web que pymes y contadores puedan operar."],
    done: [
      ["React + TypeScript frontend, Flask + PostgreSQL backend, deployed on Render with Supabase.", "Frontend React + TypeScript, backend Flask + PostgreSQL, desplegado en Render con Supabase."],
      ["Each forecast stores the model version, its hash and the signature of the history used.", "Cada pronóstico guarda la versión del modelo, su hash y la firma del historial usado."],
      ["With fewer than 6 months the app offers manual planning instead of inventing a forecast.", "Con menos de 6 meses la app ofrece planificación manual en lugar de inventar un pronóstico."],
    ],
    result: ["Forecast → plan → reserve → alerts working online, with roles and isolation per company.", "Pronóstico → plan → reserva → alertas funcionando en línea, con roles y aislamiento por empresa."],
    docs: "docs/erp/ · backend/model_artifacts/",
  },
  {
    n: 6, crisp: ["Monitoring and maintenance", "Monitoreo y mantenimiento"],
    title: ["Monitoring and operation", "Monitoreo y operación"],
    goal: ["Detect when the model stops working and define how to act.", "Detectar cuándo el modelo deja de funcionar y definir cómo actuar."],
    done: [
      ["Each forecast month is compared with the real value when the month closes.", "Cada mes pronosticado se compara con el valor real cuando el mes cierra."],
      ["Status normal / watch / degraded against the evaluation reference.", "Estado normal / vigilancia / degradado frente a la referencia de la evaluación."],
      ["Retraining and rollback procedure; privacy and retention rules.", "Procedimiento de reentrenamiento y reversión; reglas de privacidad y retención."],
    ],
    result: ["15 of 15 required test cases passed; backend test suite green in CI.", "15 de 15 casos de prueba requeridos superados; pruebas del backend en verde en CI."],
    docs: "docs/06_monitoring.md · docs/06_test_cases.md",
  },
];

const PhasesView = ({ lang }: { lang: Lang }) => {
  const [active, setActive] = useState(1);
  const phase = PHASES.find((p) => p.n === active) ?? PHASES[0];
  const t = (pair: [string, string]) => (lang === "es" ? pair[1] : pair[0]);
  return (
    <>
      <section className="lp-page-head">
        <div className="lp-container">
          <Eyebrow light>{pick(lang, "Project phases", "Fases del proyecto")}</Eyebrow>
          <h1 className="lp-page-title">{pick(lang, "How AlertaFiscal was built, phase by phase", "Cómo se construyó AlertaFiscal, fase por fase")}</h1>
          <p className="lp-hero-lead" style={{ maxWidth: 760 }}>
            {pick(
              lang,
              "The project follows CRISP-ML(Q), the CRISP-DM process model adapted to machine learning with quality assurance at every phase. The criterion was set before modeling and the protocol before evaluating, and each phase left a document in the repository.",
              "El proyecto sigue CRISP-ML(Q), el modelo de proceso CRISP-DM adaptado a machine learning con aseguramiento de calidad en cada fase. El criterio se definió antes de modelar y el protocolo antes de evaluar, y cada fase dejó un documento en el repositorio.",
            )}
          </p>
        </div>
      </section>

      <Section>
        <div className="lp-phase-track" role="tablist" aria-label={pick(lang, "Phases", "Fases")}>
          {PHASES.map((p) => (
            <button key={p.n} type="button" role="tab" aria-selected={p.n === active} onClick={() => setActive(p.n)} className={p.n === active ? "lp-phase-step lp-phase-step-active" : "lp-phase-step"}>
              <span className="lp-phase-num">{p.n}</span>
              <span className="lp-phase-name">{t(p.title)}</span>
              <span className="lp-phase-cdio">CRISP-ML(Q) · {t(p.crisp)}</span>
            </button>
          ))}
        </div>

        <div className="lp-phase-detail" role="tabpanel">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="lp-chip">{pick(lang, "Phase", "Fase")} {phase.n}</span>
              <span className="lp-chip">CRISP-ML(Q) · {t(phase.crisp)}</span>
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: "6px 0 10px", letterSpacing: "-0.02em" }}>{t(phase.title)}</h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: C.muted, margin: 0 }}>{t(phase.goal)}</p>
            <div style={{ marginTop: 22, fontSize: 12, fontWeight: 700, color: C.g700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{pick(lang, "What was done", "Qué se hizo")}</div>
            <ul className="lp-list">
              {phase.done.map((item) => (
                <li key={item[0]}><CheckCircle2 size={16} color={C.g600} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t(item)}</span></li>
              ))}
            </ul>
          </div>
          <div className="lp-result">
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.g300, textTransform: "uppercase", letterSpacing: "0.08em" }}><Target size={14} /> {pick(lang, "Result", "Resultado")}</div>
            <p style={{ fontSize: 16, lineHeight: 1.6, margin: "10px 0 18px", color: C.white }}>{t(phase.result)}</p>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{pick(lang, "Documents", "Documentos")}</div>
            <code style={{ fontSize: 12, color: C.g200, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{phase.docs}</code>
            <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
              <button type="button" className="lp-btn lp-btn-ghost-light" disabled={active === 1} onClick={() => setActive((n) => Math.max(1, n - 1))} style={{ opacity: active === 1 ? 0.4 : 1 }}>{pick(lang, "Previous", "Anterior")}</button>
              <button type="button" className="lp-btn lp-btn-ghost-light" disabled={active === PHASES.length} onClick={() => setActive((n) => Math.min(PHASES.length, n + 1))} style={{ opacity: active === PHASES.length ? 0.4 : 1 }}>{pick(lang, "Next", "Siguiente")}</button>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="tint">
        <Eyebrow>{pick(lang, "All phases at a glance", "Todas las fases de un vistazo")}</Eyebrow>
        <div className="lp-timeline">
          {PHASES.map((p) => (
            <div key={p.n} className="lp-timeline-item">
              <span className="lp-timeline-dot">{p.n}</span>
              <div>
                <div style={{ fontWeight: 700, color: C.ink, fontSize: 15 }}>{t(p.title)}</div>
                <div style={{ fontSize: 12, color: C.g700, fontWeight: 600, marginTop: 2 }}>CRISP-ML(Q) · {t(p.crisp)}</div>
                <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.55, marginTop: 4 }}>{t(p.result)}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
};

// ─── PGC (Anexo 1 format of the Faculty of Engineering) ──────────────────────

/** Data of the PGC proposal (Annex 1). An empty value is shown as pending. */
export const PGC_INFO = {
  program: "Ingeniería de Sistemas y Computación",
  campus: "Extensión Chía",
  cycle: "Ciclo II · Profundización (VI semestre)",
  members: ["Jonathan Alejandro Yacuma Rivera", "Manuel Eduardo Alarcón Aza"],
};

const PgcRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="lp-pgc-row">
    <div className="lp-pgc-label">{label}</div>
    <div className="lp-pgc-value">{children}</div>
  </div>
);

const PgcBlock = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="lp-card" style={{ padding: 0, overflow: "hidden" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 22px", borderBottom: `1px solid ${C.line}`, backgroundColor: C.g50 }}>
      <span style={{ color: C.g700, display: "flex" }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: "-0.01em" }}>{title}</h3>
    </div>
    <div style={{ padding: "18px 22px" }}>{children}</div>
  </div>
);

const PgcView = ({ lang }: { lang: Lang }) => {
  const pending = <span style={{ color: C.warn, fontStyle: "italic" }}>{pick(lang, "To be confirmed", "Por confirmar")}</span>;
  const products: Array<[string, string, boolean]> = [
    ["PGC summary document", "Documento síntesis de PGC", true],
    ["Software", "Software", true],
    ["Information system", "Sistema de información", true],
    ["Prototype", "Prototipo", false],
    ["Scientific article", "Artículo científico", false],
    ["Poster / talk", "Póster - Ponencia", false],
    ["Community of practice and knowledge networks", "Comunidad de práctica y redes de conocimiento", false],
    ["Scientific or academic event", "Evento científico o académico", false],
    ["Digital content production", "Producción de contenidos digitales", false],
    ["Web development", "Desarrollo Web", true],
    ["Course creation", "Creación de cursos", false],
    ["Entrepreneurship and innovation", "Emprendimiento e innovación", false],
  ];
  const t = (pair: [string, string]) => (lang === "es" ? pair[1] : pair[0]);
  return (
    <>
      <section className="lp-page-head">
        <div className="lp-container">
          <Eyebrow light>{pick(lang, "Knowledge Management Project", "Proyecto de Gestión del Conocimiento")}</Eyebrow>
          <h1 className="lp-page-title">PGC · AlertaFiscal</h1>
          <p className="lp-hero-lead" style={{ maxWidth: 780 }}>
            {pick(
              lang,
              "Proposal presented in the format of Annex 1 of the Faculty of Engineering guidelines for Knowledge Management Projects (approved by the Faculty Council, minutes 07 of 2023).",
              "Propuesta presentada en el formato del Anexo 1 de los lineamientos de la Facultad de Ingeniería para los Proyectos de Gestión del Conocimiento (aprobados por el Consejo de Facultad, acta 07 de 2023).",
            )}
          </p>
        </div>
      </section>

      <Section>
        <div className="lp-pgc-grid">
          <PgcBlock icon={<FileText size={18} />} title={pick(lang, "General information", "Datos generales")}>
            <PgcRow label={pick(lang, "Program", "Programa")}>{PGC_INFO.program}</PgcRow>
            <PgcRow label={pick(lang, "Campus", "Sede")}>{PGC_INFO.campus || pending}</PgcRow>
            <PgcRow label={pick(lang, "Project type", "Tipo de proyecto")}>
              {pick(lang, "Technological project: software product and information system.", "Proyecto tecnológico: producto de software y sistema de información.")}
            </PgcRow>
            <PgcRow label={pick(lang, "Cycle", "Ciclo")}>{PGC_INFO.cycle || pending}</PgcRow>
            <PgcRow label={pick(lang, "Articulating CADI", "CADI articulador")}>
              Machine Learning
            </PgcRow>
            <PgcRow label={pick(lang, "Research line", "Línea de investigación")}>
              {pick(lang, "Learning, knowledge, technologies, communication and digitalization (Agreement 09 of 2021).", "Aprendizaje, conocimiento, tecnologías, comunicación y digitalización (Acuerdo 09 de 2021).")}
            </PgcRow>
          </PgcBlock>

          <PgcBlock icon={<Users size={18} />} title={pick(lang, "Project members", "Integrantes del proyecto")}>
            <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px" }}>{pick(lang, "Groups of 2 students, as required by item 6 of the protocol.", "Grupos de 2 estudiantes, como pide el ítem 6 del protocolo.")}</p>
            {PGC_INFO.members.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                <span className="lp-avatar">{name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <span style={{ fontWeight: 600, color: C.ink, fontSize: 14 }}>{name}</span>
              </div>
            ))}
          </PgcBlock>
        </div>

        <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
          <PgcBlock icon={<BookOpen size={18} />} title={pick(lang, "Project title", "Título del proyecto")}>
            <p style={{ fontSize: 17, fontWeight: 700, color: C.g800, margin: 0, lineHeight: 1.45 }}>
              {pick(lang, "Development of an intelligent web system for SME tax planning using machine learning techniques", "Desarrollo de un sistema web inteligente para la planificación fiscal de pymes mediante técnicas de machine learning")}
            </p>
          </PgcBlock>

          <PgcBlock icon={<Target size={18} />} title={pick(lang, "Problem statement and justification", "Planteamiento del problema y justificación")}>
            <p className="lp-p">{pick(lang, "Small Colombian businesses pay VAT, income tax and withholdings out of the same cash they use to operate, and they usually learn how much they owe when the filing date arrives. The accountant reviews several companies with data that may be incomplete or scattered.", "Las pymes colombianas pagan IVA, renta y retenciones con el mismo efectivo que usan para operar, y suelen saber cuánto deben cuando llega la fecha de declarar. El contador revisa varias empresas con datos que pueden estar incompletos o dispersos.")}</p>
            <p className="lp-p"><strong>{pick(lang, "Question:", "Pregunta:")}</strong> {pick(lang, "can a model forecast income and expenses well enough to plan a tax reserve?", "¿puede un modelo pronosticar ingresos y gastos con utilidad suficiente para planificar una reserva fiscal?")}</p>
            <p className="lp-p" style={{ marginBottom: 0 }}>{pick(lang, "Anticipating income and expenses gives margin to plan the reserve, inside the ERP where the SME and the accountant already work, with an honest and traceable evaluation.", "Anticipar ingresos y gastos da margen para planear la reserva, dentro del ERP donde la pyme y el contador ya trabajan, con una evaluación honesta y trazable.")}</p>
          </PgcBlock>

          <PgcBlock icon={<Flag size={18} />} title={pick(lang, "Project objectives", "Objetivos del proyecto")}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{pick(lang, "General objective", "Objetivo general")}</div>
            <p className="lp-p">{pick(lang, "Develop a web system that forecasts the monthly income and expenses of SMEs 6 months ahead with machine learning and uses those forecasts to plan tax reserves.", "Desarrollar un sistema web que pronostique los ingresos y gastos mensuales de pymes a 6 meses con machine learning y use esos pronósticos para planificar reservas fiscales.")}</p>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 6 }}>{pick(lang, "Specific objectives", "Objetivos específicos")}</div>
            <ol className="lp-ol">
              <li>{pick(lang, "Define the problem, the metric and the success criterion before modeling.", "Definir el problema, la métrica y el criterio de éxito antes de modelar.")}</li>
              <li>{pick(lang, "Build a reproducible dataset calibrated with public Colombian sources.", "Construir un dataset reproducible calibrado con fuentes públicas colombianas.")}</li>
              <li>{pick(lang, "Compare candidate models and export the selected one.", "Comparar modelos candidatos y exportar el seleccionado.")}</li>
              <li>{pick(lang, "Evaluate over time and on companies the model never saw.", "Evaluar en el tiempo y en empresas que el modelo nunca vio.")}</li>
              <li>{pick(lang, "Integrate and monitor the model inside the web ERP.", "Integrar y monitorear el modelo dentro del ERP web.")}</li>
            </ol>
          </PgcBlock>

          <PgcBlock icon={<Layers size={18} />} title={pick(lang, "Reference framework", "Marco referencial")}>
            <ul className="lp-list" style={{ marginTop: 0 }}>
              {[
                ["Time series and temporal validation (Hyndman & Athanasopoulos, 2021).", "Series temporales y validación temporal (Hyndman y Athanasopoulos, 2021)."],
                ["Random forest (Breiman, 2001); a strong baseline is required (M4, Makridakis et al., 2018).", "Random forest (Breiman, 2001); un baseline fuerte es obligatorio (M4, Makridakis et al., 2018)."],
                ["Concept drift and monitoring (Gama et al., 2014); technical debt in ML systems (Sculley et al., 2015).", "Deriva de concepto y monitoreo (Gama et al., 2014); deuda técnica en sistemas de ML (Sculley et al., 2015)."],
                ["Knowledge management: tacit to explicit (Nonaka & Takeuchi), data with context (Davenport & Prusak).", "Gestión del conocimiento: de tácito a explícito (Nonaka y Takeuchi), datos con contexto (Davenport y Prusak)."],
              ].map((item) => (
                <li key={item[0]}><CheckCircle2 size={16} color={C.g600} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t(item as [string, string])}</span></li>
              ))}
            </ul>
          </PgcBlock>

          <PgcBlock icon={<Cpu size={18} />} title={pick(lang, "Methodology and development schedule", "Metodología a utilizar y cronograma de desarrollo")}>
            <p className="lp-p">{pick(lang, "CRISP-ML(Q) (Studer et al., 2021): the CRISP-DM process model adapted to machine learning, with quality assurance in every phase. Item 1 of the protocol lets the project propose its own strategy when it shows a strict engineering process; CRISP-ML(Q) is the standard process for machine learning projects and each phase closes with a verifiable deliverable.", "CRISP-ML(Q) (Studer et al., 2021): el modelo de proceso CRISP-DM adaptado a machine learning, con aseguramiento de calidad en cada fase. El ítem 1 del protocolo permite proponer una estrategia propia que evidencie un proceso estricto de ingeniería; CRISP-ML(Q) es el proceso estándar para proyectos de machine learning y cada fase cierra con un entregable verificable.")}</p>
            <div className="lp-crisp">
              {PHASES.map((p) => (
                <div key={p.n} className="lp-cdio-item">
                  <div className="lp-cdio-letter">{p.n}</div>
                  <div style={{ fontWeight: 700, color: C.ink }}>{t(p.crisp)}</div>
                  <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginTop: 6 }}>{t(p.goal)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.g700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "20px 0 8px" }}>{pick(lang, "Deliveries of the academic period (protocol items 9 – 12)", "Entregas del periodo académico (ítems 9 – 12 del protocolo)")}</div>
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead><tr><th>{pick(lang, "Week", "Semana")}</th><th>{pick(lang, "Delivery", "Entrega")}</th></tr></thead>
                <tbody>
                  <tr><td>5</td><td>{pick(lang, "Proposal or progress report with adjustments", "Propuesta o informe de avance con ajustes")}</td></tr>
                  <tr><td>10</td><td>{pick(lang, "Progress report of the solution with a strict engineering process", "Informe de avance de la solución con un proceso estricto de ingeniería")}</td></tr>
                  <tr><td>12</td><td>{pick(lang, "Presentation before the cycle evaluation committee", "Sustentación ante el comité evaluador del ciclo")}</td></tr>
                  <tr><td>14</td><td>{pick(lang, "Final grade published", "Publicación de la calificación final")}</td></tr>
                </tbody>
              </table>
            </div>
          </PgcBlock>

          <PgcBlock icon={<BarChart2 size={18} />} title={pick(lang, "Expected products", "Productos esperados")}>
            <div className="lp-products">
              {products.map(([en, es, checked]) => (
                <div key={en} className={checked ? "lp-product lp-product-on" : "lp-product"}>
                  <span className="lp-check" aria-hidden="true">{checked ? "✓" : ""}</span>
                  <span>{lang === "es" ? es : en}</span>
                </div>
              ))}
            </div>
          </PgcBlock>

          <PgcBlock icon={<ShieldCheck size={18} />} title={pick(lang, "Knowledge management in the product", "Gestión del conocimiento en el producto")}>
            <ul className="lp-list" style={{ marginTop: 0 }}>
              {[
                ["The accountant's criterion becomes explicit in rules, versioned plans and observations.", "El criterio del contador queda explícito en reglas, planes versionados y observaciones."],
                ["Every forecast keeps its model version, hash and the history it used: knowledge with context.", "Cada pronóstico conserva la versión del modelo, su hash y el historial que usó: conocimiento con contexto."],
                ["Changes enter by Pull Request with CI; criterion and protocol were frozen in Git before seeing results.", "Los cambios entran por Pull Request con CI; criterio y protocolo se congelaron en Git antes de ver resultados."],
                ["Monitoring compares forecast and real value; 2 consecutive degraded months trigger a review.", "El monitoreo compara pronóstico y valor real; 2 meses seguidos degradado activan una revisión."],
              ].map((item) => (
                <li key={item[0]}><CheckCircle2 size={16} color={C.g600} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t(item as [string, string])}</span></li>
              ))}
            </ul>
          </PgcBlock>

          <PgcBlock icon={<LineChart size={18} />} title={pick(lang, "References", "Referencias bibliográficas")}>
            <ul className="lp-refs">
              <li>Studer, S., Bui, T. B., Drescher, C., Hanuschkin, A., Winkler, L., Peters, S., &amp; Müller, K.-R. (2021). Towards CRISP-ML(Q): A machine learning process model with quality assurance methodology. <em>Machine Learning and Knowledge Extraction, 3</em>(2), 392–413.</li>
              <li>Breiman, L. (2001). Random forests. <em>Machine Learning, 45</em>(1), 5–32.</li>
              <li>Davenport, T. H., &amp; Prusak, L. (1998). <em>Working knowledge</em>. Harvard Business School Press.</li>
              <li>Gama, J., Žliobaitė, I., Bifet, A., Pechenizkiy, M., &amp; Bouchachia, A. (2014). A survey on concept drift adaptation. <em>ACM Computing Surveys, 46</em>(4).</li>
              <li>Hyndman, R. J., &amp; Athanasopoulos, G. (2021). <em>Forecasting: principles and practice</em> (3rd ed.). OTexts.</li>
              <li>Makridakis, S., Spiliotis, E., &amp; Assimakopoulos, V. (2018). The M4 Competition. <em>International Journal of Forecasting, 34</em>(4), 802–808.</li>
              <li>Nonaka, I., &amp; Takeuchi, H. (1995). <em>The knowledge-creating company</em>. Oxford University Press.</li>
              <li>Sculley, D., et al. (2015). Hidden technical debt in machine learning systems. <em>NeurIPS 28</em>.</li>
              <li>Universidad de Cundinamarca, Facultad de Ingeniería (2023). <em>Lineamientos para la planificación, ejecución y evaluación de los PGC</em>. Comunicado N.° 03.</li>
            </ul>
          </PgcBlock>
        </div>
      </Section>
    </>
  );
};

// ─── Auth forms ──────────────────────────────────────────────────────────────

const friendlyError = (error: unknown, lang: Lang) => {
  if (error instanceof ApiError) {
    if (error.code === "network_error" || error.code === "timeout") {
      return pick(lang, "Could not reach the server. It may be starting (up to a minute): try again.", "No se pudo conectar con el servidor. Puede estar iniciando (hasta un minuto): intenta de nuevo.");
    }
    const es: Record<string, string> = {
      invalid_credentials: "Correo o contraseña incorrectos.",
      too_many_attempts: "Demasiados intentos. Espera unos minutos.",
      email_taken: "Ya existe una cuenta con ese correo. Inicia sesión.",
      nit_taken: "Ya hay una empresa registrada con ese NIT.",
    };
    if (lang === "es" && es[error.code]) return es[error.code];
    if (lang === "es" && error.code === "invalid_payload") return `Revisa los datos: ${error.message}`;
    return error.message;
  }
  return pick(lang, "The operation could not be completed.", "No se pudo completar la operación.");
};

const AuthShell = ({ children, title, subtitle, lang, backendOnline, backendChecked }: { children: React.ReactNode; title: string; subtitle: string; lang: Lang; backendOnline: boolean; backendChecked: boolean }) => (
  <section className="lp-auth">
    <div className="lp-auth-card">
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <span className="lp-logo" style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto 14px" }}><Calculator size={22} color={C.white} /></span>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.ink, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{title}</h1>
        <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>{subtitle}</p>
      </div>
      {children}
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 11.5, color: backendOnline ? C.g700 : C.warn }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: backendOnline ? C.g500 : "#C9A227", display: "inline-block" }} />
        {backendChecked
          ? backendOnline
            ? pick(lang, "Server connected", "Servidor conectado")
            : pick(lang, "The server is starting (up to a minute)", "El servidor está iniciando (hasta un minuto)")
          : pick(lang, "Connecting to the server…", "Conectando con el servidor…")}
      </div>
    </div>
  </section>
);

const Label = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => (
  <label htmlFor={htmlFor} style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{children}</label>
);

const FormError = ({ message }: { message: string }) => (
  <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 10, backgroundColor: C.dangerBg, color: C.danger, fontSize: 13, fontWeight: 600 }}>{message}</div>
);

const LoginForm = ({ lang, onAuthenticated, onView, backendOnline, backendChecked }: { lang: Lang; onAuthenticated: (u: SessionUser) => void; onView: (v: PublicView) => void; backendOnline: boolean; backendChecked: boolean }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setMessage(null);
    setLoading(true);
    try {
      onAuthenticated(await apiLogin(email.trim(), password));
    } catch (error) {
      setMessage(friendlyError(error, lang));
      setLoading(false);
    }
  };
  return (
    <AuthShell lang={lang} title={pick(lang, "Sign in", "Iniciar sesión")} subtitle={pick(lang, "Access your companies and forecasts", "Accede a tus empresas y pronósticos")} backendOnline={backendOnline} backendChecked={backendChecked}>
      <form onSubmit={submit} noValidate={false}>
        <div style={{ marginBottom: 16 }}>
          <Label htmlFor="lp-email">{pick(lang, "Email", "Correo electrónico")}</Label>
          <input id="lp-email" className="lp-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <Label htmlFor="lp-password">{pick(lang, "Password", "Contraseña")}</Label>
          <input id="lp-password" className="lp-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {message && <FormError message={message} />}
        <PrimaryButton type="submit" disabled={loading} full>
          <LogIn size={16} /> {loading ? (backendOnline ? pick(lang, "Signing in…", "Ingresando…") : pick(lang, "Waking up the server…", "Despertando el servidor…")) : pick(lang, "Sign in", "Iniciar sesión")}
        </PrimaryButton>
      </form>
      <p style={{ textAlign: "center", fontSize: 13.5, color: C.muted, marginTop: 18 }}>
        {pick(lang, "No account yet?", "¿Aún no tienes cuenta?")}{" "}
        <button type="button" className="lp-link" onClick={() => onView("register")}>{pick(lang, "Create one", "Crea una")}</button>
      </p>
    </AuthShell>
  );
};

const SECTOR_ES: Record<string, string> = {
  Retail: "Comercio", Services: "Servicios", Manufacturing: "Manufactura", Construction: "Construcción",
  Agriculture: "Agricultura", Mining: "Minería", Technology: "Tecnología", Other: "Otro",
};
const SIZE_ES: Record<string, string> = { Micro: "Micro", Small: "Pequeña", Medium: "Mediana", Large: "Grande" };

const RegisterForm = ({ lang, onAuthenticated, onView, backendOnline, backendChecked }: { lang: Lang; onAuthenticated: (u: SessionUser) => void; onView: (v: PublicView) => void; backendOnline: boolean; backendChecked: boolean }) => {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [withCompany, setWithCompany] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [nit, setNit] = useState("");
  const [sector, setSector] = useState<string>("Retail");
  const [size, setSize] = useState<string>("Small");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setMessage(null);
    if (password.length < 10) {
      setMessage(pick(lang, "The password must have at least 10 characters.", "La contraseña debe tener al menos 10 caracteres."));
      return;
    }
    if (password !== confirm) {
      setMessage(pick(lang, "The passwords do not match.", "Las contraseñas no coinciden."));
      return;
    }
    setLoading(true);
    try {
      const user = await apiRegister(
        fullName.trim(),
        email.trim(),
        password,
        withCompany ? { name: companyName.trim(), nit: nit.trim(), sector, size } : undefined,
      );
      onAuthenticated(user);
    } catch (error) {
      setMessage(friendlyError(error, lang));
      setLoading(false);
    }
  };

  return (
    <AuthShell lang={lang} title={pick(lang, "Create your account", "Crea tu cuenta")} subtitle={pick(lang, "Register and test the model with your own data", "Regístrate y prueba el modelo con tus propios datos")} backendOnline={backendOnline} backendChecked={backendChecked}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <Label htmlFor="rg-name">{pick(lang, "Full name", "Nombre completo")}</Label>
          <input id="rg-name" className="lp-input" required minLength={3} maxLength={160} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label htmlFor="rg-email">{pick(lang, "Email", "Correo electrónico")}</Label>
          <input id="rg-email" className="lp-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="lp-form-2">
          <div>
            <Label htmlFor="rg-pass">{pick(lang, "Password (min. 10)", "Contraseña (mín. 10)")}</Label>
            <input id="rg-pass" className="lp-input" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rg-pass2">{pick(lang, "Confirm password", "Confirmar contraseña")}</Label>
            <input id="rg-pass2" className="lp-input" type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>

        <div className="lp-segment" role="radiogroup" aria-label={pick(lang, "Company", "Empresa")}>
          <button type="button" role="radio" aria-checked={withCompany} className={withCompany ? "lp-segment-on" : ""} onClick={() => setWithCompany(true)}>
            <Building2 size={15} /> {pick(lang, "Register my company", "Registrar mi empresa")}
          </button>
          <button type="button" role="radio" aria-checked={!withCompany} className={!withCompany ? "lp-segment-on" : ""} onClick={() => setWithCompany(false)}>
            <Users size={15} /> {pick(lang, "I'll join a company", "Me unirán a una empresa")}
          </button>
        </div>

        {withCompany ? (
          <div className="lp-company-box">
            <div style={{ marginBottom: 12 }}>
              <Label htmlFor="rg-company">{pick(lang, "Company name", "Nombre de la empresa")}</Label>
              <input id="rg-company" className="lp-input" required minLength={2} maxLength={200} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Label htmlFor="rg-nit">NIT</Label>
              <input id="rg-nit" className="lp-input" required inputMode="numeric" pattern="[0-9][0-9.\-]{4,19}" placeholder="900123456-7" value={nit} onChange={(e) => setNit(e.target.value)} />
            </div>
            <div className="lp-form-2" style={{ marginBottom: 0 }}>
              <div>
                <Label htmlFor="rg-sector">{pick(lang, "Sector", "Sector")}</Label>
                <select id="rg-sector" className="lp-input" value={sector} onChange={(e) => setSector(e.target.value)}>
                  {COMPANY_SECTORS.map((s) => <option key={s} value={s}>{lang === "es" ? SECTOR_ES[s] : s}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="rg-size">{pick(lang, "Size", "Tamaño")}</Label>
                <select id="rg-size" className="lp-input" value={size} onChange={(e) => setSize(e.target.value)}>
                  {COMPANY_SIZES.map((s) => <option key={s} value={s}>{lang === "es" ? SIZE_ES[s] : s}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontSize: 12, color: C.muted, margin: "12px 0 0", lineHeight: 1.5 }}>{pick(lang, "You will be the administrator of the company and can add accountants or assistants later.", "Serás el administrador de la empresa y luego podrás agregar contadores o auxiliares.")}</p>
          </div>
        ) : (
          <p className="lp-company-box" style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
            {pick(lang, "After you sign up, give your email to the company administrator: they add you from Team in the app.", "Después de registrarte, comparte tu correo con el administrador de la empresa: él te agrega desde Equipo en la app.")}
          </p>
        )}

        {message && <FormError message={message} />}
        <PrimaryButton type="submit" disabled={loading} full>
          <UserPlus size={16} /> {loading ? pick(lang, "Creating account…", "Creando cuenta…") : pick(lang, "Create account", "Crear cuenta")}
        </PrimaryButton>
      </form>
      <p style={{ textAlign: "center", fontSize: 13.5, color: C.muted, marginTop: 18 }}>
        {pick(lang, "Already have an account?", "¿Ya tienes cuenta?")}{" "}
        <button type="button" className="lp-link" onClick={() => onView("login")}>{pick(lang, "Sign in", "Inicia sesión")}</button>
      </p>
    </AuthShell>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

const HASH_VIEWS: Record<string, PublicView> = { "#inicio": "home", "#fases": "phases", "#pgc": "pgc", "#login": "login", "#registro": "register" };
const VIEW_HASH: Record<PublicView, string> = { home: "#inicio", phases: "#fases", pgc: "#pgc", login: "#login", register: "#registro" };

export default function PublicSite({ lang, onLang, onAuthenticated, backendOnline, backendChecked, initialView }: Props) {
  const [view, setView] = useState<PublicView>(() => initialView ?? HASH_VIEWS[window.location.hash] ?? "home");

  // The tabs are reflected in the address (#fases, #pgc…) so they can be shared and the
  // browser's back button works.
  useEffect(() => {
    const onHash = () => setView(HASH_VIEWS[window.location.hash] ?? "home");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: PublicView) => {
    if (window.location.hash !== VIEW_HASH[next]) window.location.hash = VIEW_HASH[next];
    setView(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="lp-root" data-i18n-skip="" style={{ fontFamily: font }}>
      <Header view={view} onView={go} lang={lang} onLang={onLang} />
      <main>
        {view === "home" && <HomeView lang={lang} onView={go} />}
        {view === "phases" && <PhasesView lang={lang} />}
        {view === "pgc" && <PgcView lang={lang} />}
        {view === "login" && <LoginForm lang={lang} onAuthenticated={onAuthenticated} onView={go} backendOnline={backendOnline} backendChecked={backendChecked} />}
        {view === "register" && <RegisterForm lang={lang} onAuthenticated={onAuthenticated} onView={go} backendOnline={backendOnline} backendChecked={backendChecked} />}
      </main>
      <footer className="lp-footer">
        <div className="lp-container" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span>AlertaFiscal · {pick(lang, "Knowledge Management Project · Universidad de Cundinamarca", "Proyecto de Gestión del Conocimiento · Universidad de Cundinamarca")}</span>
          <span>{pick(lang, "Independent academic project. Not affiliated with the DIAN. Forecasts are planning estimates.", "Proyecto académico independiente. Sin vínculo con la DIAN. Los pronósticos son estimaciones para planear.")}</span>
        </div>
      </footer>
    </div>
  );
}
