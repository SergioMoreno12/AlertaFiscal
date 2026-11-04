# Deployment

## 1. Environments

| Environment | Frontend | Backend | Database |
|---|---|---|---|
| Local | Vite on Windows (`127.0.0.1:5173`) | Flask on Windows (`127.0.0.1:5000`) | PostgreSQL 16 in Docker (`127.0.0.1:5433`) |
| Cloud | Render Static Site | Render Web Service (Gunicorn) | Supabase PostgreSQL |

Supabase **replaces** Render's managed PostgreSQL. `render.yaml` creates no database on Render.

> **Validation status:** local PostgreSQL 16 in Docker was **tested** (October 26, 2026): migrations at `head`, idempotent seed, `/health/ready` with `database: postgresql`, and data kept after restarting the container without deleting the volume. On November 3, 2026 the migrations were also run on Supabase (PostgreSQL 17.11) in the schema `alertafiscal_scratch`, through the session pooler, and `/health/ready` answered `ready`.

## 2. Requirements

| Piece | Recommended version |
|---|---|
| Python | 3.12 or later (tested with 3.14 on Windows) |
| Node.js | LTS 22 or 24 (tested with 24.22.1) |
| Docker Desktop | With the Linux engine running and Docker Compose v2 |
| Local PostgreSQL | 16 (image `postgres:16`) |
| Git | any recent version |

No global Python packages are needed. If Node only exists as a portable copy, use its absolute path and add it to the session `PATH`:

```powershell
$nodeDir = "C:\path\to\node-v24.22.1-win-x64"
$env:Path = "$nodeDir;$env:Path"
node --version
npm --version
```

## 3. Local PostgreSQL in Docker

### 3.1. Start Docker Desktop (manual step)

Open **Docker Desktop** and wait for the engine to start. Check:

```powershell
docker info --format '{{.ServerVersion}}'
```

If it answers with a `dockerDesktopLinuxEngine` error, the engine is not running yet. Do not continue with migrations or PostgreSQL tests.

Check that the chosen port is free:

```powershell
Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
```

No output means it is free. If it is busy, change `POSTGRES_PORT` in `.env.docker` and adjust `DATABASE_URL` in `backend/.env`.

### 3.2. Local variables

```powershell
cd <repository root>
Copy-Item .env.docker.example .env.docker
notepad .env.docker
```

Change `POSTGRES_PASSWORD`. `.env.docker` is ignored by git. The file defines:

- `POSTGRES_DB=alertafiscal` (demo database),
- `POSTGRES_TEST_DB=alertafiscal_test` (test database, created by the init script),
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT=5433`.

The image uses a named volume `alertafiscal_pgdata`. The script `docker/postgres/init/01-create-test-db.sh` creates the test database **only the first time** the volume is initialized.

### 3.3. Start, check and read the logs

```powershell
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f postgres
```

`docker compose ps` must show the `postgres` service as `healthy`. You can also check directly:

```powershell
docker compose --env-file .env.docker exec postgres pg_isready -U alertafiscal -d alertafiscal
```

### 3.4. Stop without deleting data

```powershell
# Stops the container; keeps the container, network and volume.
docker compose --env-file .env.docker stop

# Stops and removes the container and network; the named volume is kept.
docker compose --env-file .env.docker down
```

> **Do not run `docker compose down -v`** unless you want to delete the demo and test databases. That command removes the volume.

Start again:

```powershell
docker compose --env-file .env.docker start
# or, after `down`:
docker compose --env-file .env.docker up -d
```

### 3.5. Local backup

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
docker compose --env-file .env.docker exec -T postgres `
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/alertafiscal.dump'
docker compose --env-file .env.docker cp postgres:/tmp/alertafiscal.dump .\backups\alertafiscal.dump
```

`backups/` is ignored by git. Restoring is destructive for the target database; it is not part of the normal flow and needs explicit approval.

## 4. Configure and start the backend

```powershell
cd <repository root>\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt

Copy-Item .env.example .env
notepad .env
```

In `.env`:

```dotenv
APP_ENV=development
DB_MODE=postgresql
DATABASE_URL=postgresql+psycopg://alertafiscal:YOUR_PASSWORD@127.0.0.1:5433/alertafiscal
```

The password in the URL must match `POSTGRES_PASSWORD`. If it has reserved characters (`@`, `:`, `/`, `#`, `?`, `%`, space), percent-encode them (`@` → `%40`, and so on). URLs and passwords are never printed in logs.

If `DATABASE_URL` is missing in normal mode, the backend fails with a clear error. For an isolated demo without PostgreSQL you can use `DB_MODE=sqlite` **without** `DATABASE_URL`; that uses `backend/instance/dev.db`, and `/health/ready` marks it with `"demo": true` (explicit SQLite mode, not an automatic fallback).

### 4.1. Migrations and demo data

With PostgreSQL healthy:

```powershell
$env:FLASK_APP = "wsgi:app"
$env:APP_ENV = "development"

flask db upgrade
flask db current
flask seed-demo --yes
```

