# Phase 6 — Forecast Monitoring

- **Owner:** Sergio Steeven Moreno Forero
- **Branch:** `phase6/monitoring`
- **Code:** `backend/app/modules/monitoring/` (service and endpoint), tables in `backend/app/models.py`, migration `backend/migrations/versions/d4e8a1b2c3f5_forecast_monitoring.py`, screen in the History tab of the frontend.
- **Tests:** `backend/tests/test_monitoring.py`; results in [`06_test_cases.md`](06_test_cases.md).

## 1. Purpose

A deployed model is not a finished model. The data a company registers changes over time (a new client, a lost contract, a different season), and a forecast that was good can get worse without anyone noticing. Monitoring records what the model predicted, compares it with what really happened once the month is closed, and shows whether the error is still at the level measured in Phase 4.

Monitoring **observes**. It never changes the model, its metrics, the stored forecasts or the Phase 4 numbers. When the status is bad, a person decides what to do ([`06_retraining_and_rollback.md`](06_retraining_and_rollback.md)).

## 2. Reference error

The reference is the error Phase 4 measured once, in the official run (`eval-final-run`, [`04_evaluation_report.md`](04_evaluation_report.md), section 8): the median normalized MAE of the global model.

| Scenario | Income | Expenses |
|---|---|---|
| Temporal test (425 companies) | 10.22 % | 10.69 % |
| **Holdout test (75 unseen companies), used as reference** | **12.34 %** | **11.75 %** |

The holdout values are used because a company in the app was never part of the training data, which is exactly the holdout situation. Using the lower temporal values would mark normal companies as "watch" too often.

The values live in one place in the code: `REFERENCE_NORMALIZED_ERROR_PCT` in `monitoring/service.py`.

## 3. Why the error is normalized

Companies in this project differ about 100 times in size (9 to 1,600 million COP of monthly income). An error of 20 million COP is excellent for the largest company and useless for the smallest. Monitoring therefore compares **percentages**:

```
normalized_error_pct = |predicted − actual| / scale × 100
scale = mean monthly income of the history the forecast run used
```

This is the same definition Phase 4 used (company MAE divided by its mean monthly income), so the app's numbers can be compared directly with the reference. Expenses are also divided by the income scale, as in Phase 4. The scale is stored in each row when the forecast is made, so a later change of the history does not change past errors.

## 4. Thresholds

Each status is a **closed interval** on the ratio between the rolling normalized error and the reference:

```
ratio = rolling_normalized_error_pct / reference_pct
```

| Status | Interval | Meaning |
|---|---|---|
| `normal` | 0 ≤ ratio ≤ 1.0 | The error is at or below what Phase 4 measured. |
| `watch` | 1.0 < ratio ≤ 1.5 | The error is above the reference but less than 50 % above it. Look at the company's recent data. |
| `degraded` | 1.5 < ratio | The error is more than 50 % above the reference. Follow the retraining procedure. |
| `pending` | no resolved month yet | There is nothing to compare yet. It is not an error level. |

Every non-negative ratio belongs to exactly one level: the upper end of each interval is included in that level and excluded from the next one, so there are no gaps and no overlaps. An error exactly equal to the reference is `normal`; exactly 1.5 times the reference is `watch` (tests `test_thresholds_are_closed_intervals_without_gaps` and `test_error_exactly_equal_to_the_reference_is_normal`).

**Why 1.0 and 1.5.**

- **1.0:** the reference is a median, so half of the holdout companies were already above it in Phase 4. Being above it is not alarming, but it is the point where a company stops being "typical", so it is the start of `watch`.
- **1.5:** in Phase 4 the P90 normalized MAE on holdout was 21.25 % for income and 19.85 % for expenses, that is 1.72 and 1.69 times the median. A threshold of 1.5 marks as `degraded` a company whose error approaches the worst 10 % seen in evaluation. For income, 1.5 × 12.34 % = 18.5 %, which is also above the 15 % business criterion of Phase 1 (`01_business_and_data.md`, section 4.3): above that point the forecast no longer meets the agreed business use.
- **Rolling window of 3 months:** one bad month is noise (Phase 4 shows that horizons +5 and +6 are naturally worse). Three months smooth a single outlier while still reacting within one quarter. It also matches the model's own memory: the features use the last 3 months (`lag1`–`lag3`, `mean_last_n` with n = 3), so a level shift takes about 3 months to enter the model.

## 5. Table design

Both tables are created by the Alembic migration `d4e8a1b2c3f5` (revises `c7d2e5a9b1f3`). The migration only adds tables; it does not change existing tables or data.

### `forecast_monitoring` — one row per target and forecast month of a model run

