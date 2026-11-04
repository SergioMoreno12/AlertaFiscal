# Phase 4 — Evaluation Report

- **Run:** official, once, on November 4, 2026 at 02:06:59 UTC (`python ml/src/evaluate.py --official`), tagged `eval-final-run` (commit `c30cf64`).
- **Protocol:** `docs/04_evaluation_protocol.md`, tagged `eval-protocol-v1` before any test row was read.
- **Results file:** `ml/artifacts/test_report.json`. Level-shift diagnostic: `ml/artifacts/level_shift_analysis.json` (`ml/src/level_shift_analysis.py`).
- **Evaluator:** Sergio Steeven Moreno Forero, on behalf of Manuel Eduardo Alarcon Aza (Phase 4 owner).

## 1. Summary, verdict and artifact SHA-256

**Verdict: accepted.** All 12 checks of the protocol pass (section 2.3).

| Item | Value |
|---|---|
| Evaluated artifact | `ml/artifacts/model_global.json` |
| `model_version` | `global-20261103-84df89b5` |
| SHA-256 | `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e` |
| Model | random forest for income (100 trees, depth 8) and for expenses (100 trees, depth 6) |
| Predictor | pure Python (`ml/src/evaluate.py`), the same algorithm as the backend, with float32 inputs to the trees |
| Parity before the run | 50 cases, maximum relative difference 0.0 (tolerance 1e-6) |
| `parity_cases.json` SHA-256 | `ed68bcff1cd0fa77e529ed5756610e09a1dbadc05415122f0deeb59088134167` |
| `monthly_series.csv` SHA-256 | `a5b0265ee4727e1b67bf66e3d04a2ceb3b03d623a4013b7904cae25aa859f159` (same as `docs/02_run_log.md`) |
| `split_manifest.csv` SHA-256 | `d1c6195c03f513a663c23a80979ff7f65b88b27b6dfae053be9415ab2a26a4e4` |

The backend must deploy the file with exactly this SHA-256. Any other file is not the evaluated model.

**Incident before the run (not a result).** On Windows, Git converted the last line ending of `model_global.json` on checkout (`core.autocrlf`), so the local file had a different SHA-256 from the committed one. `.gitattributes` now marks the artifacts as `-text` (commit `c6746b0`), and the file was checked out again before the run. The bytes evaluated are the committed bytes: the hash above matches `docs/04_leakage_review.md` and Phase 3.

## 2. Results: chosen model vs baseline

Units are millions of COP per month. Normalized MAE is each company's MAE divided by its mean monthly income over months 1–30, in %. Bias is the mean of forecast minus real (negative means the forecast is too low). History: months 1–30. Forecast: months 31–36 (July to December 2025), recursively, 6 steps.

### 2.1 Temporal test (425 regular companies, 2,550 points per target)

| Scenario | Model | Target | MAE | RMSE | Median normalized MAE (%) | P90 normalized MAE (%) | MAPE (%) | Bias |
|---|---|---|---|---|---|---|---|---|
| Temporal | Random forest | Income | 21.462 | 40.559 | 10.22 | 20.72 | 9.51 | −3.561 |
| Temporal | Random forest | Expenses | 22.619 | 42.431 | 10.69 | 20.70 | 10.20 | −4.104 |
| Temporal | Seasonal naive | Income | 38.170 | 69.677 | 16.70 | 37.25 | 15.60 | −26.303 |
| Temporal | Seasonal naive | Expenses | 37.352 | 67.837 | 16.65 | 36.47 | 15.92 | −25.443 |

### 2.2 Holdout test (75 companies never used in Phases 2–3, 450 points per target)

| Scenario | Model | Target | MAE | RMSE | Median normalized MAE (%) | P90 normalized MAE (%) | MAPE (%) | Bias |
|---|---|---|---|---|---|---|---|---|
| Holdout | Random forest | Income | 23.709 | 39.248 | 12.34 | 21.25 | 10.23 | 0.072 |
| Holdout | Random forest | Expenses | 23.838 | 42.798 | 11.75 | 19.85 | 10.33 | −3.138 |
| Holdout | Seasonal naive | Income | 39.675 | 74.762 | 15.09 | 41.08 | 14.24 | −32.434 |
| Holdout | Seasonal naive | Expenses | 40.611 | 78.351 | 15.34 | 41.43 | 15.18 | −32.452 |

