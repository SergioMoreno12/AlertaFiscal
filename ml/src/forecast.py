from __future__ import annotations

import json
from pathlib import Path

import joblib

from features import (
    BASE_MONTH,
    HORIZON,
    MIN_HISTORY,
    month_index_from_label,
    month_label,
    recursive_forecast,
)

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_DIR = ROOT / "ml" / "artifacts" / "candidates"
METRICS_PATH = CANDIDATE_DIR / "metrics.json"


def _recommended_model():
    if not METRICS_PATH.exists():
        raise FileNotFoundError(
            f"{METRICS_PATH} not found; run ml/src/train_models.py first"
        )
    report = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    model_name = report.get("selection", {}).get("recommended_model")
    if not model_name:
        raise ValueError("metrics.json has no selection.recommended_model entry")
    return model_name


def _load_model(model_name, target):
    path = CANDIDATE_DIR / f"{model_name}_{target}.joblib"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run ml/src/train_models.py first")
    return joblib.load(path)


def forecast(income_history, expense_history, last_month, horizon=6, model=None):
    income = [float(value) for value in income_history]
    expenses = [float(value) for value in expense_history]

    if len(income) != len(expenses):
        raise ValueError("income_history and expense_history must have the same length")
    if len(income) < MIN_HISTORY:
        raise ValueError(
            f"at least {MIN_HISTORY} months of history are required; got {len(income)}"
        )
    if isinstance(horizon, bool) or not isinstance(horizon, int):
        raise ValueError("horizon must be an integer")
    if not 1 <= horizon <= HORIZON:
        raise ValueError(f"horizon must be between 1 and {HORIZON}")
    if any(value < 0 for value in income + expenses):
        raise ValueError("income and expenses cannot be negative")

    model_name = model or _recommended_model()
    income_model = _load_model(model_name, "income")
    expense_model = _load_model(model_name, "expenses")

    last_index = month_index_from_label(last_month, BASE_MONTH)
    predicted_income = recursive_forecast(
        income_model.predict, {"company": income}, last_index, horizon
    )
    predicted_expenses = recursive_forecast(
        expense_model.predict, {"company": expenses}, last_index, horizon
    )

    return {
        "model": model_name,
        "last_month": last_month,
        "horizon": horizon,
        "months": [month_label(last_index + step, BASE_MONTH) for step in range(1, horizon + 1)],
        "income": [round(value, 2) for value in predicted_income["company"]],
        "expenses": [round(value, 2) for value in predicted_expenses["company"]],
    }


if __name__ == "__main__":
    result = forecast(
        income_history=[100.0 + 2.0 * i for i in range(12)],
        expense_history=[92.0 + 1.5 * i for i in range(12)],
        last_month="2024-12",
    )
    print(json.dumps(result, indent=2))