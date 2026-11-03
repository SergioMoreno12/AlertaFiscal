# Despliegue

## 1. Arquitectura de entornos

| Entorno | Frontend | Backend | Base de datos |
|---|---|---|---|
| Local | Vite en Windows (`127.0.0.1:5173`) | Flask en Windows (`127.0.0.1:5000`) | PostgreSQL 16 en Docker (`127.0.0.1:5433`) |
| Nube | Render Static Site | Render Web Service (Gunicorn) | Supabase PostgreSQL |

Supabase **reemplaza** al PostgreSQL administrado de Render. `render.yaml` ya no crea
ninguna base de datos en Render.

> **Estado de validación (26/10/2026):** PostgreSQL 16 local en Docker fue **probado**:
> migraciones en `head`, seed idempotente, 37 pruebas (0 omitidas), `/health/ready` con
> `database: postgresql` y persistencia tras reiniciar el contenedor sin borrar el volumen.
> **Supabase sigue sin validar**: no se ha creado ningún proyecto ni configurado credenciales.

## 2. Requisitos

| Pieza | Versión recomendada |
|---|---|
| Python | 3.12 o superior (probado con 3.14 en Windows) |
| Node.js | LTS 22 o 24 (probado con 24.22.1) |
| Docker Desktop | Con motor Linux activo y Docker Compose v2 |
| PostgreSQL local | 16 (imagen `postgres:16`) |
| Git | cualquiera reciente |

No se necesitan instalaciones globales de Python. Si Node solo existe como copia portátil,
usa su ruta absoluta y añádela al `PATH` de la sesión:

```powershell
$nodeDir = "C:\Users\manue\AppData\Local\Temp\opencode\node-v24.22.1-win-x64"
$env:Path = "$nodeDir;$env:Path"
node --version
npm --version
```

## 3. PostgreSQL local en Docker

### 3.1. Iniciar Docker Desktop (acción manual)

Abre **Docker Desktop** y espera a que el motor termine de arrancar. Comprueba:

```powershell
docker info --format '{{.ServerVersion}}'
```

Si responde con un error de `dockerDesktopLinuxEngine`, el motor aún no está activo.
No se debe continuar con migraciones ni pruebas de PostgreSQL.

Comprueba que el puerto elegido esté libre:

```powershell
Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
```

Sin resultados significa libre. Si está ocupado, cambia `POSTGRES_PORT` en `.env.docker`
y ajusta `DATABASE_URL` en `backend/.env`.

### 3.2. Variables locales

```powershell
cd C:\Users\manue\OneDrive\Documentos\PROYECTO_FINAL_MACHINE
Copy-Item .env.docker.example .env.docker
notepad .env.docker
```

Cambia `POSTGRES_PASSWORD`. `.env.docker` está ignorado por git. El archivo define:

- `POSTGRES_DB=alertafiscal` (base demo),
- `POSTGRES_TEST_DB=alertafiscal_test` (base de pruebas, creada por el script de inicio),
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT=5433`.

La imagen usa un volumen nombrado `alertafiscal_pgdata`. El script
`docker/postgres/init/01-create-test-db.sh` crea la base de pruebas **solo la primera vez**
que se inicializa el volumen.

### 3.3. Arrancar, comprobar y ver logs

```powershell
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f postgres
```

`docker compose ps` debe mostrar el servicio `postgres` como `healthy`. También puedes
comprobar directamente:

```powershell
docker compose --env-file .env.docker exec postgres pg_isready -U alertafiscal -d alertafiscal
```

### 3.4. Parar sin borrar datos

```powershell
# Detiene el contenedor; conserva contenedor, red y volumen.
docker compose --env-file .env.docker stop

# Detiene y elimina el contenedor y la red; el volumen nombrado se conserva.
docker compose --env-file .env.docker down
```

> **No ejecutes `docker compose down -v`** salvo que quieras borrar la base demo y la base
> de pruebas. Esa orden elimina el volumen.

Volver a arrancar:

```powershell
docker compose --env-file .env.docker start
# o, si se ejecutó `down`:
docker compose --env-file .env.docker up -d
```

### 3.5. Respaldo local

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
docker compose --env-file .env.docker exec -T postgres `
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/alertafiscal.dump'
docker compose --env-file .env.docker cp postgres:/tmp/alertafiscal.dump .\backups\alertafiscal.dump
```

`backups/` está ignorado por git. La restauración es una operación destructiva sobre la
base destino; no se incluye en el recorrido habitual y requiere autorización explícita.

## 4. Configurar y arrancar el backend

```powershell
cd C:\Users\manue\OneDrive\Documentos\PROYECTO_FINAL_MACHINE\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-dev.txt

