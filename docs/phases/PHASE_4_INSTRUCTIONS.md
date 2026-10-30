# PHASE 4 — Evaluation

- **Owner:** Manuel Eduardo Alarcon Aza
- **Branch:** `phase4/evaluation`
- **Deadlines:** evaluation protocol committed by November 5, 2026. Final test evaluation on November 9-10, 2026. Reference error levels delivered to Sergio by November 11, 2026.
- **Does it need code?** Yes. You write the evaluation script yourself.

---

## 1. Why this phase exists
You are the independent check on Phase 3. Jonathan chooses a model using validation data. You measure how good that model really is on data nobody used to choose it, and you report the result honestly, even if it is bad. The value of your phase depends on one rule: the test set is used once.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 1 Business and data | Sergio | Gives you metrics and business criterion | November 3, 2026 |
| 2 Data preparation | Samuel | Gives you the dataset and the manifest | November 3, 2026 |
| 3 Modeling | Jonathan | Gives you the selected model | November 9, 2026 |
| **4 Evaluation** | **You** | Protocol first, then one test run | **November 5-10, 2026** |
| 6 Monitoring | Sergio | Receives your reference error levels | November 11, 2026 |

Write the protocol before Jonathan finishes. That is what makes your evaluation trustworthy.

## 3. Glossary
- **Test set:** months 31-36 of the companies seen in training. The final exam.
- **Holdout companies:** about 15% of companies whose rows were never used in training or tuning. They test whether the model works on a company it has never seen.
- **Recursive multi-step forecast:** predict one month, feed it back as history, repeat for 6 months. The app forecasts this way, so you evaluate this way.
- **Forecast horizon:** how many months ahead (1 to 6).
- **MAE:** average absolute error in millions of COP.
- **RMSE:** square root of the average squared error. Penalizes large mistakes.
- **MAPE:** average percentage error. Misleading when real values are near zero.
- **Bias:** systematic tendency to over- or under-forecast. Computed as the average of (forecast − real). Positive means the model forecasts too high.
- **Baseline:** simple reference model the chosen model must beat.
- **Data leakage:** information from test, holdout or the future reaching training or selection.

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
| `split` | `train` (1-24), `validation` (25-30), `test` (31-36), `holdout` (all 36 months of reserved companies) |

**Evaluation scenarios:**
1. **Temporal test:** companies seen in training. History: months 1-30. Forecast months 31-36. Compare with real values.
2. **Holdout test:** companies never seen. History: months 1-30 of those companies (used only as input, never for fitting). Forecast months 31-36. Compare with real values.

## 5. What you must do, step by step

**Step 1. Write the evaluation protocol before running anything** (`docs/04_evaluation_protocol.md`). Use the template in section 7. It must fix, in advance: the metrics and formulas, the two scenarios, the recursive mode, the acceptance criteria and the run-once rule. Get the business criterion from Sergio's Phase 1 document. Example acceptance criteria (agree the real numbers with the team): "the chosen model beats the baseline in MAE on both scenarios, and the average monthly error stays below X% of the company's average monthly income".

**Step 2. Commit the protocol first and mark it.** The history must prove it existed before any result:
```
git add docs/04_evaluation_protocol.md
git commit -m "docs: add evaluation protocol"
git tag eval-protocol-v1
git push origin phase4/evaluation --tags
```

**Step 3. Review Phase 3 for leakage** (while Jonathan trains, using only his code and documents). Answer in writing:
- Does the code read rows with `split` equal to `test` or `holdout`?
- Is any scaler, average or statistic fitted on validation, test or the full series?
- Is any feature built from future months?
- Is the baseline evaluated with the same procedure as the other models?
- Is the selection decision based only on validation numbers?
Write findings in `docs/04_leakage_review.md`. If you find a problem, tell Jonathan before the test run, not after.

