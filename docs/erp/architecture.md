# AlertaFiscal Architecture

## Overview

AlertaFiscal is a monorepo with three pieces that deploy independently:

```
frontend/  React 18 + TypeScript + Vite      → Static Site (Render)
backend/   Flask + Blueprints + SQLAlchemy   → Web Service (Render)
ml/        Offline training and evaluation   → runs separately, never on the web server
```

The database is PostgreSQL. Locally it runs in Docker; in the cloud it is hosted on Supabase. The browser **never** talks to the database directly: it only uses the versioned REST API under `/api/v1`.

```
LOCAL
Browser ──HTTP──> Vite :5173 ──proxy /api,/health──> Flask :5000 ──psycopg──> PostgreSQL :5433 (Docker)

CLOUD
Browser ──HTTPS──> Render Static Site ──HTTPS/fetch──> Render Web Service (Flask/Gunicorn)
                                                            └──TLS──> Supabase PostgreSQL
```

Supabase is used **only as a PostgreSQL provider**. Supabase Auth, the Supabase SDK, the Data API and the `anon`/`service_role` keys are not used in the frontend. Flask is the only intermediary for ERP data.

## Backend: modular monolith

```
backend/
├── wsgi.py                  # entry point (gunicorn / flask run)
├── app/
│   ├── __init__.py          # application factory, hooks, CLI
│   ├── config.py            # database modes, production guards, pool
│   ├── db_schema.py         # DB_SCHEMA applied per pooled connection
│   ├── extensions.py        # db (SQLAlchemy), migrate (Alembic)
│   ├── models.py            # full schema (multi-company)
│   ├── security.py          # Argon2id, revocable sessions, CSRF
│   ├── seed.py              # idempotent demo data
│   ├── common/
│   │   ├── http.py          # per-company authorization, pagination, audit
│   │   └── health.py        # /health/live and /health/ready
│   └── modules/
│       ├── auth/            # login, logout, /me, sessions
│       ├── companies/       # companies visible to the user
│       ├── dashboard/       # period aggregates
│       ├── movements/       # income, expenses, receipts, payments, counterparties
│       ├── planning/        # parameters, versioned plans, reserves, forecasts
│       ├── tracking/        # tax obligations and audit
│       ├── alerts/          # alerts and comments
│       └── context/         # read-only external context (DIAN, Supersociedades)
├── migrations/              # Alembic
└── tests/                   # SQLite unit tests + PostgreSQL integration
```

Each module is a Blueprint with its own `url_prefix`. No business logic in the frontend is a source of truth: permissions, per-company isolation, statuses and amounts are validated on the server.

### Application factory

`create_app()` in `app/__init__.py`:

1. Loads the configuration (`Config`); `config.py` reads `backend/.env` **before** its attributes are evaluated.
2. Initializes `db` and `migrate`.
3. Registers the Blueprints.
4. Registers hooks: `X-Request-ID`, session resolution, CSRF validation, CORS headers, security headers and commit/rollback per request.
5. Registers uniform error handlers (`{"error": {...}}`).
6. Registers CLI commands: `flask seed-demo --yes`, `flask create-admin`, `flask context-load`.

### Database modes

There is no silent fallback to SQLite.

| Situation | Result |
|---|---|
| `DATABASE_URL=postgresql+psycopg://...` | PostgreSQL; normal mode |
| No `DATABASE_URL` and no `DB_MODE` | Startup error with instructions |
| No `DATABASE_URL` and `DB_MODE=sqlite` | SQLite demo in `backend/instance/dev.db` |
| SQLite `DATABASE_URL` without `DB_MODE=sqlite` | Startup error |
| `APP_ENV=production` + SQLite or no URL | Startup error |
| `APP_ENV=production` + weak `SECRET_KEY` | Startup error |

`/health/ready` shows the real engine (`postgresql` or `sqlite-dev`) and `demo`. `demo: true` means SQLite was enabled explicitly with `DB_MODE=sqlite`; it does **not** mean an automatic fallback.

### Connection pool

On PostgreSQL:

- `pool_pre_ping=True`;
- `DB_POOL_SIZE` (default 5), `DB_MAX_OVERFLOW` (5), `pool_timeout` (15 s) and `pool_recycle` (1800 s);
- configurable `connect_timeout` (5 s);
- optional TLS with `DB_SSLMODE` and `DB_SSLROOTCERT` (not required locally);
- optional `DB_SCHEMA` for a dedicated schema. It is applied with `SET search_path` on every physical connection, because the Supabase session pooler ignores the startup `options` parameter. The schema must exist and the role must have `USAGE` on it; otherwise the backend fails instead of falling back to `public`.

With one Gunicorn worker the theoretical maximum is `pool_size + max_overflow` (10). That value must fit in the connection limit of the Supabase project, after subtracting the connections used by the provider's own services. It is never increased blindly.

### Multi-company

Every business entity has `company_id`. The helper `authorized_company(company_id)` checks, in this order:

1. The company exists and is active.
2. The authenticated user has an active membership.
3. If the operation needs a minimum role (`auxiliar < contador < admin`), it checks it.

If anything fails, it answers a generic `403`. It does not reveal whether the company exists. The tests in `tests/test_isolation.py` and `tests/test_postgres_integration.py` cover cross-company access.

### Money

Amounts are stored as `Numeric(18, 2)` and travel in the API as **strings** (`"1190000.00"`) so no precision is lost with `float`. The frontend only formats them. On PostgreSQL the integration test checks that the value is still `numeric` and is read as `Decimal`.

### Versioned plans

`FiscalPlan` has immutable versions (`FiscalPlanVersion`). Creating a new version does not overwrite the previous ones; marking a version as `reviewed` prevents reviewing it again (`409`). This implements the accounting traceability requirement.

### Forecasts

Manual planning works without any model. `POST /forecasts` computes a simple average of the history (at least 3 months with records) and returns `available: false` with the reason if there is not enough data. The answer always includes a `disclaimer`: it is a planning estimate, **not** an official DIAN assessment.

`POST /forecasts/model` runs a model artifact (JSON) on the company's monthly history in pure Python. The backend never imports scikit-learn and never trains. Training lives in `ml/` and is an offline process.

## Frontend

- React 18 + TypeScript + Vite 6.
- Local navigation state (no router): `Screen` in `shared.tsx`, switched in `App.tsx`. Each screen is one file in `src/app/screens/`; `Layout.tsx` holds the menu and the top bar.
- Central HTTP client in `src/api/client.ts`:
  - `credentials: "include"` (session cookie),
  - CSRF token in memory (never in `localStorage`),
  - timeout, `AbortController` and typed errors (`ApiError`).
- The main screens read real data from the API when there is a session, and use sample data only in the explicit "visual demo" mode.
- The API and database status is shown on the login screen, the top bar and the side menu (`/health/live` and `/health/ready`).
- The interface is available in English and Spanish, switched with the `ES | EN` button on the login screen and in the top bar. The choice is stored in `localStorage` (`af_lang`); on the first visit it follows the browser language. Stored codes such as priorities (`alta`, `media`, `baja`) and origins keep their original values and are translated only for display.
- Translation (`src/i18n/`): the screens and the API write English. `es.ts` maps each English text to Spanish, with numbered slots (`{0}`) for the variable parts of a sentence. `translate.ts` resolves exact texts, then templates, then the `·`-separated segments or the sentences of a longer text. `dom.ts` applies it with a `MutationObserver` to the text nodes and the `placeholder`, `title` and `aria-label` attributes, and keeps the English original so the switch back is exact. Because of this, the backend messages (alert titles and descriptions, errors, forecast reasons) are also shown in Spanish without changing the API. Numbers, currency and dates use `es-CO` or `en-US` (`uiLocale()`). Unknown text, such as names or notes typed by users, is shown as it is. Mark an element with `data-i18n-skip` to keep it untranslated.

## ML (offline)

- `ml/src/` trains, selects and evaluates the **global model** used by default (Phases 2–4 of the course project).
- `ml/company_trainer/train.py` (from the ERP) groups a company's monthly income and expenses, trains regression models (moving average/linear and random forest), evaluates them with a time-based split and stores metrics and artifacts in `ml/artifacts/` (ignored by git). It never runs on Render or inside a user request.

## Tests

- `backend/tests/conftest.py` uses an **explicit** temporary SQLite database by default for unit and API tests.
- If `TEST_DATABASE_URL` is set, every test of that run uses PostgreSQL and the schema is recreated with the Alembic migrations. The fixture requires the database name to end in `_test` or start with `test_` and the host to be `localhost`, and it never reads `backend/.env`; this prevents an accidental wipe of the demo or Supabase database.
- `backend/tests/test_postgres_integration.py` validates migrations, `Numeric`/`Decimal`, calendar dates, foreign keys, uniqueness, roles, sessions, CSRF, multi-company isolation, plans, reserves, alerts, comments and obligations.
- PostgreSQL is never replaced by SQLite when `TEST_DATABASE_URL` is missing: the integration tests are **skipped** and the reason is reported.
- CI (`.github/workflows/ci.yml`) runs the whole suite against a PostgreSQL 16 service, then the migrations, the idempotent seed, a health check and the frontend build.

## Decisions and known limits

- **PostgreSQL is the target**; SQLite is enabled only with `DB_MODE=sqlite` for demos or tests and is forbidden in production.
- **Supabase = PostgreSQL only**. The Data API is disabled; no Supabase key is used in the browser. See `docs/erp/security.md`.
- **No electronic invoicing**: documents are internal records, not certified tax documents.
- **No DIAN integration**: dates and amounts are the accountant's responsibility.
- **In-memory rate limiting**: valid for one replica; with several replicas it must move to Redis (see `docs/erp/security.md`).
- **Optional dedicated schema**: `DB_SCHEMA` allows migrating to a schema not exposed by the Data API, but the schema and its privileges must be created before migrating.
