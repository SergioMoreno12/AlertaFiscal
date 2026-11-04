# AlertaFiscal

AlertaFiscal is an ERP for Colombian small businesses with a machine learning forecast connected to it. A company records its monthly income and expenses; the ERP forecasts the next months, turns the forecast into a tax plan with reserves, and raises alerts.

Project for the Machine Learning course, Universidad de Cundinamarca. The data behind the model is **semi-synthetic** (built from public DIAN and Supersociedades aggregates); no real company is represented.

**Live demo:** https://alertafiscal-frontend-wyyn.onrender.com (API: https://alertafiscal-backend-h4ip.onrender.com). Free Render plan: the first request after inactivity can take about a minute.

**Final report:** [`docs/07_final_report.md`](docs/07_final_report.md). **Handover and open points:** [`docs/handover.md`](docs/handover.md).

## Results

Official evaluation, run once and tagged `eval-final-run`. Verdict: **accepted**, all 12 checks pass ([`docs/04_evaluation_report.md`](docs/04_evaluation_report.md)). MAE in millions of COP per month; the baseline is seasonal naive.

| Scenario | Target | Model MAE | Baseline MAE | Median normalized MAE |
|---|---|---|---|---|
| Temporal test (425 companies) | Income | 21.462 | 38.170 | 10.22 % |
| Temporal test | Expenses | 22.619 | 37.352 | 10.69 % |
| Holdout (75 unseen companies) | Income | 23.709 | 39.675 | 12.34 % |
| Holdout | Expenses | 23.838 | 40.611 | 11.75 % |

Deployed model: `model_global.json`, version `global-20261103-84df89b5`, SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`.

## Repository layout

| Path | What it holds |
|---|---|
| `backend/` | Flask API (modular monolith), migrations, tests and `model_artifacts/` (the deployed model) |
| `frontend/` | React + TypeScript + Vite single-page app |
| `ml/src/` | Dataset, training, evaluation and artifact export scripts (phases 2 to 4) |
| `ml/company_trainer/` | Script that trains a model for one company from its own history |
| `ml/data/` | Processed dataset. `ml/data/raw/` is never committed (see `ml/README.md`) |
| `docs/` | Phase documents (`01_` to `07_`), phase instructions and `docs/erp/` (ERP documentation) |
| `legacy_flask_site/` | The original course website, kept for reference |
| `render.yaml`, `compose.yaml`, `docker/`, `.github/` | Deployment, local PostgreSQL and CI |

## Run it locally

Requirements: Python 3.12 or later, Node.js LTS (22 or 24), Docker with Compose v2.

**1. Database (PostgreSQL 16 in Docker)**

```bash
cp .env.docker.example .env.docker        # then change POSTGRES_PASSWORD
docker compose --env-file .env.docker up -d
```

**2. Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate                  # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                       # set DATABASE_URL with the same password
export FLASK_APP=wsgi:app APP_ENV=development
flask db upgrade
flask seed-demo --yes                      # fictitious demo data, idempotent
flask run --port 5000
```

Check `http://127.0.0.1:5000/health/ready`. The full local guide, including backups and the SQLite demo mode, is in `docs/erp/deployment.md`.

**3. Frontend**

```bash
cd frontend
npm ci
npm run dev                                # http://127.0.0.1:5173
```

**4. Demo companies for the forecast (optional)**

```bash
cd backend
flask demo-load --email demo@alertafiscal.app
```

It loads six holdout companies from `ml/data/processed/monthly_series.csv`: five with a full history and one with only 4 months, to show manual mode. Every name ends in "(semi-synthetic demo)". The command is idempotent (fixed document numbers), and `--through 36` adds the last two months later.

## Tests

```bash
cd backend
python -m pytest -q
```

By default the PostgreSQL integration tests are skipped. To run them, set `TEST_DATABASE_URL` to a **separate, disposable** database (the tests recreate its schema; never point it at a shared or cloud database). Frontend: `cd frontend && npm ci && npm run build`.