- `seed-demo` is idempotent and only inserts fictitious data.
- `--yes` is required to confirm; `SEED_CONFIRM=1` is also accepted.
- It never runs when the server starts.
- If the demo user already exists, its password is not reset and no record is deleted.

### 4.2. Server

```powershell
flask run --port 5000
```

Check:

- <http://127.0.0.1:5000/health/live> → `{"status":"ok",...}`
- <http://127.0.0.1:5000/health/ready> → `{"status":"ready","database":"postgresql","demo":false}`

If PostgreSQL stops, `/health/ready` must answer `503` without revealing credentials. (`gunicorn` does not run on Windows; locally use `flask run`.)

## 5. Start the frontend

```powershell
cd ..\frontend
npm ci
npm run dev
```

Vite serves `http://127.0.0.1:5173` and forwards `/api` and `/health` to `http://localhost:5000` (`vite.config.ts`). In development there is no CORS because the browser talks to the proxy's own origin.

Visual demo mode: the login screen lets you explore sample data without a session. With a real session, the screens use the API and show empty states when there are no records.

## 6. Recommended manual test

Demo credentials: `maria.gomez@contaduria.co` / `demo2026`.

1. Start PostgreSQL: `docker compose --env-file .env.docker up -d`.
2. Confirm `docker compose ps` → `healthy`.
3. Apply the migrations: `flask db upgrade`.
4. Load the demo once: `flask seed-demo --yes`.
5. Start Flask and Vite.
6. Open <http://127.0.0.1:5173> and sign in.
7. Select a company.
8. Record an income and an expense.
9. Reload and check that they persist.
10. Create a forecast or a manual estimate and save a plan.
11. Record a reserve and look at an obligation.
12. Comment on and review an alert; look at the history.
13. Sign out, sign in again and check that the data is still there.
14. Try with a user of another company: it must not reach those records (`403`).

Volume persistence:

```powershell
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker start
docker compose --env-file .env.docker exec postgres `
  psql -U alertafiscal -d alertafiscal -c "select count(*) from companies;"
```

The volume is not deleted during this check.

## 7. Automated tests

### 7.1. Unit and API tests with an explicit temporary SQLite

```powershell
cd backend
$env:APP_ENV = "testing"
python -m pytest -q
```

`conftest.py` creates its own temporary SQLite database; it never touches `dev.db`. If `TEST_DATABASE_URL` is set, the same command also runs the tests against PostgreSQL.

### 7.2. PostgreSQL integration

Use the **separate** database created by Docker (`alertafiscal_test`):

```powershell
cd backend
$env:APP_ENV = "testing"
$env:TEST_DATABASE_URL = "postgresql+psycopg://alertafiscal:YOUR_PASSWORD@127.0.0.1:5433/alertafiscal_test"
python -m pytest -q
```

The fixture:

- requires the database name to end in `_test` or start with `test_`;
- recreates the schema with `flask db upgrade` (Alembic) before the tests;
- drops the test database schema at the end;
- refuses to run if `TEST_DATABASE_URL` does not point to `localhost`, and never reads `backend/.env` (`AF_SKIP_DOTENV=1`), so it cannot touch Supabase.

Never point `TEST_DATABASE_URL` to `alertafiscal` or to the production database: the name guard exists to stop that mistake, not to allow it.

## 8. Supabase

### 8.1. Project

1. Create the project in Supabase and choose a region close to Render.
2. Write down the **PostgreSQL version**:

   ```sql
   select version();
   ```

   Local validation uses PostgreSQL 16; the Supabase project of November 3, 2026 runs 17.11 and the migrations passed on it.
3. Copy the connection strings from **Connect** in the dashboard. Never invent the host, user or port.

### 8.2. Connection mode (from the official Supabase documentation)

| Case | Mode |
|---|---|
| Persistent backend with IPv6 (or the IPv4 add-on) | **Direct** connection, port 5432 |
| Persistent backend on an IPv4-only network | **Shared pooler, session mode**, port 5432 |
| Serverless or edge functions | Transaction mode (not used here) |
| Migrations, `pg_dump`, backups | **Direct** connection, or the session pooler when there is no IPv6 |

For Flask with Gunicorn, a persistent backend:

- Prefer the direct connection if the environment reaches the IPv6 endpoint.
- If Render cannot reach IPv6 and there is no IPv4 add-on, use the shared pooler in **session mode** (IPv4 on every plan).
- Do **not** choose transaction pooling by default: it does not support prepared statements and loses session state.
- The session pooler ignores the libpq `options` startup parameter. That is why the backend applies `DB_SCHEMA` with `SET search_path` on every new connection (`backend/app/db_schema.py`).

The pooler host and the user (`postgres.[PROJECT-REF]`) are copied from the **Connect** panel; they are not derived from the region.

### 8.3. TLS and password

- Set at least `DB_SSLMODE=require`.
- To also verify the server, download the root certificate from **Database settings** and use `DB_SSLMODE=verify-full` with `DB_SSLROOTCERT` pointing to the file. `require` encrypts but does not verify the server identity.
- Never disable TLS to work around errors.
- Percent-encode special characters of the password in the URL. Never paste URLs into logs or shared commands.

Suggested backend variables for Supabase:

```dotenv
APP_ENV=production
SECRET_KEY=<random, 32+ characters>
DATABASE_URL=postgresql+psycopg://user:percent-encoded-password@host:5432/postgres
DB_SSLMODE=require
# DB_SSLROOTCERT=C:\path\supabase-ca.crt
DB_SCHEMA=alertafiscal
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=5
DB_CONNECT_TIMEOUT=5
```

`MIGRATION_DATABASE_URL` is optional. Use it only to separate the migration credential from the runtime credential. In that case the migration command must read that variable; the app does not use it automatically.

### 8.4. Data protection and schema

- **Disable the Data API** in Supabase if Flask is the only client. Then the tables are not exposed through REST or GraphQL.
- Do not use `supabase-js`, Supabase Auth, the `anon` or `service_role` keys, or `VITE_*` variables with database credentials.
- Multi-company isolation is the backend's job; it is not delegated to RLS.
- If a schema is ever exposed through the Data API, enable RLS and review the `anon` and `authenticated` privileges. A connection role with `bypassrls` (or the `postgres` role) is not protected by RLS.
- For a dedicated schema: create the schema and its privileges with an administrator role, set `DB_SCHEMA=alertafiscal` and run the migrations. The app uses that `search_path` and fails (no fallback to `public`) if the schema does not exist or the role has no `USAGE` on it.
- The runtime credential should have the minimum permissions (DML and sequences), not administrative ones. The migration credential can be different and more privileged.

## 9. Render

### 9.1. Services

`render.yaml` defines:

- **alertafiscal-backend**: Python Web Service; start command `gunicorn wsgi:app -c gunicorn.conf.py`.
- **alertafiscal-frontend**: Static Site; build `npm ci && npm run build`, publishes `dist`.

It defines no database and no `fromDatabase`.

### 9.2. Deployment order

1. Push the repository to GitHub.
2. Create the Supabase project and prepare its connection (section 8).
3. In Render, **New → Blueprint** and apply `render.yaml`.
4. Set the backend secret `DATABASE_URL` to the Supabase string.
5. Choose a migration mechanism:
   - **Pre-Deploy Command** if the plan offers it: `flask db upgrade`.
   - Otherwise run `flask db upgrade` from a local, controlled environment connected to Supabase, before deploying the backend.
   - As a controlled alternative, temporarily change the start command to `flask db upgrade && gunicorn wsgi:app -c gunicorn.conf.py`, deploy once, check `/health/ready` and **restore** the normal start command.
   Never leave a permanent automatic migration in the start command.
6. Load demo data only in a demo environment, never on server start.
7. Copy the backend URL and set it in the Static Site: `VITE_API_BASE_URL=https://<backend>.onrender.com`. Redeploy without cache, because Vite variables are embedded in the build.
8. Copy the frontend URL and set it in the backend: `FRONTEND_ORIGIN=https://<frontend>.onrender.com` (no trailing slash).
9. Check `https://<backend>/health/ready` → `{"status":"ready","database":"postgresql","demo":false}`.
10. Test sign-in, CSRF, cookies and one write operation.

