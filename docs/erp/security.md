# Security

## Threat model (academic scope)

Assets: credentials, sessions, per-company financial data and tax plans. Adversaries considered: an authenticated user of another company, a network attacker (MITM), an external site attempting CSRF, a client tampering with IDs in the API, and accidental exposure of the database through the provider's services.

Out of scope: formal audit, pentest, PCI compliance, DIAN integration.

## Authentication

- Passwords with **Argon2id** (`argon2-cffi`), parameters `time_cost=2`, `memory_cost=65536` (64 MiB), `parallelism=2`. If `argon2-cffi` is not installed, the system falls back to Werkzeug's `scrypt` and records it in `PASSWORD_SCHEME`.
- Sign-in returns the same message (`Invalid credentials`) whether or not the email exists.
- Attempt limit: 10 per 15-minute window per IP + email (`429`). **Limitation:** the counter lives in the process memory. With several replicas or restarts it resets; for real production it must move to Redis or the database.
- There is no self-registration: users are created with `flask create-admin` or by an admin.

## Sessions

- **HttpOnly** session cookie, `Secure` in production, configurable `SameSite` (`Lax` locally, `None` for frontend and API on different domains).
- The session token is random (`secrets.token_urlsafe(32)`) and stored **hashed** (SHA-256) in the `sessions` table; a token stolen from a dump cannot be reused.
- Idle expiry (`SESSION_IDLE_MINUTES`, default 120) and absolute expiry (`SESSION_ABSOLUTE_HOURS`, default 12).
- Sign-in rotates the session: any previous session of the cookie is revoked.
- Users can list and revoke their sessions (`/api/v1/auth/sessions`).
- The authentication state is **not** stored in `localStorage` or `sessionStorage`.
- `SECRET_KEY` is required in production, with at least 32 characters and no example values. The backend refuses to start if it is missing or weak.

## CSRF

Signed *double submit* pattern:

1. The client calls `GET /api/v1/auth/csrf`.
2. The server returns the token in the body and in the `af_csrf` cookie (readable by JS).
3. Every `POST/PUT/PATCH/DELETE` request to `/api/*` must send `X-CSRF-Token`.
4. The server compares the header, the cookie, the HMAC signature and the hash linked to the session.
   When a signed-in browser asks for a new token (step 1), that token replaces the one linked to its
   session. A signed token issued to anyone else is still rejected.
   Login and logout skip only the session link: a stale session cookie left by a failed logout would
   otherwise block the next sign-in. They still need the signed token in both the header and the cookie.

Other request limits: JSON bodies over 1 MB are rejected with `413`, malformed requests keep their
HTTP status (they are never turned into `500`), and amounts above the `Numeric(18, 2)` range or
non-numeric percentages answer `422`. Login verifies a dummy hash for unknown emails, so the response
time does not reveal which accounts exist. Forecast error details name the artifact file, never the
server path.

The frontend keeps the token in memory. If the page reloads, a new one is requested (the frontend
and the API are on different domains in production, so the page cannot read the cookie). If a write
answers `csrf_failed` because the token went stale (for example, another tab asked for a new one),
the client asks for a fresh token once and repeats the request. Requests without a token are rejected with `403 csrf_failed` **before** the view runs.

## Authorization and multi-company isolation

- Roles in the database: `admin` > `contador` (accountant) > `auxiliar` (assistant).
- Every route with `company_id` calls `authorized_company()`: it checks that the company exists, that the user has an **active** membership and, when needed, the minimum role.
- Queries always filter by `company_id`; an ID of another company returns `403` (not `404`, so existence is not confirmed).
- The tests `tests/test_isolation.py` and `tests/test_postgres_integration.py` try to reach another company through detail, dashboard and income.

**Supabase does not replace these checks.** Multi-company isolation is still validated in Flask, with SQLAlchemy and the application's database role.

## CORS and headers

- Allowed origins: `FRONTEND_ORIGIN` + `CORS_ORIGINS` (explicit list). Never `*`.
- `Access-Control-Allow-Credentials: true` only for origins in the list.
- Response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and HSTS when the cookie is `Secure`.
- `X-Request-ID` per request to correlate logs.

## Database: modes and credentials

- PostgreSQL is the normal mode. SQLite requires an explicit `DB_MODE=sqlite`, only for demos or tests, and is forbidden in production.
- In production `DATABASE_URL` is required; startup fails without it.
- Connection URLs are never printed in logs, responses or error messages. Supabase passwords are percent-encoded in the URL; they are never concatenated by hand.
- The pool is bounded (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, timeout and recycle) so the provider's connections are not exhausted.
- TLS: on Supabase use at least `sslmode=require`; to verify the server, `verify-full` with the root certificate downloaded from the dashboard. TLS is never disabled to work around errors.
- The runtime credential should have minimum privileges (DML and sequences). Migrations can use a separate, more privileged credential.

