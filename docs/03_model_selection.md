# Model Selection - Phase 3

Updated for the export contract agreed with the backend (Phase 5): the ERP does
not use scikit-learn or joblib, it reads `ml/artifacts/model_global.json` and
computes the forecast in pure Python.

Run: `2026-11-03T16:19:47Z`. Artifact: `global-20261103-84df89b5`.

Environment: Python 3.14.7, numpy 2.5.4, pandas 2.3.3, scikit-learn 1.9.1,
joblib 1.6.0, `random_state=42`. The training versions are pinned in
`ml/requirements.txt`; the root `requirements.txt` only keeps the web
dependencies, because the backend no longer needs scikit-learn.

## 1. Features and the scaling decision

### Data used

| Item | Value |
|---|---|
| Rows used | 12,750 |
| Companies | 425 |
| Rows discarded before any computation | 5,250 (`test` and `holdout`) |
| Training months | 1-24 (10,200 rows) |
| Validation months | 25-30 (2,550 rows) |
| Horizon | 6 months, recursive |
| Validation origin | month index 24 |

Only `monthly_series.csv` and `split_manifest.csv` were read. `test` and
`holdout` rows are filtered out inside `load_data` before the contract checks, so
they never reach the feature builder, the scaler, or any metric.
`company_profiles.csv` is never opened: it holds the true generating parameters
of every company and would be leakage.

### Features

One row per company per month, built from the target series only (income for the
income model, expenses for the expenses model). The order is the contract order,
because the backend uses it for the dot product:

| Feature | Definition |
|---|---|
| `t` | position of the month inside the company's own history, starting at 0. At prediction time it equals `len(history)` |
| `month_sin` | `sin(2 * pi * month_of_year / 12)` |
| `month_cos` | `cos(2 * pi * month_of_year / 12)` |
| `lag1` | previous value divided by the scale |
| `lag2` | value two months before divided by the scale |
| `lag3` | value three months before divided by the scale |

Prediction target: `ratio = value_of_next_month / scale`, where
`scale = mean(lag1, lag2, lag3)` in absolute units.

`t` replaced the previous absolute month index. It is 0 for the first month of
each company and grows with that company's history, so the model learns a shape
inside the history instead of a global calendar. This is what the backend can
reproduce: it only knows the history it receives. The first three months of each
company are dropped as training rows because they have no lags yet, but the
counter still starts at 0 (the first usable training row has `t = 3`, and the
first predicted month of a 24-month history has `t = 24`).

### Scaling decision: `mean_last_n`, n = 3

Each lag and the target are divided by the mean of the previous three observed
months. The model predicts a ratio and the forecast is recovered as
`ratio * scale`, clipped at zero. `t`, `month_sin` and `month_cos` are not
normalized. The rule is written in `feature_spec.normalization` of the artifact.

Reasons:

- Companies differ by more than two orders of magnitude (mean monthly income
  from about 20 to more than 1,000 million COP). Raw lags would make one global
  model dominated by the largest companies.
- After the division every lag and the target sit around 1.0, which removes the
  size effect without adding a per-company parameter.
- The scale only uses information available at prediction time: for month 25 it
  is the mean of months 22-24. Inside the recursion the scale for month 26 uses
  the forecast for month 25, never the real value, so validation is not
  contaminated.
- It is the only normalization the backend implements, and it is applied
  identically to every candidate.
- No mean, standard deviation, or any other statistic is computed over
  validation rows.
- **Scale of zero.** If the mean of the last three months is zero or negative,
  the ratio is undefined. The exporter, the parity predictor and
  `forecast()` raise an error in that case, the same way they do when there are
  fewer than six months of history; the app then falls back to manual mode.
  This dataset never triggers it (minimum monthly income 9.16 million COP,
  minimum expenses 9.93, no zero or negative rows), but the backend must apply
  the same rule. Rule proposed to Samuel.

### Sector

Sector is **not** a feature. The ERP stores sector as free text, so the app
cannot guarantee a canonical value (`retail`, `Retail`, `comercio`, and so on
would all arrive). Training on a cleaned category that the backend cannot
reproduce would break the contract between training and serving. Sector is used
only to break down the validation error in the tables below.

## 2. Candidates and search space

