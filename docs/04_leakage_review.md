# Phase 4 — Leakage and Exportability Review of Phase 3

- **Reviewed:** branch `phase3/modeling` at commit `66771f7` (November 1, 2026): `ml/src/features.py`, `ml/src/train_models.py`, `ml/src/forecast.py`, `ml/artifacts/candidates/metrics.json`, `docs/03_model_selection.md`.
- **Reviewer:** Phase 4 (Sergio Steeven Moreno Forero, on behalf of Manuel Eduardo Alarcon Aza).
- **Date:** November 3, 2026, before the final artifact and before any test or holdout row was opened.
- **Method:** code reading, plus one reproduction: Jonathan's saved random forest was exported to the global artifact format and run through `ml/src/evaluate.py` in validation mode (history 1–24, forecast 25–30). The pure-Python predictor reproduced his validation results exactly (income MAE 17.203, expenses 17.328, baseline 27.974 and 27.837), with a maximum relative difference of 2e-15 against scikit-learn on 5 parity cases. That export was a test fixture only and is not committed.

## Summary

**No data leakage was found.** Training, selection and validation use only `train` and `validation` rows, every feature is built from past months, and the baseline is evaluated under the same procedure.

**The model is not yet exportable.** Five points must be resolved by Jonathan (and two by Samuel) before November 9, 2026, or the official run cannot start (the parity gate of the protocol would stop it).

**Update, November 3, 2026 (commit `9406af5` of `phase3/modeling`):** the artifact is exported and passes parity, and findings 1, 2, 4 and 6 are resolved (see the exportability table). Finding 3 is still open for Samuel: Jonathan's own parity checker compares in double precision and passes on its 50 cases, but the backend must still cast to float32, because the difference appears only in a few company-months of the full validation set.

## Leakage questions

| Question | Answer | Evidence (file and line) |
|---|---|---|
| Does any code read rows with `split` equal to `test` or `holdout`, or `company_profiles.csv`? | **No.** The manifest is filtered to `train` and `validation` before the series is merged, and the loaded data is checked again. `company_profiles.csv` is not referenced anywhere in `ml/src/`. | `train_models.py:37-39` (allowed and blocked splits), `:73-92` (filter before merge), `:99-103` (check that only allowed splits were loaded) |
| Is any scaler, average or statistic fitted on validation, test or the full series? | **No.** Linear regression and random forest use no scaler. The size normalization is computed per row from the 3 previous months of the same company. The MLP's `StandardScaler` sits inside a pipeline fitted only on training rows. | `features.py:86` (per-row denominator from lags), `train_models.py:166-181` (scaler inside pipeline), `:187` (fit on `split == "train"` only) |
| Is any feature built from future months? | **No.** Lags come from `shift(1..3)` within each company; the seasonal terms use the calendar month; `trend` is the month index, known in advance. During the 6-month forecast, each prediction is appended to the history and used as the next lag, so real validation values never enter as inputs. Validation histories contain only `train` rows up to month 24. | `features.py:83-85` (lags), `:94` (trend), `:134-136` (recursion feeds back predictions), `train_models.py:134-140` (history up to month 24) |
| Is the baseline evaluated with the same procedure as the other models? | **Yes.** Same histories (months 1–24), same scored months (25–30), same `score()` function. The seasonal naive forecast copies the real value 12 months earlier, which always belongs to the history. | `train_models.py:273-278`, `features.py:141-150` |
| Is the selection decision based only on validation numbers? | **Yes.** Every configuration is scored on months 25–30, the best per candidate is kept by validation MAE, and the recommended model is the lowest mean of the income and expenses validation MAE. | `train_models.py:285-303` (search), `:308-315` (selection) |

## Exportability questions