### 9.3. Connection budget

With `WEB_CONCURRENCY=1`, `DB_POOL_SIZE=5` and `DB_MAX_OVERFLOW=5`, the maximum is 10 application connections. Add Supabase's own connections (Auth, Storage, PostgREST, health checks) and compare with the limit of the chosen compute. If you add workers, reduce the pool or use the session pooler; never multiply the pool without checking the limit.

### 9.4. Render free plan notes

- The Web Service sleeps after inactivity: the first request can be slow.
- The disk is ephemeral: all persistent data goes to PostgreSQL.
- `gunicorn` does not run on Windows; locally use `flask run`.
- The features available (pre-deploy, shell, jobs) depend on the plan. Check the dashboard before assuming they exist.

## 10. Quick diagnosis

| Symptom | Check |
|---|---|
| The backend does not start and mentions `DATABASE_URL` | Set the URL, or use `DB_MODE=sqlite` only for a demo |
| The backend does not start and mentions `SECRET_KEY` | Production requires a real key of 32+ characters |
| `/health/ready` → 503 | PostgreSQL stopped, wrong URL or credentials, or pending migrations |
| `docker compose ps` does not say `healthy` | `docker compose logs postgres`; volume or credentials |
| Sign-in gives 403 `csrf_failed` | The frontend does not send `X-CSRF-Token`; clear cookies and reload |
| Sign-in gives 401 with the right credentials | Run `flask seed-demo --yes` or create a user |
| The browser blocks the cookie in the cloud | `COOKIE_SAMESITE=None`, `COOKIE_SECURE=true`, HTTPS |
| CORS error | `FRONTEND_ORIGIN` must match exactly (scheme + domain, no `/`) |
| The frontend calls `localhost:5000` in production | `VITE_API_BASE_URL` was missing at build time |

## 11. Previous SQLite database

`backend/instance/dev.db` is kept only as a local reference. It is not copied to PostgreSQL or used to validate the new engine. It can still be used only with `DB_MODE=sqlite` and no `DATABASE_URL`, explicitly.