| Candidate | Configuration | Grid |
|---|---|---|
| Seasonal naive baseline | value from the same month one year earlier | none |
| Linear regression | ordinary least squares on the six features | none |
| Random forest | `RandomForestRegressor`, `n_jobs=-1` | `n_estimators` = 100, `max_depth` in {4, 6, 8}, `min_samples_leaf` in {5, 10} = 6 combinations |
| Multilayer perceptron | `StandardScaler` + `MLPRegressor`, `early_stopping=True`, `max_iter=3000`, `n_iter_no_change=20` | `hidden_layer_sizes` in {(16), (32), (32, 16)} x `alpha` in {1e-4, 1e-3, 1e-2, 1e-1} = 12 combinations |

The random forest grid respects the export limits: at most 100 trees, depth at
most 8, at least 5 samples per leaf. The JSON must stay under 5 MB, and a larger
forest does not fit.

The MLP stays in the study as a comparison experiment only. The backend has no
neural network code, so the final model must be one of `seasonal_naive`,
`linear_regression` or `random_forest`.

Protocol:

1. One model per target; income and expenses are never mixed.
2. Fit on months 1-24 only.
3. Forecast months 25-30 recursively from origin 24: each step feeds the previous
   prediction back as a lag.
4. Score against the real validation months with MAE, RMSE, MAPE (non-zero
   actuals only), and normalized MAE.
5. The hyperparameter combination with the lowest validation MAE is kept for each
   candidate-target pair.
6. The recommended model is the one with the lowest mean of the income and
   expenses MAE, restricted to the three exportable types.

40 fits in total (2 baselines, 2 linear, 12 forest, 24 MLP), 54.9 s.

### Normalized MAE

For every company, the absolute error of each horizon is divided by that
company's mean monthly income over the training months, in percent. The tables
report the mean of those values, the median, and the P90 across the 425
companies. The baseline uses exactly the same procedure.

Size terciles use the same mean monthly income: `small` up to 70.56 million COP,
`medium` up to 196.33 million COP, `large` above that. They are computed on
training months only.

## 3. Validation results

### Aggregate (months 25-30)

| Model | Target | MAE | RMSE | MAPE (%) | Normalized MAE (%) | Best hyperparameters |
|---|---|---|---|---|---|---|
| seasonal_naive | income | 27.974 | 49.363 | 15.47 | 15.15 | none |
| seasonal_naive | expenses | 27.837 | 49.131 | 15.93 | 14.99 | none |
| linear_regression | income | 35.081 | 53.870 | 24.90 | 21.31 | none |
| linear_regression | expenses | 36.805 | 56.721 | 26.92 | 22.23 | none |
| random_forest | income | 17.223 | 28.752 | 10.97 | 9.95 | `n_estimators=100, max_depth=8, min_samples_leaf=10` |
| random_forest | expenses | 17.368 | 29.150 | 11.34 | 9.90 | `n_estimators=100, max_depth=6, min_samples_leaf=5` |
| mlp | income | 49.508 | 79.960 | 33.88 | 29.83 | `hidden_layer_sizes=(32, 16), alpha=0.0001` |
| mlp | expenses | 41.515 | 66.439 | 29.59 | 24.80 | `hidden_layer_sizes=(32, 16), alpha=0.01` |

### Per horizon (MAE)

| Model | Target | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|
| seasonal_naive | income | 24.45 | 25.56 | 30.12 | 32.31 | 29.26 | 26.14 |
| seasonal_naive | expenses | 24.24 | 25.08 | 30.69 | 32.59 | 28.75 | 25.66 |
| linear_regression | income | 39.04 | 38.12 | 24.49 | 21.34 | 33.92 | 53.57 |
| linear_regression | expenses | 39.63 | 40.57 | 25.59 | 21.35 | 36.91 | 56.78 |
| random_forest | income | 16.53 | 16.82 | 15.89 | 17.20 | 18.03 | 18.88 |
| random_forest | expenses | 15.62 | 17.10 | 16.93 | 17.43 | 18.47 | 18.66 |
| mlp | income | 27.38 | 46.59 | 38.70 | 24.58 | 51.90 | 107.90 |
| mlp | expenses | 33.55 | 42.92 | 28.10 | 26.83 | 36.78 | 80.90 |

### Mean validation MAE (income and expenses)

