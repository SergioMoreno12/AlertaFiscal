# Seguridad

## Modelo de amenazas (alcance académico)

Activos: credenciales, sesiones, datos financieros por empresa y planes fiscales.
Adversarios considerados: usuario autenticado de otra empresa, atacante en red (MITM),
sitio externo que intenta CSRF, cliente que manipula IDs en la API y exposición accidental
de la base de datos por servicios del proveedor.

Fuera de alcance: auditoría formal, pentest, cumplimiento PCI, integración DIAN.

## Autenticación

- Contraseñas con **Argon2id** (`argon2-cffi`), parámetros: `time_cost=2`,
  `memory_cost=65536` (64 MiB), `parallelism=2`. Si `argon2-cffi` no está instalado,
  el sistema cae a `scrypt` de Werkzeug y lo registra vía `PASSWORD_SCHEME`.
- El login devuelve el mismo mensaje (`Credenciales inválidas`) exista o no el correo.
- Límite de intentos: 10 por ventana de 15 minutos por IP + correo (`429`).
  **Limitación**: el contador vive en memoria del proceso. Con varias réplicas o reinicios
  se reinicia; para producción real debe moverse a Redis o a la base de datos.
- No hay autorregistro: los usuarios se crean con `flask create-admin` o por un admin.

## Sesiones

- Cookie de sesión **HttpOnly**, `Secure` en producción, `SameSite` configurable
  (`Lax` en local, `None` para frontend y API en dominios distintos).
- El token de sesión es aleatorio (`secrets.token_urlsafe(32)`) y se guarda **hasheado**
  (SHA-256) en la tabla `sessions`; la base de datos no permite reutilizar un token robado
  desde un dump.
- Expiración por inactividad (`SESSION_IDLE_MINUTES`, 120 por defecto) y absoluta
  (`SESSION_ABSOLUTE_HOURS`, 12 por defecto).
- El login rota la sesión: cualquier sesión previa asociada a la cookie se revoca.
- El usuario puede listar y revocar sus sesiones (`/api/v1/auth/sessions`).
- El estado de autenticación **no** se guarda en `localStorage` ni en `sessionStorage`.
- `SECRET_KEY` es obligatoria en producción, con al menos 32 caracteres y sin valores de
  ejemplo. El backend se niega a arrancar si falta o es débil.

## CSRF

Patrón *double submit* con firma:

1. El cliente pide `GET /api/v1/auth/csrf`.
2. El servidor devuelve el token en el cuerpo y en la cookie `af_csrf` (legible por JS).
3. Toda petición `POST/PUT/PATCH/DELETE` a `/api/*` debe enviar `X-CSRF-Token`.
4. El servidor compara encabezado, cookie, firma HMAC y el hash asociado a la sesión.

El token se mantiene en memoria en el frontend. Si se recarga la página, se solicita uno
nuevo. Las peticiones sin token se rechazan con `403 csrf_failed` **antes** de ejecutar la
vista.

## Autorización y aislamiento multiempresa

- Roles en base de datos: `admin` > `contador` > `auxiliar`.
- Toda ruta con `company_id` llama a `authorized_company()`: verifica que la empresa exista,
  que el usuario tenga membresía **activa** y, si aplica, el rol mínimo.
- Las consultas siempre filtran por `company_id`; un ID de otra empresa devuelve `403`
  (no `404`, para no confirmar existencia).
- Las pruebas `tests/test_isolation.py` y `tests/test_postgres_integration.py` intentan
  acceder a una empresa ajena por detalle, dashboard e ingresos.

**Supabase no sustituye estas comprobaciones.** El aislamiento multiempresa se sigue
validando en Flask, con SQLAlchemy y el rol de base de datos de la aplicación.

## CORS y cabeceras

- Orígenes permitidos: `FRONTEND_ORIGIN` + `CORS_ORIGINS` (lista explícita). Nunca `*`.
- `Access-Control-Allow-Credentials: true` solo para orígenes de la lista.
- Cabeceras de respuesta: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  y HSTS cuando la cookie es `Secure`.
- `X-Request-ID` por petición para correlacionar logs.

## Base de datos: modos y credenciales

- PostgreSQL es el modo normal. SQLite requiere `DB_MODE=sqlite` explícito, solo para demo o
  pruebas, y está prohibido en producción.
