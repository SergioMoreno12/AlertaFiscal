# PHASE 6 — Monitoring, Testing and Final Report

- **Owner:** Sergio Steeven Moreno Forero
- **Branch:** `phase6/monitoring`
- **Deadlines:** preparation work (thresholds draft, test case document, report outline) from November 4, 2026. Code from November 11, 2026. Monitoring and tests ready by November 16, 2026. Final report by November 18, 2026.
- **Does it need code?** Yes, a small amount: one database table, monitoring logic, one endpoint or app section, and tests.

---

## 1. Why this phase exists
A deployed model is not a finished model. Real data changes, and forecasts get worse without anyone noticing. This phase makes the app record what it predicted, compare it with what actually happened, and warn when error grows. It also closes the project with tests and the final report.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 1 Business and data | You | Base of your final report | November 3, 2026 |
| 3 Modeling | Jonathan | Model selection document | November 9, 2026 |
| 4 Evaluation | Manuel | Gives you reference errors | November 11, 2026 |
| 5 Integration | Samuel | Deploys the app and stores forecasts | November 10-15, 2026 |
| **6 Monitoring** | **You** | Monitoring, tests, final report | **November 11-18, 2026** |

You cannot write monitoring code before Samuel has the integrated app skeleton (November 10, 2026). Until then, do the documents.

## 3. Glossary
- **Monitoring:** watching a deployed model to detect when it stops working well.
- **Drift:** the real world changes (new seasons, new behavior), so the model's past learning no longer fits and errors grow.
- **Reference MAE:** the error Manuel measured on the test set. It is what "normal" looks like.
- **Rolling MAE:** MAE computed over the most recent months, updated as new real data arrives.
- **Threshold:** a limit that changes the status (normal, watch, degraded).
- **Closed interval:** an interval that includes its end values, written with square brackets, such as [0, 10]. Thresholds must cover every possible number with no gap and no overlap.
- **Migration:** a versioned script that changes the database structure, so every environment ends up identical.
- **Ephemeral disk:** Render erases local files on every redeploy. Anything saved in a file is lost. Only the database survives.
- **Insufficient history:** a company with fewer than 6 months of data. The app does not forecast and offers manual mode.

## 4. What you receive
- From Phase 4 (Manuel): reference MAE per target, and the evaluation report.
- From Phase 5 (Samuel): the deployed app. The ERP already has a `ForecastRun` table that stores each forecast; you extend the system, you do not replace it.
- From Phase 3 (Jonathan): the minimum history rule (6 months) and how the model is called.
- From Phase 1 (yours): problem, data and limits, reused in the final report.

## 5. What you must do, step by step

**Step 1 (from November 4, 2026). Draft the thresholds.** Define status levels as closed intervals relative to Manuel's reference MAE. Example structure, to be adjusted:
- Normal: from 0 up to and including 1.0 times the reference MAE.
- Watch: above 1.0 up to and including 1.5 times.
- Degraded: above 1.5 times.
Every possible value must belong to exactly one level. Explain in `docs/06_monitoring.md` why you chose those numbers.

**Step 2 (from November 4, 2026). Write the test case document** (`docs/06_test_cases.md`) using the template in section 7. Minimum cases:
1. Company with fewer than 6 months of history gets an "insufficient history" message and the manual mode option.
2. Company with exactly 6 months gets a valid forecast.
3. Company with more than 6 months gets a valid forecast.
4. Company with no data returns a clear error, not a crash.
5. Forecast stored, and the real value never arrives: status stays pending.
6. Real value arrives late for one month: error is computed when it arrives.
7. Error exactly equal to a threshold: it falls in the level the closed interval says.
8. Error crossing from normal to watch to degraded changes the status correctly.
9. Redeploy on Render: monitoring data is still there.
10. Two companies do not see each other's data.

**Step 3 (from November 11, 2026). Design the monitoring table in PostgreSQL**, for example `forecast_monitoring`. Minimum columns: company id, forecast run id (link to `ForecastRun`), target (`income` or `expenses`), forecast month, predicted value, actual value (empty until the month closes), absolute error, status, creation date. Add it with the same migration mechanism the ERP already uses (ask Samuel which one).

**Step 4. Record predictions automatically** when a forecast run is created.

**Step 5. Fill the actual value** when the company registers real income or expenses for that month, then compute the error and the status.

**Step 6. Compute rolling MAE** per company and per target, and compare it with the reference MAE using your thresholds.

**Step 7. Show the result** in a simple way: an endpoint or a small section in the app with the status per company. Agree the place with Samuel.

**Step 8. Automate the tests** you can, run them, and mark each case in the document as passed or failed.

**Step 9. Write the final project report** (`docs/07_final_report.md`) using the outline in section 7. Use Jonathan's and Manuel's numbers exactly as they are. Do not round up or "improve" results.

**Step 10. Rehearse the presentation** with the team on November 18, 2026.

## 6. What you must NOT do
- Do not store monitoring data in local files or a folder inside the repository. Render erases them. PostgreSQL only.
- Do not write the database URL or passwords in code or in the repository. Use the `DATABASE_URL` environment variable.
- Do not leave gaps or overlaps between threshold intervals.
- Do not change the model, the metrics or Manuel's numbers. Monitoring observes; it does not fix.
- Do not edit files in `ml/src/` or ERP code outside the monitoring module without agreeing with Samuel.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish.

## 7. Deliverables and templates

- Migration and model for the monitoring table, monitoring logic, endpoint or app section, automated tests.
- `docs/06_monitoring.md`: purpose, table design, thresholds with justification, how status is computed, how data is protected.
- `docs/06_test_cases.md`, one row per case:

| ID | Case | Steps | Expected result | Actual result | Status (passed or failed) |
|---|---|---|---|---|---|

- `docs/07_final_report.md` outline:
  1. Problem and users
  2. Data and its limits (from Phase 1)
  3. Method and models (from Phase 3)
  4. Evaluation results (from Phase 4)
  5. System architecture and deployment
  6. Monitoring and tests
  7. Limitations and next steps
  8. Team and responsibilities

## 8. Git workflow
```
git checkout phase6/monitoring
git pull origin phase6/monitoring
git add docs/06_test_cases.md
git commit -m "docs: add test cases"
git push origin phase6/monitoring
```
Small commits (examples: `feat: add forecast monitoring table`, `test: add insufficient history case`, `docs: add final report`). Open a Pull Request into `develop` and coordinate the merge with Samuel, because your code depends on his integration.

## 9. Definition of done
- [ ] Predictions and actual values are stored in PostgreSQL and survive a redeploy.
- [ ] Thresholds are closed intervals with no gaps, and they are documented.
- [ ] All 10 test cases are documented and the automatable ones pass.
- [ ] Monitoring status is visible in the app.
- [ ] Final report is complete and uses the real evaluation numbers.
- [ ] No secrets or local log files in the repository.

## 10. What you must be able to explain at the final presentation
- Why a deployed model must be monitored and what drift is.
- How the app knows a forecast was wrong.
- Why data lives in the database and not in a file.
- What the thresholds mean and why those numbers.
- What the project cannot do and what the next steps would be.
- Likely professor questions: "What happens when the model gets worse?", "What if the company has little data?", "How did you test it?".

## 11. If you get stuck
Database and deployment: ask Samuel. Reference errors: ask Manuel. Model call: ask Jonathan.