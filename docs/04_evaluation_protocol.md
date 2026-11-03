# Phase 4 — Evaluation Protocol

- **Project:** AlertaFiscal, Machine Learning course, Universidad de Cundinamarca
- **Phase owner:** Manuel Eduardo Alarcon Aza (written with Sergio Steeven Moreno Forero)
- **Branch:** `phase4/evaluation`
- **Status:** fixed before any test result exists. Committed and tagged `eval-protocol-v1` on November 3, 2026.

> This document is written and tagged **before** the final artifact exists and before any row with `split` equal to `test` or `holdout` is opened. Nothing in it may change after the official run. If the team disagrees about a rule, this document wins.

---

## 1. Objective

Measure, once and honestly, how well the model selected in Phase 3 forecasts monthly `income` and `expenses` six months ahead on data that nobody used to train or choose it, and decide whether it is **accepted** under the success criterion approved in Phase 1.

The evaluated object is the exact file the application will run: `ml/artifacts/model_global.json`, executed with a pure-Python predictor (no scikit-learn), identified by its SHA-256.

## 2. Data and scenarios

Inputs, delivered through `develop` (never local copies):

- `ml/data/processed/monthly_series.csv`: 500 companies × 36 months (`2023-01` to `2025-12`).
- `ml/data/processed/split_manifest.csv`: `train` (months 1–24), `validation` (25–30), `test` (31–36) for the 425 regular companies; `holdout` for all 36 months of 75 reserved companies.

`company_profiles.csv` is **never** used to produce, adjust or filter a forecast (see section 4.2 for the only allowed use, after the run).

| Scenario | Companies | History given to the model | Months forecast and scored |
|---|---|---|---|
| **Temporal test** | 425 regular | Months 1–30 (`train` + `validation`) | 31–36 (`test`) |
| **Holdout test** | 75 holdout | Their months 1–30, used only as input | Their months 31–36 |

The holdout scenario is the harder and more honest one: the model has never seen these companies.

**Before the official run** the script may only be exercised on the validation window (history 1–24, forecast 25–30, regular companies). In that mode it does not read `test` or `holdout` rows at all.

## 3. Forecasting procedure

Every model, including the baseline, follows the same procedure for every company:

1. Take the company's history (months 1–30), oldest to newest, for one target at a time.
2. Forecast 6 months **recursively**: predict month 31, append the prediction to the history, predict month 32 from it, and so on until month 36. Real values of months 31–36 are never used as inputs.
3. Negative forecasts are clipped to zero.

**Chosen model.** Computed by `ml/src/evaluate.py` from `model_global.json` with the pure-Python predictor, using exactly the features and normalization declared in the artifact (`feature_spec`), and the same algorithm as the backend (`t` starting at 0, `month_sin`, `month_cos`, `lag1`, `lag2`, `lag3`, normalization `mean_last_n` with `n = 3`). The expected file structure is in Appendix A.

**Baseline.** Seasonal naive: the forecast for each month is the company's real value of the same month one year earlier (month 31 ← month 19, …, month 36 ← month 24). Since every source month belongs to the history, no forecast is fed back.

**Parity gate.** Before forecasting, the script runs every case in `parity_cases.json`. The maximum relative difference between the pure-Python predictor and Jonathan's expected values must be ≤ 1e-6. If parity fails, the official run stops: it is a bug, not a result (see section 7).

## 4. Metrics and formulas

For a set of company-months with forecast `ŷ` and real value `y`, computed separately for `income` and `expenses`:

| Metric | Formula | Notes |
|---|---|---|
| **MAE** | mean(\|ŷ − y\|) | Main metric. Millions of COP. Pooled over all company-months of the scenario. |
| **RMSE** | √mean((ŷ − y)²) | Main metric. Penalizes large misses. |
| **Normalized MAE** of company *c* | mean over its 6 months of \|ŷ − y\| ÷ mean of its **income** over months 1–30 | Same definition as Phase 1, section 4.3. Expenses are also divided by income. Reported as the **median** and the **90th percentile** across companies. |
| **MAPE** | mean(\|ŷ − y\| ÷ y) × 100, only where y > 0 | Secondary. Reported with the number of excluded zero months. Never used alone. |
| **Bias** | mean(ŷ − y) | Positive means the model forecasts too high. |

Percentiles use linear interpolation between ordered values (the default of `numpy.percentile`), implemented in pure Python.

### 4.1 Breakdowns reported for both scenarios and both targets

- By forecast horizon: MAE at +1, +2, …, +6.
- By sector (6 sectors): MAE and median normalized MAE.
- By company size tercile: companies ranked by mean monthly income over months 1–30 inside each scenario and split into three groups of nearly equal size (small, medium, large).
- Income versus expenses, temporal versus holdout, chosen model versus baseline.
- The 10 largest absolute errors (company, sector, month, target, forecast, real value).

### 4.2 Level shifts (post-run diagnostic only)

Phase 2 added a permanent level shift to 72 companies. To report "companies with a level shift versus the rest", the report may read the column `shock_month` of `company_profiles.csv` **only after** the tag `eval-final-run` exists, **only** to label companies in the error analysis. It never enters a forecast, a metric of section 5 or the verdict.

## 5. Acceptance criteria

The criterion is the one approved in Phase 1 (`docs/01_business_and_data.md`, sections 4.2–4.4), applied to the official run.

