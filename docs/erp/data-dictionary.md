# Diccionario de datos — contexto externo

Este diccionario cubre solo las tablas y archivos de contexto externo añadidos en la
etapa 2 limitada. No describe las tablas operativas del ERP (empresas, ingresos, gastos,
planes, reservas, obligaciones y alertas), que conservan su esquema.

## Convenciones

| Tema | Convención |
|---|---|
| Moneda | Pesos colombianos (COP) en `Numeric(24, 2)` o texto decimal con dos cifras |
| Supersociedades | El original publica **billones (10¹² COP)**; el procesado convierte a COP |
| DIAN | El original publica **millones (10⁶ COP)**; el procesado convierte a COP |
| Fechas de calendario | `DATE` (sin zona horaria) |
| Marcas de tiempo | `DateTime(timezone=True)` en UTC |
| Booleanos | `true` / `false` |
| Nulos | `NULL` significa “no aplica o no publicado”; no se reemplaza por 0 |
| Preliminar | `is_preliminary` indica cifra sujeta a revisión del publicador |
| Parcial | `is_partial` indica período incompleto (por ejemplo, 2026 a septiembre) |

## Tablas

### `external_sources`

Describe la **fuente lógica**, independiente de cuántas descargas se hayan hecho.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | Integer PK | No | Identificador interno |
| `code` | String(60) único | No | Código estable: `dian_recaudo`, `supersociedades_top10000` |
| `name` | String(200) | No | Nombre legible |
| `publisher` | String(200) | No | Entidad publicadora |
| `dataset_id` | String(80) | Sí | Identificador del dataset (Socrata) si existe |
| `source_url` | String(500) | No | Página o recurso oficial |
| `metadata_url` | String(500) | Sí | Metadatos de la fuente |
| `attribution` | String(300) | No | Texto de atribución requerido |
| `attribution_url` | String(500) | Sí | Enlace de atribución |
| `license_name` | String(200) | No | Nombre de la licencia o “No verificada” |
| `license_id` | String(80) | Sí | Identificador de licencia (por ejemplo `CC_40_BY_SA`) |
| `license_url` | String(500) | Sí | Términos de licencia |
| `license_status` | String(20) | No | `verified`, `uncertain` o `restricted` |
| `license_evidence_path` | String(300) | Sí | Ruta de la evidencia local de licencia |
| `cadence` | String(300) | No | Cadencia esperada; puede ser irregular |
| `description` | Text | No | Descripción y alcance |
| `is_active` | Boolean | No | Fuente habilitada |
| `created_at`, `updated_at` | DateTime(tz) | No | Auditoría técnica |

Restricción: `license_status in ('verified','uncertain','restricted')`.

### `external_dataset_versions`

Describe cada **adquisición** de una fuente lógica.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | Integer PK | No | Identificador interno |
| `source_id` | FK → `external_sources.id` | No | Fuente lógica; `ON DELETE CASCADE` |
| `version_label` | String(40) | No | Etiqueta legible, por ejemplo `20261030T214803Z` |
| `identity_sha256` | String(64) | No | Hash de identidad del contenido adquirido |
| `acquired_at` | DateTime(tz) | No | Fecha/hora de adquisición |
| `cutoff_date` | Date | Sí | Fecha de corte declarada por la fuente |
| `period_start` | Date | Sí | Inicio del período cubierto |
| `period_end` | Date | Sí | Fin del período cubierto |
| `is_partial` | Boolean | No | El período está incompleto |
| `is_preliminary` | Boolean | No | Cifras preliminares |
| `status` | String(20) | No | `succeeded`, `failed` o `blocked` |
| `row_count` | Integer | No | Filas declaradas por el manifiesto |
| `file_name` | String(255) | Sí | Archivo principal, si aplica |
| `manifest_path` | String(400) | No | Ruta del manifiesto versionado |
| `manifest_sha256` | String(64) | No | Hash del manifiesto cargado |
| `source_updated_at` | DateTime(tz) | Sí | Última actualización informada por la fuente |
| `is_current` | Boolean | No | Versión vigente para la fuente |
| `notes` | Text | No | Limitaciones y supuestos |
| `created_at`, `updated_at` | DateTime(tz) | No | Auditoría técnica |

Restricciones e índices:

- `UNIQUE (source_id, identity_sha256)`: la misma descarga no se duplica.
- Índice único parcial `uq_external_version_current (source_id) WHERE is_current`:
  como máximo una versión vigente por fuente.
- `CHECK status in ('succeeded','failed','blocked')`.
- Índice `(source_id, version_label)` para historial.

### `tax_collections`

Hechos de recaudo DIAN, siempre ligados a una versión.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | Integer PK | No | Identificador interno |
| `version_id` | FK → `external_dataset_versions.id` | No | Versión de origen; `ON DELETE CASCADE` |
| `row_key` | String(64) | No | Hash de la clave lógica de la fila |
| `scope` | String(20) | No | `national` o `department` |
| `frequency` | String(20) | No | `annual` o `monthly` |
| `period_year` | Integer | No | Año del período |
| `period_month` | Integer | Sí | Mes (1–12) solo para frecuencia mensual |
| `department_name` | String(160) | Sí | Dirección seccional; solo para `scope=department` |
| `series_code` | String(80) | No | Código normalizado de la serie (por ejemplo `total_dian`) |
| `series_label` | String(200) | No | Etiqueta original de la serie |
| `value_cop` | Numeric(24,2) | No | Valor en COP |
| `is_preliminary` | Boolean | No | Cifra preliminar |
| `created_at`, `updated_at` | DateTime(tz) | No | Auditoría técnica |