Copy-Item .env.example .env
notepad .env
```

En `.env`:

```dotenv
APP_ENV=development
DB_MODE=postgresql
DATABASE_URL=postgresql+psycopg://alertafiscal:TU_CLAVE@127.0.0.1:5433/alertafiscal
```

La contraseña de la URL debe coincidir con `POSTGRES_PASSWORD`. Si contiene caracteres
reservados (`@`, `:`, `/`, `#`, `?`, `%`, espacio), aplícalos con percent-encoding
(`@` → `%40`, etc.). No se imprimen URLs ni contraseñas en logs.

Si falta `DATABASE_URL` en modo normal, el backend falla con un error claro. Para una demo
aislada sin PostgreSQL puedes usar `DB_MODE=sqlite` y **sin** `DATABASE_URL`; eso usa
`backend/instance/dev.db` y `/health/ready` lo marca con `"demo": true` (modo SQLite explícito, no fallback automático).

### 4.1. Migraciones y semilla

Con PostgreSQL saludable:

```powershell
$env:FLASK_APP = "wsgi:app"
$env:APP_ENV = "development"

flask db upgrade
flask db current
flask seed-demo --yes
```

- `seed-demo` es idempotente y solo inserta datos ficticios.
- `--yes` es obligatorio para confirmar; también se acepta `SEED_CONFIRM=1`.
- No se ejecuta al arrancar el servidor.
- Si el usuario demo ya existe, no se restablece su contraseña ni se borran registros.

### 4.2. Servidor

```powershell
flask run --port 5000
```

Comprueba:

- <http://127.0.0.1:5000/health/live> → `{"status":"ok",...}`
- <http://127.0.0.1:5000/health/ready> →
  `{"status":"ready","database":"postgresql","demo":false}`

Si PostgreSQL se detiene, `/health/ready` debe responder `503` sin revelar credenciales.
(`gunicorn` no corre en Windows; en local usa `flask run`.)

## 5. Arrancar el frontend

```powershell
cd ..\frontend
npm ci
npm run dev
```

Vite usa `http://127.0.0.1:5173` y redirige `/api` y `/health` a
`http://localhost:5000` (`vite.config.ts`). En desarrollo no hay CORS porque el navegador
habla con el mismo origen del proxy.

Modo demo visual: la pantalla de login permite explorar datos de ejemplo sin crear sesión.
Con sesión real, las pantallas usan la API y muestran estados vacíos si no hay registros.

## 6. Prueba manual recomendada

Credenciales demo: `maria.gomez@contaduria.co` / `demo2026`.

1. Iniciar PostgreSQL: `docker compose --env-file .env.docker up -d`.
2. Confirmar `docker compose ps` → `healthy`.
3. Aplicar migraciones: `flask db upgrade`.
4. Cargar la demo una sola vez: `flask seed-demo --yes`.
5. Iniciar Flask y Vite.
6. Abrir <http://127.0.0.1:5173> e iniciar sesión.
7. Seleccionar empresa.
8. Registrar un ingreso y un gasto.
9. Recargar y comprobar persistencia.
10. Crear una proyección o una estimación manual y guardar un plan.
11. Registrar una reserva y consultar una obligación.
12. Comentar y revisar una alerta; consultar el historial.
13. Cerrar sesión, volver a entrar y comprobar que los datos siguen.
14. Probar con un usuario de otra empresa: no debe acceder a esos registros (`403`).

Persistencia del volumen:

```powershell
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker start
docker compose --env-file .env.docker exec postgres `
  psql -U alertafiscal -d alertafiscal -c "select count(*) from companies;"
