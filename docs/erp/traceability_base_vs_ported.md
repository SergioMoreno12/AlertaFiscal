# Traceability Matrix: Base ERP vs Ported ERP

- **Base:** the ERP working copy as it entered this repository, commit `870569c` (the four port commits `665b0f0`, `a4149d2`, `391101b`, `870569c` on `erp-port`). The original `AlertaFiscalBeta-main.zip` is not in the repository; the port commits are a file-for-file copy of the tested working copy (`docs/erp/baseline-commit.md`), so they are used as the base.
- **Ported:** branch `phase6/monitoring`, which contains `erp-port`, `phase5/flask-api` and `phase6/monitoring`.
- **Version:** replaces the first version (`e612c39`), which used `baseline-commit.md` as the base and left rows to verify. This one diffs the port commits directly, so no row is left to verify.
- **How it was built:** `git diff --name-status 870569c HEAD`, plus the list of routes, tables, migrations and tests read from both commits.
- **Status values:** kept (same behavior), changed (behavior or text changed), added, removed.
- **Evidence:** the test that covers the item (in `backend/tests/`), or the file where it can be checked. The full suite gives 98 passed, 10 skipped (PostgreSQL tests, run in CI).

Text changes: every user-facing message, label, log line, comment and document was translated from Spanish to English (commits `45a6ad8`, `50ba747`, `1dad405`, `66edad1`, `4074938`, `648b93b`). Stored codes kept their values so existing data stays valid: priorities `alta`/`media`/`baja`, alert origins `erp`/`plan`/`configuracion`/`proyeccion`, roles `admin`/`contador`/`auxiliar`, screen ids and error codes. Items that only changed text are marked **kept**.

## 1. Backend modules (Flask Blueprints)

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `auth` | Sessions with cookie, CSRF, login, logout, `me`, session list and revoke, password reset request | Same | kept | `test_auth.py` (5 tests), `test_sessions_and_csrf` |
| `companies` | Company list and detail by membership | Same | kept | `test_company_list_only_own`, `test_user_cannot_access_other_company` |
| `movements` | Income, expenses, receipts, payments, counterparties | Same, plus a monitoring refresh after income or expense creation (nested transaction, never blocks the save) | changed | `test_create_and_list_income`, `test_receipt_marks_income_as_collected`, `test_new_income_document_resolves_monitoring_through_the_api` |
| `dashboard` | Monthly aggregates and review list | Same | kept | `test_dashboard_aggregates` |
| `planning` | Fiscal parameters, plans with versions, reserves, manual forecast, model forecast from a company artifact | Model forecast now uses the evaluated global model by default; a company artifact still wins. Horizon capped at 6 for the global model; float32 features; zero scale is `insufficient_history`; the response returns `scope`, `artifact_sha256`, `is_demo`. Each model call records outcome and latency. | changed | `test_forecasting_ml.py` (14 tests), `test_forecasting.py` (11 tests), `test_plan_versions_are_immutable_after_review` |
| `planning/forecasting.py` | Company artifact only (`model_company<id>.json`) | Global artifact `model_global.json` validated (scope, features, normalization, model type, schema) plus company override; `load_artifact` returns the source | changed | `test_global_model_is_used_when_the_company_has_no_artifact`, `test_company_artifact_wins_over_the_global_model`, `test_invalid_global_artifact_returns_artifact_invalid` |
| `alerts` | Alert list, create, detail, update, comments, evaluate; rules for ERP, plan and configuration, and stale forecast | Same, plus rule **A1** "Projected loss months in the latest forecast" (origin `proyeccion`) from `docs/03_alert_rules.md` | changed | `test_alerts_evaluate_deduplicates_and_dashboard_reads_them`, `test_stale_forecast_alert_after_inputs_change`, `test_loss_month_alert_lists_every_projected_loss_month`, `test_loss_month_alert_does_not_fire_without_losses` |
| `tracking` | Tax obligations and audit history | Same | kept | `test_plan_reserve_alert_comment_and_obligation_persist` |
| `context` | External sources (DIAN, Supersociedades) as read-only context | Same | kept | `test_context.py` (3 tests) |
| `common/health` | `/health/live`, `/health/ready` | Same | kept | `test_ready_with_database`, `test_ready_does_not_leak_credentials` |
| `monitoring` | — | Forecast monitoring service and endpoint (Phase 6) | added | `test_monitoring.py` (14 tests, 22 with parameters) |
| `db_schema.py` | — | Applies `DB_SCHEMA` (`search_path`) on every pooled PostgreSQL connection, so the app can live in its own schema in Supabase | added | commit `840f1b0`; `test_database_is_postgresql_and_migrated` (CI) |
| `config.py` | Database modes, production checks | Same, plus `FORECAST_ARTIFACT_DIR` defaulting to `backend/model_artifacts` | changed | `test_config.py` (8 tests) |
| `demo_data.py` and `flask demo-load` | `flask seed-demo` with fictitious data | `seed-demo` kept; new `demo-load` loads labeled holdout companies of the Phase 2 dataset (5 with 34 months, 1 with 4 months) | added | `test_demo_data.py` (3 tests) |
| `flask monitoring-purge` | — | Deletes monitoring data past its retention | added | `test_purge_removes_only_data_older_than_the_retention` |