| Model | Mean MAE | Relative to baseline | Exportable |
|---|---|---|---|
| seasonal_naive | 27.906 | - | yes |
| linear_regression | 35.943 | +28.8% worse | yes |
| random_forest | 17.296 | -38.0% better | yes |
| mlp | 45.511 | +63.1% worse | no |

### Selected model, normalized MAE (%) by horizon

Income:

| Horizon | Mean | Median | P90 |
|---|---|---|---|
| +1 | 9.25 | 8.06 | 18.66 |
| +2 | 9.28 | 8.12 | 18.41 |
| +3 | 9.61 | 8.05 | 20.30 |
| +4 | 9.96 | 8.19 | 21.06 |
| +5 | 10.32 | 8.94 | 21.38 |
| +6 | 11.29 | 10.29 | 21.52 |

Expenses:

| Horizon | Mean | Median | P90 |
|---|---|---|---|
| +1 | 8.79 | 7.28 | 18.07 |
| +2 | 9.52 | 8.40 | 19.00 |
| +3 | 9.79 | 8.25 | 20.00 |
| +4 | 10.10 | 8.99 | 19.72 |
| +5 | 10.39 | 8.63 | 20.68 |
| +6 | 10.83 | 9.31 | 21.97 |

### Selected model, normalized MAE (%) by sector

Income:

| Sector | Companies | Mean | Median | P90 |
|---|---|---|---|---|
| agriculture | 17 | 10.09 | 9.59 | 16.61 |
| construction | 31 | 9.32 | 8.94 | 13.27 |
| manufacturing | 86 | 9.44 | 7.59 | 16.48 |
| mining | 7 | 12.45 | 10.97 | 16.83 |
| retail | 159 | 10.10 | 9.04 | 17.06 |
| services | 125 | 10.12 | 9.25 | 16.85 |

Expenses:

| Sector | Companies | Mean | Median | P90 |
|---|---|---|---|---|
| agriculture | 17 | 9.03 | 8.57 | 14.76 |
| construction | 31 | 9.58 | 8.86 | 15.99 |
| manufacturing | 86 | 9.16 | 8.13 | 14.80 |
| mining | 7 | 10.13 | 9.54 | 13.28 |
| retail | 159 | 10.45 | 9.41 | 17.63 |
| services | 125 | 9.90 | 8.70 | 15.12 |

### Selected model, normalized MAE (%) by company size tercile

| Target | Tercile | Companies | Mean | Median | P90 |
|---|---|---|---|---|---|
| income | small | 142 | 8.94 | 7.61 | 14.70 |
| income | medium | 141 | 10.36 | 9.46 | 17.81 |
| income | large | 142 | 10.56 | 9.92 | 16.56 |
| expenses | small | 142 | 8.92 | 7.71 | 14.45 |
| expenses | medium | 141 | 10.04 | 9.49 | 16.03 |
| expenses | large | 142 | 10.75 | 9.39 | 18.87 |

The gap between the mean and the P90 (about 10% versus 17-22%) shows that most
companies are forecast well and a minority carries most of the error. Mining has
the highest income error of the six sectors, with only 7 companies.

## 4. Selected model and reasons

**Selected: random forest**, with `n_estimators=100, max_depth=8,
min_samples_leaf=10` for income and `n_estimators=100, max_depth=6,
min_samples_leaf=5` for expenses.

Reasons:

- Lowest mean validation MAE (17.296), 38.0% below the seasonal naive baseline
  (27.906), and it is exportable.
- Both targets beat the baseline separately: income 17.223 versus 27.974
  (-38.4%), expenses 17.368 versus 27.837 (-37.6%).
- Error is stable across the horizon (15.62 to 18.88). It does not grow with the
  number of recursive steps, which is what matters for a six-month product.
- It needs no scaling inside the model, so the artifact is only the tree arrays.
- The exported forest is 1.41 MB and 100 trees per target, well inside the 5 MB
  limit.

What changed with the new contract:

- The previous forest (300 trees, depth 8, leaf 1) reached 17.266 mean MAE
  (income 17.203, expenses 17.328) but could not be exported: it would produce
  a JSON far above the 5 MB limit. The search was therefore reduced to at most
  100 trees and retrained inside the limits (income: 100 trees, depth 8, leaf
  10; expenses: 100 trees, depth 6, leaf 5), then re-compared on validation as
  the instructions require. Income moves from 17.203 to 17.223, expenses from
  17.328 to 17.368, and the mean from 17.266 to 17.296: 0.030 MAE of cost in
  exchange for an artifact that fits in 1.41 MB.