- En producción `DATABASE_URL` es obligatoria; el arranque falla si falta.
- Las URLs de conexión no se imprimen en logs, respuestas ni mensajes de error. Las
  contraseñas de Supabase se percent-encodean en la URL; no se concatenan a mano.
- El pool está acotado (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, timeout y reciclado) para no
  agotar las conexiones del proveedor.
- TLS: en Supabase usar como mínimo `sslmode=require`; para verificar el servidor,
  `verify-full` con el certificado raíz descargado del dashboard. No se desactiva TLS para
  resolver errores.
- La credencial de ejecución debe tener privilegios mínimos (DML y secuencias). Las
  migraciones pueden usar una credencial separada, más privilegiada, y una conexión directa.

## Supabase como proveedor PostgreSQL

Arquitectura: **navegador → Flask → Supabase PostgreSQL**. El navegador nunca recibe una
cadena de conexión ni una clave de base de datos.

Reglas:

1. **Desactivar la Data API** si Flask es el único intermediario. Sin Data API no hay
   endpoints REST/GraphQL automáticos sobre las tablas del ERP.
2. **No usar** Supabase Auth, `supabase-js`, ni claves `anon`, `service_role`,
   `sb_publishable_*` o `sb_secret_*` en el frontend. No hay ninguna variable `VITE_*` con
   credenciales de base de datos.
3. **No asumir que RLS protege al backend.** El rol de conexión de Flask puede tener
   privilegios que omitan RLS; las comprobaciones de empresa siguen en el backend.
4. Si en el futuro se habilita la Data API, las tablas expuestas deben tener RLS y
   privilegios revisados. Las tablas de `public` pueden recibir grants automáticos a
   `anon`/`authenticated` según la configuración del proyecto; hay que verificarlo y
   revocarlos si no se usan.
5. Preferir un **esquema dedicado no expuesto** para el ERP si se va a usar la Data API para
   otros fines. La app admite `DB_SCHEMA`, pero el esquema y sus privilegios deben crearse
   antes de migrar. Esta modalidad no se validó localmente.
6. La conexión directa es preferible para un backend persistente con IPv6; el pooler
   compartido en modo sesión es la alternativa IPv4. No usar transaction pooling por
   defecto: no soporta prepared statements.
7. Las migraciones usan conexión directa. No se asume que un pooler sea equivalente para
   DDL.

## Auditoría

Cada operación relevante escribe un `AuditEvent` con empresa, actor, acción, recurso,
detalle y `request_id`: login/logout, creación de ingresos/gastos, cobros, pagos, cambios de
plan, reservas, obligaciones, alertas y comentarios. El historial se consulta en
`GET /api/v1/companies/{id}/audit` (rol `contador` o superior).

## Validación de entrada

- Importes: `Decimal` con 2 decimales, no negativos, convertidos a cadena en la respuesta.
- Fechas: `YYYY-MM-DD` (se acepta `YYYY-MM-DDTHH:MM:SS`).
- Enums validados en servidor (`status`, `priority`, `origin`, `kind`, `unit`, `role`).
- Longitudes acotadas por columna; los textos libres se truncan.
- Documentos duplicados por empresa devuelven `409` (restricción única en base de datos).
- En PostgreSQL las claves foráneas, unicidad y `CHECK` se validan en el motor; las pruebas
  de integración lo comprueban.

## Recomendaciones antes de un uso real

1. Definir `SECRET_KEY` larga y aleatoria; nunca reutilizar la de ejemplo.
2. Usar PostgreSQL administrado con respaldos y TLS; en Supabase, verificar la versión de
   PostgreSQL antes de la validación final.
3. Mover el rate limiting a Redis.
4. Implementar recuperación de contraseña con correo transaccional (hoy solo registra la
   solicitud en logs, sin revelar si el correo existe).
5. Rotar las credenciales de la demo o desactivar `flask seed-demo` en producción real.
6. Añadir monitoreo de errores 5xx y alertas de `/health/ready`.
7. Si se agregan varias réplicas, revisar `preload_app`, el rate limiting compartido y el
   presupuesto de conexiones.
8. Revisar periódicamente los grants y la configuración de la Data API en Supabase.

## Reporte de vulnerabilidades

Este es un proyecto académico sin canal formal. No publiques credenciales reales en issues.
