# PHASE 5 — ERP Port, Integration and Deployment

- **Owner:** Samuel Castellanos Rivera (support: Manuel and Sergio)
- **Branches:** `erp-port` (copy and adapt ERP code) and `phase5/flask-api` (ML integration)
- **Deadline:** integrated skeleton with stub model on November 10, 2026; deployed on November 15, 2026

## Goal
Port the AlertaFiscalBeta ERP (backend, frontend, tests, migrations), plug in the forecasting model, and deploy to Render with Supabase PostgreSQL.

## Must NOT
- Rewrite the ERP from scratch; copy and adapt.
- Require a 12-field user form: inputs come from the company's own history.
- Forecast with fewer than 6 months of history (return "insufficient history" and offer manual mode).
- Store monitoring data in local files.
- Delete the old Flask site; move it to `legacy_flask_site/`.

