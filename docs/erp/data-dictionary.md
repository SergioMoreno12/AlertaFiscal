# Data dictionary — external context

This dictionary covers only the external context tables and files added in the limited stage 2. It does not describe the operational ERP tables (companies, income, expenses, plans, reserves, obligations and alerts), which keep their schema. The Phase 2 dataset used to train the global model is described in `docs/02_data_dictionary.md`.

## Conventions

| Topic | Convention |
|---|---|
| Currency | Colombian pesos (COP) in `Numeric(24, 2)` or decimal text with two digits |
| Supersociedades | The original publishes **trillions (10¹² COP)**; the processed file converts to COP |
| DIAN | The original publishes **millions (10⁶ COP)**; the processed file converts to COP |
| Calendar dates | `DATE` (no time zone) |
| Timestamps | `DateTime(timezone=True)` in UTC |
| Booleans | `true` / `false` |
| Nulls | `NULL` means "not applicable or not published"; it is never replaced by 0 |
| Preliminary | `is_preliminary` marks a figure subject to review by the publisher |
| Partial | `is_partial` marks an incomplete period (for example, 2026 up to September) |

## Tables

### `external_sources`

Describes the **logical source**, regardless of how many downloads were made.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer PK | No | Internal identifier |
| `code` | String(60) unique | No | Stable code: `dian_recaudo`, `supersociedades_top10000` |
| `name` | String(200) | No | Readable name |
| `publisher` | String(200) | No | Publishing entity |
| `dataset_id` | String(80) | Yes | Dataset identifier (Socrata) if any |
| `source_url` | String(500) | No | Official page or resource |
| `metadata_url` | String(500) | Yes | Source metadata |
| `attribution` | String(300) | No | Required attribution text |
| `attribution_url` | String(500) | Yes | Attribution link |
| `license_name` | String(200) | No | License name or "Not verified" |
| `license_id` | String(80) | Yes | License identifier (for example `CC_40_BY_SA`) |
| `license_url` | String(500) | Yes | License terms |
| `license_status` | String(20) | No | `verified`, `uncertain` or `restricted` |
| `license_evidence_path` | String(300) | Yes | Path of the local license evidence |
| `cadence` | String(300) | No | Expected cadence; it can be irregular |
| `description` | Text | No | Description and scope |
| `is_active` | Boolean | No | Source enabled |
| `created_at`, `updated_at` | DateTime(tz) | No | Technical audit |

Constraint: `license_status in ('verified','uncertain','restricted')`.

### `external_dataset_versions`

Describes each **acquisition** of a logical source.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer PK | No | Internal identifier |
| `source_id` | FK → `external_sources.id` | No | Logical source; `ON DELETE CASCADE` |
| `version_label` | String(40) | No | Readable label, for example `20261030T214803Z` |
| `identity_sha256` | String(64) | No | Identity hash of the acquired content |
| `acquired_at` | DateTime(tz) | No | Acquisition date and time |
| `cutoff_date` | Date | Yes | Cutoff date declared by the source |
| `period_start` | Date | Yes | Start of the covered period |
| `period_end` | Date | Yes | End of the covered period |
| `is_partial` | Boolean | No | The period is incomplete |
| `is_preliminary` | Boolean | No | Preliminary figures |
| `status` | String(20) | No | `succeeded`, `failed` or `blocked` |
| `row_count` | Integer | No | Rows declared by the manifest |
| `file_name` | String(255) | Yes | Main file, if any |
| `manifest_path` | String(400) | No | Path of the versioned manifest |
| `manifest_sha256` | String(64) | No | Hash of the loaded manifest |
| `source_updated_at` | DateTime(tz) | Yes | Last update reported by the source |
| `is_current` | Boolean | No | Current version of the source |
| `notes` | Text | No | Limitations and assumptions |
| `created_at`, `updated_at` | DateTime(tz) | No | Technical audit |

Constraints and indexes:

- `UNIQUE (source_id, identity_sha256)`: the same download is not duplicated.
- Partial unique index `uq_external_version_current (source_id) WHERE is_current`: at most one current version per source.
- `CHECK status in ('succeeded','failed','blocked')`.
- Index `(source_id, version_label)` for the history.

### `tax_collections`