| Question | Answer | Evidence |
|---|---|---|
| Is the final model one of the three exportable types? | **Yes.** The selected model is a random forest, which the backend supports. The MLP and the linear regression were not selected. | `docs/03_model_selection.md`, section 4; `metrics.json` → `selection.recommended_model = "random_forest"` |
| Does `model_global.json` exist? | **Yes** (re-checked November 3, 2026, commit `9406af5`). `model_version` `global-20261103-84df89b5`, 1.48 MB, SHA-256 `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e`. Features are `t`, `month_sin`, `month_cos`, `lag1`, `lag2`, `lag3`, normalization `mean_last_n` with `n = 3`; both targets are random forests of 100 trees. | `ml/artifacts/model_global.json` on `phase3/modeling` |
| Does `parity_cases.json` pass (relative difference ≤ 1e-6)? | **Yes.** 50 cases, histories from months 1–24 of `train` companies; `evaluate.py` gives a maximum relative difference of 0.0. In validation mode it reproduces Phase 3 exactly: income MAE 17.223, expenses 17.368. | `ml/artifacts/parity_cases.json`; `python ml/src/evaluate.py` |
| Does the artifact use the key names of Appendix A of the protocol? | **No, and the reader was adapted** (allowed by Appendix A, before the official run). The export stores each target as `selected_model` plus `models[selected_model].params` (linear coefficients under `coefficients`), and each parity case as `history: {income, expenses}`. `evaluate.py` reads both layouts; the forecasting logic did not change. | `evaluate.py`, `Predictor.__init__` and `check_parity` |

## Findings to resolve before the official run

| # | Finding | Who | What to do |
|---|---|---|---|
| 1 | **Feature `trend` does not follow the contract.** Phase 3 uses the absolute month index since `2023-01` (`trend = month_index`, starting at 1). The contract feature `t` is the position in the company's own history, starting at 0. For the training data `t = trend − 1`. | Jonathan | Rename to `t` and compute it as `len(history)` (retrain with the same hyperparameters), or export subtracting 1 from every threshold that splits on `trend`. Both give identical forecasts; the reproduction used the second option. |
| 2 | **No `model_global.json` or `parity_cases.json`.** | Jonathan | Export both following Appendix A of `docs/04_evaluation_protocol.md`. Parity cases: at least 5 companies, histories from months 1–24 only (never test or holdout), with the scikit-learn forecasts before rounding. |
| 3 | **scikit-learn compares tree inputs in single precision (float32).** A pure-Python predictor that compares in double precision gives slightly different forecasts in a few rows (validation income MAE 17.205 instead of 17.203). | Samuel (backend) | Round every feature to float32 before walking the trees, as `evaluate.py` does (`float32()`), or parity can fail. |
| 4 | **Artifact size.** The selected forests (300 trees for income, 100 for expenses, depth 8) export to about 7.2 MB of JSON, above the ~5 MB budget of the Phase 5 contract. | Jonathan | Reduce the size before exporting the final artifact (for example fewer trees for income, chosen again **on validation only**, or a more compact JSON encoding), and record the change in `docs/03_model_selection.md`. |
| 5 | **`.gitignore` blocks the artifact files.** `ml/artifacts/*` ignores everything except `candidates/` and `metrics.json`, so `model_global.json`, `parity_cases.json` and `test_report.json` could not be committed. | Fixed in this branch | Exceptions added to `.gitignore` for the three files. |
| 6 | **Zero or negative scale.** `features.py:48-54` raises an error when the mean of the last 3 months is ≤ 0; the protocol's predictor returned 0 for that month. It does not occur in the dataset (minimum income 9.16, minimum expenses 9.93) but can occur in the app. | Agreed November 3, 2026 | Treated as insufficient history, like fewer than 6 months: the backend rejects the request and the app falls back to manual mode. `evaluate.py` now raises the same error. It cannot happen in the evaluation: every history value is positive, and a random forest leaf is a mean of positive training targets, so every forecast fed back is positive too. |

## What was not reviewed

- The final artifact itself, which does not exist yet. When Jonathan delivers it, the exportability questions are answered again here, before the official run, and the artifact's SHA-256 is recorded in the report.
- Any test or holdout row: none was opened for this review.
