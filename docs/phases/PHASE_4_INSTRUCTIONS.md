# PHASE 4 — Evaluation

- **Owner:** Manuel Eduardo Alarcon Aza
- **Branch:** `phase4/evaluation`
- **Deadlines:** evaluation protocol committed by November 5, 2026. Final test evaluation on November 9-10, 2026. Reference error levels delivered to Sergio by November 11, 2026.
- **Does it need code?** Yes. You write the evaluation script yourself.

---

## 1. Why this phase exists
You are the independent check on Phase 3. Jonathan chooses a model using validation data. You measure how good that model really is on data nobody used to choose it, and you report the result honestly, even if it is bad. The value of your phase depends on one rule: the test set is used once. There is a second rule now: you evaluate **the same file the app will run**.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 1 Business and data | Sergio | Gives you metrics and the approved success criterion | November 3, 2026 |
| 2 Data preparation | Samuel | Dataset, delivered through `develop` | Merged first |
| 3 Modeling | Jonathan | Gives you `model_global.json` and `parity_cases.json` | November 9, 2026 |
| **4 Evaluation** | **You** | Protocol first, then one test run | **November 5-10, 2026** |
| 5 Integration | Samuel | Deploys the exact file you evaluated | November 10, 2026 onward |
| 6 Monitoring | Sergio | Receives your reference error levels | November 11, 2026 |

Write the protocol before Jonathan finishes. That is what makes your evaluation trustworthy.

## 3. Glossary
- **Test set:** months 31 to 36 of the 425 regular companies. The final exam.
- **Holdout companies:** 75 companies (15%) whose rows were never used in training or tuning. They test whether the model works on a company it has never seen.
- **Artifact:** the JSON file `model_global.json` that contains the model. The backend reads it and computes forecasts in pure Python (no scikit-learn).
- **Artifact hash (SHA-256):** a fingerprint of the file. If one character changes, the hash changes. It proves the evaluated file is the deployed file.
- **Parity:** the pure-Python forecast equals the scikit-learn forecast.
- **Recursive multi-step forecast:** predict one month, feed it back as history, repeat for 6 months. The app forecasts this way, so you evaluate this way.
- **Forecast horizon:** how many months ahead (1 to 6).
- **MAE:** average absolute error in millions of COP.
- **RMSE:** square root of the average squared error. Penalizes large mistakes.
- **Normalized MAE:** MAE of a company divided by its average monthly income, as a percentage. It makes a small and a large company comparable. Report its median and 90th percentile across companies.
- **MAPE:** average percentage error. Misleading when real values are near zero.
- **Bias:** average of (forecast − real). Positive means the model forecasts too high.
- **Baseline:** simple reference model the chosen model must beat under the same procedure.
- **Data leakage:** information from test, holdout, the future or hidden parameters reaching training or selection.

## 4. What you receive (data contract, frozen November 1, 2026)

**`ml/data/processed/monthly_series.csv`: 6 columns, 18,000 rows (500 companies × 36 months).**

| Column | Type | Unit | Rule |
|---|---|---|---|
| `company_id` | text | none | `C0001` to `C0500` |
| `sector` | text | none | agriculture, construction, manufacturing, mining, retail or services |
| `month` | text | `YYYY-MM` | `2023-01` to `2025-12` |
| `income` | number | millions of COP | Zero or positive. Median 116.9, range 9.2 to 1,608.4 |
| `expenses` | number | millions of COP | Zero or positive |
| `origin` | text | none | `derived` or `simulated` |

**`ml/data/processed/split_manifest.csv`: 4 columns.**

| Column | Rule |
|---|---|
| `company_id`, `month` | Key to join with the series |
| `month_index` | 1 to 36 |
| `split` | `train` (1-24), `validation` (25-30), `test` (31-36), `holdout` (all 36 months of 75 reserved companies) |

Counts: 425 regular companies and 75 holdout. Holdout per sector: agriculture 4, construction 6, manufacturing 15, mining 2, retail 27, services 21. You receive these files through `develop`. Do not upload your own copies.

**From Phase 3:** `ml/artifacts/model_global.json`, `ml/artifacts/parity_cases.json`, `docs/03_model_selection.md`.

**Evaluation scenarios:**
1. **Temporal test:** the 425 regular companies. History: months 1 to 30. Forecast months 31 to 36. Compare with the real values.
2. **Holdout test:** the 75 holdout companies. History: their months 1 to 30 (only as input, never to fit anything). Forecast months 31 to 36. Compare with the real values.

**Never use `company_profiles.csv`.** It holds the true hidden parameters of each company. Using it would hide real errors.

What to expect: 72 companies have a permanent level shift that no model can predict, and about 30% of company-months show a loss. Mention both in your error analysis.

## 5. What you must do, step by step

