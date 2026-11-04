# Phase 6 — Retraining and Rollback

- **Owner:** Sergio Steeven Moreno Forero
- **Applies to:** the global model `backend/model_artifacts/model_global.json` (version `global-20261103-84df89b5`) and any company model `model_company<id>.json`.

Monitoring ([`06_monitoring.md`](06_monitoring.md)) only raises a status. This document says what people do with it. No step here is automatic: the app never retrains or replaces a model by itself.

## 1. When to act

| Situation | Action |
|---|---|
| A company is `watch` | No model change. The accountant checks the company's recent documents (missing months, duplicated invoices, a real change in the business). |
| A company is `degraded` for **2 consecutive closed months** | Review. If the data is correct, consider a **company model** for that company (section 3.2). |
| **20 % or more** of the monitored companies are `degraded` at the same time, or the median rolling error of all companies is above 1.5 × reference | Review the **global model** (section 3.1): this points to drift that affects everyone, not to one company. |
| A forecast returns `artifact_invalid` or `model_not_trained`, or the deployed SHA-256 is not the evaluated one | **Roll back** at once (section 4). Users can keep working with manual mode meanwhile. |
| A new model version gives worse forecasts after deployment | **Roll back** (section 4). |

Two consecutive months are required because a single bad month is expected: Phase 4 shows that horizons +5 and +6 (November and December) are naturally 45–70 % worse than +1.

## 2. Who decides

| Role | Responsibility |
|---|---|
| Company accountant (`contador`) | Checks the data of a company in `watch` or `degraded` and reports it. |
| Model owner (Phase 3, Jonathan Alejandro Yacuma Rivera) | Retrains and exports a new artifact. |
| Evaluator (Phase 4, Manuel Eduardo Alarcon Aza) | Runs the evaluation protocol on the new artifact and gives the verdict. |
| Integration owner (Phase 5) | Deploys the accepted artifact and, when needed, rolls back. |
| Monitoring owner (Phase 6, Sergio Steeven Moreno Forero) | Watches the statuses, opens the review and updates the reference if a new model is accepted. |

A new global model goes to production only with an **accepted** verdict from the evaluator. Nobody deploys a model they evaluated themselves without a second person reviewing the report.

## 3. How a new model is produced and validated

### 3.1 Global model

1. Train offline with the Phase 3 pipeline (`ml/src/train_models.py`, then `ml/src/export_artifact.py`) on a branch, never on the web server.
2. Respect the backend contract: random forest, linear regression or seasonal naive only; at most 100 trees, depth 8, file under 5 MB; features `t, month_sin, month_cos, lag1, lag2, lag3`; normalization `mean_last_n` with n = 3.
3. **Parity test:** `ml/src/check_export_parity.py` must give a maximum relative difference ≤ 1e-6 against scikit-learn, and the backend test `test_parity_with_scikit_learn` must pass with the new `parity_cases.json`.
4. **Evaluation:** follow `docs/04_evaluation_protocol.md`. Write and tag a new protocol version first if anything changes. Evaluate on months and companies the new model never saw. The same acceptance checks apply (C1 MAE ≤ 0.90 × baseline, C2 median normalized MAE ≤ 15 %, C3 P90 ≤ 30 %).
5. Record the new SHA-256 in the evaluation report and in `test_forecasting_ml.py` (`EVALUATED_SHA256`, `EVALUATED_VERSION`).
6. Update the monitoring reference (`REFERENCE_NORMALIZED_ERROR_PCT` in `monitoring/service.py`) to the new holdout medians. Old monitoring rows keep their `model_version`, so the two versions stay distinguishable.

### 3.2 Company model

1. Run `ml/company_trainer/train.py` for that company (see `ml/company_trainer/README.md`). It uses a time-based split and compares against the seasonal naive baseline.
2. Accept it only if it beats the baseline on its own test months **and** beats the global model's error for that company.
3. Copy `model_company<id>.json` to the artifact directory. The backend uses it in place of the global model for that company only.

## 4. How to roll back

The previous model is always recoverable because **every deployed artifact is committed to Git** (`backend/model_artifacts/`, marked `-text` in `.gitattributes` so its bytes and SHA-256 never change on checkout) and every evaluated version has a tag (the current one is `eval-final-run`).

**Global model:**

1. Find the last good commit: `git log --oneline -- backend/model_artifacts/model_global.json`.
2. Restore the file on a branch: `git checkout <good-commit> -- backend/model_artifacts/model_global.json backend/model_artifacts/parity_cases.json`.
3. Check the hash: `python -c "import hashlib;print(hashlib.sha256(open('backend/model_artifacts/model_global.json','rb').read()).hexdigest())"` must match the evaluation report of that version.
4. Run `python -m pytest -q` in `backend/`, open a Pull Request into `develop` and merge it to `main`. Render redeploys automatically.
5. **Faster option** when the whole release is bad: in the Render dashboard, open `alertafiscal-backend`, choose the previous successful deploy and select *Rollback*. This only changes the code; the database is not touched.

**Company model:** delete `model_company<id>.json` from the artifact directory (or restore the previous one from Git). The company falls back to the global model immediately.

**What a rollback does not undo:** stored forecast runs and monitoring rows are history and stay as they are, each with the `model_version` that produced it. A database migration is only reverted with `flask db downgrade` if the release added one; the monitoring migration `d4e8a1b2c3f5` only adds tables, so a code rollback does not need it.

## 5. Where previous versions are stored

| What | Where |
|---|---|
| Model files | Git history of `backend/model_artifacts/` and `ml/artifacts/`; tag `eval-final-run` for the current evaluated model |
| Evaluation of each version | `ml/artifacts/test_report.json` and `docs/04_evaluation_report.md` at that tag |
| Deployed code | Render deploy history (rollback button) |
| Forecasts and monitoring | PostgreSQL tables `forecast_runs` and `forecast_monitoring`, with `model_version` on every row |

## 6. After any change

1. Create a model forecast for one demo company and check in the response that `model_version` and `artifact_sha256` are the expected ones.
2. Open History → Monitoring and confirm that new rows carry the new version.
3. Write the change (date, old and new version, reason, who approved it) in the Pull Request description.
