# AlertaFiscal

AlertaFiscal helps small Colombian businesses plan their tax reserve. A machine learning model forecasts each company's **monthly income and expenses for the next 6 months**. The ERP shows the forecast, an estimated reserve and plan-based alerts, and it monitors whether the forecasts stay as accurate as they were in evaluation.

Machine Learning course project, Universidad de Cundinamarca.

> AlertaFiscal is preventive support for tax planning. It is not accounting or tax advice. The model was trained and evaluated on semi-synthetic data and is labeled as a demonstration in the app.

**Final report:** [`docs/07_final_report.md`](docs/07_final_report.md).

## Results in one table

Official evaluation, run once and tagged `eval-final-run`. Verdict: **accepted**, all 12 checks pass ([`docs/04_evaluation_report.md`](docs/04_evaluation_report.md)).

| Scenario | Target | Model MAE | Baseline MAE | Median normalized MAE |
|---|---|---|---|---|
| Temporal test (425 companies) | Income | 21.462 | 38.170 | 10.22 % |
| Temporal test | Expenses | 22.619 | 37.352 | 10.69 % |
| Holdout (75 unseen companies) | Income | 23.709 | 39.675 | 12.34 % |
| Holdout | Expenses | 23.838 | 40.611 | 11.75 % |

MAE in millions of COP per month. The model is a random forest per target (`model_global.json`, version `global-20261103-84df89b5`, SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`). The baseline is seasonal naive (same month last year).

## Repository layout

```
backend/            Flask API (modular monolith), SQLAlchemy, Alembic migrations, tests
  model_artifacts/  Evaluated global model deployed by the backend
frontend/           React 18 + TypeScript + Vite
ml/
  src/              Phases 2–4: data preparation, training, export, evaluation
  data/processed/   Semi-synthetic dataset (monthly_series.csv, split_manifest.csv)
  artifacts/        Model, metrics and evaluation reports
  company_trainer/  Optional offline trainer for one company's own model
docs/               Phase documents, ERP documentation, final report
render.yaml         Render Blueprint (backend Web Service and frontend Static Site)
compose.yaml        Local PostgreSQL in Docker
legacy_flask_site/  First course website, kept for reference
```

## Run locally

Full guide: [`docs/erp/deployment.md`](docs/erp/deployment.md). Short version on Windows (PowerShell), with Docker Desktop, Python 3.12+ and Node.js LTS 22 or 24:

```powershell
# 1. Database
Copy-Item .env.docker.example .env.docker   # set POSTGRES_PASSWORD
docker compose --env-file .env.docker up -d

# 2. Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
Copy-Item .env.example .env                 # set DATABASE_URL
$env:FLASK_APP = "wsgi:app"
flask db upgrade
flask demo-load --email demo@alertafiscal.app   # asks for a password (min. 10 characters)
flask run --port 5000

# 3. Frontend (another terminal)
cd frontend
npm ci
npm run dev                                 # http://127.0.0.1:5173
```

Sign in with the demo user. The demo companies are holdout companies of the Phase 2 dataset, labeled as demonstration data. Five have 34 months of history and get a model forecast. One has 4 months and shows the manual mode.

## Tests

```powershell
cd backend
python -m pytest -q
```

Current result: 84 passed, 10 skipped. The skipped tests are the PostgreSQL integration tests; they need `TEST_DATABASE_URL` and run in CI. The 15 Phase 6 test cases and their status are in [`docs/06_test_cases.md`](docs/06_test_cases.md).

## Deploy on Render

1. In Render, **New → Blueprint** and select this repository; it reads `render.yaml`.
2. Backend environment: `DATABASE_URL` (Supabase connection string), `DB_SCHEMA` if the app uses its own schema, and `FRONTEND_ORIGIN` (the frontend URL, no trailing slash).
3. Frontend environment: `VITE_API_BASE_URL` (the backend URL). Redeploy the frontend after setting it.
4. From a local environment pointed at the same database, run `flask db upgrade` and `flask demo-load`. Migrations never run on server start.
5. Check `https://<backend>/health/ready`.

Details: [`docs/erp/deployment.md`](docs/erp/deployment.md), section 9.

## Documents

| Phase | Owner | Documents |
|---|---|---|
| 1 Business and data understanding | Sergio Steeven Moreno Forero | [`01_business_and_data.md`](docs/01_business_and_data.md), [`03_alert_rules.md`](docs/03_alert_rules.md) |
| 2 Data preparation | Samuel Castellanos Rivera | [`02_dataset_report.md`](docs/02_dataset_report.md), [`02_dataset_card.md`](docs/02_dataset_card.md), [`02_data_dictionary.md`](docs/02_data_dictionary.md), [`02_run_log.md`](docs/02_run_log.md) |
| 3 Modeling | Jonathan Alejandro Yacuma Rivera | [`03_model_selection.md`](docs/03_model_selection.md) |
| 4 Evaluation | Manuel Eduardo Alarcon Aza | [`04_evaluation_protocol.md`](docs/04_evaluation_protocol.md), [`04_leakage_review.md`](docs/04_leakage_review.md), [`04_evaluation_report.md`](docs/04_evaluation_report.md) |
| 5 Integration and ERP | Manuel Eduardo Alarcon Aza | [`docs/erp/`](docs/erp/) (architecture, API, deployment, security, [traceability](docs/erp/traceability_base_vs_ported.md)) |
| 6 Monitoring and final report | Sergio Steeven Moreno Forero | [`06_monitoring.md`](docs/06_monitoring.md), [`06_test_cases.md`](docs/06_test_cases.md), [`06_retraining_and_rollback.md`](docs/06_retraining_and_rollback.md), [`06_privacy_and_retention.md`](docs/06_privacy_and_retention.md), [`07_final_report.md`](docs/07_final_report.md) |

Handover status: [`docs/handover.md`](docs/handover.md).
