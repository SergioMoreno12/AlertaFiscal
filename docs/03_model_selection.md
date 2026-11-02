# Model Selection - Phase 3

Generated from `ml/artifacts/candidates/metrics.json` (run `2026-11-02T03:19:42Z`).

Environment: Python 3.14.7, scikit-learn 1.9.1, pandas 2.3.3, numpy 2.5.4, `random_state=42`.

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

Only `monthly_series.csv` and `split_manifest.csv` were read. `test` and `holdout` rows are
filtered out inside `load_data` before the contract checks, so they never reach the feature
builder, the scaler, or any metric.

### Features

One row per company per month, built from the target series only (income for the income
model, expenses for the expenses model):

| Feature | Definition |
|---|---|
| `lag_1` | value of the previous month divided by the denominator |
| `lag_2` | value of two months before divided by the denominator |
| `lag_3` | value of three months before divided by the denominator |
| `trend` | `month_index`, the absolute month counter since 2023-01 |
| `sin_month` | `sin(2 * pi * month_of_year / 12)` |
| `cos_month` | `cos(2 * pi * month_of_year / 12)` |

Prediction target: `ratio = value_of_next_month / denominator`, where
`denominator = mean(lag_1, lag_2, lag_3)` in absolute units.

### Scaling decision: option (a)

Each lag and the target are divided by the mean of the previous three observed months.
The model predicts a ratio and the forecast is recovered as `ratio * denominator`, clipped
at zero.

Reasons:

- Companies differ by orders of magnitude (millions versus thousands of millions). An error
  of 10 million COP means something very different for each of them, so raw lags would make a
  single global model dominated by the largest companies.
- After the division every feature and the target sit around 1.0, which removes the size
  effect without adding a per-company parameter.
- The divisor only uses information that exists at prediction time: for month 25 it is the
  mean of months 22-24. Inside the recursion, the divisor for month 26 uses the forecast of
  month 25, never the real value, so validation results are not contaminated.
- It is applied identically to all four candidates. The seasonal naive baseline does not
  need it because it copies a value from the same company's own series.
- Option (b), scaling the target with a global scaler fitted on the whole training set, was
  rejected because the transformation would depend on a statistic computed across companies;
  option (a) keeps it inside each company's history and stays valid for a company whose level
  is far from the training average.
- No mean, standard deviation, or any other statistic is computed over validation rows.

## 2. Candidates and search space

| Candidate | Configuration | Grid |
|---|---|---|
| Seasonal naive baseline | value from the same month one year earlier | none |
| Linear regression | ordinary least squares on the six features | none |
| Random forest | `RandomForestRegressor`, `n_jobs=-1` | `n_estimators` in {100, 300} x `max_depth` in {4, 8, 12} x `min_samples_leaf` in {1, 10} = 12 combinations |
| Multilayer perceptron | `StandardScaler` + `MLPRegressor`, `early_stopping=True`, `max_iter=3000`, `n_iter_no_change=20` | `hidden_layer_sizes` in {(16), (32), (32, 16)} x `alpha` in {1e-4, 1e-3, 1e-2, 1e-1} = 12 combinations |

Protocol:

1. One model per target; income and expenses are never mixed.
2. Fit on months 1-24 only.
3. Forecast months 25-30 recursively from origin 24: each step feeds the previous prediction
   back as a lag.
4. Score against the real validation months with MAE, RMSE, and MAPE (computed only on
   non-zero actuals).
5. The hyperparameter combination with the lowest validation MAE is kept for each
   candidate-target pair.
6. The recommended model is the one with the lowest mean of the income and expenses MAE.

25 fits per target, 50 in total, 157.3 s on the machine described above.

## 3. Validation results

### Aggregate (months 25-30)

| Model | Target | MAE | RMSE | MAPE (%) | Best hyperparameters |
|---|---|---|---|---|---|
| baseline | income | 27.974 | 49.363 | 15.47 | none |
| baseline | expenses | 27.837 | 49.131 | 15.93 | none |
| linear_regression | income | 35.081 | 53.870 | 24.90 | none |
| linear_regression | expenses | 36.805 | 56.721 | 26.92 | none |
| random_forest | income | 17.203 | 28.567 | 11.07 | `n_estimators=300, max_depth=8, min_samples_leaf=1` |
| random_forest | expenses | 17.328 | 28.983 | 11.37 | `n_estimators=100, max_depth=8, min_samples_leaf=1` |
| mlp | income | 161.756 | 233.920 | 102.18 | `hidden_layer_sizes=(32), alpha=0.001` |
| mlp | expenses | 154.352 | 234.284 | 101.86 | `hidden_layer_sizes=(32), alpha=0.1` |

### Per horizon