No month had a real value of zero, so MAPE excludes no point.

### 2.3 Acceptance checks

| Check | Rule | Temporal income | Temporal expenses | Holdout income | Holdout expenses |
|---|---|---|---|---|---|
| C1 | MAE ≤ 0.90 × baseline MAE | 0.562 PASS | 0.606 PASS | 0.598 PASS | 0.587 PASS |
| C2 | Median normalized MAE ≤ 15 % | 10.22 PASS | 10.69 PASS | 12.34 PASS | 11.75 PASS |
| C3 | P90 normalized MAE ≤ 30 % | 20.72 PASS | 20.70 PASS | 21.25 PASS | 19.85 PASS |

The model reduces the baseline MAE by 39–44 %. Compared with validation (income MAE 17.223, median normalized MAE 8.93 %), the test error is higher: income MAE grows by about 25 % on the temporal test and 38 % on holdout. This is expected: the history is longer but the scored months are July to December, which include the December peak, and holdout companies were never seen in training.

## 3. Error by horizon (MAE)

| Scenario | Model | Target | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|---|
| Temporal | Random forest | Income | 17.18 | 21.81 | 17.14 | 17.83 | 25.88 | 28.93 |
| Temporal | Random forest | Expenses | 18.33 | 23.57 | 17.53 | 18.56 | 26.86 | 30.86 |
| Temporal | Seasonal naive | Income | 36.74 | 37.90 | 33.57 | 36.09 | 41.45 | 43.27 |
| Temporal | Seasonal naive | Expenses | 35.22 | 37.48 | 33.21 | 34.46 | 40.56 | 43.19 |
| Holdout | Random forest | Income | 21.23 | 19.19 | 18.29 | 20.13 | 31.09 | 32.33 |
| Holdout | Random forest | Expenses | 20.76 | 22.03 | 19.81 | 20.43 | 27.54 | 32.46 |
| Holdout | Seasonal naive | Income | 33.72 | 39.33 | 28.85 | 38.63 | 47.93 | 49.59 |
| Holdout | Seasonal naive | Expenses | 34.64 | 41.09 | 29.14 | 39.88 | 47.42 | 51.50 |

Error grows with the horizon, but not evenly: +5 and +6 (November and December 2025) are about 45–70 % worse than +1. Part of it is recursion (each step feeds on earlier forecasts), and part is the calendar: November and December have the strongest seasonal peaks, where amounts and therefore absolute errors are largest. The model beats the baseline at every horizon in both scenarios.

## 4. Error by sector

