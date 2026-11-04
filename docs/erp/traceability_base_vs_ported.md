# Traceability matrix: base ERP vs ported ERP

First version, built on November 4, 2026 from the repository (`phase5/flask-api`, after commit `648b93b`).

**Limits of this version (read first).** The base ERP (`AlertaFiscalBeta-main.zip`) is not in the repository, so it could not be diffed file by file. The "Base" column comes from `docs/erp/baseline-commit.md` (section 5), which lists what the ERP working copy contained before the port. Every row marked **verify** must be checked against the zip before the final presentation. Nothing here claims a comparison that was not made.

Status values: **kept** (in the base and in the port), **changed** (kept, but modified after the port), **added** (not in the base), **removed** (in the base, not in the port). No removed item is known.

Reference points in Git: the ERP as first ported is `665b0f0` (backend) and `a4149d2` (frontend) on `erp-port`; "now" is `phase5/flask-api`.

## 1. Modules and endpoints

| Item | Endpoints | Base | Ported | Status | Evidence |
|---|---|---|---|---|---|
| Auth (session, CSRF) | 7 | Yes (baseline-commit.md §5) | Yes | changed (messages translated) | `test_auth.py`: `test_login_without_csrf_is_rejected`, `test_login_and_me`, `test_logout_revokes_session` |
| Companies | 2 | Yes | Yes | kept | `test_isolation.py`: `test_company_list_only_own`, `test_user_cannot_access_other_company` |
| Movements (income, expenses, receipts, payments, counterparties) | 10 | Yes | Yes | changed (messages translated) | `test_api.py`: `test_create_and_list_income`, `test_duplicate_document_conflict`, `test_money_precision_is_preserved` |
| Planning (parameters, plans, versions, reserves, forecasts) | 12 | Yes | Yes | changed (translation; model forecast changed, see section 4) | `test_api.py`: `test_plan_versions_are_immutable_after_review`; `test_forecasting.py` |
| Tracking (obligations, audit) | 4 | Yes | Yes | changed (messages translated) | `test_api.py` (obligations flows) |
| Alerts (list, evaluate, comments) | 6 | Yes | Yes | changed (new rule, see section 4) | `test_forecasting_ml.py`: `test_loss_month_alert_*` |
| Dashboard | 1 | Not listed: **verify** | Yes | changed (messages translated) | `test_api.py`: `test_dashboard_aggregates` |
| External context (sources, summary, DIAN collections, sector benchmarks) | 5 | No (limited stage 2) | Yes | added | `test_context.py`: `test_load_is_idempotent_and_does_not_create_alerts` |
| Health (`/health/live`, `/health/ready`) | 2 | Not listed: **verify** | Yes | kept | `test_health.py` |

## 2. Tables (22 plus `alembic_version`)

| Table | Base | Status |
|---|---|---|
| `users`, `companies`, `company_memberships`, `sessions` | Yes (auth, companies) | kept |
| `counterparties`, `income_documents`, `income_receipts`, `expense_documents`, `expense_payments` | Yes (movements) | kept |
| `tax_obligations`, `audit_events` | Yes (tracking) | kept |
| `fiscal_parameters`, `fiscal_plans`, `fiscal_plan_versions`, `reserve_entries` | Yes (planning) | kept |
| `forecast_runs` | Yes (planning); the `method` constraint was widened by migration `c7d2e5a9b1f3` | kept (see section 3) |
| `alerts`, `alert_comments` | Yes (alerts) | kept |
| `external_sources`, `external_dataset_versions`, `tax_collections`, `sector_benchmarks` | No (limited stage 2) | added |

No table was added or removed in Phase 5. The model list is in `backend/app/models.py`.

## 3. Migrations

| Revision | Content | Status | Note |
|---|---|---|---|
| `b936452f07f9_initial_schema` | Initial schema | kept | verify against the base zip |
| `c7d2e5a9b1f3_forecast_method_ml` | Allows the ML methods in `forecast_runs.method` | kept | Phase 5 did not add a migration; the stored methods stay inside this constraint |
| `f3b8c2d1a7e4_external_context` | New external-context tables only, with downgrade | added | baseline-commit.md §5 |