Clave lógica (`row_key`): `scope | frequency | period_year | period_month |
department_name | series_code`, codificada con SHA-256.

Restricciones:

- `UNIQUE (version_id, row_key)`.
- `CHECK scope in ('national','department')`.
- `CHECK frequency in ('annual','monthly')`.

### `sector_benchmarks`

Agregados por año, métrica y macrosector de Supersociedades.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | Integer PK | No | Identificador interno |
| `version_id` | FK → `external_dataset_versions.id` | No | Versión de origen |
| `year` | Integer | No | Año de corte |
| `metric` | String(60) | No | Código: `ingresos_operacionales`, `ganancia_p_rdida`, `total_activos`, `total_pasivos`, `total_patrimonio` |
| `metric_label` | String(120) | No | Etiqueta legible |
| `sector` | String(80) | No | Macrosector o `ALL` para el total |
| `sample_size` | Integer | No | Empresas incluidas en el agregado |
| `total_cop` | Numeric(24,2) | No | Suma en COP |
| `mean_cop` | Numeric(24,2) | No | Promedio en COP |
| `median_cop` | Numeric(24,2) | No | Mediana en COP |
| `p25_cop`, `p75_cop` | Numeric(24,2) | No | Cuartiles en COP |
| `min_cop`, `max_cop` | Numeric(24,2) | No | Mínimo y máximo en COP |
| `zero_count` | Integer | No | Empresas con valor exactamente 0 |
| `negative_count` | Integer | No | Empresas con valor negativo |
| `created_at`, `updated_at` | DateTime(tz) | No | Auditoría técnica |

Restricción: `UNIQUE (version_id, year, metric, sector)`.

## Archivos procesados

### `sector_benchmarks.csv`

Columnas: `year, metric, metric_label, sector, sample_size, total_cop, mean_cop,
median_cop, p25_cop, p75_cop, min_cop, max_cop, zero_count, negative_count`.

- `sector = ALL` agrega todas las empresas del año.
- Los cuantiles usan interpolación lineal sobre los valores publicados.
- Los valores están en COP tras multiplicar por 10¹².

### `tax_collection.csv`

Columnas: `scope, frequency, period_year, period_month, department_name, series_code,
series_label, value_cop, is_preliminary`.

- `period_month` va vacío en filas anuales.
- `department_name` va vacío en filas nacionales.
- Las filas de total anual de la hoja seccional se excluyen para evitar doble conteo.
  La fuente usa variantes como `TOTAL AÑO 2005`, `TOTAL_AÑO_2010` y `TOTA  AÑO 2026`;
  el procesador las normaliza antes de comparar.
- `department_name` conserva la grafía original. Hay 51 nombres distintos para unas 48
  seccionales (por ejemplo `ADUANAS CARTAGENA` y `ADUANAS DE CARTAGENA`); no se normalizan
  para no alterar la fuente. Los filtros por departamento deben usar el nombre exacto.
- `value_cop` está en COP tras multiplicar por 10⁶.

### `quality.json`

Resume conteos, años, sectores, conciliaciones y limitaciones de cada procesamiento.
Se guarda junto al CSV y su hash queda en el manifiesto.

## Manifiesto de adquisición

Estructura general:

```json
{
  "manifest_version": 1,
  "generated_at": "…",
  "source": { "code": "…", "license": { "status": "…" }, "cadence": "…" },
  "version": {
    "version_label": "…",
    "identity_sha256": "…",
    "acquired_at": "…",
    "cutoff_date": "…",
    "is_partial": false,
    "is_preliminary": false,
    "status": "succeeded",
    "file": { "sha256": "…", "bytes": 0 },
    "files": [],
    "integrity": {},
    "processed": [
      { "table": "tax_collections", "path": "…", "sha256": "…", "rows": 0 }
    ]
  }
}
```

`processed` es la lista que consume el cargador para validar rutas, hashes y conteos antes
de insertar. El cargador no descarga: si falta el archivo procesado, falla de forma explícita.

## API de solo lectura

| Ruta | Descripción |
|---|---|
| `GET /api/v1/context/sources` | Fuentes con su versión vigente |
| `GET /api/v1/context/sources/<code>` | Detalle e historial de versiones |
| `GET /api/v1/context/summary` | Resumen para la pantalla “Contexto y fuentes” |
| `GET /api/v1/context/tax-collections` | Recaudo paginado con filtros |
| `GET /api/v1/context/sector-benchmarks` | Agregados sectoriales paginados |

Todas requieren sesión (`@require_auth`). No existe endpoint de escritura. Las respuestas
incluyen un `disclaimer` que recuerda que el contexto no es una obligación de la empresa.
