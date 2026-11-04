# External context sources

> **Notice:** this document describes public data used as **aggregated context**. It is not a tax obligation of any company, it is not joined by NIT with the ERP and it does not feed the forecast or the alerts.

## 1. Principles

1. **Separate domains.** The ERP describes facts of a company (income, expenses, plans, reserves). External sources describe national or sector aggregates. Mixing them would produce false comparisons.
2. **No join by NIT.** Supersociedades is never matched with ERP companies or with the DIAN. National totals are not added up as if they were independent observations.
3. **Context, not a label.** No external figure is used as a non-compliance label or as a model training variable.
4. **Immutable originals.** Raw files live in `ml/data/raw/` (ignored by git) and are never overwritten. Each new acquisition is saved in a folder labeled with its version.
5. **Reproducible processing.** Derived files are produced by versioned scripts and recorded with their hash, count and date in a manifest.
6. **Nothing is downloaded on request.** The API only reads what was explicitly acquired, processed and loaded. Flask startup does not download, train or run automatic seeds.

## 2. Supersociedades — 10,000 largest companies

| Field | Value |
|---|---|
| Internal code | `supersociedades_top10000` |
| Dataset | `6cat-2gcs` (datos.gov.co / Socrata) |
| Publisher | Superintendencia de Sociedades (Supersociedades) |
| Attribution | Superintendencia de Sociedades SuperSociedades, Bogotá D.C. |
| License | Creative Commons Attribution \| Share Alike 4.0 International (`CC_40_BY_SA`) |
| Terms | <http://creativecommons.org/licenses/by-sa/4.0/legalcode> |
| Evidence | `docs/erp/evidence/supersociedades-license.json` |
| Cadence | Irregular, no fixed calendar; do not assume a monthly frequency |
| Coverage | 2021–2025, 50,000 rows × 14 columns |
| Granularity | One row per company and cutoff year |
| Original units | **Trillions of pesos (10¹² COP)**, not billions |
| Acquisition | 2026-10-30T21:48:03Z |
| Last source update | 2026-09-16T20:29:04Z |
| File | `ml/data/raw/supersociedades_10000_empresas.csv` (9,100,868 bytes) |
| SHA-256 | `5162638b205f752277cdc6c5965bf6d5169dc932d332288a188f95fbb59b017f` |
| Manifest | `ml/company_trainer/sources/manifests/supersociedades_top10000/20261030T214803Z.json` |

### Download integrity

Verified with a **count + stable pagination** against the Socrata API:

- Remote `count(*)`: 50,000 rows.
- Local rows: 50,000.
- Pagination: 10 pages of 5,000, ordered by `nit,a_o_de_corte,raz_n_social`.
- Duplicate keys in the pagination: 0.
- Hash of local keys = hash of remote keys: `366645ff4b4690747077a547425b0783bf633149be751ef501874a65037e1b94`.

The check is repeated with `python -m ml.company_trainer.sources.acquire supersociedades` (without `--download`), which does not download again: it compares the local file with the source.

### Processing

`python -m ml.company_trainer.sources.build_context supersociedades` produces `ml/data/processed/supersociedades_top10000/20261030T214803Z/sector_benchmarks.csv` (175 rows: 5 years × 5 metrics × 7 sectors, including `ALL`).

- The two published decimals are kept; no precision is made up.
- Accounting identity residual `assets − liabilities − equity`: at most 0.01 trillion, with no row above the tolerance.
- Duplicate company-year pairs: 0.
- Distinct companies: 15,032.

### Limitations

- It is a sample of the **10,000 largest companies**, not a census.
- It has selection and size bias; it does not represent small businesses.
- Macro-sector aggregates do not describe an individual company.
- The license requires attribution and sharing adaptations under the same license.

## 3. DIAN — collection statistics

| Field | Value |
|---|---|
| Internal code | `dian_recaudo` |
| Publisher | DIAN — Subdirección de Estudios Económicos |
| Page | <https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx> |
| License | **Not verified at the source** (`uncertain`) |
| Evidence | `docs/erp/evidence/dian-license-uncertainty.md` |
| Cadence | Monthly/irregular; regional offices can be published later |
| Cutoff date | 2026-10-23 |
| Units | **Millions of current pesos** |
| Manifest | `ml/company_trainer/sources/manifests/dian_recaudo/20261030T214856Z.json` |

### Original files

| File | Coverage | SHA-256 |
|---|---|---|
| `Recaudo-anual-por-tipo-de-impuesto-1970-2026.xlsx` | 57 years (1970–2026p) | `d47b15934af8cdef96a9c70e54d76544a3e463319c6b18e9d6211bd9384a7524` |
| `Recaudo-mensual-por-tipo-de-impuesto-2000-2026.xlsx` | 321 months (2000–2026, 9 months in 2026) | `68d5c296ba43554f7bb1f49fbebaddc6a1136c50c00cc6e65108de298804f0bd` |
| `Recaudo-bruto-por-seccionales-y-tipo-de-impuesto-2005-2026.xlsx` | 1,078 rows read: 1,056 regional offices + 22 total rows (2005–2026p) | `d625f23dac232acd32fc4ea237d3f23842f8108d06a48a9fb4f1f8966b6dc58b` |