## 4. Changes made in Phase 5 (verifiable in Git)

| Item | Base / as first ported | Now | Status | Evidence |
|---|---|---|---|---|
| Global model artifact | Only a per-company artifact | `backend/model_artifacts/model_global.json` (`global-20261103-84df89b5`), SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e` | added | `test_deployed_artifact_has_the_evaluated_sha256` |
| Artifact lookup | Company artifact only | Company artifact first, then the global one | changed | `test_global_model_is_used_when_the_company_has_no_artifact`, `test_company_artifact_wins_over_the_global_model` |
| Normalization and float32 | Not supported | `mean_last_n` normalization; features cast to float32 before the trees | changed | `test_parity_with_scikit_learn` (parity cases in `backend/model_artifacts/parity_cases.json`) |
| History rules | `lags + 1` months | `min_history_months` from the artifact (6); zero or negative scale is insufficient history | changed | `test_fewer_than_six_months_returns_insufficient_history`, `test_exactly_six_months_is_enough`, `test_zero_scale_is_insufficient_history` |
| Horizon | Up to 12 in the route | Capped at the 6 evaluated months for the global model | changed | `test_global_horizon_is_capped_at_the_evaluated_six_months` |
| Run provenance | `model_version` | Adds `scope`, `artifact_sha256`, `is_demo` to `assumptions` | changed | `test_global_model_is_used_when_the_company_has_no_artifact` |
| Invalid artifacts | n/a | `artifact_invalid` without breaking the ERP | added | `test_invalid_global_artifact_returns_artifact_invalid`, `test_corrupt_global_artifact_keeps_the_erp_working` |
| No scikit-learn in the backend | n/a | Checked by a test | added | `test_backend_never_imports_scikit_learn` |
| Demo data command `flask demo-load` | `flask seed-demo` only | Loads holdout companies and one 4-month company, idempotent | added | `test_demo_data.py` (3 tests) |
| Alert rule A1, projected loss month | Not present | `_rule_loss_month` in `alerts/rules.py` | added | `test_loss_month_alert_lists_every_projected_loss_month`, `test_loss_month_alert_does_not_fire_without_losses` |
| Forecast screen | Model results | Shows the model scope and its evaluation | changed | `frontend/src/app/App.tsx` (commit `ad272c7`) |
| Language | Mixed Spanish and English | English; `es-CO` locale replaced | changed | commits `45a6ad8`, `1dad405`, `66edad1`, `648b93b` |
| Error `code` values | n/a | Unchanged: the codes found by a pattern check in `backend/app` are the same before and after (11 and 11, none added or removed) | kept | pattern check on `a4149d2` vs `HEAD` |
| Raw data | n/a | Not tracked; only `.gitkeep` remains | changed | commit `4d867dd` |
| CI | Pytest on PostgreSQL | Pytest restored after a short period without it | kept | commit `2f714fa` |
| Deployment files | `render.yaml`, `compose.yaml`, `docker/` | Same, with the artifact in `backend/model_artifacts/` | kept | `docs/erp/deployment.md` |

## 5. Tests

Last full run for this document: `pytest` on SQLite, **62 passed, 10 skipped** (the 10 skipped are the PostgreSQL integration tests, which need `TEST_DATABASE_URL`). The earlier figures in the instructions (38 passed, 10 skipped) and in the baseline commit (30 and 10) are historical. The run against PostgreSQL 16 and 17.11 reported by the ERP port session (51 passed) was on the `erp-port` suite and has not been repeated here.

## 6. Pending verification

1. Compare the base zip against sections 1 to 3 and fix every **verify** cell.
2. Confirm whether the Dashboard and Health modules were in the base.
3. Re-run the PostgreSQL tests on `phase5/flask-api` and record the number.