DIAN collection facts, always linked to a version.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer PK | No | Internal identifier |
| `version_id` | FK → `external_dataset_versions.id` | No | Source version; `ON DELETE CASCADE` |
| `row_key` | String(64) | No | Hash of the logical key of the row |
| `scope` | String(20) | No | `national` or `department` |
| `frequency` | String(20) | No | `annual` or `monthly` |
| `period_year` | Integer | No | Year of the period |
| `period_month` | Integer | Yes | Month (1–12), only for the monthly frequency |
| `department_name` | String(160) | Yes | Regional office; only for `scope=department` |
| `series_code` | String(80) | No | Normalized series code (for example `total_dian`) |
| `series_label` | String(200) | No | Original series label |
| `value_cop` | Numeric(24,2) | No | Value in COP |
| `is_preliminary` | Boolean | No | Preliminary figure |
| `created_at`, `updated_at` | DateTime(tz) | No | Technical audit |

Logical key (`row_key`): `scope | frequency | period_year | period_month | department_name | series_code`, encoded with SHA-256.

Constraints:

- `UNIQUE (version_id, row_key)`.
- `CHECK scope in ('national','department')`.
- `CHECK frequency in ('annual','monthly')`.

### `sector_benchmarks`

Supersociedades aggregates by year, metric and macro-sector.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer PK | No | Internal identifier |
| `version_id` | FK → `external_dataset_versions.id` | No | Source version |
| `year` | Integer | No | Cutoff year |
| `metric` | String(60) | No | Code (source column names): `ingresos_operacionales`, `ganancia_p_rdida`, `total_activos`, `total_pasivos`, `total_patrimonio` |
| `metric_label` | String(120) | No | Readable label |
| `sector` | String(80) | No | Macro-sector, or `ALL` for the total |
| `sample_size` | Integer | No | Companies included in the aggregate |
| `total_cop` | Numeric(24,2) | No | Sum in COP |
| `mean_cop` | Numeric(24,2) | No | Mean in COP |
| `median_cop` | Numeric(24,2) | No | Median in COP |
| `p25_cop`, `p75_cop` | Numeric(24,2) | No | Quartiles in COP |
| `min_cop`, `max_cop` | Numeric(24,2) | No | Minimum and maximum in COP |
| `zero_count` | Integer | No | Companies with a value of exactly 0 |
| `negative_count` | Integer | No | Companies with a negative value |
| `created_at`, `updated_at` | DateTime(tz) | No | Technical audit |

Constraint: `UNIQUE (version_id, year, metric, sector)`.

## Processed files

### `sector_benchmarks.csv`

Columns: `year, metric, metric_label, sector, sample_size, total_cop, mean_cop, median_cop, p25_cop, p75_cop, min_cop, max_cop, zero_count, negative_count`.

- `sector = ALL` aggregates every company of the year.
- Quantiles use linear interpolation on the published values.
- Values are in COP after multiplying by 10¹².

### `tax_collection.csv`

Columns: `scope, frequency, period_year, period_month, department_name, series_code, series_label, value_cop, is_preliminary`.

- `period_month` is empty in annual rows.
- `department_name` is empty in national rows.
- The annual total rows of the regional sheet are excluded to avoid double counting. The source uses variants such as `TOTAL AÑO 2005`, `TOTAL_AÑO_2010` and `TOTA  AÑO 2026`; the processor normalizes them before comparing.
- `department_name` keeps the original spelling. There are 51 distinct names for about 48 regional offices (for example `ADUANAS CARTAGENA` and `ADUANAS DE CARTAGENA`); they are not normalized so the source is not altered. Department filters must use the exact name.
- `value_cop` is in COP after multiplying by 10⁶.

### `quality.json`

Summarizes the counts, years, sectors, reconciliations and limitations of each processing run. It is saved next to the CSV and its hash is recorded in the manifest.

## Acquisition manifest

General structure:

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

`processed` is the list the loader uses to validate paths, hashes and counts before inserting. The loader does not download: if the processed file is missing, it fails explicitly.

## Read-only API

| Route | Description |
|---|---|
| `GET /api/v1/context/sources` | Sources with their current version |
| `GET /api/v1/context/sources/<code>` | Detail and version history |
| `GET /api/v1/context/summary` | Summary for the "Context and sources" screen |
| `GET /api/v1/context/tax-collections` | Paginated collection data with filters |
| `GET /api/v1/context/sector-benchmarks` | Paginated sector aggregates |

All of them require a session (`@require_auth`). There is no write endpoint. The responses include a `disclaimer` that reminds that the context is not an obligation of the company.
