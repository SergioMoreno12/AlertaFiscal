# PHASE 5 — ERP Port, Model Integration and Deployment

- **Owner:** Samuel Castellanos Rivera (support: Manuel and Sergio, because this is the heaviest phase)
- **Branches:** `erp-port` (copy, clean and translate the ERP) and `phase5/flask-api` (model integration and deployment)
- **Deadlines:** ERP ported with tests passing on November 3-4, 2026. Skeleton with a placeholder model on November 6, 2026. Real model on November 10-12, 2026. Deployed on Render and Supabase by November 15, 2026.
- **Does it need code?** Yes. Adapting an existing ERP, one set of backend changes, tests and deployment.

## Status on November 3, 2026 (review by Sergio)

| Step | Status |
|---|---|
| 1. `erp-port` branch | Done |
| 2. Copy the clean ERP code | **Missing.** `erp-port` has no `backend/`, `frontend/`, `ml/company_trainer/`, `docs/erp/`, `render.yaml`, `compose.yaml`, `docker/` or `.github/` yet |
| 3. Old Flask site in `legacy_flask_site/` | Done (`app.py`, `templates/`, `static/`, `requirements.txt`) |
| `.gitignore` for the ERP | Done, with two notes in Step 2 |
| 4. Tests (38 passed, 10 skipped), frontend build, Pull Request | Blocked by Step 2 |
| 5-16 | Not started |
| Phase 2 correction (16.2 % → validation reference) | Done, merged in Pull Request #3 |

**Most urgent:** Step 2 and Step 4 (planned for November 3-4). Everything else depends on them, and the placeholder artifact of Step 10 is due on **November 6, 2026** (Sergio needs it for Phase 6).

**News from Phase 3:** Jonathan's real artifact is already on `phase3/modeling` (commit `9406af5`) and passes the Phase 4 checks (see section 5.1). It can be used from Step 7 on, instead of waiting for November 10.

---

## 1. Why this phase exists
The product of this course is the AlertaFiscal ERP with the machine learning forecast connected to it. Phase 5 turns the model of Phase 3 into something a user opens in a browser, and proves that the deployed model is the same one Manuel evaluated. If this phase fails, there is no demo.

## 2. Where you fit in the project

| Phase | Owner | Relation to you | Date |
|---|---|---|---|
| 2 Data preparation | You | Dataset, merged into `develop` first | Done |
| 3 Modeling | Jonathan | Gives you `model_global.json` and `parity_cases.json` | Delivered November 3, 2026 (commit `9406af5`) |
| 4 Evaluation | Manuel (run by Sergio) | Gives you the artifact SHA-256 and the verdict | November 10, 2026 |
| **5 Integration** | **You** | Port, adapt, integrate, deploy | **November 3-15, 2026** |
| 1 and 6 | Sergio | Alert rule (Phase 1) and monitoring (Phase 6), built on your app | From November 6, 2026 |

## 3. Glossary
- **ERP:** the AlertaFiscal ERP (`PROYECTO_FINAL_MACHINE`). It was generated with the AI tool opencode, so the team must read it and be able to explain it.
- **Port:** copy the existing ERP code into this repository and adapt it. It is not a rewrite.
- **Artifact:** the JSON file that contains a trained model. The backend reads it and computes the forecast in pure Python. Flask never imports scikit-learn or joblib.
- **Global model:** one model trained on all 425 training companies. It is the default for every company.
- **Company model:** an artifact trained by the ERP script on one company's own history. If it exists, it takes priority over the global model.
- **`ForecastRun`:** table of the ERP that stores each forecast (method, horizon, model version, monthly values, history signature).
- **Stub / placeholder:** a temporary model with the same format as the real one, so the app can be built and tested before the real model is ready.
- **Parity test:** a test that checks the backend gives the same forecast as scikit-learn for the same history.
- **SHA-256 hash:** a fingerprint of a file. It proves two files are identical.
- **Migration:** versioned script that changes the database structure.
- **Environment variable:** configuration (such as `DATABASE_URL`) set in the hosting panel, never written in code.
- **Render:** hosting for the backend (Gunicorn) and the static frontend. **Supabase:** hosted PostgreSQL database.
- **Cold start:** the free Render plan sleeps after inactivity, so the first request can take about a minute.
- **Insufficient history:** a company with fewer than 6 months of data. The app does not forecast and offers manual mode.
- **Manual mode:** the ERP's existing planning by manual average. It is always available when the model cannot run.

