# Phase 6 — Test Cases

- **Owner:** Sergio Steeven Moreno Forero
- **Run:** November 3, 2026, branch `phase6/monitoring`, command `python -m pytest -q` in `backend/` (SQLite test database, Python 3.14).
- **Result of the whole suite:** 84 passed, 0 failed, 10 skipped. The 10 skipped tests are `test_postgres_integration.py`; they need `TEST_DATABASE_URL` and run in CI against a PostgreSQL service.
- Test files: `backend/tests/test_forecasting_ml.py`, `test_forecasting.py`, `test_monitoring.py`, `test_isolation.py`, `test_demo_data.py`.

A case is **passed** only when every automated test listed for it passed in this run. Case 14 needs the deployed app and is marked as not run until it is checked on Render.

| ID | Case | Steps | Expected result | Actual result | Status |
|---|---|---|---|---|---|
| 1 | Fewer than 6 months of history | Company with 4 months of documents asks for a model forecast (`test_fewer_than_six_months_returns_insufficient_history`; demo company C0252 in `test_demo_companies_show_model_and_manual_mode`). | HTTP 200 with `code: insufficient_history`, required and available months, and `manual_available: true`. No forecast is stored. | `insufficient_history`, `required_months: 6`, `months_available: 4`, `manual_available: true`. | Passed |
| 2 | Exactly 6 months | Company with 6 months asks for a model forecast (`test_exactly_six_months_is_enough`). | HTTP 201, forecast created with `history_months: 6`. | HTTP 201, `history_months: 6`. | Passed |
| 3 | More than 6 months | Company with 12 months asks for a forecast (`test_global_model_is_used_when_the_company_has_no_artifact`); company with 8 months asks for 12 months (`test_global_horizon_is_capped_at_the_evaluated_six_months`). | Valid 6-month forecast, positive values; the horizon is capped at the evaluated 6 months. | 6 monthly points starting `2026-01`, all positive; a request for 12 returns 6. | Passed |
| 4 | Company with no data | Company with no documents asks for a model forecast (`test_company_without_documents_returns_insufficient_history`). | Clear message, not a crash. | HTTP 200, `insufficient_history`, `months_available: 0`. | Passed |
| 5 | Own model vs global model | Company without its own artifact (`test_global_model_is_used_when_the_company_has_no_artifact`); company with `model_company<id>.json` (`test_company_artifact_wins_over_the_global_model`). | Without its own artifact the global model is used; with one, the company model is used. | `scope: global`, version `global-20261103-84df89b5`; with its own file, `scope: company` and its own version. | Passed |
| 6 | Forecast stored, real value never arrives | Create a model forecast, add no new documents, refresh monitoring (`test_actual_value_that_never_arrives_stays_pending`, `test_predictions_are_recorded_when_a_run_is_created`). An open month with documents is also checked (`test_open_month_is_not_resolved_even_with_documents`). | 12 rows (6 months × 2 targets) with status `pending`; nothing is resolved; an open month is not resolved even if it has documents. | 12 `pending` rows linked to the run; 0 resolved; the open month stays pending. | Passed |
| 7 | Real value arrives late | Forecast, refresh (nothing resolved), then register the month's documents and refresh again (`test_late_actual_value_is_computed_when_it_arrives`); the same through the API when an income document is created (`test_new_income_document_resolves_monitoring_through_the_api`). | The error is computed when the value arrives. | First refresh resolves 0 rows, second resolves 2; the API path fills `actual_value` `120000000.00`. | Passed |
| 8 | Error exactly on a threshold | Ratios 0, 0.9999, 1.0, 1.0001, 1.5, 1.5001 and 10 (`test_thresholds_are_closed_intervals_without_gaps`); error equal to the reference and to 1.5 × reference (`test_error_exactly_equal_to_the_reference_is_normal`). | 1.0 → normal, 1.5 → watch, 1.5001 → degraded; no value without a level. | All 7 ratios get the expected level; reference → normal, 1.5 × reference → watch. | Passed |
| 9 | Status moves normal → watch → degraded | Resolve three months one at a time with errors of 0.5, 2.5 and 4.0 × reference (`test_status_moves_from_normal_to_watch_to_degraded`); fixed ratios 0.5, 1.25 and 2.0 (`test_status_follows_the_rolling_error`). | Rolling means 0.5, 1.5 and 2.33 give normal, watch, degraded; fixed ratios give normal, watch, degraded with 3 months used. | `["normal", "watch", "degraded"]`; fixed ratios as expected, 3 months used. | Passed |
| 10 | Small and large company, same percentage | Company with about 10 million COP per month and one with about 1,000 million, both with 1.3 × reference (`test_small_and_large_company_with_same_percentage_get_the_same_status`). | Same status and the same rolling normalized error. | Both `watch`; rolling errors equal within 0.1 %. | Passed |
| 11 | "Inputs changed since training" flag | Run marked as having inputs changed after training (`test_inputs_changed_flag_is_reported`); history changed after a forecast (`test_stale_forecast_alert_after_inputs_change`). | The monitoring view shows the flag; a stale-forecast alert is raised. | `inputs_changed_since_training: true` in the view; the stale alert is created. | Passed |
| 12 | Model file missing or invalid | No artifact (`test_model_forecast_missing_artifact_is_explicit`); artifact with wrong scope, features, normalization, model type or schema (`test_invalid_global_artifact_returns_artifact_invalid`, 5 variants); file that is not JSON (`test_corrupt_global_artifact_keeps_the_erp_working`). | Explicit error code, manual mode offered, the rest of the ERP keeps working. | `model_not_trained` / `artifact_invalid` with `manual_available: true`; dashboard returns 200 and a manual forecast is created. | Passed |
| 13 | Deployed file has the evaluated SHA-256 | Hash `backend/model_artifacts/model_global.json` (`test_deployed_artifact_has_the_evaluated_sha256`); parity with scikit-learn on the 50 Phase 3 cases (`test_parity_with_scikit_learn`). | `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`; parity within 1e-6. | Same SHA-256; parity passes. The forecast response also returns `artifact_sha256`. | Passed |
| 14 | Redeploy on Render keeps monitoring data | Deploy, create a model forecast, trigger a manual redeploy from the Render dashboard, open History → Monitoring again. | The rows and the service events are still there, because they live only in PostgreSQL (Supabase). | Not run yet: the app is not deployed. By design the monitoring module writes nothing to disk (section 7 of `06_monitoring.md`). | Not run |
| 15 | Two companies never see each other's data | Read the monitoring of a company the user does not belong to (`test_monitoring_of_another_company_is_forbidden`); company list, other company and missing company (`test_isolation.py`); forecast list isolation (`test_list_forecasts_isolated_between_companies`). | HTTP 403 for another company; lists show only the user's companies. | 403 for monitoring and the other company; isolation tests pass. | Passed |

**Summary:** 14 passed, 0 failed, 1 not run (case 14, needs the deployment).

## How to repeat

```bash
cd backend
python -m pytest -q
python -m pytest -q tests/test_monitoring.py tests/test_forecasting_ml.py
```

For case 14, after the deployment in `docs/erp/deployment.md`:

1. Sign in, open a demo company with at least 6 months, and create a model forecast in Forecasts.
2. Open History → Monitoring and write down the number of rows and of requests.
3. In the Render dashboard, open `alertafiscal-backend` and choose Manual Deploy → Deploy latest commit.
4. When the service is live again, reload History → Monitoring. The counts must be the same.
5. Write the result in the table above and change the status to Passed or Failed.
