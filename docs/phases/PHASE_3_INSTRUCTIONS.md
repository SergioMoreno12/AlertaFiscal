# PHASE 3 — Modeling

- **Owner:** Jonathan Alejandro Yacuma Rivera
- **Branch:** `phase3/modeling`
- **Deadlines:** candidates trained by November 8, 2026. Final model selected by November 9, 2026 (Manuel needs it on that day).
- **Does it need code?** Yes. You write the training and selection code yourself in `ml/src/`.

---

## 1. Why this phase exists
Turn the monthly series into forecasting models, compare them fairly, and choose one using validation data only. The model you choose is the one that goes into the app, and Manuel will measure it on data you never touched.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 1 Business and data | Sergio | Gives you metrics and the data dictionary | November 3, 2026 |
| 2 Data preparation | Samuel | Gives you the dataset and the split manifest | November 3, 2026 |
| **3 Modeling** | **You** | Train, compare, select | **November 8-9, 2026** |
| 4 Evaluation | Manuel | Tests your selected model once | November 9-10, 2026 |
| 5 Integration | Samuel | Receives your final model | November 11, 2026 |

You cannot start training until Samuel delivers the dataset (November 3, 2026). Before that date you can prepare the feature code using a few fake rows, and read this document twice.

## 3. Glossary
- **Lag:** the value of the same series some months earlier. `lag_1` is last month, `lag_2` two months ago, `lag_3` three months ago.
- **Trend:** a number that grows with time (here the month index), so the model can capture growth.
- **Seasonality (sine and cosine):** the month of the year converted into two numbers that form a circle, so December and January are close to each other. Formula: sine and cosine of `2 × π × month_of_year / 12`.
- **Recursive multi-step forecast:** predict next month, treat that prediction as if it were real, use it to predict the following month, and repeat until 6 months are covered. Errors can pile up along the way. This is exactly how the app will forecast.
- **Baseline:** simple reference forecast. Every serious model must beat it.
- **Training, validation, test:** training teaches the model; validation is used to compare and choose; test is the final exam, used once and only by Manuel.
- **Data leakage:** when information from validation, test or the future reaches training. It makes results look better than reality.
- **Hyperparameters:** settings you choose before training (depth of the forest, size of the network).
- **Overfitting:** the model memorizes training data and fails on new data.
- **MAE, RMSE, MAPE:** see Phase 1 document. MAE and RMSE are your main metrics.

## 4. What you receive (data contract, frozen November 1, 2026)

**`ml/data/processed/monthly_series.csv`: 6 columns, 36 rows per company.**

| Column | Type | Unit | Rule |
|---|---|---|---|
| `company_id` | text | none | Unique code such as `C0001` |
| `sector` | text | none | Lowercase English sector name |
| `month` | text | `YYYY-MM` | 36 consecutive months |
| `income` | number | millions of COP | Zero or positive |
| `expenses` | number | millions of COP | Zero or positive |
| `origin` | text | none | `derived` or `simulated` |

**`ml/data/processed/split_manifest.csv`: 4 columns.**

| Column | Rule |
|---|---|
| `company_id`, `month` | Key to join with the series |
| `month_index` | 1 to 36 |
| `split` | `train` (months 1-24), `validation` (25-30), `test` (31-36), or `holdout` (all 36 months of the ~15% reserved companies) |

**What you may use:** rows with `split` equal to `train` or `validation`.
**What you must never open:** rows with `split` equal to `test` or `holdout`.

## 5. What you must do, step by step

**Step 1. Load and check.** Join the series with the manifest. Keep only `train` and `validation`. Check: no nulls, no negatives, 24 train months and 6 validation months per company. If something is wrong, tell Samuel, do not fix it silently.

**Step 2. Build the features (file `ml/src/features.py`).** For each company, month and target (`income` and `expenses` separately), using only past months:
- `lag_1`, `lag_2`, `lag_3` of the target,
- `trend`: the month index,
- `sin_month`, `cos_month`: seasonal encoding from the calendar month of the `month` column.

Decision you must make and document: companies have very different sizes (millions vs thousands of millions). Raw lags will confuse linear and neural models. Common options: (a) divide the lags by the mean of the last 3 lags and predict a ratio, (b) scale the target. Pick one, justify it in `docs/03_model_selection.md`, and apply it identically to all models.

Do not use `sector` as a feature unless Samuel confirms the ERP stores it for every company. The app only has each company's own history.

**Step 3. Define the forecasting procedure.** For each company, validation works like this: take history up to month 24, forecast months 25 to 30 recursively, compare with the real values. The same procedure is used for every model.

**Step 4. Train four candidates**, each for `income` and for `expenses`:
1. **Baseline:** same month of the previous year (seasonal naive). With only 24 training months this works from month 13 on. Document your choice if you use last-value naive instead.
2. **`LinearRegression`.**
3. **`RandomForestRegressor`.** Suggested search: `n_estimators` between 100 and 300, `max_depth` between 4 and 12, `min_samples_leaf` between 1 and 10.
4. **`MLPRegressor`** inside a pipeline with `StandardScaler`. The scaler learns only from training rows. Suggested search: `hidden_layer_sizes` among `(16,)`, `(32,)`, `(32, 16)`; `alpha` among 0.0001, 0.001, 0.01, 0.1; `early_stopping=True`; fixed `random_state`. Note: scikit-learn's early stopping takes a random slice of the training rows (not the latest months). Mention it as a limitation.

