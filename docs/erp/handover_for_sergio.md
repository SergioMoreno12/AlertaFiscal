# Phase 5 handover note for Sergio

Written on November 4, 2026 from the state of `phase5/flask-api` (after the changes of this note). It answers the four points of Step 16: where forecasts are stored, how actual values are read, the deployed URL and how to roll back.

## 1. Where forecasts are stored

- Table `forecast_runs` (model `ForecastRun` in `backend/app/models.py`). One row per forecast: `company_id`, `method`, `horizon_months`, `cutoff_date`, `projected_income`, `projected_expenses`, `model_version`, `assumptions` (JSON), `created_by`.
- `cutoff_date` is the end of the last month of history used for the forecast.
- The monthly values are inside `assumptions["monthly"]` (one entry per forecast month, income and expenses). The same JSON holds `history_signature`, `history_months`, `history_period`, `scope` (`global` or `company`), `artifact_file`, `artifact_sha256`, `is_demo`, the model metrics and `inputs_changed_since_training`.
- `method` is one of `manual`, `seasonal_naive`, `linear`, `random_forest`, `mlp` (constraint `ck_forecast_method`). The global model currently stores `random_forest`.
- Every model run also writes an audit event `forecast.model_run` (table `audit_events`) with the method, model version, horizon, scope and artifact hash.
- Nothing is stored in local files: everything is in PostgreSQL, so a redeploy does not lose forecasts.
- Read them through `GET /api/v1/companies/<company_id>/forecasts` (list) or the helper `latest_forecast(company_id)` in `backend/app/modules/planning/forecasting.py`. Create one with `POST /api/v1/companies/<company_id>/forecasts/model` (body `{"horizon_months": 6}`; the global model is capped at 6).

## 2. How actual values are read

- The function is `monthly_history(company_id)` in `backend/app/modules/planning/forecasting.py`.
- It sums `total` of `income_documents` and `expense_documents` by month of `issue_date`, excludes documents whose status is `void`, and fills months without movements with an explicit zero between the first and the last month.
- It uses only the company's own ERP documents, never DIAN or Supersociedades data.
- To compare a forecast with what actually happened, call `monthly_history` again after new documents arrive and compare each `assumptions["monthly"]` month with the same month of the history. `flask demo-load --through 36` adds months 35 and 36 of the demo companies for that purpose.
- The `history_signature` in `assumptions` fingerprints the history used; if it differs from the current one, the inputs changed after the forecast.

## 3. Deployed URL

**There is none yet.** The deployment on Render and Supabase (Step 15) has not been done from this branch; the repository only holds `render.yaml` and the deployment guide `docs/erp/deployment.md`. Add the URL here once the services are up and the end-to-end check passes.

The scratch validation on Supabase (schema `alertafiscal_scratch`, PostgreSQL 17.11, `/health/ready` ready) described in `docs/erp/deployment.md` is not production: the production schema, the migrations run as a controlled step and a separate least-privilege runtime role still have to be set up.

## 4. How to roll back

1. The deployed model is a file in Git: `backend/model_artifacts/model_global.json` (version `global-20261103-84df89b5`, SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`). To go back to a previous artifact, restore that file from the earlier commit and redeploy.
2. To go back to a previous release, redeploy the previous commit in Render. Data stays in PostgreSQL.
3. Do not edit the artifact by hand and do not run `ml/src/train_models.py` for this: each run changes `trained_at` and therefore the hash, and the test `test_deployed_artifact_has_the_evaluated_sha256` will fail on purpose.
4. Database migrations are not rolled back automatically. A `flask db downgrade` needs explicit approval and a backup first.

## 5. Useful commands

```
flask db upgrade            # migrations (a controlled step, never on startup)
flask demo-load             # semi-synthetic demo companies (idempotent)
flask seed-demo --yes       # fictitious ERP demo data (idempotent)
python -m pytest -q         # backend tests (SQLite by default)
```

## 6. What is not done (honest status)

- Deployment on Render and Supabase and its end-to-end check.
- Production database schema, least-privilege runtime role and the connection budget for the real Supabase limit.
- Re-running the PostgreSQL integration tests on this branch (they are skipped without `TEST_DATABASE_URL`).
- Confirming the GitHub Actions run is green.
- Verifying the traceability matrix against the base zip (see `traceability_base_vs_ported.md`, section 6).