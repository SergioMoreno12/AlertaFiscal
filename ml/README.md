# ML — Data Preparation (Phase 2)

Scripts that build the semi-synthetic dataset used by every later phase. Run them from the repository root, in this order:

```
python ml/src/prepare_data.py
python ml/src/generate_series.py
python ml/src/split_series.py
python ml/src/check_dataset.py
```

| Script | What it does | Outputs (`ml/data/processed/`) |
|---|---|---|
| `prepare_data.py` | Cleans the raw Supersociedades and DIAN files and computes real sector margins, growth and seasonality. | `sector_profiles.csv`, `seasonality.csv`, `companies_base.csv` |
| `generate_series.py` | Generates 500 companies × 36 months of income and expenses (seed 42). | `monthly_series.csv`, `company_profiles.csv` |
| `split_series.py` | Marks each row as `train`, `validation`, `test` or `holdout` (seed 42). | `split_manifest.csv` |
| `check_dataset.py` | Validates the data contract and reproducibility. Exits with code 1 if any check fails. | — (prints a table) |

## Requirements

```
pip install pandas numpy openpyxl
```

`openpyxl` is needed only by `prepare_data.py` to read the DIAN Excel file.

## Raw files (`ml/data/raw/`, not committed)

| File name expected by the scripts | Source |
|---|---|
| `supersociedades_10000_companies.csv` | https://www.datos.gov.co/resource/6cat-2gcs.csv?$limit=100000 (CSV export of dataset 6cat-2gcs) |
| `dian_monthly_collection_2000_2026.xlsx` | The `.xlsx` inside https://www.dian.gov.co/dian/cifras/EstadisticasRecaudo/Estadisticas-de-recaudo-mensual-por-tipo-de-impuesto-2000-2026.zip |

Both were downloaded on October 30, 2026. Raw files are never edited by hand.

## Files for other phases

- **Phase 3 and 4** use only `monthly_series.csv` and `split_manifest.csv` (join on `company_id` and `month`).
- `company_profiles.csv` holds the hidden parameters of each simulated company (true margin, growth, rescaling factor). It exists only to audit the generator. **Never use it as a model input**: it would be data leakage.
- The column-by-column description is in `docs/02_data_dictionary.md` (Phase 1).