**Step 1. Write the evaluation protocol before running anything** (`docs/04_evaluation_protocol.md`, template in section 7). Fix in advance: the metrics and formulas (including normalized MAE), both scenarios, the recursive mode, the acceptance criteria (use Sergio's approved success criterion, with the names of who approved it and the date), the run-once rule, and this rule: **the evaluated artifact is `model_global.json`, computed with the pure-Python predictor, and its SHA-256 is written in the report**. Reference: the baseline has a median normalized error of 12.5% on the validation months (Phase 2 report). Do not compute the baseline on test months before the official run.

**Step 2. Commit the protocol first and tag it.** The history must prove it existed before any result:
```
git add docs/04_evaluation_protocol.md
git commit -m "docs: add evaluation protocol"
git tag eval-protocol-v1
git push origin phase4/evaluation --tags
```

**Step 3. Review Phase 3 for leakage and exportability**, while Jonathan works and using only his code and documents. Write the answers in `docs/04_leakage_review.md`:
- Does any code read rows with `split` equal to `test` or `holdout`, or `company_profiles.csv`?
- Is any scaler, average or statistic fitted on validation, test or the full series?
- Is any feature built from future months?
- Is the baseline evaluated with the same procedure as the other models?
- Is the selection decision based only on validation numbers?
- Is the final model one of the three exportable types, and does `parity_cases.json` pass (relative difference at most 1e-6)?
If you find a problem, tell Jonathan before the test run, not after.

**Step 4. Write `ml/src/evaluate.py`.** It reads `model_global.json`, forecasts both scenarios recursively with the pure-Python predictor (same algorithm as the backend), and computes MAE, RMSE, normalized MAE, MAPE and bias. It writes `ml/artifacts/test_report.json`, including `artifact_sha256`. Test the script on validation data first (not test) so you know it works.

**Step 5. Run the official evaluation once**, after Jonathan announces the final artifact (November 9, 2026). Commit and tag the result right away:
```
git add ml/artifacts/test_report.json
git commit -m "feat: add final test evaluation results"
git tag eval-final-run
git push origin phase4/evaluation --tags
```
After this, nobody may change `model_global.json`. If it changes, its hash changes and the evaluation is void.

**Step 6. Analyze errors.** By sector, by horizon (+1 to +6), by company size tercile, income vs expenses, temporal test vs holdout, bias, companies with a level shift vs the rest, and the 10 largest errors. Does error grow with the horizon? Is one sector much worse? Note if MAPE misbehaves.

**Step 7. Write the report** (`docs/04_evaluation_report.md`, template in section 7) with a clear verdict: accepted or not accepted under the protocol.

**Step 8. Hand over.** Give Sergio the reference error levels (MAE and median normalized MAE per target, temporal and holdout), and give Samuel the artifact hash he must verify before deploying.

## 6. What you must NOT do
- Do not run the test set more than once. A second run means you have started tuning to it.
- Do not ask Jonathan to change or replace the model because of test results. The decision is closed after the test. If the result is poor, the report says so and the team discusses it with the professor.
- Do not change the protocol after seeing any result.
- Do not train, tune or refit any model. Evaluation only.
- Do not use `company_profiles.csv`.
- Do not report only the favorable metrics.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish.

If something crashes in the official run (a bug, not a result), tell the team immediately, fix the bug without changing the model or the protocol, and document it in the report.

## 7. Deliverables and templates

**`docs/04_evaluation_protocol.md`** sections:
1. Objective
2. Data and scenarios (temporal test, holdout)
3. Forecasting procedure (recursive, 6 months)
4. Metrics and formulas
5. Acceptance criteria (with the approval record: names and date)
6. Evaluated artifact and hash rule
7. Run-once rule and how it is enforced (tags)

**`docs/04_leakage_review.md`**:

| Question | Answer | Evidence (file and line) |
|---|---|---|

**`docs/04_evaluation_report.md`** sections:
1. Summary, verdict and artifact SHA-256
2. Results: chosen model vs baseline

| Scenario | Model | Target | MAE | RMSE | Median normalized MAE (%) | P90 normalized MAE (%) | Bias |
|---|---|---|---|---|---|---|---|

3. Error by horizon

| Scenario | Model | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|

4. Error by sector
5. Error by company size tercile
6. Largest errors and what they have in common (level shifts?)
7. Limitations and consequences for a real small business

Also: `ml/src/evaluate.py` and `ml/artifacts/test_report.json`.

## 8. Work plan

| Date | Task |
|---|---|
| Until November 4, 2026 | Read this file and the data contract, get the data through `develop` |
| November 4-5, 2026 | Protocol written, committed and tagged |
| November 6-8, 2026 | Leakage review, write and test `evaluate.py` on validation data |
| November 9, 2026 | Jonathan announces the final artifact |
| November 9-10, 2026 | Official run (once), analysis, report |
| November 11, 2026 | Reference errors to Sergio, hash to Samuel |

## 9. Git workflow
```
git checkout phase4/evaluation
git pull origin phase4/evaluation
```
Order of commits matters: protocol first (`docs: add evaluation protocol`), then script (`feat: add evaluation script`), then results (`feat: add final test evaluation results`), then report (`docs: add evaluation report`). Use `git add` with file names, never `git add .`. Open a Pull Request into `develop` at the end.

## 10. Definition of done
- [ ] Protocol committed and tagged before any test result existed.
- [ ] Leakage and exportability review written, with evidence.
- [ ] Test set evaluated exactly once, with a tagged commit as proof.
- [ ] Report includes the artifact SHA-256 and an explicit verdict.
- [ ] Both scenarios reported, with baseline comparison and breakdowns by horizon, sector and size.
- [ ] Sergio received the reference errors and Samuel received the hash.

## 11. What you must be able to explain at the final presentation
- The difference between training, validation and test sets, and why test is used once.
- What data leakage is and how you checked for it.
- Why the evaluated file is the deployed file (the hash).
- What MAE, RMSE, normalized MAE, MAPE and bias mean and when each one misleads.
- Why holdout companies are a harder and more honest test.
- What the model gets wrong and what that means for a real small business.
- Likely professor questions: "How do you know the test set was not used before?", "How do you know the app runs the model you evaluated?", "Is this error acceptable for a business?".

## 12. If you get stuck
Protocol and thresholds: ask Sergio. Model and artifact: ask Jonathan. Data format: ask Samuel. If the team disagrees about a rule, the protocol you committed wins.
