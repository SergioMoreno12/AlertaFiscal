# Arquitectura de AlertaFiscal

## Visión general

AlertaFiscal es un monorepo con tres piezas desplegables de forma independiente:

```
frontend/  React 18 + TypeScript + Vite  → Static Site (Render)
backend/   Flask + Blueprints + SQLAlchemy → Web Service (Render)
ml/        Entrenamiento/evaluación offline → se ejecuta aparte, no en el servidor web
```

La base de datos es PostgreSQL. En local corre en Docker; en la nube se aloja en
Supabase. El navegador **nunca** habla directamente con la base de datos: solo consume la
API REST versionada en `/api/v1`.

```
LOCAL
Navegador ──HTTP──> Vite :5173 ──proxy /api,/health──> Flask :5000 ──psycopg──> PostgreSQL :5433 (Docker)

NUBE
Navegador ──HTTPS──> Render Static Site ──HTTPS/fetch──> Render Web Service (Flask/Gunicorn)
                                                              └──TLS──> Supabase PostgreSQL
```

Supabase se usa **solo como proveedor de PostgreSQL**. No se usa Supabase Auth, ni el SDK
de Supabase, ni la Data API, ni claves `anon`/`service_role` en el frontend. Flask sigue
siendo el único intermediario de datos del ERP.

## Backend: monolito modular

```
backend/
├── wsgi.py                  # punto de entrada (gunicorn / flask run)
├── app/
│   ├── __init__.py          # application factory, hooks, CLI
│   ├── config.py            # modos de BD, guards de producción, pool
│   ├── extensions.py        # db (SQLAlchemy), migrate (Alembic)
│   ├── models.py            # esquema completo (multiempresa)
│   ├── security.py          # Argon2id, sesiones revocables, CSRF
│   ├── seed.py              # datos de demostración idempotentes
│   ├── common/
│   │   ├── http.py          # autorización por empresa, paginación, auditoría
│   │   └── health.py        # /health/live y /health/ready
│   └── modules/
│       ├── auth/            # login, logout, /me, sesiones
│       ├── companies/       # empresas visibles para el usuario
│       ├── dashboard/       # agregados del período
│       ├── movements/       # ingresos, gastos, cobros, pagos, terceros
│       ├── planning/        # parámetros, planes versionados, reservas, proyecciones
│       ├── tracking/        # obligaciones tributarias y auditoría
│       └── alerts/          # alertas y comentarios
├── migrations/              # Alembic (una migración inicial)
└── tests/                   # unitarias SQLite + integración PostgreSQL
```

Cada módulo es un Blueprint con su propio `url_prefix`. No hay lógica de negocio en el
frontend que sea fuente de verdad: permisos, aislamiento por empresa, estados y montos se
validan en el servidor.

### Application factory

`create_app()` en `app/__init__.py`:

1. Carga configuración (`Config`); `config.py` lee `backend/.env` **antes** de evaluar
   sus atributos.
2. Inicializa `db` y `migrate`.
3. Registra Blueprints.
4. Registra hooks: `X-Request-ID`, resolución de sesión, validación CSRF, cabeceras CORS,
   cabeceras de seguridad y commit/rollback por petición.
5. Registra manejadores de error uniformes (`{"error": {...}}`).
6. Registra comandos CLI: `flask seed-demo --yes`, `flask create-admin`.

### Modos de base de datos

No hay fallback silencioso a SQLite.

| Situación | Resultado |
|---|---|
| `DATABASE_URL=postgresql+psycopg://...` | PostgreSQL; modo normal |
| Sin `DATABASE_URL` y sin `DB_MODE` | Error de arranque con instrucciones |
| Sin `DATABASE_URL` y `DB_MODE=sqlite` | SQLite demo en `backend/instance/dev.db` |
| `DATABASE_URL` sqlite sin `DB_MODE=sqlite` | Error de arranque |
| `APP_ENV=production` + SQLite o sin URL | Error de arranque |
| `APP_ENV=production` + `SECRET_KEY` débil | Error de arranque |

`/health/ready` expone el motor real (`postgresql` o `sqlite-dev`) y `demo`. `demo: true`
significa que SQLite fue habilitado explícitamente con `DB_MODE=sqlite`; **no** indica un
fallback automático.

### Pool de conexiones

En PostgreSQL:

- `pool_pre_ping=True`;
- `DB_POOL_SIZE` (5 por defecto), `DB_MAX_OVERFLOW` (5), `pool_timeout` (15 s) y
  `pool_recycle` (1800 s);
- `connect_timeout` configurable (5 s);
- TLS opcional con `DB_SSLMODE` y `DB_SSLROOTCERT` (local no lo exige);
- `DB_SCHEMA` opcional para un esquema dedicado (debe existir antes de migrar).

