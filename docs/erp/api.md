# API REST (`/api/v1`)

- Formato: JSON UTF-8.
- Autenticación: cookie de sesión + `X-CSRF-Token` en métodos mutantes.
- Importes: cadenas decimales (`"1190000.00"`).
- Marcas de tiempo (`created_at`, `updated_at`): ISO-8601 con zona (`"2026-10-01T15:04:05+00:00"`).
- Fechas de calendario (`issue_date`, `due_date`, `cutoff_date`): solo día (`"2026-10-01"`).
  No se envían como medianoche UTC para evitar que un cliente en UTC−5 muestre el día anterior.
- Errores: `{"error": {"code": "...", "message": "...", "request_id": "..."}}`.
- Paginación: `?page=1&page_size=20` (máximo 100).

## Salud

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health/live` | Proceso vivo. |
| GET | `/health/ready` | Comprueba la base; devuelve `database` (`postgresql` o `sqlite-dev`) y `demo` (`true` solo si SQLite está habilitado explícitamente). Responde `503` si la base no responde. |

## Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/auth/csrf` | Emite token CSRF (cuerpo + cookie). |
| POST | `/auth/login` | `{email, password}` → usuario + `csrf_token`. |
| POST | `/auth/logout` | Revoca la sesión actual. |
| GET | `/auth/me` | Usuario y empresas (memberships). |
| GET | `/auth/sessions` | Sesiones activas del usuario. |
| DELETE | `/auth/sessions/{id}` | Revoca una sesión propia. |
| POST | `/auth/password-reset/request` | Respuesta genérica; no revela si el correo existe. |

Ejemplo de login:

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
    "full_name": "María Gómez",
    "companies": [{"id": 1, "name": "Comercializadora Andina S.A.S.", "nit": "900.456.123-1", "role": "admin"}]
  },
  "csrf_token": "..."
}
```

## Empresas y panel

| Método | Ruta | Rol |
|---|---|---|
| GET | `/companies` | autenticado |
| GET | `/companies/{id}` | miembro |
| GET | `/companies/{id}/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` | miembro |

El dashboard devuelve `totals`, `monthly`, `alerts.open`, `obligations` y `plan`
(meta/registrado/cobertura).

## Movimientos

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET/POST | `/companies/{id}/income` | miembro / auxiliar |
| GET | `/companies/{id}/income/{income_id}` | miembro |
| GET/POST | `/companies/{id}/expenses` | miembro / auxiliar |
| PATCH | `/companies/{id}/expenses/{expense_id}` | contador |
| POST | `/companies/{id}/receipts` | auxiliar |
| POST | `/companies/{id}/payments` | auxiliar |
| GET/POST | `/companies/{id}/counterparties` | miembro / auxiliar |

```json
POST /api/v1/companies/1/income
{
  "doc_number": "FV-001",
  "issue_date": "2026-10-01",
  "description": "Venta de mercancía",
  "subtotal": "1000000.00",
  "tax_amount": "190000.00",
  "total": "1190000.00",
  "status": "pending"
}
```

`total` es opcional: si se omite se calcula `subtotal + tax_amount`. Un documento repetido
en la misma empresa devuelve `409 duplicate_document`.

## Planificación

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET/POST | `/companies/{id}/fiscal-parameters` | miembro / contador |
| GET/POST | `/companies/{id}/plans` | miembro / contador |
| GET | `/companies/{id}/plans/{plan_id}` | miembro |
| POST | `/companies/{id}/plans/{plan_id}/versions` | contador |
| POST | `/companies/{id}/plans/{plan_id}/versions/{version_id}/review` | contador |
| GET/POST | `/companies/{id}/reserve-entries` | miembro / contador |
| GET/POST | `/companies/{id}/forecasts` | miembro / contador |

Una versión `reviewed` no se puede volver a revisar (`409`). `POST /forecasts` con menos de
3 meses de historial responde `200` y `{"available": false, "reason": "..."}`; no inventa
datos. Si hay historial, devuelve la estimación manual con `disclaimer`.

### Plan y versiones

`estimated_reserve` es la **meta de reserva definida por el contador**. No se deriva de
`projected_income - projected_expenses` y no representa un impuesto liquidado. Si se omite,
el servidor la guarda como `0.00`; los valores negativos se rechazan con `422`.

```json
POST /api/v1/companies/1/plans
{
  "name": "Plan de reserva Oct 2026",
  "period": "2026-10",
  "projected_income": "55000000.00",
  "projected_expenses": "37000000.00",
  "estimated_reserve": "4500000.00",
  "assumptions": {"source": "manual"},
  "notes": "Revisar con el contador antes del cierre."
}
```

`POST /plans` crea el plan y su versión `1`. `POST /plans/{id}/versions` acepta el mismo
cuerpo sin `name`/`period` y crea la siguiente versión. `POST .../review` marca la versión
como `reviewed` (inmutable). El dashboard expone la versión vigente en `plan` con
`projected_income`, `projected_expenses`, `estimated_reserve`, `reserved` y
`coverage_percent`. La diferencia pendiente se calcula en el cliente como
`max(estimated_reserve - reserved, 0)`.

## Seguimiento y alertas

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET | `/companies/{id}/obligations` | miembro |
| POST | `/companies/{id}/obligations` | contador |
| PATCH | `/companies/{id}/obligations/{obligation_id}` | contador |
| GET | `/companies/{id}/audit` | contador |
| GET/POST | `/companies/{id}/alerts` | miembro / contador |
| GET/PATCH | `/companies/{id}/alerts/{alert_id}` | miembro / contador |
| POST | `/companies/{id}/alerts/{alert_id}/comments` | miembro |

## Códigos de error usados

| HTTP | `code` | Cuándo |
|---|---|---|
| 401 | `unauthorized` / `invalid_credentials` | Sin sesión o credenciales incorrectas. |
| 403 | `forbidden` / `csrf_failed` | Empresa ajena, rol insuficiente o CSRF inválido. |
| 404 | `not_found` | Recurso inexistente dentro de una empresa autorizada. |
| 409 | `duplicate_document` / `invalid_state` | Duplicado o transición no permitida. |
| 422 | `invalid_payload` | Fecha, monto o enum inválido. |
| 429 | `too_many_attempts` | Límite de login excedido. |
| 500 | `server_error` | Error no controlado (se registra con `request_id`). |