| Scenario | Target | Sector | Companies | MAE | Median norm. MAE (%) | Bias | Baseline MAE | Baseline median norm. MAE (%) |
|---|---|---|---|---|---|---|---|---|
| Temporal | Income | Agriculture | 17 | 21.773 | 13.50 | 3.015 | 22.564 | 13.41 |
| Temporal | Income | Construction | 31 | 18.627 | 12.52 | −7.676 | 33.506 | 21.89 |
| Temporal | Income | Manufacturing | 86 | 16.395 | 9.36 | 0.894 | 30.953 | 12.92 |
| Temporal | Income | Mining | 7 | 46.596 | 12.87 | −23.100 | 85.169 | 24.04 |
| Temporal | Income | Retail | 159 | 26.949 | 10.94 | −6.982 | 49.720 | 19.98 |
| Temporal | Income | Services | 125 | 17.220 | 9.67 | −1.054 | 29.090 | 15.22 |
| Temporal | Expenses | Agriculture | 17 | 20.348 | 12.56 | 1.361 | 22.629 | 13.88 |
| Temporal | Expenses | Construction | 31 | 18.284 | 12.02 | −7.905 | 29.603 | 19.19 |
| Temporal | Expenses | Manufacturing | 86 | 17.325 | 9.35 | −0.511 | 30.655 | 12.68 |
| Temporal | Expenses | Mining | 7 | 35.446 | 14.83 | −16.033 | 70.866 | 23.50 |
| Temporal | Expenses | Retail | 159 | 29.510 | 11.87 | −6.679 | 49.511 | 19.61 |
| Temporal | Expenses | Services | 125 | 18.162 | 9.68 | −2.432 | 28.541 | 15.89 |
| Holdout | Income | Agriculture | 4 | 21.257 | 14.31 | −0.436 | 16.883 | 8.42 |
| Holdout | Income | Construction | 6 | 24.323 | 12.92 | −7.566 | 41.729 | 21.09 |
| Holdout | Income | Manufacturing | 15 | 18.796 | 14.08 | −4.882 | 26.553 | 8.57 |
| Holdout | Income | Mining | 2 | 26.820 | 12.57 | −12.312 | 73.748 | 24.95 |
| Holdout | Income | Retail | 27 | 29.101 | 12.41 | −1.103 | 52.978 | 19.86 |
| Holdout | Income | Services | 21 | 20.281 | 10.96 | 8.579 | 32.454 | 13.11 |
| Holdout | Expenses | Agriculture | 4 | 19.739 | 12.54 | 3.862 | 17.565 | 11.06 |
| Holdout | Expenses | Construction | 6 | 23.650 | 11.80 | −5.237 | 42.582 | 21.67 |
| Holdout | Expenses | Manufacturing | 15 | 19.374 | 12.98 | −5.573 | 27.443 | 9.87 |
| Holdout | Expenses | Mining | 2 | 25.319 | 11.32 | −0.923 | 78.947 | 24.89 |
| Holdout | Expenses | Retail | 27 | 32.133 | 14.61 | −7.406 | 55.219 | 19.85 |
| Holdout | Expenses | Services | 21 | 17.054 | 8.22 | 3.145 | 31.412 | 13.61 |

- Mining has the largest MAE in pesos (large companies, strong seasonality) and a clear negative bias, but its normalized error is close to the others. Only 7 and 2 companies, so it is unstable.
- Retail is the largest sector and has the largest share of the biggest errors (section 6).
- **Agriculture and manufacturing in holdout are the exception:** there the seasonal naive baseline has a lower median normalized MAE than the model (8.42 % vs 14.31 % for agriculture income, 8.57 % vs 14.08 % for manufacturing income), although the model still has a lower MAE in manufacturing. These are small groups (4 and 15 companies) with stable seasonality, where "same month last year" is already a good forecast. The acceptance checks are per target and scenario, not per sector, so this does not change the verdict, but it is reported.

## 5. Error by company size tercile

Companies ranked by mean monthly income over months 1–30 inside each scenario.

| Scenario | Target | Tercile | Companies | MAE | Median norm. MAE (%) | Bias | Baseline MAE | Baseline median norm. MAE (%) |
|---|---|---|---|---|---|---|---|---|
| Temporal | Income | Small | 142 | 4.460 | 9.46 | 0.956 | 6.964 | 14.48 |
| Temporal | Income | Medium | 142 | 15.291 | 10.43 | −3.141 | 27.108 | 17.55 |
| Temporal | Income | Large | 141 | 44.798 | 10.75 | −8.532 | 80.737 | 18.38 |
| Temporal | Expenses | Small | 142 | 4.695 | 10.09 | 0.873 | 6.860 | 13.68 |
| Temporal | Expenses | Medium | 142 | 15.236 | 10.68 | −3.244 | 26.273 | 16.68 |
| Temporal | Expenses | Large | 141 | 48.106 | 11.52 | −9.981 | 79.218 | 18.59 |
| Holdout | Income | Small | 25 | 6.412 | 11.50 | 1.260 | 8.565 | 14.05 |
| Holdout | Income | Medium | 25 | 18.728 | 14.30 | −0.675 | 27.120 | 13.83 |
| Holdout | Income | Large | 25 | 45.987 | 12.34 | −0.369 | 83.340 | 16.96 |
| Holdout | Expenses | Small | 25 | 6.106 | 11.29 | 1.232 | 8.924 | 13.66 |
| Holdout | Expenses | Medium | 25 | 17.183 | 12.98 | −0.721 | 27.194 | 15.34 |
| Holdout | Expenses | Large | 25 | 48.225 | 11.38 | −9.925 | 85.717 | 19.10 |

