# Phase 6 — Privacy and Retention of Monitoring Data

- **Owner:** Sergio Steeven Moreno Forero
- **Scope:** the tables `forecast_monitoring` and `forecast_service_events` added in Phase 6. The rest of the ERP is covered by `docs/erp/security.md`.

## 1. What is stored

| Table | Data | Personal data? |
|---|---|---|
| `forecast_monitoring` | Company id, forecast run id, target (`income` or `expenses`), month, predicted and actual **monthly totals**, errors, status, model version, dates | No. Only aggregated monthly amounts of a company. No names, tax ids, invoice numbers, clients, suppliers or user ids. |
| `forecast_service_events` | Company id, outcome code, latency in milliseconds, model version, date | No. It does not store the user, IP address, request body or response. |

The monthly totals are already in the ERP (they are the sum of the company's documents); monitoring stores a copy of the total at the moment of the forecast so later edits do not rewrite the past.

Not stored anywhere by monitoring: log files, local files, raw documents, request headers. Errors are logged by the ERP's normal logger without amounts.

## 2. Who can read it

- Through the API, `GET /api/v1/companies/{id}/monitoring` is available to **members of that company only** (any role: `admin`, `contador`, `auxiliar`), using the same `authorized_company` check as the rest of the ERP. A user who is not a member gets HTTP 403 (case 15 of [`06_test_cases.md`](06_test_cases.md)).
- The endpoint is read-only. No role can edit monitoring rows from the app.
- Direct database access is limited to the project's database administrators through the Supabase dashboard. The connection string is kept only in the `DATABASE_URL` environment variable on Render and in local `.env` files that are never committed.
- The browser never connects to the database; Supabase's public APIs and keys are not used.

## 3. How long it is kept

| Data | Retention | Why |
|---|---|---|
| `forecast_monitoring` rows | **24 months** after the forecast month | Two full seasonal cycles: enough to compare a model version with the previous one in the same months of the year and to justify a retraining decision. |
| `forecast_service_events` rows | **90 days** | Operational data is only useful to diagnose recent problems (latency, failures). |
| Everything of a company | Deleted with the company | Both tables use `ON DELETE CASCADE` on `company_id`. |

The purge is a controlled command, not an automatic job:

```bash
cd backend
flask monitoring-purge --dry-run   # counts what would be deleted
flask monitoring-purge             # deletes it
```

It is run monthly by the integration owner (it can be scheduled later as a Render cron job). It deletes only rows older than the limits above (`purge_expired` in `monitoring/service.py`, test `test_purge_removes_only_data_older_than_the_retention`).

## 4. Data used in this project

All companies in the app are demonstration companies built from the semi-synthetic Phase 2 dataset (`flask demo-load`), clearly labeled as such. The real public data behind it (Supersociedades and DIAN) contains no personal data in the files used, and real tax ids were never written to any output (`docs/02_dataset_report.md`, section 7).

If the app is used with real companies in the future:

- The company (data controller) must authorize the processing of its figures, in line with Colombia's personal data law (Law 1581 of 2012) when any data could identify a natural person (for example a sole proprietor).
- Monitoring data must stay in the same database and region as the rest of the ERP data.
- A company that leaves the service is deleted with its data, including monitoring.