## 2. Endpoints

All 49 base endpoints exist in the ported ERP with the same method and path.

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `GET/POST /api/v1/auth/*` (7 endpoints) | Present | Same | kept | `test_auth.py` |
| `GET /api/v1/companies`, `GET /api/v1/companies/{id}` | Present | Same | kept | `test_isolation.py` |
| `/api/v1/companies/{id}/income`, `/expenses`, `/receipts`, `/payments`, `/counterparties` (10 endpoints) | Present | Same; income and expense creation also refresh monitoring | changed | `test_api.py` |
| `GET /api/v1/companies/{id}/dashboard` | Present | Same | kept | `test_dashboard_aggregates` |
| `/fiscal-parameters`, `/plans`, `/plans/{id}`, `/plans/{id}/versions`, `/versions/{id}/review`, `/reserve-entries` (9 endpoints) | Present | Same | kept | `test_plan_versions_are_immutable_after_review`, `test_versioning_plan_does_not_lose_or_duplicate_reserves` |
| `GET /forecasts`, `POST /forecasts` (manual) | Present | Same; manual method label "Manual average" | kept | `test_list_forecasts_tolerates_manual_run_without_ml_metadata`, `test_forecast_requires_history` |
| `POST /forecasts/model` | Company artifact only | Global model by default, company override, new response fields, service events | changed | `test_forecasting_ml.py` |
| `/alerts` (6 endpoints) | Present | Same; evaluation includes A1 | changed | see alerts row above |
| `/obligations` (3), `/audit` | Present | Same | kept | `test_plan_reserve_alert_comment_and_obligation_persist` |
| `/api/v1/context/*` (5 endpoints) | Present | Same | kept | `test_context.py` |
| `/health/live`, `/health/ready` | Present | Same | kept | `test_health.py` |
| `GET /api/v1/companies/{id}/monitoring` | — | Status, rows and operations | added | `test_monitoring_endpoint_shows_status_version_date_and_operations`, `test_monitoring_of_another_company_is_forbidden` |

## 3. Tables

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `users`, `companies`, `company_memberships`, `sessions` | Present | Same | kept | `test_role_permissions_are_read_from_postgres` |
| `counterparties`, `income_documents`, `income_receipts`, `expense_documents`, `expense_payments` | Present | Same | kept | `test_money_uses_numeric_and_decimal`, `test_unique_document_constraint_and_rollback` |
| `tax_obligations`, `fiscal_parameters`, `fiscal_plans`, `fiscal_plan_versions`, `reserve_entries` | Present | Same | kept | `test_plan_reserve_alert_comment_and_obligation_persist` |
| `forecast_runs` | Present | Same columns; `assumptions` now also stores `scope`, `artifact_file`, `artifact_sha256`, `is_demo` | changed | `test_global_model_is_used_when_the_company_has_no_artifact` |
| `alerts`, `alert_comments`, `audit_events` | Present | Same | kept | `test_alerts_evaluate_deduplicates_and_dashboard_reads_them` |
| `external_sources`, `external_dataset_versions`, `tax_collections`, `sector_benchmarks` | Present | Same | kept | `test_new_version_preserves_previous_facts` |
| `forecast_monitoring` | — | Predicted vs actual values per target and month | added | `test_predictions_are_recorded_when_a_run_is_created` |
| `forecast_service_events` | — | Outcome and latency of each model forecast call | added | `test_monitoring_endpoint_shows_status_version_date_and_operations` |