**Step 5. Tune and compare.** Keep the search small (a few dozen configurations at most). Record every configuration you try and its validation MAE. Use a fixed `random_state` everywhere so results are reproducible.

**Step 6. Evaluate on validation.** Months 25-30, recursive forecasting. Report MAE, RMSE and MAPE per model and per target, and also MAE per forecast month (1 to 6) to show how error grows.

**Step 7. Select the final model using validation only.** Choose by MAE (state which target or the average of both). If two models are within noise, prefer the simpler one and say so. If no model beats the baseline, say it honestly in the report: do not hide it.

**Step 8. Save artifacts** in `ml/artifacts/candidates/`: one `.joblib` file per candidate and per target, and `metrics.json` with all validation numbers. Do not commit very large files: if the forest is heavy, reduce `n_estimators` or tell Samuel.

**Step 9. Optional refit.** You may refit the chosen model on months 1-30 with the same hyperparameters, and document it. Holdout companies stay excluded.

**Step 10. Handoff to Samuel (Phase 5).** The model must be usable from the app through one function. Agree its exact name with Samuel; the expected shape is:
- Input: income history, expense history (both oldest to newest, at least 6 months), the last known month (`YYYY-MM`), and the horizon (default 6).
- Output: forecast lists for `income` and `expenses`, one value per future month.
- Behavior: if there are fewer than 6 months of history, it raises a clear error (the app will then offer manual mode).
- `features.py` must not import training code, so the backend can use it alone.

## 6. What you must NOT do
- Do not open, plot or describe rows with `split` equal to `test` or `holdout`, not even "just to check". After seeing them, the selection is no longer honest.
- Do not choose the model using test results. Selection is validation only.
- Do not use features the ERP will not have.
- Do not compute any statistic (mean, scaling) over the full series or over validation rows when fitting.
- Do not use the `control_ruido_*` noise columns of plan v1.
- Do not say the MLP has Dropout. `MLPRegressor` does not. `alpha` (L2 penalty) is not equivalent. The team will ask the professor whether this is acceptable.
- Do not change the data contract. If you need a change, tell Samuel before November 1, 2026.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish.

## 7. Deliverables and templates

- `ml/src/features.py`, `ml/src/train_models.py`
- `ml/artifacts/candidates/` with the saved models and `metrics.json`
- `docs/03_model_selection.md` with these sections:
  1. Features and the scaling decision
  2. Candidates and search space
  3. Validation results (table below)
  4. Selected model and reasons
  5. Limitations and what you would do with more time

Results table template:

| Model | Target | MAE | RMSE | MAPE | Best hyperparameters |
|---|---|---|---|---|---|

Per-horizon table template:

| Model | Month +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|

## 8. Work plan

| Date | Task |
|---|---|
| Until November 3, 2026 | Read this file, write `features.py` with fake rows, wait for the dataset |
| November 4-5, 2026 | Load data, baseline and linear regression |
| November 6-7, 2026 | Random forest and MLP, small searches |
| November 8, 2026 | All candidates saved, `metrics.json` ready |
| November 9, 2026 | Selection written, tell Manuel and Samuel which model won |

## 9. Git workflow
```
git checkout phase3/modeling
git pull origin phase3/modeling
git add ml/src/features.py
git commit -m "feat: add feature builder"
git push origin phase3/modeling
```
One commit per logical step (examples: `feat: add baseline and linear regression`, `feat: add random forest and mlp`, `docs: add model selection report`). Pull Request into `develop` once the selection document is ready.

## 10. Definition of done
- [ ] Four candidates trained, for income and for expenses, and saved.
- [ ] Same validation months and same metrics for all of them.
- [ ] Every configuration tried is recorded.
- [ ] `metrics.json` and `docs/03_model_selection.md` exist and agree.
- [ ] The result against the baseline is stated honestly.
- [ ] The handoff function works with fewer than 6 months (clear error) and with 6 or more (valid forecast).
- [ ] Nothing in the code reads `test` or `holdout` rows.

## 11. What you must be able to explain at the final presentation
- How each of the four models works, in simple words.
- What lags, trend and seasonality represent.
- Why forecasting is recursive and why error accumulates.
- Why selection is done on validation and not on test.
- Why the MLP has no Dropout and what `alpha` does instead.
- Why the chosen model won and where it fails.
- Likely professor questions: "Why Random Forest and not only a neural network?", "How do you know it is not overfitting?", "What if the company has only 6 months of data?".

## 12. If you get stuck
Data problems: ask Samuel. Metrics or business criterion: ask Sergio. Evaluation rules: ask Manuel. Never look at test rows to "debug".