## 4. What you receive
- The ERP folder `PROYECTO_FINAL_MACHINE`. Its backend tests were run: 38 pass and 10 are skipped. It contains: the forecast service (`backend/app/modules/planning/forecasting.py`), alert rules (`alerts/rules.py`), an external context module, 3 migrations, a per-company trainer (`ml/train.py`), docs, a GitHub Actions folder and Docker files.
- The old base ERP (`AlertaFiscalBeta-main.zip`), used to build the traceability matrix.
- From Phase 3: `model_global.json` and `parity_cases.json`. From Phase 4: the verdict and the artifact SHA-256.

## 5. The global artifact contract (agreed with Jonathan)
- `scope: "global"`, `schema_version: 1`, `min_history_months: 6`.
- Features: `t` (position in the company's own history, starting at 0), `month_sin`, `month_cos`, `lag1`, `lag2`, `lag3`.
- Optional `feature_spec.normalization = {"type": "mean_last_n", "n": 3}`: scale = mean of the last 3 values; the lags are divided by the scale; the model predicts a ratio; the backend multiplies the result by the scale.
- Models supported: `seasonal_naive`, `linear_regression`, `random_forest` (trees stored as arrays). An MLP is not supported.
- `data_provenance`: `kind: "semi_synthetic"` and `is_demo: true`.
- File size: about 5 MB at most.

### 5.1 The delivered artifact and what the backend must do with it

Checked by Phase 4 on November 3, 2026 (`docs/04_leakage_review.md` on `phase4/evaluation`):

| Item | Value |
|---|---|
| File | `ml/artifacts/model_global.json` on `phase3/modeling` |
| `model_version` | `global-20261103-84df89b5` |
| Size | 1.48 MB |
| SHA-256 | `18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e` |
| Models | `random_forest` for income and for expenses, 100 trees each |
| Parity | 50 cases, maximum relative difference 0.0 with the Phase 4 predictor |

**Layout.** Each target is stored as `targets[target].selected_model` plus `targets[target].models[selected_model].params`. A random forest has `params.trees`, each tree with the arrays `children_left`, `children_right`, `feature`, `threshold` and `value` (leaf when `children_left` is −1; go left when `x[feature] <= threshold`; the prediction is the mean of the leaves). A linear regression has `params.coefficients` and `params.intercept`. `parity_cases.json` has `cases`, each with `history: {income, expenses}` (24 months), `last_month`, `expected` (unrounded, used for the 1e-6 test) and `expected_rounded` (2 decimals, what the API returns). `ml/src/check_export_parity.py` on `phase3/modeling` is a pure-Python reference reader.

**Rules the backend must follow:**
1. **Cast the features to float32 before walking the trees.** scikit-learn compares tree inputs in single precision. Without the cast, a few company-months give slightly different forecasts (validation income MAE 17.205 instead of 17.203 in the Phase 4 reproduction). See `float32()` in `ml/src/evaluate.py` on `phase4/evaluation`.
2. **Zero or negative scale** (mean of the last 3 months ≤ 0): treat it as insufficient history, exactly like fewer than 6 months. Reject the request and fall back to manual mode. Do not divide by 1.0 or any fallback value. Phase 3 and Phase 4 already apply this rule; it never occurs in the dataset (minimum income 9.16, minimum expenses 9.93).
3. **Recursion and clip:** forecast 6 months, append each prediction to the history before the next one, and clip negatives to 0. Round to 2 decimals only after the recursion.
4. **Do not retrain or re-export.** Every run of `train_models.py` changes `trained_at` and therefore the SHA-256. The file to deploy is the one with the hash above (or the one recorded in Phase 4's `test_report.json`, if it ever differs).

## 6. What you must do, step by step

**Step 1. Create the `erp-port` branch from `develop`** (after the Phase 1-3 Pull Requests are merged, if possible):
```
git checkout develop
git pull origin develop
git checkout -b erp-port
git push -u origin erp-port
```

**Step 2. Copy only clean code from the ERP.**

| Copy | Destination | Notes |
|---|---|---|
| `backend/` | `backend/` | Without `.venv*`, `.env`, `instance/`, `__pycache__`, `.pytest_cache` |
| `frontend/` | `frontend/` | Without `node_modules*` and `dist/`. The folder `node_modules_incompatible_otro_pc` is NOT covered by the ERP `.gitignore` |
| `ml/train.py`, `ml/sources/`, `ml/requirements.txt`, `ml/README.md` | `ml/company_trainer/` | Our `ml/src/`, `ml/data/` and `ml/artifacts/` already exist. Fix the paths inside `train.py` |
| `docs/*.md`, `docs/evidence` | `docs/erp/` | Our docs use `01_` to `07_` names and `docs/phases/` |
| `render.yaml`, `compose.yaml`, `docker/`, `.github/`, `.vscode/` | repository root | Review the CI workflow |
| `README.md` | repository root | Replace it after Step 16 |

**Do NOT copy:** the zip's own `.git`, `.venv*`, `node_modules*`, `backend/.env`, `.env.docker` (keep only `.env.docker.example`), `backend/instance/dev.db`, `ml/data/raw/` (the DIAN license is uncertain and the ERP decisions say not to redistribute it), `PROTOTIPO_ALERTA_FISCAL.zip`, `Guia_Pruebas_Locales_AlertaFiscal.docx`, the PDF, `session_checkpoint.md`. Add `node_modules*/` to `.gitignore`.

Notes on the `.gitignore` already on `erp-port` (review of November 3, 2026):
- It ignores `.vscode/`, but the table above says to copy `.vscode/`. Decide one: either remove `.vscode/` from `.gitignore` and commit it, or do not copy it and remove it from the table.
- It does **not** ignore the PDF or `session_checkpoint.md`. Do not copy them (or add them to `.gitignore`). The `.docx`, the zips, `.env.docker` (only `.env.docker.example` is allowed), `dev.db`, `instance/` and `ml/data/raw/` are already ignored.
- Commit by folder (`git add backend/ frontend/`), never `git add .`, and run `git status` before committing to check that nothing forbidden appears.

**Step 3. Move the old Flask site** (`app.py`, `templates/`, `static/` and the old root `requirements.txt`) to `legacy_flask_site/`. Do not delete it.

**Step 4. Run the tests and make them pass.** Expected: 38 passed and 10 skipped on SQLite. Then run `npm ci && npm run build` in `frontend/`. Fix only what the move broke (paths in `train.py`, `FORECAST_ARTIFACT_DIR`). Commit and open a Pull Request from `erp-port` into `develop`, and ask Manuel or Sergio to review it.

**Step 5. Traceability matrix** (`docs/erp/traceability_base_vs_ported.md`). Compare the base ERP with the ported one. Columns: item (module, endpoint, table, migration, test), base, ported, status (kept, changed, added or removed), evidence (test name). Claude can build the first version from the two folders. The technical review requires it.

**Step 6. Translate to English** (the professor requires English deliverables). About 700 lines: the frontend (`App.tsx` and one more file), backend messages, tests, `docs/erp/`, `ml/company_trainer/`, the demo seed names, and the 12 uses of the `es-CO` locale (use `en-US` with currency COP). **Keep every error `code` value unchanged** (for example `insufficient_history` and `model_not_trained`). Translate only the messages. Run all tests after each group of changes. One Pull Request.

**Step 7. Backend changes in `forecasting.py`** (the model integration):
1. Accept `scope: "global"` artifacts: do not require `company_id` or a training `history`.
2. `load_artifact(company_id)`: look first for the company's own artifact, then for `model_global.json`.
3. Support `feature_spec.normalization` in `predict_target`.
4. Read `min_history_months` from the artifact (6) instead of only `lags + 1`.
5. Put `scope`, `artifact_sha256` and `is_demo` in `assumptions`, so every `ForecastRun` shows which file produced it. Keep `model_version`.

**Step 8. Behavior rules in the planning route.**
- Read the company's recorded income and expense documents and group them by month (the ERP already does this in `monthly_history`: cancelled documents are excluded and empty months count as zero).
- Fewer than 6 months: return `insufficient_history` with the number of months available, and keep manual mode.
- Otherwise run the model, save a `ForecastRun` with the method, model version, monthly values and history signature, and record the audit event.
- The stored `method` must be one that the `ForecastRun` constraint accepts (`manual`, `linear`, `random_forest`, `mlp`, `seasonal_naive`). The ERP migrations already allow them; if you add anything new, add a migration.
- Never let a model error break the ERP screens. Any forecast problem returns a clear message and manual mode stays available.

**Step 9. Artifact location.** `ml/artifacts/` is in `.gitignore` and Render builds from `backend/` (`rootDir`), so the file would not exist in production and the app would answer `model_not_trained`. Set the default `FORECAST_ARTIFACT_DIR` to `backend/model_artifacts/`, commit that folder (small JSON files only) and add a `.gitignore` exception for it.

**Step 10. Placeholder artifact (November 6, 2026).** Create a `model_global.json` with `seasonal_naive` (the backend already supports it) and `model_version: "placeholder-baseline"`. This gives the whole team a working skeleton before Jonathan finishes. Replace it later.

**Step 11. Tests** in `backend/tests/test_forecasting_ml.py` (new tests next to the existing ones):
- the global artifact is used when the company has none, and the company artifact wins when both exist;
- fewer than 6 months returns `insufficient_history`;
- an invalid or unsupported artifact returns `artifact_invalid`;
- **parity:** load `parity_cases.json` and compare with the backend (maximum relative difference 1e-6);
- **hash:** the deployed `model_global.json` has the SHA-256 recorded in Manuel's `test_report.json`.

**Step 12. Demo data command.** A command that loads about 5 holdout companies of different sectors from `monthly_series.csv` into the ERP as monthly income and expense documents, plus one company with 4 months to show manual mode. Label them as semi-synthetic. This data is also used by Sergio's tests.

**Step 13. Real model (November 10-12, 2026; the file is available since November 3).** Copy Jonathan's `model_global.json` and `parity_cases.json` from `phase3/modeling` into `backend/model_artifacts/` (Step 9). Verify the SHA-256 against section 5.1 and against Phase 4's `test_report.json`. Run all tests. Do not edit the file by hand: any change breaks the evaluation.

**Step 14. Alerts.** Implement Sergio's loss-month rule (`docs/03_alert_rules.md`) in `alerts/rules.py`, with its tests.

**Step 15. Supabase and Render (November 13-15, 2026).**
- Create the Supabase project (you own it) and copy the pooled connection string. Never commit it.
- In Render set `DATABASE_URL`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL` and the secrets in the panel (`sync: false`).
- Deploy the backend as a web service and the frontend as a static site, following `render.yaml`.
- Run the migrations once against Supabase and the demo data command.
- Check `/health/ready`. Test end to end: login, a company with a forecast, the company with 4 months (manual mode), alerts, and that the model version and date are shown.

**Step 16. README and handover.** Rewrite the root `README.md` in English: what the product is, how to run it locally, how to deploy it, how the ML module works. Give Sergio a short handover note (November 10, 2026 for the skeleton, November 15, 2026 for the deployed app): where forecasts are stored, how actual values are read (`monthly_history`), the deployed URL, and how to roll back (previous artifact in Git, redeploy the previous commit).

## 7. What you must NOT do
- Do not rewrite the ERP from scratch. Copy, clean and adapt.
- Do not import scikit-learn or joblib in the backend.
- Do not edit `model_global.json` by hand or after Manuel evaluated it.
- Do not require a form with 12 fields. Inputs come from the company's own history.
- Do not forecast with fewer than 6 months of history (return "insufficient history" and offer manual mode).
- Do not store monitoring data in local files.
- Do not delete the old Flask site. Move it to `legacy_flask_site/`.
- Do not commit `.env`, passwords, the Supabase connection string, `dev.db`, `node_modules*`, `.venv*` or `ml/data/raw`.
- Do not use `company_profiles.csv`, `test` or `holdout` rows to tune or "fix" the model during integration.
- Do not translate error `code` values.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish. The website, code comments and commits are in English.

## 8. Deliverables
- `erp-port` merged: ERP running locally with tests passing, old site in `legacy_flask_site/`.
- ERP translated to English, error codes unchanged.
- Backend changes for the global model, with tests (parity and hash included).
- Placeholder artifact first, real artifact after.
- Demo data command.
- `docs/erp/traceability_base_vs_ported.md`.
- App deployed on Render with Supabase.
- English `README.md` and the handover note for Sergio.

## 9. Work plan

| Date | Task |
|---|---|
| November 3-4, 2026 | Steps 1-4: ported ERP, tests passing, Pull Request |
| November 4-5, 2026 | Steps 5-6: traceability matrix and translation |
| November 5-6, 2026 | Steps 7-11: backend changes, placeholder artifact, tests |
| November 9-10, 2026 | Steps 12 and 14: demo data and alerts; receive the artifact |
| November 10-12, 2026 | Step 13: real model and hash check |
| November 13-15, 2026 | Steps 15-16: deployment, README and handover |

## 10. Git workflow
```
git checkout erp-port
git pull origin erp-port
git add backend/ frontend/
git commit -m "feat: port ERP backend and frontend"
git push origin erp-port
```
Commit examples: `chore: move legacy flask site`, `chore: translate ERP to English`, `feat: support global forecast artifact`, `test: add artifact parity and hash tests`, `feat: add demo data command`, `chore: configure render deployment`. Add files by folder or name, never `git add .`. Work after the port goes in `phase5/flask-api` and ends in a Pull Request into `develop`.

## 11. Common problems

| Problem | What to do |
|---|---|
| Tests fail after copying | Check the Python version, `requirements.txt` and the paths to `ml/` |
| `model_not_trained` in production | The artifact is not committed or the directory variable is wrong (Step 9) |
| Parity test fails | Compare the features one by one: `t` starts at 0, normalization, clip at zero, rounding. Check the float32 cast before the trees (section 5.1) |
| `model_type` or `coef` not found in the artifact | The export uses `selected_model` and `models[...].params` (`coefficients` for linear). See section 5.1 |
| Translation breaks a test | A message text was asserted. Update the test, not the `code` |
| Frontend cannot reach the API | Check `VITE_API_BASE_URL` and `FRONTEND_ORIGIN` (CORS and cookies) |
| First request takes a minute | Render free plan cold start. Open the app before the demo |
| Supabase refuses the connection | Use the pooled connection string and check the password |
| Files are lost after a deploy | Something was written to disk. Store data in PostgreSQL |

## 12. Definition of done
- [ ] ERP runs locally, 38 tests pass, the frontend builds, and nothing forbidden is in Git.
- [ ] The traceability matrix base vs ported exists.
- [ ] The ERP is in English and the error codes are unchanged.
- [ ] The global artifact works with company override, the 6-month minimum, and the parity and hash tests.
- [ ] The deployed app works end to end and shows the model version and date.
- [ ] Sergio has the handover note.

## 13. What you must be able to explain at the final presentation
- What the ERP is, that it was generated with an AI tool, and that the team reviewed it.
- How a forecast is made step by step, and why Flask has no scikit-learn.
- The global model as default, the per-company override and the 6-month rule.
- How we prove the deployed model is the evaluated one (SHA-256).
- Deployment: Render, Supabase, environment variables and rollback.
- Likely professor questions: "Why a global model?", "What happens with a new company?", "How do you know the app uses the model you evaluated?".

## 14. If you get stuck
Ask Claude for the exact code of each step and for its explanation. Manuel or Sergio review and test. Jonathan answers about the artifact.