| # | Condition | Applied to |
|---|---|---|
| **C1** | Chosen model MAE ≤ 0.90 × baseline MAE (at least 10 % better), computed with the same procedure | Each target, each scenario (4 checks) |
| **C2** | Median normalized MAE ≤ 15 % | Each target, each scenario (4 checks) |
| **C3** | 90th percentile of normalized MAE ≤ 30 % | Each target, each scenario (4 checks) |

**Verdict:** the model is **accepted** only if all 12 checks pass. Otherwise it is **not accepted**, and the report lists every failed check. There is no partial acceptance and no re-run.

C1 was used in Phase 3 on the validation window to select the model. Here the same 10 % rule is applied on test and holdout data, because the comparison with the baseline must hold on data nobody used for selection.

**Reference (validation only, from Phase 1 and Phase 2):** the seasonal naive baseline has a median normalized MAE of 12.5 % for income (90th percentile 28.0 %) and 12.3 % for expenses (90th percentile 27.1 %). No reference number is computed on test months before the official run.

### Approval record (copied from Phase 1, section 4.4)

| Item | Value |
|---|---|
| Criterion approved | Phase 1 sections 4.2 and 4.3, option A: 15 % / 30 % as the business ceiling; at least 10 % better than the baseline |
| Approved by | Sergio Steeven Moreno Forero, Jonathan Alejandro Yacuma Rivera, Manuel Eduardo Alarcon Aza, Samuel Castellanos Rivera |
| Date | November 3, 2026 |

## 6. Evaluated artifact and hash rule

1. The evaluated artifact is `ml/artifacts/model_global.json` delivered by Phase 3, together with `ml/artifacts/parity_cases.json`.
2. `evaluate.py` computes the SHA-256 of the exact bytes of `model_global.json` and writes it to `ml/artifacts/test_report.json` as `artifact_sha256`, together with the SHA-256 of `parity_cases.json`, `monthly_series.csv` and `split_manifest.csv`.
3. After the official run nobody edits `model_global.json`. A different hash means a different model: the evaluation does not apply to it.
4. Phase 5 deploys a file with the same SHA-256 and checks it in a test. Phase 6 records the model version in every forecast.
5. The artifact must be one of the three types the backend supports: `seasonal_naive`, `linear_regression` or `random_forest`. An MLP cannot be evaluated because it cannot be deployed.

## 7. Run-once rule and how it is enforced

| Control | How |
|---|---|
| Protocol before results | This file is committed and tagged `eval-protocol-v1` before `evaluate.py` and before the final artifact. The tag date proves it. |
| Validation mode by default | `python ml/src/evaluate.py` reads only `train` and `validation` rows. |
| Official mode is explicit | `python ml/src/evaluate.py --official` is required to open `test` and `holdout` rows. |
| One official run | The script refuses to run in official mode if `ml/artifacts/test_report.json` already exists or the tag `eval-final-run` exists. |
| Parity gate | The official run stops before reading test rows if parity fails. |
| Proof | Right after the run: `git add ml/artifacts/test_report.json`, commit `feat: add final test evaluation results`, tag `eval-final-run`, push with tags. |

**If the official run crashes** (an exception, not a bad number): the team is told immediately; the bug is fixed without changing the model, the artifact or this protocol; the run is repeated once; the report documents the crash, the fix and its commit. A bad result is not a crash.

**Forbidden after the run:** changing or retraining the model because of test results, re-running to get a better number, or reporting only favorable metrics.

---

## Appendix A. Artifact structure read by `evaluate.py`

This is the structure the pure-Python predictor reads. It follows the global artifact contract agreed with Phase 5. If Jonathan's export uses different key names, only the reader is adapted, before the official run, and the change is documented in the report.

```json
{
  "schema_version": 1,
  "scope": "global",
  "model_version": "rf-2026-11-09",
  "min_history_months": 6,
  "horizon": 6,
  "feature_spec": {
    "features": ["t", "month_sin", "month_cos", "lag1", "lag2", "lag3"],
    "normalization": {"type": "mean_last_n", "n": 3}
  },
  "targets": {
    "income":   {"model_type": "random_forest", "trees": [ ... ]},
    "expenses": {"model_type": "random_forest", "trees": [ ... ]}
  },
  "data_provenance": {"kind": "semi_synthetic", "is_demo": true}
}
```

Features, for the month being forecast, with `history` holding the known values (real or already forecast):

| Feature | Value |
|---|---|
| `t` | position of the forecast month in the company's own history, starting at 0 (equal to `len(history)`) |
| `month_sin`, `month_cos` | sin and cos of 2π × calendar month / 12 |
| `lag1`, `lag2`, `lag3` | last, second-to-last and third-to-last value of `history`, divided by `scale` |
| `scale` | mean of the last `n` values of `history` (normalization `mean_last_n`) |

Forecast = max(0, model output × `scale`). Without normalization, lags are raw and the output is the forecast.

Model types:

| `model_type` | Fields | Prediction |
|---|---|---|
| `seasonal_naive` | none | value 12 months earlier |
| `linear_regression` | `coef` (one per feature, same order), `intercept` | intercept + Σ coef × feature |
| `random_forest` | `trees`: list of `{children_left, children_right, feature, threshold, value}` arrays as in scikit-learn's `tree_` (leaf when `children_left` is −1; go left when `x[feature] <= threshold`) | mean of the leaf values of all trees |

`parity_cases.json`:

```json
{"cases": [
  {"income_history": [ ... ], "expense_history": [ ... ], "last_month": "2025-06",
   "expected": {"income": [6 values], "expenses": [6 values]}}
]}
```

`expected` holds the forecasts that Jonathan's scikit-learn model produces for the same inputs, before rounding.