MAE in pesos grows about 10 times from small to large companies, but the normalized error stays between 9.5 % and 14.3 %. The size normalization works: a small company is not forecast worse in relative terms. Large companies are under-forecast (bias −8.5 to −10.0), because they include the fastest-growing ones.

## 6. Largest errors and what they have in common

### 6.1 The 10 largest absolute errors

| Scenario | Company | Sector | Month | Target | Forecast | Real | Absolute error |
|---|---|---|---|---|---|---|---|
| Temporal | C0295 | Retail | 2025-11 | Income | 953.36 | 1,444.58 | 491.22 |
| Temporal | C0295 | Retail | 2025-11 | Expenses | 876.97 | 1,366.66 | 489.69 |
| Temporal | C0310 | Mining | 2025-08 | Income | 1,128.55 | 1,502.04 | 373.49 |
| Temporal | C0396 | Retail | 2025-12 | Expenses | 1,063.07 | 1,412.15 | 349.08 |
| Temporal | C0310 | Mining | 2025-12 | Expenses | 957.41 | 1,302.42 | 345.01 |
| Temporal | C0295 | Retail | 2025-12 | Expenses | 892.85 | 1,237.34 | 344.49 |
| Temporal | C0310 | Mining | 2025-12 | Income | 1,214.31 | 1,552.16 | 337.85 |
| Temporal | C0295 | Retail | 2025-12 | Income | 948.49 | 1,281.04 | 332.55 |
| Temporal | C0396 | Retail | 2025-12 | Income | 1,094.86 | 1,382.44 | 287.58 |
| Temporal | C0500 | Retail | 2025-12 | Expenses | 668.46 | 952.99 | 284.53 |
| Holdout | C0238 | Retail | 2025-12 | Expenses | 1,247.79 | 1,613.16 | 365.37 |
| Holdout | C0238 | Retail | 2025-11 | Income | 1,296.00 | 1,608.40 | 312.40 |
| Holdout | C0238 | Retail | 2025-11 | Expenses | 1,232.48 | 1,525.52 | 293.04 |
| Holdout | C0238 | Retail | 2025-12 | Income | 1,289.46 | 1,557.56 | 268.10 |
| Holdout | C0214 | Retail | 2025-10 | Expenses | 495.68 | 698.59 | 202.91 |
| Holdout | C0238 | Retail | 2025-08 | Expenses | 1,133.89 | 1,335.94 | 202.05 |
| Holdout | C0214 | Retail | 2025-10 | Income | 546.97 | 738.04 | 191.07 |
| Holdout | C0238 | Retail | 2025-07 | Expenses | 1,102.70 | 1,263.19 | 160.49 |
| Holdout | C0238 | Retail | 2025-09 | Expenses | 961.30 | 1,117.91 | 156.61 |
| Holdout | C0337 | Construction | 2025-12 | Income | 491.19 | 646.36 | 155.17 |