The three files are in `ml/data/raw/dian/` and are **not committed or redistributed** while the license stays unverified.

### Processing

`python -m ml.company_trainer.sources.build_context dian` produces `ml/data/processed/dian_recaudo/20261030T214856Z/tax_collection.csv` (28,064 rows, SHA-256 `ca327290c99f2277f49e3405f731623815ffac0229e3087a0af940508a21f77a`).

- The 22 annual total rows of the regional sheet are excluded so collection is not counted twice. The source uses variants: `TOTAL AÑO 2005`, `TOTAL_AÑO_2010` and, in 2026, `TOTA  AÑO 2026` (without the L and with a double space). The detection normalizes accents, separators and spaces; it does not depend on one spelling.
- The 2026 series is marked `is_preliminary=true` and is partial (up to September).
- Figures are not deflated: they are current pesos.

### Reconciliations

DIAN publishes in **millions of COP** and Supersociedades in **trillions (10¹²) of COP**. The processing converts to COP, but that conversion **creates no precision**: the figures are documented in their original unit and the conversion is shown only for reading convenience.

| Comparison | Difference in original unit (millions of COP) | Difference in COP | Tolerance applied |
|---|---|---|---|
| Monthly vs annual 2010–2025 (max.) | 0.00000007 | 0.07 | 0.10 COP |
| Regional 2025 vs national 2025 | 0.0000001 | 0.10 | 0.10 COP |
| Regional 2026 vs national 2026 | 0.00000001 | 0.01 | 0.10 COP |
| Regional vs national 2013–2026 (worst year, 2017) | 4.42241398 | 4,422,413.98 | 50,000,000 COP |

- **Monthly vs annual (2010–2025):** the maximum difference is 0.07 COP. Both series are published in millions with two decimals; the residual is the source's rounding.
- **Regional 2025 vs national 2025:** 294,462,356,991,440.00 vs 294,462,356,991,440.10 COP; difference 0.10 COP (0.0000001 millions).
- **Regional 2026 vs national 2026:** 241,511,755,928,644.99 vs 241,511,755,928,645.00 COP; difference 0.01 COP. This check catches a duplicated total row.
- **2013–2026:** each regional office is published in whole millions, so the sum can differ from the national total by up to 4,422,413.98 COP (2017). The 50,000,000 COP tolerance covers the rounding of 48 cells and is still far smaller than any relevant figure (the 2026 total exceeds 2.4×10¹⁴ COP). It is not treated as a loading error.
- **2005–2012:** the regional sheet does not cover all national collection; the difference is not treated as a loading error and those years are not used for the regional-national reconciliation.

The reproducible validation is `python -m ml.company_trainer.sources.validate`. It checks that no total row is treated as a regional office, that there are no duplicate keys, that the quantiles are ordered and that the hashes and counts match the manifest.

These reconciliations validate how the files are read; they do **not** turn collection into an obligation of a company. Amounts shown in COP must not be presented as original precision to the cent: the real resolution is the source's (millions or trillions).

### Limitations

- Aggregated collection does not say how much a company owes or paid.
- 2026 is partial and preliminary; it must not be compared as a full year.
- Before 2013 the regional sheet does not cover all national collection; it is not used to reconcile against the national total.
- Regional office names keep the source's spelling and have variants; they are not normalized so the original is not altered.
- There are no historical vintages of the publications: only the acquired copy is kept.
- Without a verified license, neither a legal prohibition nor an authorization is claimed: a conservative no-redistribution position is adopted.

## 4. Reproduction

From the repository root:

```powershell
# 1) Acquisition / verification (network only in this step)
ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire supersociedades
ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire dian

# 2) Offline processing into context CSV files
ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.build_context all

# 3) Idempotent load into PostgreSQL (creates no alerts)
cd backend
.venv/Scripts/python.exe -m flask context-load ..\ml\company_trainer\sources\manifests\supersociedades_top10000\20261030T214803Z.json
.venv/Scripts/python.exe -m flask context-load ..\ml\company_trainer\sources\manifests\dian_recaudo\20261030T214856Z.json
```

`context-load` accepts `--dry-run` (validates without writing) and `--replace` (reloads the aggregates of a version). Without `--replace`, a second load of the same manifest returns `skipped`.

## 5. Versioning and failures

- **Logical source vs acquisition version.** `external_sources` describes the source (publisher, license, cadence). `external_dataset_versions` describes each acquisition.
- **Identity by content.** The identity is `identity_sha256`, not the date label. Two downloads with the same name but different content are kept as different versions.
- **Only one current.** A partial unique index guarantees one `is_current` version per source. Earlier ones are not deleted.
- **Source failure.** If the download or verification fails, the command ends with status `blocked`, the last valid version is kept and the original is requested. Gaps are never filled with made-up data and an estimate is never presented as a download.

## 6. What this stage does not do

- It does not change the alert engine, the reserves or the obligations.
- It does not use the sources to train or to create labels.
- It creates no alerts or accountant tasks from the context.
- It exposes no writes: the context API is read only.
