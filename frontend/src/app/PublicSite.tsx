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

type Pair = [string, string];
type Phase = {
  n: number;
  crisp: Pair;
  title: Pair;
  owner: string;
  question: Pair;
  goal: Pair;
  activities: Pair[];
  quality: Pair[];
  decisions: Array<{ what: Pair; why: Pair }>;
  figures: Array<{ value: string; label: Pair }>;
  deliverables: Array<{ file: string; what: Pair }>;
  limits: Pair[];
  result: Pair;
};

const PHASES: Phase[] = [
  {
    n: 1,
    crisp: ["Business and data understanding", "Comprensión del negocio y de los datos"],
    title: ["Business and data understanding", "Comprensión del negocio y de los datos"],
    owner: "Sergio Steeven Moreno Forero",
    question: ["What decision must the model support, and what does “good enough” mean before training anything?", "¿Qué decisión debe apoyar el modelo y qué significa “suficientemente bueno” antes de entrenar nada?"],
    goal: ["Define the problem, the users, the target, the metrics and the success criterion, and take stock of the public data available.", "Definir el problema, los usuarios, la variable objetivo, las métricas y el criterio de éxito, y hacer el inventario de los datos públicos disponibles."],
    activities: [
      ["Described the problem: SMEs pay VAT, income tax and withholdings out of their operating cash and learn what they owe when the filing date arrives.", "Se describió el problema: las pymes pagan IVA, renta y retenciones con su caja de operación y saben cuánto deben cuando llega la fecha de declarar."],
      ["Identified two users: the SME owner and the accountant who manages several clients.", "Se identificaron dos usuarios: el dueño de la pyme y el contador que maneja varios clientes."],
      ["Framed the task as supervised regression over time series: monthly income and expenses, 6 months ahead, from the company's own history.", "Se planteó la tarea como regresión supervisada sobre series de tiempo: ingresos y gastos mensuales a 6 meses, a partir del historial de la propia empresa."],
      ["Chose the metrics: MAE and RMSE as main metrics, MAPE as secondary, and an MAE normalized by the company's mean monthly income.", "Se eligieron las métricas: MAE y RMSE como principales, MAPE como secundaria y un MAE normalizado por el ingreso mensual medio de la empresa."],
      ["Inventoried two public sources: Supersociedades (10,000 largest companies, annual) and DIAN (monthly tax collection, national).", "Se inventariaron dos fuentes públicas: Supersociedades (10.000 empresas más grandes, anual) y DIAN (recaudo mensual, nacional)."],
      ["Listed five known data problems (rounding, bimonthly VAT, national totals, only large companies, unit confusion) with their treatment.", "Se listaron cinco problemas de datos conocidos (redondeo, IVA bimestral, totales nacionales, solo empresas grandes, confusión de unidades) con su tratamiento."],
      ["Wrote the alert rules as a consequence of the forecast, and what the system will not do.", "Se escribieron las reglas de alerta como consecuencia del pronóstico y lo que el sistema no hará."],
    ],
    quality: [
      ["Success criterion fixed and approved by the four members (November 3, 2026) before any model existed.", "Criterio de éxito fijado y aprobado por los cuatro integrantes (3 de noviembre de 2026) antes de que existiera cualquier modelo."],
      ["Honesty statement: the data is semi-synthetic and is never presented as real company data.", "Declaración de honestidad: los datos son semi-sintéticos y nunca se presentan como datos de empresas reales."],
      ["Risk table with mitigation for each risk (short history, leakage, users reading the forecast as tax advice, Law 1581 of 2012).", "Tabla de riesgos con su mitigación (historial corto, fuga de información, usuarios que lean el pronóstico como asesoría tributaria, Ley 1581 de 2012)."],
    ],
    decisions: [
      { what: ["Forecast income and expenses, not tax risk or penalties.", "Pronosticar ingresos y gastos, no riesgo tributario ni sanciones."], why: ["There are no public labels of penalties per company, and the decision to support is how much cash to reserve.", "No hay etiquetas públicas de sanciones por empresa, y la decisión a apoyar es cuánto efectivo reservar."] },
      { what: ["Seasonal naive as the baseline to beat.", "Seasonal naive como baseline a superar."], why: ["“Same month last year” is simple and strong for seasonal series; a model that does not beat it is not worth its complexity.", "“El mismo mes del año anterior” es simple y fuerte en series estacionales; un modelo que no lo supera no justifica su complejidad."] },
      { what: ["Error normalized by income, judged by the median and the 90th percentile.", "Error normalizado por el ingreso, juzgado con la mediana y el percentil 90."], why: ["Companies differ about 100 times in size; the median keeps very small companies from dominating.", "Las empresas difieren unas 100 veces en tamaño; la mediana evita que las empresas muy pequeñas dominen el resultado."] },
    ],
    figures: [
      { value: "≥ 10 %", label: ["better than the baseline in MAE", "mejor que el baseline en MAE"] },
      { value: "≤ 15 %", label: ["median normalized MAE", "mediana del MAE normalizado"] },
      { value: "≤ 30 %", label: ["90th percentile of normalized MAE", "percentil 90 del MAE normalizado"] },
      { value: "6", label: ["months of horizon", "meses de horizonte"] },
    ],
    deliverables: [
      { file: "docs/01_business_and_data.md", what: ["Problem, users, metrics, criterion, data inventory, risks and scope.", "Problema, usuarios, métricas, criterio, inventario de datos, riesgos y alcance."] },
      { file: "docs/03_alert_rules.md", what: ["Alert rules applied to the forecast.", "Reglas de alerta aplicadas al pronóstico."] },
    ],
    limits: [
      ["Only 36 months per company: three observations of each calendar month.", "Solo 36 meses por empresa: tres observaciones de cada mes del año."],
      ["No public monthly data of small businesses exists, so the data has to be built.", "No existen datos públicos mensuales de pymes, así que los datos deben construirse."],
    ],
    result: ["A measurable success criterion, approved before modeling: at least 10 % better than the baseline in MAE, median normalized MAE ≤ 15 % and 90th percentile ≤ 30 %.", "Un criterio de éxito medible y aprobado antes de modelar: al menos 10 % mejor que el baseline en MAE, mediana del MAE normalizado ≤ 15 % y percentil 90 ≤ 30 %."],
  },
  {
    n: 2,
    crisp: ["Data engineering", "Ingeniería de datos"],
    title: ["Data preparation", "Preparación de los datos"],
    owner: "Samuel Castellanos Rivera",
    question: ["How can a realistic and reproducible dataset be built when no public monthly SME data exists?", "¿Cómo construir un dataset realista y reproducible si no existen datos públicos mensuales de pymes?"],
    goal: ["Generate a semi-synthetic dataset calibrated with real public statistics, split it without leakage and prove that it is reproducible.", "Generar un dataset semi-sintético calibrado con estadísticas públicas reales, dividirlo sin fuga de información y demostrar que es reproducible."],
    activities: [
      ["Computed margins and growth per sector from Supersociedades records with income ≥ 0.5 trillion COP, where rounding does not distort them.", "Se calcularon márgenes y crecimiento por sector con los registros de Supersociedades de ingresos ≥ 0,5 billones COP, donde el redondeo no los distorsiona."],
      ["Estimated expenses as income minus profit, and excluded absurd values (margins outside −50 % … +60 %, growth outside −50 % … +100 %).", "Se estimaron los gastos como ingresos menos utilidad y se excluyeron valores absurdos (márgenes fuera de −50 % … +60 %, crecimiento fuera de −50 % … +100 %)."],
      ["Built the seasonal shape from DIAN collection: averaged the bimonthly VAT pairs, shifted them two months back and excluded the COVID years 2020–2021.", "Se construyó la forma estacional con el recaudo de la DIAN: se promediaron los pares bimestrales de IVA, se corrieron dos meses atrás y se excluyeron los años COVID 2020–2021."],
      ["Generated 36 months per company with growth, seasonality, noise and, for 72 companies, a permanent level shift as a hard case.", "Se generaron 36 meses por empresa con crecimiento, estacionalidad, ruido y, para 72 empresas, un cambio de nivel permanente como caso difícil."],
      ["Rescaled every company to small-business size (annual income between COP 300 and 6,000 million) keeping its size rank.", "Se reescaló cada empresa a tamaño pyme (ingreso anual entre COP 300 y 6.000 millones) conservando su posición de tamaño."],
      ["Split by time and by company, and wrote a 26-check verification script.", "Se dividió por tiempo y por empresa, y se escribió un script de 26 verificaciones."],
    ],
    quality: [
      ["Fixed random seed (42): running the four scripts again produces byte-identical files, proven by SHA-256.", "Semilla aleatoria fija (42): al correr de nuevo los cuatro scripts los archivos salen idénticos byte a byte, comprobado con SHA-256."],
      ["26 of 26 checks: columns, rows, no gaps, no duplicates, no nulls, no negatives, split rules and holdout coverage per sector.", "26 de 26 verificaciones: columnas, filas, sin huecos, sin duplicados, sin nulos, sin negativos, reglas de división y cobertura del holdout por sector."],
      ["The file with the true generating parameters is never used as model input; real tax ids never reach an output file.", "El archivo con los parámetros reales del generador nunca se usa como entrada del modelo; los NIT reales nunca llegan a un archivo de salida."],
    ],
    decisions: [
      { what: ["Semi-synthetic data instead of invented numbers.", "Datos semi-sintéticos en lugar de cifras inventadas."], why: ["Each profile comes from real margins, growth and seasonality, so the series behave like real businesses.", "Cada perfil sale de márgenes, crecimiento y estacionalidad reales, así que las series se comportan como negocios reales."] },
      { what: ["75 companies reserved as holdout.", "75 empresas reservadas como holdout."], why: ["To measure, at the end, how the model behaves on companies it never saw: the situation of a new user of the app.", "Para medir al final cómo se comporta el modelo con empresas que nunca vio: la situación de un usuario nuevo de la app."] },
      { what: ["DIAN used only for the shape of seasonality.", "La DIAN se usa solo para la forma de la estacionalidad."], why: ["Its figures are national totals; using them as a company's values would be wrong.", "Sus cifras son totales nacionales; usarlas como valores de una empresa sería un error."] },
    ],
    figures: [
      { value: "500", label: ["companies (301 from real records, 199 simulated)", "empresas (301 de registros reales, 199 simuladas)"] },
      { value: "18.000", label: ["company-months, 2023-01 to 2025-12", "meses-empresa, 2023-01 a 2025-12"] },
      { value: "6", label: ["sectors", "sectores"] },
      { value: "26/26", label: ["checks passed", "verificaciones superadas"] },
    ],
    deliverables: [
      { file: "docs/02_dataset_report.md", what: ["Generation method, parameters, split, checks and limitations.", "Método de generación, parámetros, división, verificaciones y limitaciones."] },
      { file: "docs/02_dataset_card.md · 02_data_dictionary.md", what: ["Dataset card and data dictionary.", "Ficha del dataset y diccionario de datos."] },
      { file: "ml/data/processed/", what: ["monthly_series.csv and split_manifest.csv.", "monthly_series.csv y split_manifest.csv."] },
    ],
    limits: [
      ["Margins come from large companies; small businesses may differ.", "Los márgenes vienen de empresas grandes; las pymes pueden ser distintas."],
      ["About 30 % of company-months are losses (retail's real median margin is 1.8 %).", "Cerca del 30 % de los meses-empresa son pérdidas (el margen mediano real del comercio es 1,8 %)."],
      ["All sectors share one national seasonal shape.", "Todos los sectores comparten una sola forma estacional nacional."],
    ],
    result: ["A reproducible semi-synthetic dataset of 500 companies × 36 months, split into train (months 1–24), validation (25–30), test (31–36) and 75 holdout companies, passing 26 of 26 checks.", "Un dataset semi-sintético reproducible de 500 empresas × 36 meses, dividido en entrenamiento (meses 1–24), validación (25–30), prueba (31–36) y 75 empresas holdout, que pasa 26 de 26 verificaciones."],
  },
  {
    n: 3,
    crisp: ["Model engineering", "Ingeniería del modelo"],
    title: ["Modeling", "Modelado"],
    owner: "Jonathan Alejandro Yacuma Rivera",
    question: ["Which model forecasts better than the baseline and can still run inside the web server?", "¿Qué modelo pronostica mejor que el baseline y aun así puede ejecutarse dentro del servidor web?"],
    goal: ["Design the features, compare candidate models only on validation, select one and export it so the backend can run it without scikit-learn.", "Diseñar las variables, comparar modelos candidatos solo en validación, seleccionar uno y exportarlo para que el backend lo ejecute sin scikit-learn."],
    activities: [
      ["Built six features from the target series only: position in the history (t), month of the year as sine and cosine, and lags 1–3.", "Se construyeron seis variables solo con la serie objetivo: posición en el historial (t), mes del año como seno y coseno, y rezagos 1–3."],
      ["Scaled each series by the mean of its last three months (mean_last_n, n = 3), so companies of very different sizes share one model.", "Se escaló cada serie por la media de sus últimos tres meses (mean_last_n, n = 3), para que empresas de tamaños muy distintos compartan un modelo."],
      ["Trained one model per target (income and expenses) on months 1–24 and forecast months 25–30 recursively.", "Se entrenó un modelo por objetivo (ingresos y gastos) con los meses 1–24 y se pronosticaron los meses 25–30 de forma recursiva."],
      ["Compared four candidates in 40 fits: seasonal naive, linear regression, random forest (6 combinations) and MLP (12 combinations).", "Se compararon cuatro candidatos en 40 ajustes: seasonal naive, regresión lineal, random forest (6 combinaciones) y MLP (12 combinaciones)."],
      ["Broke the error down by horizon, sector and company size.", "Se desglosó el error por horizonte, sector y tamaño de empresa."],
      ["Exported the forest to JSON and wrote a pure-Python predictor with the backend's algorithm.", "Se exportó el bosque a JSON y se escribió un predictor en Python puro con el algoritmo del backend."],
    ],
    quality: [
      ["Test and holdout rows are filtered out before any computation; selection uses validation only.", "Las filas de prueba y holdout se descartan antes de cualquier cálculo; la selección usa solo validación."],
      ["Every feature comes from past months; inside the recursion each prediction feeds the next lag, never the real value.", "Toda variable viene de meses pasados; dentro de la recursión cada predicción alimenta el siguiente rezago, nunca el valor real."],
      ["Parity test: 50 companies, 600 points; maximum difference with scikit-learn below 1e-15 (tolerance 1e-6).", "Prueba de paridad: 50 empresas, 600 puntos; diferencia máxima con scikit-learn menor a 1e-15 (tolerancia 1e-6)."],
    ],
    decisions: [
      { what: ["Random forest selected (100 trees, depth 8 for income and 6 for expenses).", "Se seleccionó random forest (100 árboles, profundidad 8 para ingresos y 6 para gastos)."], why: ["Lowest validation MAE, stable across the horizon, and exportable.", "Menor MAE en validación, estable a lo largo del horizonte y exportable."] },
      { what: ["MLP kept only as a comparison.", "La MLP quedó solo como comparación."], why: ["It was worse than the baseline (45.5) and the backend cannot run a neural network.", "Fue peor que el baseline (45,5) y el backend no puede ejecutar una red neuronal."] },
      { what: ["Sector is not a feature.", "El sector no es una variable."], why: ["The ERP cannot guarantee a clean sector value, so training on it would break the contract with serving.", "El ERP no garantiza un valor limpio de sector, así que entrenar con él rompería el contrato con la producción."] },
    ],
    figures: [
      { value: "17,3", label: ["random forest validation MAE (M COP/month)", "MAE en validación del random forest (M COP/mes)"] },
      { value: "27,9", label: ["seasonal naive baseline", "baseline seasonal naive"] },
      { value: "−38 %", label: ["error vs. the baseline", "error frente al baseline"] },
      { value: "1,41 MB", label: ["exported model (JSON)", "modelo exportado (JSON)"] },
    ],
    deliverables: [
      { file: "docs/03_model_selection.md", what: ["Features, candidates, results by horizon, sector and size, selection and export.", "Variables, candidatos, resultados por horizonte, sector y tamaño, selección y exportación."] },
      { file: "ml/artifacts/model_global.json", what: ["Exported model, version global-20261103-84df89b5.", "Modelo exportado, versión global-20261103-84df89b5."] },
      { file: "ml/artifacts/parity_cases.json", what: ["50 parity cases the backend replays in its tests.", "50 casos de paridad que el backend repite en sus pruebas."] },
    ],
    limits: [
      ["A single validation window (months 25–30); the ranking could change with another one.", "Una sola ventana de validación (meses 25–30); el orden podría cambiar con otra."],
      ["Sudden level changes are only reflected after three months of the new level enter the history.", "Los cambios bruscos de nivel solo se reflejan cuando tres meses del nuevo nivel entran al historial."],
    ],
    result: ["Random forest selected: validation MAE 17.3 vs. 27.9 baseline, 35.9 linear regression and 45.5 MLP (millions COP/month), exported and equal to scikit-learn.", "Random forest seleccionado: MAE en validación 17,3 vs. 27,9 del baseline, 35,9 de la regresión lineal y 45,5 de la MLP (millones COP/mes), exportado e igual a scikit-learn."],
  },
  {
    n: 4,
    crisp: ["Model evaluation", "Evaluación del modelo"],
    title: ["Evaluation", "Evaluación"],
    owner: "Manuel Eduardo Alarcón Aza",
    question: ["Does the model meet the criterion on months and companies nobody used to train or choose it?", "¿Cumple el modelo el criterio en meses y empresas que nadie usó para entrenarlo ni elegirlo?"],
    goal: ["Measure once and honestly the exact file the app will run, and give a verdict: accepted or not accepted.", "Medir una sola vez y con honestidad el archivo exacto que ejecutará la app, y dar un veredicto: aceptado o no aceptado."],
    activities: [
      ["Wrote the evaluation protocol and tagged it in Git (eval-protocol-v1) before reading any test row.", "Se escribió el protocolo de evaluación y se etiquetó en Git (eval-protocol-v1) antes de leer cualquier fila de prueba."],
      ["Reviewed Phase 3 for data leakage and exportability, file by file.", "Se revisó la Fase 3 en busca de fuga de información y exportabilidad, archivo por archivo."],
      ["Defined two scenarios: temporal test (425 companies, months 31–36) and holdout test (75 unseen companies).", "Se definieron dos escenarios: prueba temporal (425 empresas, meses 31–36) y prueba holdout (75 empresas no vistas)."],
      ["Ran the official evaluation once, on November 4, 2026, with a pure-Python predictor and the artifact identified by its SHA-256.", "Se corrió la evaluación oficial una sola vez, el 4 de noviembre de 2026, con un predictor en Python puro y el artefacto identificado por su SHA-256."],
      ["Reported MAE, RMSE, normalized MAE, MAPE and bias, by horizon, sector and size, and the 10 largest errors.", "Se reportaron MAE, RMSE, MAE normalizado, MAPE y sesgo, por horizonte, sector y tamaño, y los 10 errores más grandes."],
    ],
    quality: [
      ["Run-once rule enforced by the script: it refuses a second official run.", "Regla de una sola corrida impuesta por el script: rechaza una segunda corrida oficial."],
      ["Parity gate: the run stops before reading test rows if the predictor differs from scikit-learn.", "Compuerta de paridad: la corrida se detiene antes de leer datos de prueba si el predictor difiere de scikit-learn."],
      ["Forbidden afterwards: retraining because of test results, re-running for a better number or reporting only favorable metrics.", "Prohibido después: reentrenar por los resultados de prueba, repetir para mejorar la cifra o reportar solo métricas favorables."],
    ],
    decisions: [
      { what: ["12 acceptance checks, no partial acceptance.", "12 comprobaciones de aceptación, sin aceptación parcial."], why: ["Three conditions × two targets × two scenarios: the model passes all of them or it is not accepted.", "Tres condiciones × dos objetivos × dos escenarios: el modelo las pasa todas o no se acepta."] },
      { what: ["Holdout as the main reference.", "El holdout como referencia principal."], why: ["A company in the app was never part of training, exactly like the holdout companies.", "Una empresa en la app nunca estuvo en el entrenamiento, igual que las empresas holdout."] },
    ],
    figures: [
      { value: "12/12", label: ["acceptance checks passed", "comprobaciones de aceptación superadas"] },
      { value: "−40 %", label: ["income MAE vs. baseline on holdout (23.7 vs. 39.7)", "MAE de ingresos vs. baseline en holdout (23,7 vs. 39,7)"] },
      { value: "12,3 %", label: ["median normalized error, income (holdout)", "error normalizado mediano, ingresos (holdout)"] },
      { value: "11,8 %", label: ["median normalized error, expenses (holdout)", "error normalizado mediano, gastos (holdout)"] },
    ],
    deliverables: [
      { file: "docs/04_evaluation_protocol.md", what: ["Scenarios, metrics, acceptance criteria and run-once rule.", "Escenarios, métricas, criterios de aceptación y regla de una sola corrida."] },
      { file: "docs/04_leakage_review.md", what: ["Leakage and exportability review of Phase 3.", "Revisión de fuga de información y exportabilidad de la Fase 3."] },
      { file: "docs/04_evaluation_report.md", what: ["Official results and verdict.", "Resultados oficiales y veredicto."] },
    ],
    limits: [
      ["Test error is higher than validation, because it includes the December peak and unseen companies.", "El error de prueba es mayor que el de validación, porque incluye el pico de diciembre y empresas no vistas."],
      ["Horizons +5 and +6 are 45–70 % worse than +1, although the model beats the baseline at every horizon.", "Los horizontes +5 y +6 son 45–70 % peores que +1, aunque el modelo supera al baseline en todos."],
      ["Results describe the method on semi-synthetic data, not the accuracy for a specific real company.", "Los resultados describen el método sobre datos semi-sintéticos, no la precisión para una empresa real concreta."],
    ],
    result: ["Accepted: 12 of 12 checks. On holdout, income MAE 23.7 vs. 39.7 of the baseline (−40 %); median normalized error 12.3 % in income and 11.8 % in expenses.", "Aceptado: 12 de 12 comprobaciones. En holdout, MAE de ingresos 23,7 vs. 39,7 del baseline (−40 %); error normalizado mediano 12,3 % en ingresos y 11,8 % en gastos."],
  },
  {
    n: 5,
    crisp: ["Deployment", "Despliegue"],
    title: ["Integration into the ERP", "Integración en el ERP"],
    owner: "Manuel Eduardo Alarcón Aza",
    question: ["How does the evaluated model reach SMEs and accountants inside a tool they can operate?", "¿Cómo llega el modelo evaluado a las pymes y contadores dentro de una herramienta que puedan operar?"],
    goal: ["Integrate the evaluated model, byte for byte, into a web ERP with sign-in, roles and isolation per company, and deploy it in the cloud.", "Integrar el modelo evaluado, byte a byte, en un ERP web con inicio de sesión, roles y aislamiento por empresa, y desplegarlo en la nube."],
    activities: [
      ["Ported the base ERP into the repository and kept every module, endpoint, table and migration.", "Se trasladó el ERP base al repositorio conservando cada módulo, endpoint, tabla y migración."],
      ["Built the React + TypeScript frontend and the Flask + PostgreSQL backend, with a REST API under /api/v1.", "Se construyó el frontend en React + TypeScript y el backend en Flask + PostgreSQL, con una API REST en /api/v1."],
      ["Wrote the inference service: it validates version, hash, features and normalization of the artifact, and walks the trees in pure Python.", "Se escribió el servicio de inferencia: valida versión, hash, variables y normalización del artefacto, y recorre los árboles en Python puro."],
      ["Connected the flow forecast → plan version → reserve → alerts, where the accountant sets the reserve target.", "Se conectó el flujo pronóstico → versión del plan → reserva → alertas, donde el contador fija la meta de reserva."],
      ["Configured Docker locally, Supabase as the cloud database, Render for hosting and GitHub Actions for CI.", "Se configuró Docker en local, Supabase como base de datos en la nube, Render para el hosting y GitHub Actions para CI."],
    ],
    quality: [
      ["A test checks that the deployed file has the evaluated SHA-256; the 50 parity cases are replayed in the backend.", "Una prueba verifica que el archivo desplegado tenga el SHA-256 evaluado; los 50 casos de paridad se repiten en el backend."],
      ["Fewer than 6 months, or a missing or invalid model, return an explicit code and offer manual planning: no forecast is ever invented.", "Menos de 6 meses, o un modelo ausente o inválido, devuelven un código explícito y ofrecen planificación manual: nunca se inventa un pronóstico."],
      ["Security: Argon2id passwords, HttpOnly cookies, CSRF on every write, roles per company and 403 for another company's data.", "Seguridad: contraseñas con Argon2id, cookies HttpOnly, CSRF en cada escritura, roles por empresa y 403 ante datos de otra empresa."],
    ],
    decisions: [
      { what: ["The server does not use scikit-learn.", "El servidor no usa scikit-learn."], why: ["A JSON artifact and a small predictor keep the deployment light and make the model auditable.", "Un artefacto JSON y un predictor pequeño hacen el despliegue liviano y el modelo auditable."] },
      { what: ["Every forecast stores model version, hash and history signature.", "Cada pronóstico guarda versión del modelo, hash y firma del historial."], why: ["Any number on screen can be traced back to the exact model and data that produced it.", "Cualquier cifra en pantalla se puede rastrear al modelo y los datos exactos que la produjeron."] },
      { what: ["Horizon capped at 6 months.", "Horizonte limitado a 6 meses."], why: ["That is the horizon that was evaluated.", "Es el horizonte que se evaluó."] },
    ],
    figures: [
      { value: "49", label: ["endpoints of the ported ERP", "endpoints del ERP trasladado"] },
      { value: "22", label: ["database tables", "tablas de la base de datos"] },
      { value: "50", label: ["parity cases replayed in the backend", "casos de paridad repetidos en el backend"] },
      { value: "3", label: ["roles: admin, accountant, assistant", "roles: administrador, contador, auxiliar"] },
    ],
    deliverables: [
      { file: "docs/erp/", what: ["Architecture, API, deployment, security and traceability against the base ERP.", "Arquitectura, API, despliegue, seguridad y trazabilidad frente al ERP base."] },
      { file: "backend/model_artifacts/", what: ["The deployed model, identical to the evaluated one.", "El modelo desplegado, idéntico al evaluado."] },
      { file: "render.yaml", what: ["Blueprint that creates the backend and the frontend on Render.", "Blueprint que crea el backend y el frontend en Render."] },
    ],
    limits: [
      ["Free hosting plan: the first request after inactivity can take about a minute.", "Plan de hosting gratuito: la primera solicitud tras inactividad puede tardar cerca de un minuto."],
      ["The login rate limiter lives in memory; with several replicas it must move to a shared store.", "El limitador de intentos de inicio de sesión vive en memoria; con varias réplicas debe pasar a un almacén compartido."],
    ],
    result: ["The ERP works online: users sign up, load their history, get the 6-month forecast and turn it into a reserve plan with alerts, with roles and isolation per company.", "El ERP funciona en línea: los usuarios se registran, cargan su historial, obtienen el pronóstico a 6 meses y lo convierten en un plan de reserva con alertas, con roles y aislamiento por empresa."],
  },
  {
    n: 6,
    crisp: ["Monitoring and maintenance", "Monitoreo y mantenimiento"],
    title: ["Monitoring and operation", "Monitoreo y operación"],
    owner: "Sergio Steeven Moreno Forero",
    question: ["How do we know when the model stops working, and what do we do then?", "¿Cómo sabemos cuándo el modelo deja de funcionar y qué hacemos entonces?"],
    goal: ["Compare every forecast with the real value when the month closes, classify the error, and define how to retrain or roll back.", "Comparar cada pronóstico con el valor real cuando cierra el mes, clasificar el error y definir cómo reentrenar o revertir."],
    activities: [
      ["Each model forecast stores one row per target and month; when the month closes and its documents exist, the real value and the error are filled in.", "Cada pronóstico del modelo guarda una fila por objetivo y mes; cuando el mes cierra y existen sus documentos, se llenan el valor real y el error."],
      ["Normalized the error by the company's mean monthly income, the same definition used in the evaluation.", "Se normalizó el error por el ingreso mensual medio de la empresa, la misma definición usada en la evaluación."],
      ["Compared a 3-month rolling error with the holdout reference (12.34 % income, 11.75 % expenses).", "Se comparó un error móvil de 3 meses con la referencia del holdout (12,34 % ingresos, 11,75 % gastos)."],
      ["Recorded operational events: outcome and latency of every forecast call.", "Se registraron eventos operativos: resultado y latencia de cada llamada al pronóstico."],
      ["Wrote the retraining and rollback procedure, the privacy and retention rules, and 15 test cases.", "Se escribió el procedimiento de reentrenamiento y reversión, las reglas de privacidad y retención, y 15 casos de prueba."],
    ],
    quality: [
      ["Thresholds as closed intervals with no gaps: normal (ratio ≤ 1.0), watch (≤ 1.5), degraded (> 1.5).", "Umbrales como intervalos cerrados sin huecos: normal (razón ≤ 1,0), vigilancia (≤ 1,5), degradado (> 1,5)."],
      ["Monitoring only observes: it never changes the model or the stored forecasts.", "El monitoreo solo observa: nunca cambia el modelo ni los pronósticos guardados."],
      ["15 of 15 required cases passed, including persistence across a Render redeploy.", "15 de 15 casos requeridos superados, incluida la persistencia tras un redespliegue en Render."],
    ],
    decisions: [
      { what: ["Review after 2 consecutive degraded months.", "Revisión tras 2 meses seguidos degradado."], why: ["One bad month is expected: horizons +5 and +6 are naturally worse.", "Un mes malo es esperable: los horizontes +5 y +6 son naturalmente peores."] },
      { what: ["Retrain the global model if 20 % or more of the companies degrade together.", "Reentrenar el modelo global si 20 % o más de las empresas se degradan a la vez."], why: ["That points to drift affecting everyone, not to one company.", "Eso indica una deriva que afecta a todos, no a una sola empresa."] },
      { what: ["Every model version is kept in Git with its hash.", "Cada versión del modelo se guarda en Git con su hash."], why: ["A rollback restores the previous file and checks it against its evaluation report.", "Una reversión restaura el archivo anterior y lo verifica contra su informe de evaluación."] },
    ],
    figures: [
      { value: "3", label: ["months of rolling error", "meses de error móvil"] },
      { value: "1,0 · 1,5", label: ["watch and degraded thresholds (× reference)", "umbrales de vigilancia y degradado (× referencia)"] },
      { value: "15/15", label: ["required test cases passed", "casos de prueba requeridos superados"] },
      { value: "24", label: ["months of monitoring data kept", "meses de datos de monitoreo conservados"] },
    ],
    deliverables: [
      { file: "docs/06_monitoring.md", what: ["Reference error, thresholds, tables and where monitoring is shown.", "Error de referencia, umbrales, tablas y dónde se muestra el monitoreo."] },
      { file: "docs/06_retraining_and_rollback.md", what: ["When to act, who decides, how to retrain and how to roll back.", "Cuándo actuar, quién decide, cómo reentrenar y cómo revertir."] },
      { file: "docs/06_test_cases.md · 06_privacy_and_retention.md", what: ["The 15 test cases, and privacy and retention rules.", "Los 15 casos de prueba, y las reglas de privacidad y retención."] },
    ],
    limits: [
      ["The reference comes from semi-synthetic data; with real companies it may need recalibration.", "La referencia viene de datos semi-sintéticos; con empresas reales puede requerir recalibración."],
      ["Monitoring cannot tell a real change in the business from a data entry error; the accountant checks the data first.", "El monitoreo no distingue un cambio real del negocio de un error de digitación; el contador revisa primero los datos."],
    ],
    result: ["Each company shows a monitoring status (normal, watch or degraded) against the evaluation reference, with a documented path to retrain or roll back the model.", "Cada empresa muestra un estado de monitoreo (normal, vigilancia o degradado) frente a la referencia de la evaluación, con un camino documentado para reentrenar o revertir el modelo."],
  },
];