**Common pattern:** every one is an under-forecast, almost all in October to December, and in large retail or mining companies. After the run, `company_profiles.csv` was read only to label them (section 6.2): 6 of the 7 companies have **no** level shift; they have high annual growth (C0295, C0310 and C0238 are at the generator's 50 % cap) and strong seasonality. The model learns the average behavior of 425 companies, so it follows fast growth with a lag. Only C0396 has a level shift, at month 15, long before the forecast.

### 6.2 Companies with a level shift versus the rest (post-run diagnostic)

Allowed by protocol section 4.2: `shock_month` was read only after the tag `eval-final-run` existed, only to label companies. The diagnostic recomputes the same deterministic forecasts and stops unless the overall MAE matches `test_report.json`; it matched. Phase 2 put a permanent level shift in 72 companies: 65 inside the history (months 1–30) and 7 inside the forecast window (months 31–36).

| Scenario | Target | Group | Companies | Model MAE | Model median norm. MAE (%) | Model bias | Baseline MAE | Baseline median norm. MAE (%) |
|---|---|---|---|---|---|---|---|---|
| Temporal | Income | No shift | 367 | 20.933 | 10.31 | −2.915 | 37.662 | 16.35 |
| Temporal | Income | Shift in history | 53 | 18.314 | 9.67 | −3.983 | 32.926 | 17.16 |
| Temporal | Income | Shift in forecast window | 5 | 93.618 | 21.72 | −46.519 | 131.050 | 36.14 |
| Temporal | Expenses | No shift | 367 | 21.872 | 10.69 | −3.355 | 36.695 | 16.59 |
| Temporal | Expenses | Shift in history | 53 | 20.859 | 10.43 | −4.996 | 33.415 | 15.96 |
| Temporal | Expenses | Shift in forecast window | 5 | 96.088 | 22.06 | −49.642 | 127.313 | 36.56 |
| Holdout | Income | No shift | 61 | 25.607 | 12.41 | −0.677 | 43.960 | 15.90 |
| Holdout | Income | Shift in history | 12 | 16.628 | 11.23 | 5.146 | 22.829 | 13.10 |
| Holdout | Income | Shift in forecast window | 2 | 8.318 | 16.14 | −7.535 | 10.080 | 22.31 |
| Holdout | Expenses | No shift | 61 | 26.011 | 11.75 | −4.294 | 44.771 | 16.89 |
| Holdout | Expenses | Shift in history | 12 | 15.420 | 11.79 | 3.345 | 24.516 | 13.91 |
| Holdout | Expenses | Shift in forecast window | 2 | 8.070 | 16.37 | −6.787 | 10.321 | 22.63 |

- **A shift already in the history costs nothing:** those companies have the same or lower normalized error than the rest. The normalization by the mean of the last 3 months re-anchors the forecast to the new level.
- **A shift inside the forecast window cannot be predicted:** the 7 companies have about twice the normalized error (16–22 %) and, in the temporal test, a strong negative bias. No model can see a shift that has not happened yet; the baseline is worse still (22–37 %).
- These 7 companies are 1.4 % of the evaluated companies, so they barely move the overall medians.

**Losses.** About 30 % of company-months show a loss (expenses above income). The model forecasts income and expenses separately, and both errors are of similar size (around 10–12 % normalized), so a forecast loss month is only reliable when the forecast gap is clearly larger than that error. This is why Phase 1's alert rule needs a margin and not a bare "expenses > income" test.

## 7. Limitations and consequences for a real small business

- **The data is semi-synthetic.** Company sizes come from real Supersociedades records and seasonality from real DIAN collection, but the monthly series are generated (Phase 2). These numbers say how well the model learns this generator, not how it will do with a real company's books. The app labels the model as a demonstration (`is_demo: true`).
- **Typical error is about 10–12 % of a month's income.** For a company with 100 million COP of monthly income, a forecast is usually within about 10–12 million, and 1 in 10 companies has an average error above about 21 million. It is good enough to plan a tax reserve with a safety margin, not to state an exact amount.
- **Fast-growing companies are under-forecast,** especially in November and December. A company that plans its December reserve with this model should add a margin when it knows it is growing fast.
- **Sudden changes are not predicted.** If a company changes its level (new contract, lost client), the forecast is wrong until three months of the new level enter the history. Monitoring (Phase 6) must catch this.
- **Six months is the maximum horizon,** and the last two months are the least reliable.
- **For some stable, seasonal companies** (agriculture and manufacturing in holdout), the simple "same month last year" forecast is as good or better in normalized terms. Showing both in the app would help a user judge it.
- **Small groups:** mining (7 + 2 companies) and the holdout sectors with 2–6 companies give unstable numbers.

## 8. Handover

- **To Phase 5 (Manuel):** deploy `model_global.json` with SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e` and test it in the backend against `test_report.json`.
- **To Phase 6 (Sergio):** reference errors for monitoring (median normalized MAE of the model):

| Scenario | Income | Expenses |
|---|---|---|
| Temporal test | 10.22 % (MAE 21.462) | 10.69 % (MAE 22.619) |
| Holdout test | 12.34 % (MAE 23.709) | 11.75 % (MAE 23.838) |

The holdout values are the better reference for a new company in the app, because the app's companies were not used to train the model.
