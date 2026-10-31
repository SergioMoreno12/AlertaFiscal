# Data Dictionary

- **Owner:** Sergio Steeven Moreno Forero (Phase 1)
- **Produced by:** Phase 2 scripts (Samuel Castellanos Rivera): `prepare_data.py`, `generate_series.py`, `split_series.py`, `check_dataset.py`
- **Contract frozen on:** November 1, 2026. Any change after that date must be agreed by the whole team and recorded in this file.
- **Verified against:** the generated files; `check_dataset.py` passes 26 of 26 checks.

This document describes, column by column, the two processed files that every later phase reads. It must match the data contract exactly. If a script produces something different, the script is wrong, not this document.

**General rules for both files**

- Encoding UTF-8, comma separator, one header row, no index column.
- Column names are lowercase English, in the order shown below.
- No empty values in any column.
- One row per company and month: 500 companies × 36 months = **18,000 rows**.

---

## 1. `ml/data/processed/monthly_series.csv`

6 columns. One row per company and month. All monthly values are **generated** (semi-synthetic); see [`01_business_and_data.md`](01_business_and_data.md), section 7.

| Column | Type | Unit | Allowed values or range | Source | Derived or simulated | Notes |
|---|---|---|---|---|---|---|
| `company_id` | text | none | `C0001` to `C0500` (letter `C` + 4 digits, zero-padded) | Generator | Simulated | Unique per company and never reused. Does not identify any real company; no NIT or name is kept. |
| `sector` | text | none | One of 6 values: `agriculture`, `construction`, `manufacturing`, `mining`, `retail`, `services` | Supersociedades `macrosector`, translated | Derived | Same value in all 36 rows of a company. Mapping: AGROPECUARIO → `agriculture`, CONSTRUCCIÓN → `construction`, MANUFACTURA → `manufacturing`, MINERO → `mining`, COMERCIO → `retail`, SERVICIOS → `services`. |
| `month` | text | `YYYY-MM` | `2023-01` to `2025-12`, 36 consecutive months | Generator | Simulated | Same 36 months for every company. Calendar month, not a date; no day part. |
| `income` | number | millions of COP | ≥ 0, two decimals. Observed: 9.16 to 1,608.40 (median 116.86) | Generator calibrated with Supersociedades (size rank, annual growth) and DIAN (seasonality) | Simulated | Monthly operating income, rescaled to small-business size (annual income COP 300–6,000 million at month 1). Never empty. |
| `expenses` | number | millions of COP | ≥ 0, two decimals | Generator: `income × (1 − margin)` with its own noise; margin from Supersociedades | Simulated | Monthly costs and expenses. Never empty. Can exceed `income` in a given month (loss month): about 30 % of company-months, because real sector margins are thin (retail median 1.8 %). |
| `origin` | text | none | `derived` (301 companies) or `simulated` (199 companies) | Generator | — | How the company's **profile** (sector, margin, annual growth) was obtained. `derived`: taken from a real Supersociedades record. `simulated`: sampled from the sector's distributions. Same value in all 36 rows of a company. In both cases the monthly values are simulated. |

**Companies per sector**

| Sector | Derived | Simulated | Total | Holdout |
|---|---|---|---|---|
| agriculture | 13 | 8 | 21 | 4 |
| construction | 22 | 15 | 37 | 6 |
| manufacturing | 61 | 40 | 101 | 15 |
| mining | 5 | 4 | 9 | 2 |
| retail | 112 | 74 | 186 | 27 |
| services | 88 | 58 | 146 | 21 |
| **Total** | **301** | **199** | **500** | **75** |

**Validation checks (Phase 2 must pass all of them)**

1. Exactly 18,000 rows and 500 distinct `company_id`.
2. Every `company_id` has exactly 36 rows, one per month from `2023-01` to `2025-12`, with no gaps or duplicates.
3. `income` and `expenses` are numeric, ≥ 0, with at most two decimals, and never empty.
4. `sector` and `origin` are constant within each company.
5. `origin` only takes the values `derived` or `simulated`.