- The previous `trend` feature was the absolute calendar month. It is now `t`,
  the 0-based position inside each company's history.
- Sector was removed from the feature set and is only used for reporting.

Why not the others:

- **Linear regression** is worse than the baseline (35.943). `t` grows outside
  the training range during validation, so the slope extrapolates and the error
  jumps at +6 (53.57 and 56.78). It cannot capture the non-linear relation
  between lags and the ratio.
- **MLP** is better than before but still worse than the baseline (45.511) and
  its error explodes at +6 (107.90 and 80.90). More importantly, the backend
  cannot evaluate a neural network, so it could not be deployed even if it had
  won.
- **Seasonal naive baseline** is competitive (27.906) and is the reference any
  candidate must beat. Only the random forest does.

Selection used validation only. The 5,250 `test` and `holdout` rows were never
read.

## 5. Export artifact and parity

`ml/src/export_artifact.py` writes `ml/artifacts/model_global.json`:

| Property | Value |
|---|---|
| `artifact_kind` | `forecast_model` |
| `schema_version` | 1 |
| `scope` | `global` |
| `model_version` | `global-20261103-84df89b5` |
| `min_history_months` | 6 |
| `feature_spec.features` | `t, month_sin, month_cos, lag1, lag2, lag3` |
| `feature_spec.normalization` | `{"type": "mean_last_n", "n": 3}` |
| Size | 1.41 MB (1,481,932 bytes, limit 5 MB) |
| Trees | 100 per target (income 26,144 nodes, expenses 10,914 nodes) |

`params` for the random forest store one scalar `value` per node and the
`children_left`, `children_right`, `feature` and `threshold` arrays of
`tree_`, the same layout the backend already uses.

`ml/src/check_export_parity.py` implements the backend algorithm in pure Python
(features from the history, `mean_last_n` scale, tree walk, multiply by the
scale, clip at zero, recursive) and compares it against the scikit-learn
recursive forecast for 50 validation companies:

| Check | Result |
|---|---|
| Cases | 50 companies, 6 months each, both targets (600 points) |
| Maximum relative difference | 9.876e-16 |
| Tolerance | 1e-6 |
| Status | PASS |

The comparison uses unrounded values, as the evaluation protocol asks. Rounding
to 2 decimals is applied after the recursion, at the API boundary; the file also
stores `expected_rounded` for that output. `ml/artifacts/parity_cases.json`
(74 KB) holds the 50 cases so the backend test can replay them.

## 6. Limitations and what you would do with more time

Limitations:

- Single validation origin. With 24 training months there is room for one origin
  (24) and one six-month window (25-30); the ranking could change with another
  window.
- `t` is a counter, not a calendar month, so the model cannot learn a trend
  shared across companies; it learns the shape of one company's history. That is
  the price of a feature the backend can rebuild from the history alone.
- The ratio target damps abrupt changes: the scale averages three months, so a
  company that suddenly halves its income will be forecast above what actually
  happened.
- Negative predictions are clipped at zero, which hides uncertainty in those
  cases.
- The mean normalized MAE (about 10%) and the P90 (17-22%) differ a lot: a small
  group of companies carries most of the error, and Mining is the worst sector
  with only 7 companies.
- Metrics are in millions of COP and weight every company equally.
- The forest had to shrink to fit the 5 MB limit, which cost 0.030 MAE.
- The MLP is reported only as an experiment; it cannot be deployed.
- Training frame starts at month 4 per company because of the three lag columns.
- The artifact is a global model; there is no per-company model yet.

With more time:

- Rolling-origin validation with several origins once more history is available.
- Direct per-horizon models instead of pure recursion, so errors do not compound.
- Per-segment models (by size tercile, not by sector text) if the ERP confirms a
  canonical category.
- Prediction intervals (quantile forest or residual bootstrap) instead of a
  single point forecast, which the alert product needs to avoid false positives.
- Compress the tree arrays (shared thresholds, float32) to win back forest size
  without touching the 5 MB limit.
- Calibrate the clip-at-zero rule with a floor per company instead of a global
  zero.