**Step 4. Write `ml/src/evaluate.py`.** It loads the selected model and the baseline, builds the recursive forecast for both scenarios, computes MAE, RMSE, MAPE and bias, and writes `ml/artifacts/test_report.json`. Test the script on validation data first (not test) so you know it works before the official run.

**Step 5. Run the official evaluation once**, after Jonathan announces the selected model (November 9, 2026). Commit and tag the result right away:
```
git add ml/artifacts/test_report.json
git commit -m "feat: add final test evaluation results"
git tag eval-final-run
git push origin phase4/evaluation --tags
```

**Step 6. Analyze errors.** By sector, by horizon (month +1 to +6), income vs expenses, temporal test vs holdout, bias, and the 10 largest errors. Look for patterns: does the error grow with the horizon? Is one sector much worse? Check MAPE for near-zero values and say so if it explodes.

**Step 7. Write the report** (`docs/04_evaluation_report.md`) with the template in section 7 and a clear verdict: accepted or not accepted under the protocol.

**Step 8. Hand reference error levels to Sergio.** The MAE (income and expenses) on the temporal test, and the holdout MAE. Sergio uses them as the baseline for monitoring thresholds.

## 6. What you must NOT do
- Do not run the test set more than once. A second run means you have started tuning to it.
- Do not ask Jonathan to change or replace the model because of test results. The decision is closed after the test. If the result is poor, the report says so and the team discusses it with the professor.
- Do not change the protocol after seeing any result.
- Do not train, tune or refit any model. Evaluation only.
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
5. Acceptance criteria
6. Run-once rule and how it is enforced (tags)

**`docs/04_leakage_review.md`**: one table:

| Question | Answer | Evidence (file and line) |
|---|---|---|

**`docs/04_evaluation_report.md`** sections:
1. Summary and verdict
2. Results: chosen model vs baseline

| Scenario | Model | Target | MAE | RMSE | MAPE | Bias |
|---|---|---|---|---|---|---|

3. Error by horizon

| Scenario | Model | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|

4. Error by sector
5. Largest errors and what they have in common
6. Limitations and consequences for a real small business

Also: `ml/src/evaluate.py` and `ml/artifacts/test_report.json`.

## 8. Work plan

| Date | Task |
|---|---|
| Until November 3, 2026 | Read this file and the data contract |
| November 4-5, 2026 | Protocol written, committed and tagged |
| November 6-8, 2026 | Leakage review, write and test `evaluate.py` on validation data |
| November 9, 2026 | Jonathan announces the model |
| November 9-10, 2026 | Official run (once), analysis, report |
| November 11, 2026 | Reference errors delivered to Sergio |

## 9. Git workflow
```
git checkout phase4/evaluation
git pull origin phase4/evaluation
```
Order of commits matters: protocol first (`docs: add evaluation protocol`), then script (`feat: add evaluation script`), then results (`feat: add final test evaluation results`), then report (`docs: add evaluation report`). Pull Request into `develop` at the end.

## 10. Definition of done
- [ ] Protocol committed and tagged before any test result existed.
- [ ] Leakage review written, with evidence.
- [ ] Test set evaluated exactly once, with a tagged commit as proof.
- [ ] Both scenarios reported, with baseline comparison.
- [ ] Errors broken down by sector and horizon.
- [ ] Report ends with an explicit verdict and limits.
- [ ] Sergio received the reference error levels.

## 11. What you must be able to explain at the final presentation
- The difference between training, validation and test sets, and why test is used once.
- What data leakage is and how you checked for it.
- What MAE, RMSE, MAPE and bias mean and when each one misleads.
- Why holdout companies are a harder and more honest test.
- What the model gets wrong and what that means for a real small business.
- Likely professor questions: "How do you know the test set was not used before?", "Why did the model fail on this sector?", "Is this error acceptable for a business?".

## 12. If you get stuck
Protocol and thresholds: ask Sergio. Model details: ask Jonathan. Data format: ask Samuel. If the team disagrees about a rule, the protocol you committed wins.