---

## 2. `ml/data/processed/split_manifest.csv`

4 columns. One row per company and month (18,000 rows). It says which part of the data each row belongs to, so that no phase can mix training and test data by mistake.

| Column | Type | Unit | Allowed values or range | Source | Derived or simulated | Notes |
|---|---|---|---|---|---|---|
| `company_id` | text | none | `C0001` to `C0500` | `monthly_series.csv` | — | Join key with `monthly_series.csv`, together with `month`. |
| `month` | text | `YYYY-MM` | `2023-01` to `2025-12` | `monthly_series.csv` | — | Join key. |
| `month_index` | integer | months | 1 to 36 | Computed from `month` | Derived | `2023-01` = 1, `2025-12` = 36. |
| `split` | text | none | `train`, `validation`, `test`, `holdout` | Split script (Phase 2) | Derived | `train`: months 1–24. `validation`: months 25–30. `test`: months 31–36. `holdout`: all 36 months of the 75 holdout companies. |

**Holdout rule:** 75 of the 500 companies (15 %) are `holdout`. They are chosen at random within each sector with seed 42: at least one per sector, the rest proportional to sector size. All 36 rows of a holdout company are marked `holdout`. The model never trains on them; they test how well it generalizes to companies it has never seen.

**Rows per split**

| Split | Months (`month_index`) | Calendar months | Companies | Rows |
|---|---|---|---|---|
| `train` | 1–24 | 2023-01 to 2024-12 | 425 | 10,200 |
| `validation` | 25–30 | 2025-01 to 2025-06 | 425 | 2,550 |
| `test` | 31–36 | 2025-07 to 2025-12 | 425 | 2,550 |
| `holdout` | 1–36 | 2023-01 to 2025-12 | 75 | 2,700 |

**Validation checks**

1. 18,000 rows; every (`company_id`, `month`) pair of `monthly_series.csv` appears exactly once.
2. `month_index` matches `month` for every row.
3. Exactly 75 companies have `split = holdout` in all 36 rows; no company mixes `holdout` with other values.
4. For the other 425 companies: months 1–24 are `train`, 25–30 are `validation`, 31–36 are `test`.

---

## 3. Supporting files (not for model training)

Phase 2 also writes these files to `ml/data/processed/`. They document how the dataset was built. Phases 3 and 4 must use only `monthly_series.csv` and `split_manifest.csv`.

| File | Content | Key columns |
|---|---|---|
| `sector_profiles.csv` | Real margin and growth per sector (median and robust spread), from Supersociedades records with income ≥ 0.5 trillion COP | `sector`, `share`, `margin_median`, `margin_spread`, `growth_median`, `growth_spread` |
| `seasonality.csv` | 12 factors (mean 1.0) from DIAN VAT returns, years 2015–2019 and 2022–2025, smoothed by bimonthly pairs and shifted 2 months back | `month_of_year`, `factor` (0.79 in January–February to 1.23 in November–December) |
| `companies_base.csv` | 608 real records eligible for `derived` companies | `nit`, `sector`, `margin`, `growth`, `size_pct` |
| `company_profiles.csv` | Hidden parameters of each generated company (true margin, growth, rescaling factor, noise) | `company_id`, `origin`, `margin`, `growth`, `rescale_factor` |

> **`company_profiles.csv` must never be used as a model input.** It contains the true parameters behind each series, so using it would be data leakage.

---

## 4. Glossary of terms used in this file

- **Derived:** obtained by a documented computation from real data or from another column.
- **Simulated:** produced by the generator; it does not come from any real record.
- **Rescaling:** multiplying a large-company profile by a factor so that its values match the size of a small business. For derived companies the median factor is about 1 : 800 (1.26 × 10⁻³); each company's factor is in `company_profiles.csv`.
- **Seed 42:** the fixed random seed of the generator and the split. Running the Phase 2 scripts again produces byte-identical files.
- **Millions of COP:** `12.50` means COP 12,500,000.