| Model | Target | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|
| baseline | income | 24.45 | 25.56 | 30.12 | 32.31 | 29.26 | 26.14 |
| baseline | expenses | 24.24 | 25.08 | 30.69 | 32.59 | 28.75 | 25.66 |
| linear_regression | income | 39.04 | 38.12 | 24.49 | 21.34 | 33.92 | 53.57 |
| linear_regression | expenses | 39.63 | 40.57 | 25.59 | 21.35 | 36.91 | 56.78 |
| random_forest | income | 16.86 | 16.68 | 16.05 | 16.84 | 17.89 | 18.89 |
| random_forest | expenses | 15.87 | 16.73 | 16.99 | 17.45 | 18.31 | 18.61 |
| mlp | income | 70.23 | 119.67 | 124.19 | 172.95 | 233.32 | 250.18 |
| mlp | expenses | 66.49 | 92.60 | 96.95 | 151.91 | 232.18 | 285.97 |

### Mean validation MAE (income and expenses)

| Model | Mean MAE | Relative to baseline |
|---|---|---|
| baseline | 27.906 | - |
| linear_regression | 35.943 | +28.8% worse |
| random_forest | 17.266 | -38.1% better |
| mlp | 158.054 | +466.4% worse |

## 4. Selected model and reasons

**Selected: random forest**, with `n_estimators=300, max_depth=8, min_samples_leaf=1` for
income and `n_estimators=100, max_depth=8, min_samples_leaf=1` for expenses.

Reasons:

- Lowest mean validation MAE (17.266), 38.1% below the seasonal naive baseline (27.906).
- Both targets beat the baseline separately: income 17.203 versus 27.974, expenses 17.328
  versus 27.837.
- Error is stable across the horizon (15.87 to 18.89). It does not grow with the number of
  recursive steps, which is what matters for a six-month product.
- It needs no scaling and handles the monotone `trend` feature by clamping it at the
  boundary of the training range instead of extrapolating.
- It trains in seconds and the artifact is small enough to load in the app.

Why not the others:

- **Linear regression** is worse than the baseline (35.943). The `trend` feature is outside
  the training range during validation (25-30 versus 1-24), so the model extrapolates the
  slope linearly and the error jumps at +6 (53.57 and 56.78). It also has no way to capture
  the non-linear relation between lags and the ratio.
- **MLP** fails (158.054, MAPE above 100%) and its error grows with the horizon
  (70 -> 250). Plausible causes: the same extrapolation problem with a monotone `trend`
  feature, overfitting on a small dataset (9,750 usable training rows), and `early_stopping`
  leaving a solution that is unstable when fed its own predictions. It was kept in the study
  because the instructions require four candidates, but it is not usable for the product.
- **Seasonal naive baseline** is competitive (27.906) and is the reference any candidate must
  beat. Only the random forest does.

Selection used validation only. The 5,250 `test` and `holdout` rows were never read, so they
remain clean for the later evaluation phase.

## 5. Limitations and what you would do with more time

Limitations:

- Single validation origin. With 24 training months there is room for one origin (24) and one
  six-month window (25-30); the ranking could change with another window.
- The `trend` feature is an absolute month index, which lands outside the training range at
  prediction time. Trees tolerate it, linear models and the MLP do not. This is the main
  reason two candidates fail.
- The ratio target damps abrupt changes: the denominator averages three months, so a company
  that suddenly halves its income will be forecast above what actually happened.
- Negative predictions are clipped at zero, which hides the model's uncertainty in those
  cases.
- Metrics are in millions of COP and aggregate all companies equally; a single large company
  contributes the same as a small one to the MAE.
- No sector feature. The ERP does not confirm that it stores sector, so it was left out to
  avoid a feature Phase 5 could not provide.
- The MLP has no Dropout; `MLPRegressor` does not support it and `alpha` is only an L2
  penalty. This is a documented limitation, not a claim of regularization equivalent to
  Dropout.
- Training frame starts at month 4 per company because of the three lag columns, so the first
  three months of each company are not used.

With more time:

- Rolling-origin validation with several origins once more history is available, and a
  comparison against the same windows the final evaluation will use.
- Direct per-horizon models instead of pure recursion, so errors do not compound.
- Refine the random forest around `max_depth` 6-10 and add `HistGradientBoostingRegressor` as
  a fifth candidate, which usually beats a plain forest on tabular data of this size.
- Prediction intervals (quantiles or residual bootstrap) instead of a single point forecast,
  which the alert product needs to avoid false positives.
- Replace `trend` with a bounded or normalized time feature (for example months since the
  company's first record divided by the history length) so linear and neural models stop
  extrapolating outside the observed range.
- Revisit the scaling with a log-ratio target to reduce the influence of very large jumps.
- Per-sector models, only if the ERP confirms the sector field.