const DetailHeading = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="lp-detail-heading">
    <span>{icon}</span>
    {children}
  </div>
);

const PhasesView = ({ lang }: { lang: Lang }) => {
  const [active, setActive] = useState(1);
  const phase = PHASES.find((p) => p.n === active) ?? PHASES[0];
  const t = (pair: Pair) => (lang === "es" ? pair[1] : pair[0]);
  const go = (n: number) => {
    setActive(n);
    document.getElementById("phase-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
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

        <article id="phase-detail" className="lp-phase-article" role="tabpanel">
          <header className="lp-phase-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="lp-chip">{pick(lang, "Phase", "Fase")} {phase.n} / {PHASES.length}</span>
              <span className="lp-chip">CRISP-ML(Q) · {t(phase.crisp)}</span>
              <span className="lp-chip lp-chip-outline"><Users size={12} /> {pick(lang, "Owner", "Responsable")}: {phase.owner}</span>
            </div>
            <h2 className="lp-phase-title">{t(phase.title)}</h2>
            <p className="lp-phase-goal">{t(phase.goal)}</p>
            <div className="lp-question">
              <span className="lp-question-label">{pick(lang, "Key question", "Pregunta clave")}</span>
              {t(phase.question)}
            </div>
          </header>

          <div className="lp-figures">
            {phase.figures.map((figure) => (
              <div key={figure.value + figure.label[0]} className="lp-figure">
                <div className="lp-figure-value">{figure.value}</div>
                <div className="lp-figure-label">{t(figure.label)}</div>
              </div>
            ))}
          </div>

          <div className="lp-phase-columns">
            <section>
              <DetailHeading icon={<ClipboardList size={16} />}>{pick(lang, "What was done", "Qué se hizo")}</DetailHeading>
              <ol className="lp-steps">
                {phase.activities.map((item) => <li key={item[0]}>{t(item)}</li>)}
              </ol>
            </section>
            <section>
              <DetailHeading icon={<ShieldCheck size={16} />}>{pick(lang, "Quality assurance", "Aseguramiento de calidad")}</DetailHeading>
              <ul className="lp-list" style={{ marginTop: 0 }}>
                {phase.quality.map((item) => (
                  <li key={item[0]}><CheckCircle2 size={16} color={C.g600} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t(item)}</span></li>
                ))}
              </ul>
            </section>
          </div>

          <section style={{ marginTop: 28 }}>
            <DetailHeading icon={<Target size={16} />}>{pick(lang, "Key decisions and why", "Decisiones clave y por qué")}</DetailHeading>
            <div className="lp-decisions">
              {phase.decisions.map((decision) => (
                <div key={decision.what[0]} className="lp-decision">
                  <div className="lp-decision-what">{t(decision.what)}</div>
                  <div className="lp-decision-why">{t(decision.why)}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="lp-phase-columns" style={{ marginTop: 28 }}>
            <section>
              <DetailHeading icon={<FileText size={16} />}>{pick(lang, "Deliverables", "Entregables")}</DetailHeading>
              <ul className="lp-deliverables">
                {phase.deliverables.map((item) => (
                  <li key={item.file}>
                    <code>{item.file}</code>
                    <span>{t(item.what)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <DetailHeading icon={<Flag size={16} />}>{pick(lang, "Limits", "Limitaciones")}</DetailHeading>
              <ul className="lp-limits">
                {phase.limits.map((item) => <li key={item[0]}>{t(item)}</li>)}
              </ul>
            </section>
          </div>

          <div className="lp-result" style={{ marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.g300, textTransform: "uppercase", letterSpacing: "0.08em" }}><Target size={14} /> {pick(lang, "Result of the phase", "Resultado de la fase")}</div>
            <p style={{ fontSize: 17, lineHeight: 1.6, margin: "10px 0 18px", color: C.white }}>{t(phase.result)}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="lp-btn lp-btn-ghost-light" disabled={active === 1} onClick={() => go(Math.max(1, active - 1))} style={{ opacity: active === 1 ? 0.4 : 1 }}>{pick(lang, "Previous phase", "Fase anterior")}</button>
              <button type="button" className="lp-btn lp-btn-ghost-light" disabled={active === PHASES.length} onClick={() => go(Math.min(PHASES.length, active + 1))} style={{ opacity: active === PHASES.length ? 0.4 : 1 }}>{pick(lang, "Next phase", "Fase siguiente")}</button>
            </div>
          </div>
        </article>
      </Section>

      <Section tone="tint">
        <Eyebrow>{pick(lang, "All phases at a glance", "Todas las fases de un vistazo")}</Eyebrow>
        <div className="lp-timeline">
          {PHASES.map((p) => (
            <button key={p.n} type="button" className="lp-timeline-item" onClick={() => go(p.n)}>
              <span className="lp-timeline-dot">{p.n}</span>
              <div>
                <div style={{ fontWeight: 700, color: C.ink, fontSize: 15 }}>{t(p.title)}</div>
                <div style={{ fontSize: 12, color: C.g700, fontWeight: 600, marginTop: 2 }}>CRISP-ML(Q) · {t(p.crisp)} · {p.owner}</div>
                <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.55, marginTop: 4 }}>{t(p.result)}</div>
              </div>
            </button>
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
  members: [
    "Jonathan Alejandro Yacuma Rivera",
    "Manuel Eduardo Alarcón Aza",
    "Sergio Steeven Moreno Forero",
    "Samuel Castellanos Rivera",
  ],
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