Con un worker de Gunicorn el máximo teórico es `pool_size + max_overflow` (10). Ese valor
debe caber en el límite de conexiones del proyecto Supabase, restando las conexiones que
consumen los servicios del proveedor. No se aumenta a ciegas.

### Multiempresa

Toda entidad de negocio lleva `company_id`. El helper `authorized_company(company_id)`
comprueba, en este orden:

1. La empresa existe y está activa.
2. El usuario autenticado tiene una membresía activa.
3. Si la operación exige rol mínimo (`auxiliar < contador < admin`), lo valida.

Si algo falla, responde `403` genérico. No se revela si la empresa existe. Las pruebas de
`tests/test_isolation.py` y `tests/test_postgres_integration.py` cubren el acceso cruzado.

### Dinero

Los importes se guardan como `Numeric(18, 2)` y viajan en la API como **cadenas**
(`"1190000.00"`) para no perder precisión con `float`. El frontend solo formatea. En
PostgreSQL la prueba de integración verifica que el valor sigue siendo `numeric` y se lee
como `Decimal`.

### Planes versionados

`FiscalPlan` tiene versiones inmutables (`FiscalPlanVersion`). Crear una versión nueva no
sobrescribe las anteriores; marcar una versión como `reviewed` impide volver a revisarla
(`409`). Esto materializa el requisito de trazabilidad contable.

### Proyecciones

La planificación manual funciona sin ningún modelo. `POST /forecasts` calcula un promedio
simple del historial (mínimo 3 meses con registros) y devuelve `available: false` con el
motivo si no hay datos suficientes. La respuesta siempre incluye un `disclaimer`: es una
estimación de planificación, **no** una liquidación oficial de la DIAN.

El entrenamiento de modelos vive en `ml/` y es un proceso offline. El backend no importa
scikit-learn ni carga modelos al arrancar.

## Frontend

- React 18 + TypeScript + Vite 6.
- Estado de navegación local (sin router): `Screen` en `App.tsx`.
- Cliente HTTP centralizado en `src/api/client.ts`:
  - `credentials: "include"` (cookie de sesión),
  - token CSRF en memoria (nunca en `localStorage`),
  - timeout, `AbortController` y errores tipados (`ApiError`).
- La UI del prototipo se conserva; las pantallas principales leen datos reales de la API
  cuando hay sesión y usan datos de ejemplo solo en el modo "demo visual" explícito.
- El estado de la API/base de datos se muestra en el login, la barra superior y el menú
  lateral (`/health/live` y `/health/ready`).

## ML (offline)

`ml/train.py` agrega ingresos y gastos mensuales por empresa, entrena modelos de regresión
(media móvil/lineal y Random Forest), evalúa con partición temporal y guarda métricas y
artefactos en `ml/artifacts/` (ignorado por git). No se ejecuta en Render ni en el request
del usuario.

## Pruebas

- `backend/tests/conftest.py` usa por defecto SQLite temporal **explícito** para pruebas
  unitarias/API.
- Si existe `TEST_DATABASE_URL`, todas las pruebas de esa ejecución usan PostgreSQL y el
  esquema se recrea con las migraciones de Alembic. El fixture exige que el nombre de la
  base termine en `_test` o empiece por `test_`; así se impide una limpieza accidental de
  la base demo.
- `backend/tests/test_postgres_integration.py` valida migraciones, `Numeric`/`Decimal`,
  fechas de calendario, claves foráneas, unicidad, roles, sesiones, CSRF, aislamiento
  multiempresa, planes, reservas, alertas, comentarios y obligaciones.
- No se sustituye PostgreSQL por SQLite cuando falta `TEST_DATABASE_URL`: las pruebas de
  integración se **saltan** y se informa el motivo.

## Decisiones y límites conocidos

- **PostgreSQL es el objetivo**; SQLite solo se habilita con `DB_MODE=sqlite` para demo o
  pruebas y está prohibido en producción.
- **Supabase = solo PostgreSQL**. La Data API se desactiva; no se usan claves de Supabase
  en el navegador. Ver `docs/security.md`.
- **Sin facturación electrónica**: los documentos son registros internos, no documentos
  tributarios certificados.
- **Sin integración DIAN**: las fechas y valores son responsabilidad del contador.
- **Rate limiting en memoria**: válido para una réplica; con varias réplicas debe moverse a
  Redis (ver `docs/security.md`).
- **Esquema dedicado opcional**: `DB_SCHEMA` permite migrar a un esquema no expuesto por la
  Data API, pero requiere crear el esquema y los privilegios antes de migrar. La validación
  local documentada usa `public` con la Data API desactivada.