## Supabase as a PostgreSQL provider

Architecture: **browser → Flask → Supabase PostgreSQL**. The browser never receives a connection string or a database key.

Rules:

1. **Disable the Data API** if Flask is the only client. Without the Data API there are no automatic REST or GraphQL endpoints on the ERP tables.
2. **Do not use** Supabase Auth, `supabase-js`, or the `anon`, `service_role`, `sb_publishable_*` or `sb_secret_*` keys in the frontend. No `VITE_*` variable holds database credentials.
3. **Do not assume RLS protects the backend.** Flask's connection role can have privileges that skip RLS; the company checks stay in the backend.
4. If the Data API is ever enabled, the exposed tables must have RLS and reviewed privileges. Tables in `public` can receive automatic grants to `anon`/`authenticated` depending on the project settings; check them and revoke them if unused.
5. Prefer a **dedicated, non-exposed schema** for the ERP. The app supports `DB_SCHEMA` (applied with `SET search_path` on every connection, with no fallback to `public`), but the schema and its privileges must be created before migrating.
6. The direct connection is preferred for a persistent backend with IPv6; the shared pooler in session mode is the IPv4 alternative. Do not use transaction pooling by default: it does not support prepared statements.
7. The destructive test suite only runs against a local database (`localhost`) and never reads `backend/.env`, so it cannot reach Supabase.

## Audit

Every relevant operation writes an `AuditEvent` with company, actor, action, resource, detail and `request_id`: sign-in/sign-out, income and expense creation, receipts, payments, plan changes, reserves, obligations, alerts, comments and model forecasts (`forecast.model_run`). The history is read at `GET /api/v1/companies/{id}/audit` (role `contador` or higher).

## Input validation

- Amounts: `Decimal` with 2 decimals, not negative, converted to strings in the response.
- Dates: `YYYY-MM-DD` (`YYYY-MM-DDTHH:MM:SS` is also accepted).
- Enums validated on the server (`status`, `priority`, `origin`, `kind`, `unit`, `role`).
- Lengths bounded per column; free text is truncated.
- Duplicate documents per company return `409` (unique constraint in the database).
- On PostgreSQL, foreign keys, uniqueness and `CHECK` constraints are enforced by the engine; the integration tests check it.

## Recommendations before real use

1. Set a long, random `SECRET_KEY`; never reuse the example.
2. Use managed PostgreSQL with backups and TLS.
3. Move rate limiting to Redis.
4. Implement password recovery with transactional email (today it only logs the request, without revealing whether the email exists).
5. Rotate the demo credentials or disable `flask seed-demo` in real production.
6. Add monitoring of 5xx errors and alerts on `/health/ready`.
7. If replicas are added, review `preload_app`, shared rate limiting and the connection budget.
8. Review the Supabase grants and the Data API settings regularly.

## Vulnerability reports

This is an academic project without a formal channel. Never publish real credentials in issues.

## Passwords: change and recovery

- **Change (signed in).** `POST /api/v1/auth/password` asks for the current password, applies the
  same minimum length as sign-up (10 characters) and closes every other session of the user.
  Wrong attempts count against the same in-memory limiter as sign-in.
- **Recovery by email.** `POST /api/v1/auth/password-reset/request` always answers the same,
  whether the email exists or not. The link is sent by email only: it is never in the response
  or in the log. `POST /api/v1/auth/password-reset/confirm` sets the new password and closes
  every session of the user.
- **Token.** Stateless: `user id . expiry . HMAC(SECRET_KEY, id, expiry, current password hash)`.
  It lasts 30 minutes and stops working as soon as the password changes, so it is single use
  and needs no table. The frontend reads it from `#restablecer=<token>` and removes it from
  the address at once.
- **Email provider.** Sending needs `BREVO_API_KEY` and `MAIL_FROM` (Brevo HTTP API; the free
  Render plan blocks SMTP ports). `MAIL_FROM` must be a sender verified in Brevo, which needs
  no domain of our own. Without them no email is sent, `GET
  /api/v1/auth/password-reset/available` answers `false` and the sign-in page says recovery is
  not set up. The link points to `FRONTEND_ORIGIN`.

## Deleting records

Income, expenses, obligations and the totals of a month are deleted for real (role `contador`
or `admin`), together with their receipts or payments. Each deletion writes an audit event
with the document number, date and total, which is what remains of the record.
