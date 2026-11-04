# Per-company trainer (offline, from the ERP)

This folder is **independent of the web server**. The Flask backend never imports scikit-learn or trains during a request. The app works without this module: the global model of Phase 3 (`backend/model_artifacts/model_global.json`) is the default, and manual planning is always available.

A company artifact produced here takes priority over the global model for that company.

## What it does

`train.py`:

1. Reads income and expenses from the AlertaFiscal database (PostgreSQL, or SQLite for development).
2. Groups them by month and company, filling months without movements with zero.
3. Builds features: trend, three lags and seasonality (sine/cosine of the month).
4. Evaluates with a **time-based split** (the last months are the test set, never random):
   - `seasonal_naive` (baseline: value of the same month a year earlier, or the previous month),
   - linear regression,
   - random forest.
5. Reports MAE, RMSE and MAPE per model and picks the one with the lowest MAE.
6. Retrains the best model on the whole series and forecasts `--horizon` months recursively.
7. Saves the artifacts in `ml/artifacts/` (ignored by git).

## Installation

```powershell
# From the repository root
python -m venv ml/company_trainer/.venv
ml\company_trainer\.venv\Scripts\Activate.ps1
pip install -r ml/company_trainer/requirements.txt
```

Python 3.11+ recommended. The script uses the same environment variables as the backend (`DATABASE_URL`, also read from `backend/.env`).

## Usage

```powershell
# Uses DATABASE_URL from backend/.env (PostgreSQL)
python ml/company_trainer/train.py

# Explicit demo with backend/instance/dev.db (no DATABASE_URL)
$env:DB_MODE = "sqlite"
python ml/company_trainer/train.py

# One company and a 6-month horizon
python ml/company_trainer/train.py --company-id 1 --horizon 6

# Against PostgreSQL
python ml/company_trainer/train.py --database-url "postgresql+psycopg://user:password@host:5432/alertafiscal"

# Custom output folder
python ml/company_trainer/train.py --out ml/artifacts
```

Default minimum: 12 months per company (`--min-months`). The demo seed creates 18 months, enough to train and evaluate. If there is no history, the script says so and makes up no data.

## Artifacts

```
ml/artifacts/
├── metrics.json                 # metrics, forecasts and metadata
├── dataset_company1.csv         # monthly series used
└── model_company1.json          # interpretable JSON artifact read by the backend
```

Example of `metrics.json`:

```json
{
  "generated_at": "2026-10-26T...",
  "horizon_months": 3,
  "companies": [
    {
      "company_id": 1,
      "months_available": 18,
      "targets": {
        "income": {
          "best_model": "random_forest",
          "metrics": {
            "seasonal_naive": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0},
            "linear_regression": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0},
            "random_forest": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0}
          },
          "forecast": [{"month": "2026-11", "projected_income": 0.0}]
        }
      }
    }
  ],
  "disclaimer": "Planning forecasts for guidance only..."
}
```

The values in the example are illustrative; run the script to get the real ones.

## Limits and responsible use

- With 18 months of synthetic data, the metrics measure the pipeline, **not** the predictive power on a real company.
- MAPE is unstable when there are zero months; it is reported as `null` if there are no non-zero values.
- The forecast is recursive: errors add up over the horizon.
- It is **not** an official tax assessment and does not replace the accountant. The backend always shows the estimate notice.
- No personal data is stored in the artifacts: only aggregated series per company.