```

No se elimina el volumen durante esta comprobación.

## 7. Pruebas automatizadas

### 7.1. Unitarias/API con SQLite temporal explícito

```powershell
cd backend
$env:APP_ENV = "testing"
python -m pytest -q
```

`conftest.py` crea una base SQLite temporal propia; no toca `dev.db`. Si existe
`TEST_DATABASE_URL`, esta misma orden ejecuta además las pruebas contra PostgreSQL.

### 7.2. Integración PostgreSQL

Usa la base **separada** creada por Docker (`alertafiscal_test`):

```powershell
cd backend
$env:APP_ENV = "testing"
$env:TEST_DATABASE_URL = "postgresql+psycopg://alertafiscal:TU_CLAVE@127.0.0.1:5433/alertafiscal_test"
python -m pytest -q
```

El fixture:

- exige que el nombre de la base termine en `_test` o empiece por `test_`;
- recrea el esquema con `flask db upgrade` (Alembic) antes de las pruebas;
- elimina el esquema de la base de pruebas al terminar.

Nunca apuntes `TEST_DATABASE_URL` a `alertafiscal` ni a la base de producción: la
protección por nombre está pensada para detener ese error, no para autorizarlo.

## 8. Preparación de Supabase

No se ha creado ningún proyecto Supabase ni recurso de pago.

### 8.1. Crear el proyecto (cuando se autorice)

1. Crear el proyecto en Supabase y elegir una región cercana a Render.
2. Anotar la **versión de PostgreSQL**:

   ```sql
   select version();
   ```

   La validación local usa PostgreSQL 16. Antes de la validación final contra Supabase,
   compara la versión real del proyecto y revisa las migraciones si difiere.
3. Copiar las cadenas desde **Connect** en el dashboard. No inventar host, usuario ni
   puerto.

### 8.2. Modalidad de conexión (según documentación oficial de Supabase)

| Caso | Modalidad |
|---|---|
| Backend persistente con IPv6 (o add-on IPv4) | Conexión **directa**, puerto 5432 |
| Backend persistente en red solo IPv4 | **Shared pooler, session mode**, puerto 5432 |
| Funciones serverless/edge | Transaction mode (no aplica aquí) |
| Migraciones, `pg_dump`, respaldo | Conexión **directa** |

Para Flask/Gunicorn, que es un backend persistente:

- Preferir la conexión directa si el entorno alcanza el endpoint IPv6.
- Si Render no alcanza IPv6 y no hay add-on IPv4, usar el pooler compartido en **modo
  sesión** (IPv4 en todos los planes).
- **No** elegir transaction pooling por defecto: no soporta prepared statements y pierde
  estado de sesión.
- Las migraciones requieren una conexión directa. No se debe asumir que un pooler es
  equivalente. Si el entorno de ejecución no alcanza IPv6, las alternativas son ejecutar
  las migraciones desde un entorno con IPv6 o habilitar el add-on IPv4 (de pago), no
  improvisar con transaction pooling.

El host del pooler y el usuario (`postgres.[PROJECT-REF]`) se copian del panel **Connect**;
no se deducen de la región.

### 8.3. TLS y contraseña

- Configurar `DB_SSLMODE=require` como mínimo.
- Para verificar también el servidor, descargar el certificado raíz desde
  **Database settings** y usar `DB_SSLMODE=verify-full` con `DB_SSLROOTCERT` apuntando al
  archivo. `require` cifra pero no verifica la identidad del servidor.
- No desactivar TLS para resolver errores.
- Percent-encodear caracteres especiales de la contraseña en la URL. No concatenar URLs a
  mano en logs ni en comandos compartidos.

Variables de backend sugeridas en Supabase:

```dotenv
APP_ENV=production
SECRET_KEY=<aleatoria de 32+ caracteres>
DATABASE_URL=postgresql+psycopg://usuario:clave-percent-encoded@host:5432/postgres
DB_SSLMODE=require
# DB_SSLROOTCERT=C:\ruta\supabase-ca.crt
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=5
DB_CONNECT_TIMEOUT=5
```

`MIGRATION_DATABASE_URL` es opcional. Úsala solo si quieres separar la credencial de
migraciones de la credencial de ejecución. En ese caso, el comando de migración debe leer
esa variable; no se debe asumir que la app la usa automáticamente.

### 8.4. Protección de datos y esquema

- **Desactivar la Data API** en Supabase si Flask es el único intermediario. Así las tablas
  no quedan expuestas por REST/GraphQL.
- No usar `supabase-js`, Supabase Auth, claves `anon`, `service_role` ni `VITE_*` con
  credenciales de base de datos.
- El aislamiento multiempresa sigue siendo responsabilidad del backend; no se delega a RLS.
- Si en el futuro se expone un esquema por la Data API, habilitar RLS y revisar privilegios
  de `anon`/`authenticated`. Un rol de conexión con `bypassrls` (o el rol `postgres`) no
  queda protegido por RLS.
- Para un esquema dedicado: crear el esquema y los privilegios con un rol administrador,
  definir `DB_SCHEMA=alertafiscal` y ejecutar las migraciones con una conexión directa. La
  app usa ese `search_path`. Esta modalidad es opcional y no se validó localmente.
- La credencial de ejecución debe tener permisos mínimos (DML + secuencias), no
  administrativos. La credencial de migraciones puede ser distinta y más privilegiada.

## 9. Render

### 9.1. Servicios

`render.yaml` define:

- **alertafiscal-backend**: Web Service Python; arranque
  `gunicorn wsgi:app -c gunicorn.conf.py`.
- **alertafiscal-frontend**: Static Site; build `npm ci && npm run build`, publica `dist`.

No define base de datos ni `fromDatabase`.

### 9.2. Orden de despliegue

1. Con autorización, subir el repositorio a GitHub.
2. Crear el proyecto Supabase y preparar su conexión (sección 8).
3. En Render, **New → Blueprint** y aplicar `render.yaml`.
4. Definir en el backend el secreto `DATABASE_URL` con la cadena de Supabase.
5. Elegir un mecanismo de migración:
   - **Pre-Deploy Command** si el plan contratado lo ofrece: `flask db upgrade`.
   - Si no está disponible: ejecutar `flask db upgrade` desde un entorno local/controlado
     con conexión directa a Supabase, antes de desplegar el backend.
   - Como alternativa controlada, cambiar temporalmente el start command del servicio a
     `flask db upgrade && gunicorn wsgi:app -c gunicorn.conf.py`, desplegar una vez,
     verificar `/health/ready` y **restaurar** el start command normal.
   No se debe dejar una migración automática permanente en el arranque.
6. Cargar la demo solo si el entorno es de demostración:
   `flask seed-demo --yes`. Nunca en el arranque del servidor.
7. Copiar la URL del backend y definir en el Static Site:
   `VITE_API_BASE_URL=https://<backend>.onrender.com`. Redesplegar sin caché porque las
   variables de Vite se incrustan en el build.
