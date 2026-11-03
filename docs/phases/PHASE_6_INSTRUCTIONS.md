# PHASE 6 — Monitoring, Testing and Final Report

- **Owner:** Sergio Steeven Moreno Forero
- **Branch:** `phase6/monitoring`
- **Deadlines:** documents from November 4, 2026. Code from November 10, 2026 (when Samuel's skeleton exists). Monitoring and tests ready by November 16, 2026. Final report by November 18, 2026.
- **Does it need code?** Yes, a small amount: one database table, monitoring logic, one endpoint or app section, and tests.

---

## 1. Why this phase exists
A deployed model is not a finished model. Real data changes, and forecasts get worse without anyone noticing. This phase makes the app record what it predicted, compare it with what actually happened, warn when error grows, and define what to do then (retrain or roll back). It also closes the project with the tests and the final report.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 1 Business and data | You | Alert rule, decisions, base of your final report | November 3, 2026 |
| 3 Modeling | Jonathan | Model selection document and artifact | November 9, 2026 |
| 4 Evaluation | Manuel | Gives you reference errors | November 11, 2026 |
| 5 Integration | Samuel | Skeleton on November 6, deployed app on November 15, 2026 | From November 6, 2026 |
| **6 Monitoring** | **You** | Monitoring, tests, final report | **November 10-18, 2026** |

You cannot write monitoring code before Samuel has the integrated app skeleton. Until then, do the documents.

## 3. Glossary
- **Monitoring:** watching a deployed model to detect when it stops working well.
- **Drift:** the real world changes (new seasons, new behavior), so the model's past learning no longer fits and errors grow.
- **Reference error:** the normalized error Manuel measured on the test set. It is what "normal" looks like.
- **Normalized error:** a company's MAE divided by its average monthly income, in %. Companies in this project differ about 100 times in size (9 to 1,600 million COP per month), so monitoring compares percentages, not pesos.
- **Rolling error:** error computed over the most recent months, updated as new real data arrives.
- **Threshold:** a limit that changes the status (normal, watch, degraded).
- **Closed interval:** an interval that includes its end values, such as [0, 10]. Thresholds must cover every possible number with no gap and no overlap.
- **`ForecastRun`:** ERP table that stores every forecast: method, model version, projected monthly values, history signature and a flag that says if the inputs changed after training. You extend it, you do not replace it.
- **Audit event:** the ERP already records a `forecast.model_run` event for each forecast.
- **Operational monitoring:** availability, latency and error counts of the forecast service.
- **Rollback:** going back to the previous model version.
- **Migration:** a versioned script that changes the database structure, so every environment ends up identical.
- **Ephemeral disk:** Render erases local files on every redeploy. Only the database survives.
- **Insufficient history:** a company with fewer than 6 months of data. The app does not forecast and offers manual mode.

## 4. What you receive
- From Phase 4 (Manuel): reference errors (MAE and median normalized MAE per target) and the evaluation report.
- From Phase 5 (Samuel): the app. Forecasts are stored in `ForecastRun`; real values are read with the ERP function that groups income and expenses by month (`monthly_history`). Samuel also loads demo companies for your tests.
- From Phase 3 (Jonathan): the model version and the 6-month minimum history.
- From Phase 1 (yours): problem, data, limits and the loss-month alert rule, reused in the final report.

## 5. What you must do, step by step

**Step 1 (from November 4, 2026). Draft the thresholds** as closed intervals on normalized error relative to Manuel's reference. Example, to adjust: normal from 0 up to and including 1.0 times the reference; watch above 1.0 up to and including 1.5 times; degraded above 1.5 times. Every value belongs to exactly one level. Justify the numbers in `docs/06_monitoring.md`.

**Step 2 (from November 4, 2026). Write the test case document** (`docs/06_test_cases.md`, template in section 7). Minimum cases:
1. Fewer than 6 months of history: "insufficient history" message and the manual mode option.
2. Exactly 6 months: valid forecast.
3. More than 6 months: valid forecast.
4. Company with no data: clear error, not a crash.
5. A company with its own model uses it; a company without one uses the global model.
6. Forecast stored and the real value never arrives: status stays pending.
7. Real value arrives late for one month: error is computed when it arrives.
8. Error exactly equal to a threshold falls in the level the closed interval says.
9. Status changes correctly from normal to watch to degraded.
10. A small and a large company with the same percentage error get the same status.
11. The "inputs changed since training" flag appears when the history changed after training.
12. Model file missing or invalid: the ERP keeps working and manual mode is offered.
13. The deployed model file has the same SHA-256 that Manuel evaluated.
14. Redeploy on Render: monitoring data is still there.
15. Two companies never see each other's data.

**Step 3 (from November 10, 2026). Design the monitoring table in PostgreSQL**, for example `forecast_monitoring`. Minimum columns: company id, forecast run id (link to `ForecastRun`), target (`income` or `expenses`), forecast month, predicted value, actual value (empty until the month closes), absolute error, normalized error, status, model version, creation date. Add it with the migration mechanism the ERP already uses (ask Samuel which one).

**Step 4. Record predictions automatically** when a forecast run is created: one row per target and forecast month, taken from the monthly values stored in the run.

**Step 5. Fill the actual value** when the company registers real income or expenses for that month, then compute the absolute error, the normalized error and the status.

**Step 6. Compute rolling normalized error** per company and per target, and compare it with the reference using your thresholds.

**Step 7. Operational monitoring.** Record and show: availability of the health endpoint, latency of the forecast endpoint, counts of results by outcome (success, `insufficient_history`, `model_not_trained`, `artifact_invalid`), and the model version used. Store the counts in PostgreSQL, never in files.

**Step 8. Retraining and rollback procedure** (`docs/06_retraining_and_rollback.md`): when to retrain (for example, status degraded for 2 consecutive months), who decides, how a new model is validated (parity test and Manuel's protocol), how to roll back (previous model file kept in Git, redeploy the previous commit), and where the previous version is stored.

**Step 9. Privacy and retention** (`docs/06_privacy_and_retention.md`): what is stored (aggregated amounts, no personal data), for how long (propose a period), and who can read it.

**Step 10. Show the result** in a simple way: an endpoint or a small section in the app with the status per company, the model version and the date. Agree the place with Samuel.

**Step 11. Automate the tests** you can, run them, and mark each case in the document as passed or failed.

**Step 12. Write the final project report** (`docs/07_final_report.md`, outline in section 7). Use Jonathan's and Manuel's numbers exactly as they are. Do not round up or "improve" results.

**Step 13. Rehearse the presentation** with the team on November 18, 2026.

## 6. What you must NOT do
- Do not store monitoring data in local files or in a folder inside the repository. Render erases them. PostgreSQL only.
- Do not write the database URL or passwords in code or in the repository. Use the `DATABASE_URL` environment variable.
- Do not leave gaps or overlaps between threshold intervals.
- Do not compare companies using errors in pesos. Use normalized error.
- Do not change the model, the metrics or Manuel's numbers. Monitoring observes; it does not fix.
- Do not edit files in `ml/src/` or ERP code outside the monitoring module without agreeing with Samuel.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish.

## 7. Deliverables and templates
- Migration and model for the monitoring table, monitoring logic, endpoint or app section, automated tests.
- `docs/06_monitoring.md`: purpose, table design, thresholds with justification, how status is computed, operational metrics, how data is protected.
- `docs/06_retraining_and_rollback.md` and `docs/06_privacy_and_retention.md`.
- `docs/06_test_cases.md`, one row per case:

| ID | Case | Steps | Expected result | Actual result | Status (passed or failed) |
|---|---|---|---|---|---|

- `docs/07_final_report.md` outline:
  1. Problem and users
  2. Data and its limits (from Phase 1 and the Phase 2 report)
  3. Method and models (from Phase 3)
  4. Evaluation results (from Phase 4)
  5. System architecture and deployment
  6. Monitoring, tests and operations
  7. Limitations and next steps
  8. Team and responsibilities

## 8. Work plan

| Date | Task |
|---|---|
| November 4-9, 2026 | Steps 1, 2, 8 and 9 (documents) |
| November 10-12, 2026 | Steps 3-6 (table, recording, error, status) once the skeleton exists |
| November 13-15, 2026 | Steps 7 and 10 (operational monitoring, screen) |
| November 16, 2026 | Step 11: all automatable tests run |
| November 17-18, 2026 | Steps 12 and 13: final report and rehearsal |

## 9. Git workflow
```
git checkout phase6/monitoring
git pull origin phase6/monitoring
git add docs/06_test_cases.md
git commit -m "docs: add test cases"
git push origin phase6/monitoring
```
Small commits (examples: `feat: add forecast monitoring table`, `test: add insufficient history case`, `docs: add rollback procedure`, `docs: add final report`). Use `git add` with file names, never `git add .`. Open a Pull Request into `develop` and coordinate the merge with Samuel, because your code depends on his integration.

## 10. Definition of done
- [ ] Predictions and actual values are stored in PostgreSQL and survive a redeploy.
- [ ] Thresholds are closed intervals on normalized error, with no gaps, and documented.
- [ ] All 15 test cases are documented and the automatable ones pass.
- [ ] Status, model version and date are visible in the app.
- [ ] Operational metrics, retraining and rollback, and privacy documents are written.
- [ ] Final report is complete and uses the real evaluation numbers.
- [ ] No secrets or local log files in the repository.

## 11. What you must be able to explain at the final presentation
- Why a deployed model must be monitored and what drift is.
- How the app knows a forecast was wrong, and why error is normalized.
- What happens when the model degrades: retrain or roll back.
- Why data lives in the database and not in a file.
- What the thresholds mean and why those numbers.
- What the project cannot do and what the next steps would be.
- Likely professor questions: "What happens when the model gets worse?", "What if the model file is missing?", "What if the company has little data?", "How did you test it?".

## 12. If you get stuck
Database and deployment: ask Samuel. Reference errors: ask Manuel. Model and artifact: ask Jonathan.