## 4. Migrations (Alembic)

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `b936452f07f9_initial_schema` | Present | Same | kept | `test_database_is_postgresql_and_migrated` (CI) |
| `f3b8c2d1a7e4_external_context` | Present | Comments translated only | kept | same |
| `c7d2e5a9b1f3_forecast_method_ml` | Present (head) | Docstring translated only | kept | same |
| `d4e8a1b2c3f5_forecast_monitoring` | — | New head; only adds the two monitoring tables | added | checked against the models with `flask_migrate.check` on SQLite after `stamp c7d2e5a9b1f3` + `upgrade` |

## 5. Tests

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `test_api.py`, `test_auth.py`, `test_config.py`, `test_context.py`, `test_health.py`, `test_isolation.py` | 28 tests | Same tests; `conftest.py` refuses a non-loopback database host and supports `AF_SKIP_DOTENV`; `test_config.py` reads files as UTF-8 | kept | full suite run |
| `test_forecasting.py` | 11 tests | Same 11, expectations updated to English labels | kept | full suite run |
| `test_postgres_integration.py` | 10 tests | Same 10 (need `TEST_DATABASE_URL`, run in CI) | kept | CI workflow |
| `test_forecasting_ml.py` | — | 14 tests: SHA-256, parity, no scikit-learn, global vs company, history limits, invalid artifacts, A1 | added | full suite run |
| `test_demo_data.py` | — | 3 tests | added | full suite run |
| `test_monitoring.py` | — | 14 tests (22 with parameters) | added | full suite run |

## 6. Frontend screens

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| Login, Companies, Summary, Income, Expenses, Planning, Scenarios, Obligations, Alerts, Alert detail, Context | Spanish UI | Same screens, English UI, locale `en-US` | kept | `frontend/src/app/App.tsx` |
| Forecasts | Model and manual forecast | Same, plus model scope, SHA-256 and the Phase 4 evaluation text | changed | `App.tsx` (`ProyeccionesScreen`) |
| History | Plans, Forecasts, Audit tabs | Same, plus a Monitoring tab | changed | `App.tsx` (`MonitoringPanel`) |

The frontend has no automated tests; CI runs `npm run build` (TypeScript check and Vite build).

## 7. Deployment, CI and offline ML

| Item | Base | Ported | Status | Evidence |
|---|---|---|---|---|
| `render.yaml` | Not in the base commit | Blueprint with the backend Web Service and the frontend Static Site | added | commit `7bc4c8a` |
| `.github/workflows/ci.yml` | Not in the base commit | Backend tests on PostgreSQL, migrations, frontend build | added | commits `7bc4c8a`, `e8c760d`, `2f714fa` |
| Docker (`compose.yaml`, `docker/postgres/init/`, `.env.docker.example`) | Not in the base commit | Local PostgreSQL 16 and a test database | added | commit `7bc4c8a`; `docs/erp/deployment.md` |
| `backend/model_artifacts/` | — | Evaluated `model_global.json` and `parity_cases.json`, marked `-text` in `.gitattributes` | added | `test_deployed_artifact_has_the_evaluated_sha256` |
| `ml/company_trainer/` | Trainer and source scripts | Same, paths fixed after the move into `ml/` | changed | commit `dca2787` |

## 8. Removed items

Nothing was removed from the base ERP. Raw data files that were committed by mistake on `phase5/flask-api` were removed from that branch before the merge; they never belonged to the base ERP.
