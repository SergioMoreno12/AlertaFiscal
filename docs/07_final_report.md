# AlertaFiscal — Final Report

- **Course:** Machine Learning, Universidad de Cundinamarca
- **Team:** Sergio Steeven Moreno Forero, Samuel Castellanos Rivera, Jonathan Alejandro Yacuma Rivera, Manuel Eduardo Alarcon Aza
- **Report owner:** Sergio Steeven Moreno Forero (Phase 6)
- **Date:** November 2026

> AlertaFiscal is preventive support for tax planning. It is not accounting or tax advice. Every number it shows is an estimate that the business owner or their accountant must review.

All numbers below are copied from the phase documents without rounding or changes. Units are millions of COP per month unless stated otherwise.

## 1. Problem and users

Small Colombian businesses pay VAT, income tax and withholdings out of the same cash they use to operate, and they usually find out how much they owe when the filing date arrives. When income drops or expenses rise, the money for taxes is not set aside.

AlertaFiscal forecasts each company's **monthly income and monthly expenses for the next 6 months**, so the owner or the accountant can estimate the tax base and plan a monthly reserve. Alerts are fixed, documented rules applied to the forecast (for example, a month where projected expenses exceed projected income); they are a consequence of the plan, never the goal of the model.

| User | Need | What AlertaFiscal gives |
|---|---|---|
| Small business owner | Know in advance how much cash to set aside | 6-month forecast, estimated reserve, plan-based alerts |
| Accountant with several clients | Know which client needs attention first | The same per client, alerts and a monitoring status |

The system does not classify tax risk, predict penalties, compute or file returns, connect to the DIAN or replace an accountant (`docs/01_business_and_data.md`, sections 1 and 9).

**Success criteria (Phase 1, approved November 3, 2026):** the model must be at least 10 % better than the seasonal naive baseline in MAE, and the median normalized MAE must be ≤ 15 % with a 90th percentile ≤ 30 %, for both targets, on the temporal test and on holdout companies.

## 2. Data and its limits

There is no public dataset of monthly income and expenses of Colombian small businesses, so the team built a **semi-synthetic** dataset (Phase 2, `docs/02_dataset_report.md`):

- Company sizes, sectors and margins come from real **Supersociedades** annual records (10,000 companies, 2025).
- Seasonality comes from real **DIAN** monthly tax collection.
- From these, 36 monthly values of income and expenses are generated per company.

| Item | Value |
|---|---|
| Rows | 18,000 |
| Companies | 500 (301 derived from real records, 199 simulated) |
| Months | 36, from 2023-01 to 2025-12 |
| Sectors | 6: agriculture, construction, manufacturing, mining, retail, services |
| Median monthly income | COP 116.9 million |
| Monthly income range | COP 9.2 – 1,608.4 million |

**Split:** train = months 1–24 of 425 companies; validation = months 25–30; test = months 31–36; holdout = all 36 months of 75 companies never used in training.

**Limits:**