## How the machine learning module works

1. **Offline training.** `ml/src/train_models.py` trains candidate models on the semi-synthetic dataset; the evaluation (`ml/src/evaluate.py`) uses companies never seen in training. The chosen model is exported as one JSON file, `model_global.json`.
2. **The artifact is the contract.** The backend reads that JSON and computes the forecast in pure Python. The backend never imports scikit-learn or joblib (a test enforces it).
3. **Global model by default, company model first.** `model_global.json` (scope `global`, trained on all training companies) serves every company. If a company has its own artifact, that one is used instead.
4. **How a forecast is made.** The ERP groups the company's recorded income and expense documents by month (cancelled documents are excluded; empty months count as zero). The model uses the month position, month of year and the last three values, scaled by the mean of the last three months. It forecasts one month at a time, appends each prediction to the history, clips negatives to 0 and rounds to 2 decimals at the end. Features are cast to float32 before walking the trees, as scikit-learn does.
5. **Minimum history.** With fewer than 6 months, or a non-positive scale, the API answers `insufficient_history` and the ERP keeps the manual planning mode available. A model error never breaks the ERP screens.
6. **Provenance.** Each forecast is stored in `forecast_runs` with its method, model version, monthly values and history signature. Its `assumptions` record `scope`, `artifact_sha256` and `is_demo`.
7. **Proof that the deployed model is the evaluated one.** The SHA-256 of `backend/model_artifacts/model_global.json` is checked by a test against the value recorded by the evaluation phase, and `parity_cases.json` checks that the backend reproduces the scikit-learn forecasts. Do not retrain, re-export or edit the artifact: any change alters the hash and invalidates the evaluation.
8. **Monitoring.** Each model forecast is stored month by month in `forecast_monitoring`. When a month closes and its real documents exist, the error normalized by the company's mean income is compared with the Phase 4 reference (normal ≤ 1.0×, watch ≤ 1.5×, degraded above). The status, model version and operations (outcome and latency of each call) are shown in History → Monitoring and at `GET /api/v1/companies/{id}/monitoring`. See `docs/06_monitoring.md`.

## Deploy (Render + Supabase)

`render.yaml` defines the backend (a Gunicorn web service rooted in `backend/`) and the frontend (a static site rooted in `frontend/`). The database is an external Supabase PostgreSQL project; Render creates none.

1. In Render, set the secrets in the dashboard (they are marked `sync: false` and must never be committed): `DATABASE_URL` (Supabase pooled connection string), `DB_SCHEMA` (the app's schema, if not `public`) and `FRONTEND_ORIGIN` (the static site URL); on the frontend set `VITE_API_BASE_URL` (the backend URL).
2. Deploy both services from `render.yaml`. Cookies are `Secure` with `SameSite=None` because the two services live on different domains.
3. Run the migrations once against the database (`flask db upgrade`) and, if wanted, `flask demo-load`. Neither runs on startup.
4. Check `/health/ready`, then test login, a company with a forecast, the company with 4 months (manual mode), alerts, and that the model version and date are shown.

The free Render plan sleeps after inactivity; the first request can take about a minute. Details and the connection budget are in `docs/erp/deployment.md`.

**Rollback.** The artifact lives in Git: restore the previous `backend/model_artifacts/model_global.json` commit and redeploy the previous commit. Data stays in PostgreSQL.

## Documentation

- `docs/erp/` — architecture, API, security, deployment, decisions and the traceability matrix (`traceability_base_vs_ported.md`).
- `docs/01_` to `docs/04_` — business and data, dataset, alert rules, model selection and evaluation protocol.
- `docs/06_monitoring.md`, `docs/06_test_cases.md`, `docs/06_retraining_and_rollback.md`, `docs/06_privacy_and_retention.md` — monitoring, test cases with results, retraining and rollback, privacy and retention.
- `docs/07_final_report.md` — final report. `docs/handover.md` — merge and deployment status.
- `docs/phases/` — instructions for each phase.