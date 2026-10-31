# Data Dictionary

- **Owner:** Sergio Steeven Moreno Forero (Phase 1)
- **Produced by:** Phase 2 scripts (Samuel Castellanos Rivera)
- **Contract frozen on:** November 1, 2026. Any change after that date must be agreed by the whole team and recorded in this file.

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
| `sector` | text | none | Lowercase English sector name (e.g. `manufacturing`, `commerce`, `services`) | Supersociedades macrosector | Derived | Same value in all 36 rows of a company. The final list of sector names is fixed by Samuel and copied here before November 1, 2026. |
| `month` | text | `YYYY-MM` | `2023-01` to `2025-12`, 36 consecutive months | Generator | Simulated | Same 36 months for every company. Calendar month, not a date; no day part. |
| `income` | number | millions of COP | ≥ 0, two decimals | Generator calibrated with Supersociedades (size, growth) and DIAN (seasonality) | Simulated | Monthly operating income, rescaled to small-business size. Never empty. |
| `expenses` | number | millions of COP | ≥ 0, two decimals | Generator calibrated with Supersociedades sector margins | Simulated | Monthly costs and expenses, rescaled with the same factor as `income`. Never empty. Can exceed `income` in a given month (loss month). |
| `origin` | text | none | `derived` or `simulated` | Generator | — | How the company's **profile** (sector, margin, annual growth) was obtained. `derived`: taken from a real Supersociedades record. `simulated`: sampled from the sector's distributions. Same value in all 36 rows of a company. In both cases the monthly values are simulated. |

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

**Holdout rule:** 75 of the 500 companies (15 %) are `holdout`. They are chosen at random within each sector (stratified), with a fixed random seed documented by Samuel. All 36 rows of a holdout company are marked `holdout`. The model never trains on them; they test how well it generalizes to companies it has never seen.

**Validation checks**

1. 18,000 rows; every (`company_id`, `month`) pair of `monthly_series.csv` appears exactly once.
2. `month_index` matches `month` for every row.
3. Exactly 75 companies have `split = holdout` in all 36 rows; no company mixes `holdout` with other values.
4. For the other 425 companies: months 1–24 are `train`, 25–30 are `validation`, 31–36 are `test`.

---

## 3. Glossary of terms used in this file

- **Derived:** obtained by a documented computation from real data or from another column.
- **Simulated:** produced by the generator; it does not come from any real record.
- **Rescaling:** multiplying a large-company profile by a factor so that its values match the size of a small business. The factor is documented in Phase 2.
- **Millions of COP:** `12.50` means COP 12,500,000.