- The monthly values are generated. Results prove that the method works on this generator, not that it is accurate for a real business.
- Margins come from large companies; small businesses may differ.
- About 30 % of company-months show a loss (retail's real median margin is 1.8 %), so the loss-month alert fires often.
- All sectors share one national seasonal shape.
- Only three observations of each calendar month.
- Real tax ids were used only inside the preparation script and never written to an output file.

## 3. Method and models

Phase 3 (`docs/03_model_selection.md`) trained one model per target on months 1–24 and forecast months 25–30 **recursively** (each step feeds the previous prediction back as a lag).

- **Features:** `t` (position in the company's history), `month_sin`, `month_cos`, `lag1`, `lag2`, `lag3`. Sector is not a feature because the ERP does not guarantee it.
- **Scaling:** each series is divided by the mean of its last 3 months (`mean_last_n`, n = 3) so companies of very different sizes can share one model; the forecast is multiplied back.
- **Candidates:** seasonal naive baseline, linear regression, random forest (6 combinations), multilayer perceptron (12 combinations). 40 fits in total. Selection used validation only; test and holdout rows were never read.

| Model | Mean validation MAE (income and expenses) |
|---|---|
| **Random forest (selected)** | **17.296** |
| Seasonal naive baseline | 27.906 |
| Linear regression | 35.943 |
| MLP (comparison only, not exportable) | 45.511 |

**Selected:** random forest, 100 trees, depth 8, minimum 10 samples per leaf for income; 100 trees, depth 6, minimum 5 per leaf for expenses. Validation MAE: income 17.223 (−38.4 % vs baseline 27.974), expenses 17.368 (−37.6 % vs 27.837).

**Export:** the forest is exported to a JSON artifact of 1.41 MB, `model_global.json`, version `global-20261103-84df89b5`. The backend evaluates the trees in pure Python, without scikit-learn. A parity test on 50 cases gives a maximum relative difference of 0.0 against scikit-learn (tolerance 1e-6).

## 4. Evaluation results

Phase 4 (`docs/04_evaluation_report.md`) ran the official evaluation **once**, on November 4, 2026 at 02:06:59 UTC, under a protocol tagged before any test row was read (`eval-protocol-v1`). The run is tagged `eval-final-run`. Artifact SHA-256: `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`.

**Verdict: accepted.** All 12 checks pass.

| Scenario | Model | Target | MAE | RMSE | Median normalized MAE (%) | P90 normalized MAE (%) | MAPE (%) | Bias |
|---|---|---|---|---|---|---|---|---|
| Temporal (425 companies) | Random forest | Income | 21.462 | 40.559 | 10.22 | 20.72 | 9.51 | −3.561 |
| Temporal | Random forest | Expenses | 22.619 | 42.431 | 10.69 | 20.70 | 10.20 | −4.104 |
| Temporal | Seasonal naive | Income | 38.170 | 69.677 | 16.70 | 37.25 | 15.60 | −26.303 |
| Temporal | Seasonal naive | Expenses | 37.352 | 67.837 | 16.65 | 36.47 | 15.92 | −25.443 |
| Holdout (75 companies) | Random forest | Income | 23.709 | 39.248 | 12.34 | 21.25 | 10.23 | 0.072 |
| Holdout | Random forest | Expenses | 23.838 | 42.798 | 11.75 | 19.85 | 10.33 | −3.138 |
| Holdout | Seasonal naive | Income | 39.675 | 74.762 | 15.09 | 41.08 | 14.24 | −32.434 |
| Holdout | Seasonal naive | Expenses | 40.611 | 78.351 | 15.34 | 41.43 | 15.18 | −32.452 |

| Check | Rule | Temporal income | Temporal expenses | Holdout income | Holdout expenses |
|---|---|---|---|---|---|
| C1 | MAE ≤ 0.90 × baseline MAE | 0.562 PASS | 0.606 PASS | 0.598 PASS | 0.587 PASS |
| C2 | Median normalized MAE ≤ 15 % | 10.22 PASS | 10.69 PASS | 12.34 PASS | 11.75 PASS |
| C3 | P90 normalized MAE ≤ 30 % | 20.72 PASS | 20.70 PASS | 21.25 PASS | 19.85 PASS |

What the numbers mean:

- The model reduces the baseline MAE by 39–44 %.
- The test error is higher than validation (income MAE grows by about 25 % on the temporal test and 38 % on holdout), because the scored months include the December peak and holdout companies were never seen.
- Error grows with the horizon: +5 and +6 (November and December) are about 45–70 % worse than +1. The model beats the baseline at every horizon.
- Typical error is about 10–12 % of a month's income: for a company with 100 million COP of monthly income, a forecast is usually within about 10–12 million.
- Fast-growing companies are under-forecast, and sudden level changes are not predicted until three months of the new level enter the history.

## 5. System architecture and deployment

AlertaFiscal is a monorepo with three pieces (`docs/erp/architecture.md`):

```
frontend/  React 18 + TypeScript + Vite      → Render Static Site
backend/   Flask + Blueprints + SQLAlchemy   → Render Web Service (Gunicorn)
ml/        Offline training and evaluation   → never runs on the web server
Database:  PostgreSQL (Docker locally, Supabase in the cloud)
```

- **ERP base.** The ERP from AlertaFiscalBeta was ported into this repository (`erp-port`), translated to English and kept functionally equal. Every base module, endpoint, table and migration is still there (`docs/erp/traceability_base_vs_ported.md`).
- **Model integration (Phase 5).** The evaluated `model_global.json` is deployed byte for byte in `backend/model_artifacts/` (`.gitattributes` keeps its bytes, and a test checks its SHA-256). The backend uses the global model by default; a company-specific model `model_company<id>.json`, trained offline with `ml/company_trainer/`, wins over it when it exists.
- **Rules applied in the backend:** at least 6 months of history; horizon capped at the evaluated 6 months; features cast to float32 as in scikit-learn; a zero or negative scale is treated as insufficient history; recursion without intermediate rounding, values clipped at 0 and rounded only at the end.
- **When the model cannot run** (too little history, missing or invalid file), the API returns an explicit code (`insufficient_history`, `model_not_trained`, `artifact_invalid`) and offers manual mode; the rest of the ERP keeps working.
- **Alerts:** rule A1 (projected loss month) of `docs/03_alert_rules.md` was implemented on the stored forecast; its message states the typical model error. The other ERP alerts (plan, configuration, stale forecast) come from the base ERP.
- **Demo data:** `flask demo-load` loads labeled holdout companies of the Phase 2 dataset (5 with 34 months and 1 with 4 months, to show manual mode).
- **Security:** cookie sessions, CSRF on every write, roles per company (`admin`, `contador`, `auxiliar`), every query filtered by company, audit events. The browser never talks to the database; the connection string is only in `DATABASE_URL`.
- **Deployment:** one Render Blueprint (`render.yaml`) creates the backend and the frontend. Migrations (`flask db upgrade`) and demo data are explicit steps, never run on startup (`docs/erp/deployment.md`).

## 6. Monitoring, tests and operations

**Monitoring (Phase 6, `docs/06_monitoring.md`).**

- Each model forecast stores one row per target and month in PostgreSQL (`forecast_monitoring`).
- When a month is closed and its real documents exist, the actual value, the absolute error and the normalized error are filled.
- The error is normalized by the company's mean monthly income, so companies of very different sizes are compared fairly.
- The rolling error over the last 3 resolved months is compared with the Phase 4 holdout reference (12.34 % income, 11.75 % expenses), using closed intervals with no gaps:

| Status | Ratio to reference |
|---|---|
| normal | 0 ≤ ratio ≤ 1.0 |
| watch | 1.0 < ratio ≤ 1.5 |
| degraded | 1.5 < ratio |

**Operations.**

- Render checks `/health/ready`.
- Each model forecast call stores its outcome and latency (`forecast_service_events`).
- Everything is in the database, so it survives redeploys.
- Status, model version, last forecast date and operations are shown in History → Monitoring and through `GET /api/v1/companies/{id}/monitoring`.

**When it degrades (`docs/06_retraining_and_rollback.md`).** A company that stays degraded for 2 consecutive months is reviewed. If its data is correct, a company model is considered. If 20 % or more of companies degrade together, the global model is retrained. A new model must pass the parity test and the Phase 4 protocol. Rollback restores the previous artifact from Git, which is tagged and checked against its SHA-256, or uses Render's rollback.

**Privacy (`docs/06_privacy_and_retention.md`).** Only aggregated monthly amounts are stored, with no personal data, and only members of the company can read them. Monitoring rows are kept for 24 months and service events for 90 days (`flask monitoring-purge`).

**Tests (`docs/06_test_cases.md`).** The backend suite gives **84 passed, 0 failed, 10 skipped**. The skipped tests are the PostgreSQL integration tests, run in CI. Of the 15 required cases, **14 passed** and 1 is **not run**: case 14, persistence across a Render redeploy, which needs the deployed app.

## 7. Limitations and next steps

**Limitations.**

- **Semi-synthetic data.** The model was evaluated on generated series. It is labeled as a demonstration in the app (`is_demo: true`), and its accuracy for a real company is unknown.
- **Error size.** About 10–12 % of monthly income is enough to plan a reserve with a safety margin, not to state an exact tax amount. The last two forecast months are the least reliable.
- **No reaction to sudden changes.** New contracts or lost clients are not predicted; monitoring is how the app notices them.
- **Loss months fire often.** About 30 % of company-months are losses. A1 fires on any projected gap, and its message reminds the user of the model error.
- **History rule.** The alert rule A6 in `docs/03_alert_rules.md` asked for 12 months of history. The model needs and was evaluated with 6 months as the minimum, so the app uses 6.
- **Not verified yet.** The frontend build was not run on the team's machines without Node.js; CI builds it. The Render deployment and case 14 are pending at the time of writing.

**Next steps.**

1. Test with anonymized, authorized data from real small businesses, and recalibrate the monitoring reference with it.
2. Show the seasonal naive forecast next to the model, because for some stable seasonal companies it is as good.
3. Add an alert margin equal to the model error for A1, and prediction intervals instead of single values.
4. Schedule the retention purge and a monthly monitoring summary as Render cron jobs.
5. Add frontend tests (component and end-to-end).

## 8. Team and responsibilities

| Member | Phase and responsibility |
|---|---|
| Sergio Steeven Moreno Forero | Phase 1 (business and data understanding, success criteria, alert rules); ran the Phase 4 official evaluation and wrote its report on Manuel's behalf; Phase 5 support (global model integration, demo data, A1 alert, translation); Phase 6 (monitoring, tests, final report) |
| Samuel Castellanos Rivera | Phase 2 (dataset preparation and generation); started Phase 5 (Steps 1 and 3) |
| Jonathan Alejandro Yacuma Rivera | Phase 3 (features, candidates, model selection, export and parity) |
| Manuel Eduardo Alarcon Aza | Phase 4 owner (evaluation protocol and leakage review); ERP port into the repository (`erp-port`); Phase 5 owner from November 3, 2026 (Docker, Render and CI configuration, `DB_SCHEMA` support) |

## References inside the repository

| Topic | Document |
|---|---|
| Problem, users, success criteria | `docs/01_business_and_data.md` |
| Dataset | `docs/02_dataset_report.md`, `docs/02_dataset_card.md`, `docs/02_data_dictionary.md`, `docs/02_run_log.md` |
| Model selection | `docs/03_model_selection.md`; alert rules `docs/03_alert_rules.md` |
| Evaluation | `docs/04_evaluation_protocol.md`, `docs/04_leakage_review.md`, `docs/04_evaluation_report.md` |
| ERP and deployment | `docs/erp/` (architecture, API, deployment, security, traceability) |
| Monitoring | `docs/06_monitoring.md`, `docs/06_test_cases.md`, `docs/06_retraining_and_rollback.md`, `docs/06_privacy_and_retention.md` |
