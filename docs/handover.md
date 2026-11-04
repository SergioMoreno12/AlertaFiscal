# Handover

State of the project on November 3, 2026, and what is left to close it.

## 1. Branches and merge order

Merge the Pull Requests into `develop` in this order. `phase6/monitoring` contains all the others. `phase5/flask-api` contains `erp-port` and carries identical copies of the Phase 4 files it needs (`.gitattributes`, `ml/artifacts/test_report.json`), so it merges after `phase4/evaluation`. The only expected conflict is in `.gitignore`: keep both blocks (the ERP block and the `level_shift_analysis.json` line).

| Order | Branch | Content |
|---|---|---|
| 1 | `erp-port` | ERP ported from AlertaFiscalBeta and translated to English; trainer paths fixed; backend tests restored in CI; Render, Docker and CI configuration |
| 2 | `phase4/evaluation` | Official evaluation (`eval-final-run`), evaluation report, level shift diagnostic, `.gitattributes` for artifacts |
| 3 | `phase5/flask-api` | Global model in the backend, parity and hash tests, `flask demo-load`, alert A1, model details in the Forecasts screen |
| 4 | `phase6/monitoring` | Monitoring tables, service, endpoint and screen; retention purge; Phase 6 documents; traceability matrix; final report; this README |

Then `develop` → `main`, which is the branch Render deploys.

CI runs on every Pull Request. It runs the backend tests (including the 10 PostgreSQL tests skipped locally), the migrations, and the frontend build. **The frontend build has not been run locally**, because Node.js was not installed on the machine used for Phases 5 and 6. Check the frontend step in CI on the first Pull Request.

## 2. Deployment

**Done on November 4, 2026.** Backend: https://alertafiscal-backend-h4ip.onrender.com (`/health/ready` returns `ready`). Frontend: https://alertafiscal-frontend-wyyn.onrender.com. Database: Supabase project **AlertaFiscal**, schema `alertafiscal_scratch`, migrated to `d4e8a1b2c3f5`, with the demo companies loaded for `demo@alertafiscal.app`. Test case 14 passed.

Steps used (repeat them for a new environment):

1. Set `DATABASE_URL` and `DB_SCHEMA=alertafiscal_scratch` locally (never commit them), then run `flask db upgrade`. This adds the monitoring tables (`d4e8a1b2c3f5`).
2. Run `flask demo-load --email <demo user>`. It is idempotent and adds the labeled demo companies.
3. In Render, create the Blueprint from `render.yaml` and set:
   - backend: `DATABASE_URL`, `DB_SCHEMA` and `FRONTEND_ORIGIN`;
   - frontend: `VITE_API_BASE_URL`.
4. Check `/health/ready`, sign in, create a model forecast for a demo company, and open History → Monitoring.
5. Run test case 14 (redeploy keeps the monitoring data) and write the result in `docs/06_test_cases.md`.

Full steps: `docs/erp/deployment.md`, section 9.

## 3. Known open points

- `docs/03_alert_rules.md` says A6 needs 12 months of history; the model and the app use 6 (Phase 3 decision). The final report explains it.
- Internal identifiers of the frontend are still Spanish names (`nombre`, `tamaño`, screen ids such as `proyecciones`). They are code, not user-facing text; renaming them is optional.
- The JSON manifests of the external context sources keep their original Spanish notes as data records.
- Monitoring uses the Phase 4 holdout medians as reference. Recalibrate them if real company data is ever used.

## 4. Presentation (November 18, 2026)

Questions to prepare, with the document that answers each:

| Question | Where |
|---|---|
| What happens when the model gets worse? | `docs/06_retraining_and_rollback.md` |
| What if the model file is missing? | `docs/06_test_cases.md`, case 12 |
| What if the company has little data? | Cases 1 and 4; manual mode |
| How did you test it? | `docs/06_test_cases.md` |
| Why normalized error and why those thresholds? | `docs/06_monitoring.md`, sections 3 and 4 |
| Is the evaluation honest? | `docs/04_evaluation_protocol.md` (tagged before the run), `docs/04_leakage_review.md` |
