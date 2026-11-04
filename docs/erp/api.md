# REST API (`/api/v1`)

- Format: JSON, UTF-8.
- Authentication: session cookie + `X-CSRF-Token` on mutating methods.
- Amounts: decimal strings (`"1190000.00"`).
- Timestamps (`created_at`, `updated_at`): ISO-8601 with time zone (`"2026-10-01T15:04:05+00:00"`).
- Calendar dates (`issue_date`, `due_date`, `cutoff_date`): day only (`"2026-10-01"`). They are not sent as UTC midnight, so a client at UTC−5 does not show the previous day.
- Errors: `{"error": {"code": "...", "message": "...", "request_id": "..."}}`. Error `code` values are stable identifiers; only the `message` is human text.
- Pagination: `?page=1&page_size=20` (at most 100).

## Health

| Method | Route | Description |
|---|---|---|
| GET | `/health/live` | Process alive. |
| GET | `/health/ready` | Checks the database; returns `database` (`postgresql` or `sqlite-dev`) and `demo` (`true` only if SQLite was enabled explicitly). Answers `503` if the database does not respond. |

## Authentication

| Method | Route | Description |
|---|---|---|
| GET | `/auth/csrf` | Issues a CSRF token (body + cookie). |
| POST | `/auth/login` | `{email, password}` → user + `csrf_token`. |
| POST | `/auth/logout` | Revokes the current session. |
| GET | `/auth/me` | User and companies (memberships). |
| GET | `/auth/sessions` | Active sessions of the user. |
| DELETE | `/auth/sessions/{id}` | Revokes one of the user's sessions. |
| POST | `/auth/password-reset/request` | Generic answer; it does not reveal whether the email exists. |

Sign-in example:

```http
POST /api/v1/auth/login
Content-Type: application/json
X-CSRF-Token: <token>

{"email": "maria.gomez@contaduria.co", "password": "demo2026"}
```

```json
{
  "user": {
    "id": 1,
    "email": "maria.gomez@contaduria.co",
    "full_name": "Maria Gomez",
    "companies": [{"id": 1, "name": "Andean Trading S.A.S.", "nit": "900.456.123-1", "role": "admin"}]
  },
  "csrf_token": "..."
}
```

## Companies and dashboard

| Method | Route | Role |
|---|---|---|
| GET | `/companies` | authenticated |
| GET | `/companies/{id}` | member |
| GET | `/companies/{id}/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` | member |

The dashboard returns `totals`, `monthly`, `alerts.open`, `obligations` and `plan` (target/recorded/coverage).

## Movements

| Method | Route | Minimum role |
|---|---|---|
| GET/POST | `/companies/{id}/income` | member / auxiliar |
| GET | `/companies/{id}/income/{income_id}` | member |
| GET/POST | `/companies/{id}/expenses` | member / auxiliar |
| PATCH | `/companies/{id}/expenses/{expense_id}` | contador |
| POST | `/companies/{id}/receipts` | auxiliar |
| POST | `/companies/{id}/payments` | auxiliar |
| GET/POST | `/companies/{id}/counterparties` | member / auxiliar |

```json
POST /api/v1/companies/1/income
{
  "doc_number": "FV-001",
  "issue_date": "2026-10-01",
  "description": "Sale of goods",
  "subtotal": "1000000.00",
  "tax_amount": "190000.00",
  "total": "1190000.00",
  "status": "pending"
}
```

`total` is optional: if it is omitted, `subtotal + tax_amount` is used. A repeated document in the same company returns `409 duplicate_document`.

## Planning

| Method | Route | Minimum role |
|---|---|---|
| GET/POST | `/companies/{id}/fiscal-parameters` | member / contador |
| GET/POST | `/companies/{id}/plans` | member / contador |
| GET | `/companies/{id}/plans/{plan_id}` | member |
| POST | `/companies/{id}/plans/{plan_id}/versions` | contador |
| POST | `/companies/{id}/plans/{plan_id}/versions/{version_id}/review` | contador |
| GET/POST | `/companies/{id}/reserve-entries` | member / contador |
| GET/POST | `/companies/{id}/forecasts` | member / contador (GET lists the stored runs) |
| POST | `/companies/{id}/forecasts/model` | contador |

A `reviewed` version cannot be reviewed again (`409`). `POST /forecasts` (manual mode) with less than 3 months of history answers `200` and `{"available": false, "reason": "..."}`; it does not make up data. With history it returns the manual estimate with a `disclaimer`.

`POST /forecasts/model` runs the model artifact on the company's monthly history and stores a `ForecastRun`. If the model cannot run it answers `200` with `available: false`, an error `code` (`model_not_trained`, `artifact_invalid`, `insufficient_history`) and a `reason`; manual mode stays available.

### Plan and versions

`estimated_reserve` is the **reserve target set by the accountant**. It is not derived from `projected_income - projected_expenses` and it is not an assessed tax. If it is omitted, the server stores `0.00`; negative values are rejected with `422`.

```json
POST /api/v1/companies/1/plans
{
  "name": "Reserve plan Oct 2026",
  "period": "2026-10",
  "projected_income": "55000000.00",
  "projected_expenses": "37000000.00",
  "estimated_reserve": "4500000.00",
  "assumptions": {"source": "manual"},
  "notes": "Review with the accountant before the close."
}
```

`POST /plans` creates the plan and its version `1`. `POST /plans/{id}/versions` accepts the same body without `name`/`period` and creates the next version. `POST .../review` marks the version as `reviewed` (immutable). The dashboard exposes the current version in `plan` with `projected_income`, `projected_expenses`, `estimated_reserve`, `reserved` and `coverage_percent`. The missing amount is computed in the client as `max(estimated_reserve - reserved, 0)`.

## Tracking and alerts

| Method | Route | Minimum role |
|---|---|---|
| GET | `/companies/{id}/obligations` | member |
| POST | `/companies/{id}/obligations` | contador |
| PATCH | `/companies/{id}/obligations/{obligation_id}` | contador |
| GET | `/companies/{id}/audit` | contador |
| GET/POST | `/companies/{id}/alerts` | member / contador |
| POST | `/companies/{id}/alerts/evaluate` | contador |
| GET/PATCH | `/companies/{id}/alerts/{alert_id}` | member / contador |
| POST | `/companies/{id}/alerts/{alert_id}/comments` | member |

Stored enum values keep their original codes: priorities `alta` (high), `media` (medium), `baja` (low); origins `erp`, `plan`, `configuracion`, `proyeccion`; roles `admin`, `contador` (accountant), `auxiliar` (assistant).

## Error codes

| HTTP | `code` | When |
|---|---|---|
| 401 | `unauthorized` / `invalid_credentials` | No session or wrong credentials. |
| 403 | `forbidden` / `csrf_failed` | Another company, insufficient role or invalid CSRF. |
| 404 | `not_found` | Resource does not exist inside an authorized company. |
| 409 | `duplicate_document` / `invalid_state` | Duplicate or transition not allowed. |
| 422 | `invalid_payload` | Invalid date, amount or enum. |
| 429 | `too_many_attempts` | Sign-in limit exceeded. |
| 500 | `server_error` | Unhandled error (logged with `request_id`). |
