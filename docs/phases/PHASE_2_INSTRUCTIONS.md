# PHASE 2 — Data Preparation

- **Owner:** Samuel Castellanos Rivera
- **Branch:** `phase2/data-preparation`
- **Deadline:** November 3, 2026 (dataset frozen)
- **Code:** `ml/src/prepare_data.py`, `ml/src/generate_series.py`, `ml/src/split_series.py`

## Goal
Build the monthly income/expense dataset (6 columns, 36 months per company) and the split manifest (months 1-24 train, 25-30 validation, 31-36 test, plus 15% held-out companies).

## Must NOT
- Include noise columns or risk labels from plan v1.
- Let test months leak into training in any step (scaling, averages, etc.).
- Distribute DIAN collection as per-company VAT (use seasonality only).
- Change the 6-column schema after November 1, 2026.

## Deliverables
`ml/data/processed/monthly_series.csv`, `ml/data/processed/split_manifest.csv`.

## Definition of done
- [ ] 36 rows per company, exact 6 columns, no nulls or negatives.
- [ ] Running the scripts twice gives identical output (fixed seed).
- [ ] Held-out companies never appear in training.