| Column | Type | Meaning |
|---|---|---|
| `id` | integer, PK | |
| `company_id` | FK `companies.id`, cascade | Owner company; every query filters by it. |
| `forecast_run_id` | FK `forecast_runs.id`, cascade | Link to the `ForecastRun` that produced the value. `ForecastRun` is extended by reference, not replaced. |
| `target` | `income` or `expenses` | Check constraint. |
| `forecast_month` | `YYYY-MM` | Forecast calendar month. |
| `horizon_step` | integer | 1 to 6: how far ahead the forecast was. |
| `predicted_value` | numeric(18,2), COP | Taken from the monthly values stored in the run. |
| `scale_value` | numeric(18,2), COP | Mean monthly income of the history used by the run. |
| `actual_value` | numeric(18,2), nullable | Empty until the month is closed and has real data. |
| `absolute_error` | numeric(18,2), nullable | `|predicted − actual|`. |
| `normalized_error_pct` | numeric(9,4), nullable | Section 3. |
| `status` | `pending`, `normal`, `watch`, `degraded` | Check constraint. Level of this single month. |
| `model_version` | text | Copied from the run, for example `global-20261103-84df89b5`. |
| `resolved_at` | timestamp, nullable | When the actual value was filled. |
| `created_at`, `updated_at` | timestamps | |

Unique key `(forecast_run_id, target, forecast_month)` and index `(company_id, target, forecast_month)`.

### `forecast_service_events` — one row per call to the model forecast endpoint

| Column | Meaning |
|---|---|
| `company_id` | Company that asked for the forecast. |
| `outcome` | `success`, `insufficient_history`, `model_not_trained`, `artifact_invalid` or another `ForecastUnavailable` code. |
| `latency_ms` | Time spent computing the forecast. |
| `model_version` | Version used when the forecast succeeded. |
| `created_at` | |

## 6. How it works

1. **Recording predictions.** When `POST /api/v1/companies/{id}/forecasts/model` creates a run, `record_predictions` writes 2 × horizon rows (one per target and month) with status `pending`. Manual runs are not monitored: they are user assumptions, not model output.
2. **Filling actual values.** A month is resolved only when it is **closed** (earlier than the current month) and the ERP history (`monthly_history`, the same function the forecast uses) has a value for it. This happens:
   - when the company creates an income or expense document (the movements module calls the refresh inside a nested transaction, so a monitoring problem never blocks saving a document), and
   - every time the monitoring endpoint is read, so a value registered late or loaded by another path is still picked up.
   If the real value never arrives, the row stays `pending` forever; it is never guessed.
3. **Rolling status.** For each target, `company_status` takes, for each forecast month, the row of the most recent run that forecast it, keeps the resolved ones and averages the normalized error of the last 3. The ratio to the reference gives the target status (section 4). The company status is the worse of the two targets.
4. **Inputs changed since training.** If the company's history changed after the model it uses was trained, the run carries `inputs_changed_since_training`, and the monitoring view shows it.

## 7. Operational monitoring

| Metric | Where it comes from |
|---|---|
| Availability | Render calls `GET /health/ready` (`render.yaml`, `healthCheckPath`); it checks the database connection. Render restarts the service when it fails and shows the history in its dashboard. |
| Forecast latency | `latency_ms` of each `forecast_service_events` row; the endpoint returns p50 and p95 of the last 500 calls. |
| Counts by outcome | `outcome` of each row (`success`, `insufficient_history`, `model_not_trained`, `artifact_invalid`). |
| Model version used | `model_version` of the last successful call and of each monitoring row. |

Everything is stored in PostgreSQL. Nothing is written to local files: Render's disk is erased on every redeploy.

## 8. Where it is shown

- **Endpoint:** `GET /api/v1/companies/{id}/monitoring` returns the company status, status per target (rolling error, ratio, months used, pending months), model version, date of the last forecast, the inputs-changed flag, the thresholds, the latest 60 rows and the operational summary.
- **Screen:** History → Monitoring tab. It shows the overall status, one card per target, the forecast service counts and latency, and the table of predicted versus actual values.

## 9. Data protection

- Every query filters by `company_id`, and the endpoint uses the same `authorized_company` check as the rest of the ERP: a user only sees companies they belong to (`test_monitoring_of_another_company_is_forbidden`).
- The tables store aggregated monthly amounts per company, no personal data. Details and retention: [`06_privacy_and_retention.md`](06_privacy_and_retention.md).
- The database URL comes only from the `DATABASE_URL` environment variable; there are no credentials in the code or the repository.

## 10. Limits

- With semi-synthetic data, the first real evidence of drift will only exist once a company registers several real months after a forecast. Until then most rows are `pending`.
- The reference comes from evaluation on generated series. For real companies it may need to be recalibrated after some months of real data.
- Monitoring does not distinguish between a real change in the business and a data entry error; both raise the error. The user must check the data first.