8. Copiar la URL del frontend y definir en el backend:
   `FRONTEND_ORIGIN=https://<frontend>.onrender.com` (sin barra final).
9. Verificar `https://<backend>/health/ready` →
   `{"status":"ready","database":"postgresql","demo":false}`.
10. Probar login, CSRF, cookies y una operación de escritura.

### 9.3. Presupuesto de conexiones

Con `WEB_CONCURRENCY=1`, `DB_POOL_SIZE=5` y `DB_MAX_OVERFLOW=5`, el máximo es 10
conexiones de aplicación. Súmalas a las conexiones internas de Supabase (Auth, Storage,
PostgREST, health checks) y compáralas con el límite del compute elegido. Si se aumenta el
número de workers, reduce el pool o usa el pooler en modo sesión; no multipliques el pool
sin revisar el límite.

### 9.4. Notas del plan gratuito de Render

- El Web Service se suspende por inactividad: la primera petición puede tardar.
- El disco es efímero: todo dato persistente va a PostgreSQL.
- `gunicorn` no corre en Windows; en local usa `flask run`.
- Las funciones disponibles (pre-deploy, shell, jobs) dependen del plan. Verifica el
  dashboard antes de asumir que existen.

## 10. Diagnóstico rápido

| Síntoma | Revisión |
|---|---|
| El backend no arranca y menciona `DATABASE_URL` | Define la URL o usa `DB_MODE=sqlite` solo para demo |
| El backend no arranca y menciona `SECRET_KEY` | Producción exige una clave real de 32+ caracteres |
| `/health/ready` → 503 | PostgreSQL detenido, URL/credenciales incorrectas o migraciones pendientes |
| `docker compose ps` no dice `healthy` | `docker compose logs postgres`; volumen o credenciales |
| El login da 403 `csrf_failed` | El frontend no envía `X-CSRF-Token`; limpia cookies y recarga |
| El login da 401 con credenciales correctas | Ejecuta `flask seed-demo --yes` o crea un usuario |
| El navegador bloquea la cookie en la nube | `COOKIE_SAMESITE=None`, `COOKIE_SECURE=true`, HTTPS |
| Error CORS | `FRONTEND_ORIGIN` debe coincidir exacto (esquema + dominio, sin `/`) |
| El frontend llama a `localhost:5000` en producción | Falta `VITE_API_BASE_URL` al construir |

## 11. SQLite anterior

`backend/instance/dev.db` se conserva como referencia local. No se copia a PostgreSQL ni se
usa para validar el motor nuevo. Se puede seguir usando únicamente con
`DB_MODE=sqlite` y sin `DATABASE_URL`, de forma explícita.
