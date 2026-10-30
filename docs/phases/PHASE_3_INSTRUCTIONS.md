# PHASE 3 — Modeling

- **Owner:** Jonathan Alejandro Yacuma Rivera
- **Branch:** `phase3/modeling`
- **Deadline:** candidates trained by November 8, 2026; final model chosen by November 10, 2026
- **Does it need code?** Yes. You write the training and selection code yourself in `ml/src/`.

## 1. Why this phase exists
Turn the monthly series into forecasting models, compare them fairly, and choose one using validation data only. The choice you make is the one that goes into the app.

## 2. What you receive
From Phase 2 (Samuel):
- `ml/data/processed/monthly_series.csv` (columns: `company_id`, `sector`, `month`, `income`, `expenses`, `origin`).
- `ml/data/processed/split_manifest.csv` (which rows are train, validation, test, and which companies are held out).
From Phase 1 (Sergio): the data dictionary and the success metrics.

## 3. What you must do
1. **Load the data and the manifest.** Use only the rows marked as train and validation. The test rows and held-out companies must stay untouched.
2. **Build features per company and month** using only past information:
   - 3 lags of the target (month-1, month-2, month-3),
   - a linear trend index,
   - month of year as sine and cosine.
   Build one forecaster for `income` and one for `expenses`.
3. **Train four candidates:**
   1. Baseline: seasonal naive (same month of the previous year) or last-value naive.
   2. `LinearRegression`.
   3. `RandomForestRegressor`.
   4. `MLPRegressor` inside a pipeline with `StandardScaler`. Fit the scaler on training rows only. Use `early_stopping` and tune `alpha` (L2) and the hidden layer sizes.
4. **Tune with a small search**, using validation only (or time-ordered folds inside the training months). Keep the search small and record every configuration tried.
5. **Evaluate on the validation months (25-30) with recursive multi-step forecasting**, because that is how the app will forecast: predict one month, feed it back as a lag, repeat. Report MAE, RMSE and MAPE per model and per target.
6. **Select the final model using validation results only.** Write the decision in `docs/03_model_selection.md`: the table of results, the model chosen and the reasons.
7. **Save the artifacts** in `ml/artifacts/candidates/`: one file per candidate (joblib) plus `metrics.json` with validation results.
8. Optional: refit the chosen model on months 1-30 with the same hyperparameters, and document it. The held-out companies must still be excluded.
9. **Hand the final model to Samuel** (Phase 5) with a short note: expected input, expected output, and the minimum history it needs.

## 4. What you must NOT do
- Do not look at the test months (31-36) or the held-out companies, not even "just to check". If you see them, you cannot unsee them and the selection is no longer honest.
- Do not choose the model using test results. Selection is validation only.
- Do not use features that the ERP will not have. The app only has the company's own history of income and expenses.
- Do not use any column that leaks the future (for example, statistics computed over the full series).
- Do not fit the scaler or any statistic on validation or test data.
- Do not use noise columns (`control_ruido_*`) from plan v1.
- Do not claim the MLP has Dropout. scikit-learn's `MLPRegressor` has none, and `alpha` (L2) is not equivalent. The team will ask the professor whether this is acceptable.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish.

## 5. Deliverables
- `ml/src/train_models.py` (training and tuning).
- `ml/src/features.py` (feature building, shared with the app).
- `ml/artifacts/candidates/` with all candidate models and `metrics.json`.
- `docs/03_model_selection.md`.
- Receivers: Manuel (Phase 4) for evaluation and Samuel (Phase 5) for integration.

## 6. How to work in the branch
1. `git checkout phase3/modeling` and `git pull origin phase3/modeling`.
2. Commit in small steps, in English (examples: `feat: add feature builder`, `feat: train linear regression and random forest`, `docs: add model selection report`).
3. Push to `origin phase3/modeling`.
4. Open a Pull Request into `develop` once candidates and the selection document are ready.

## 7. Definition of done
- [ ] The four candidates are trained and saved.
- [ ] The same validation months and the same metrics were used for all of them.
- [ ] Results are in `metrics.json` and in the selection document.
- [ ] The chosen model beats the baseline on validation. If it does not, the report says so.
- [ ] `features.py` can be imported by the backend with no dependency on training code.
- [ ] Nothing in the code reads test rows or held-out companies.

## 8. What you must be able to explain at the final presentation
- How each of the four models works, in simple words.
- Why recursive forecasting is used and what error accumulation is.
- Why selection is done on validation and not on test (data leakage).
- What the lags, trend and seasonal features represent.
- Why the MLP has no Dropout and what `alpha` does instead.
- Why the chosen model won, and what its weak points are.