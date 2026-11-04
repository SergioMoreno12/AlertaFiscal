"""Monthly forecast engine based on the artifact trained offline.

Contract:
- The JSON artifact is produced offline (Phase 3 or ``ml/company_trainer/train.py``). Flask only reads and validates it.
- scikit-learn is never imported, nothing is trained and no input is made up.
- If the artifact or the minimum history is missing, ``ForecastUnavailable`` is raised
  so the route answers with an explicit error and the UI offers manual
  mode.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from flask import current_app, g

from ...common.http import iso, money, record_audit
from ...extensions import db
from ...models import ExpenseDocument, ForecastRun, IncomeDocument

SCHEMA_VERSION = 1
ARTIFACT_KIND = "alertafiscal_monthly_forecast"
METHOD_MAP = {
    "linear_regression": "linear",
    "random_forest": "random_forest",
    "seasonal_naive": "seasonal_naive",
}
MODEL_LABEL = {
    "linear_regression": "Linear regression",
    "random_forest": "Random Forest",
    "seasonal_naive": "Seasonal naive (lag-12)",
}


class ForecastUnavailable(Exception):
    """The model or its inputs are not available. No data is substituted."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _artifact_path(company_id: int) -> Path:
    directory = Path(current_app.config["FORECAST_ARTIFACT_DIR"])
    return directory / f"model_company{company_id}.json"


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ForecastUnavailable(
            "model_not_trained",
            "No trained model exists for this company. Train one offline or use manual planning.",
            {"artifact": str(path)},
        ) from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The model artifact exists but is not valid JSON.",
            {"artifact": str(path)},
        ) from exc


def _validate_artifact(artifact: dict, company_id: int, path: Path) -> dict:
    if artifact.get("artifact_kind") != ARTIFACT_KIND:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact is not an AlertaFiscal model.",
            {"artifact": str(path)},
        )
    if int(artifact.get("schema_version", 0)) != SCHEMA_VERSION:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact version is not compatible with this backend.",
            {"artifact": str(path), "schema_version": artifact.get("schema_version")},
        )
    if int(artifact.get("company_id", -1)) != company_id:
        raise ForecastUnavailable(
            "artifact_company_mismatch",
            "The artifact belongs to another company. It is not reused across companies.",
            {"artifact": str(path)},
        )
    feature_spec = artifact.get("feature_spec") or {}
    features = feature_spec.get("features")
    if not isinstance(features, list) or not features:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact does not declare the inputs the model expects.",
            {"artifact": str(path)},
        )
    history = artifact.get("history") or {}
    months = history.get("months")
    if not isinstance(months, list) or not months:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact does not include the history it was trained on.",
            {"artifact": str(path)},
        )
    targets = artifact.get("targets") or {}
    for target in ("income", "expenses"):
        spec = targets.get(target)
        if not isinstance(spec, dict) or spec.get("selected_model") not in METHOD_MAP:
            raise ForecastUnavailable(
                "artifact_invalid",
                f"The artifact has no valid model for {target}.",
                {"artifact": str(path), "target": target},
            )
        if not isinstance((spec.get("models") or {}).get(spec["selected_model"]), dict):
            raise ForecastUnavailable(
                "artifact_invalid",
                f"The parameters of the selected model for {target} are missing.",
                {"artifact": str(path), "target": target},
            )
    return artifact


def load_artifact(company_id: int) -> dict:
    path = _artifact_path(company_id)
    if not path.exists():
        raise ForecastUnavailable(
            "model_not_trained",
            "No trained model exists for this company. Train the model offline or continue with manual planning.",
            {"artifact": str(path)},
        )
    return _validate_artifact(_read_json(path), company_id, path)


def _iter_months(start: str, end: str):
    year, month = (int(part) for part in start.split("-"))
    end_year, end_month = (int(part) for part in end.split("-"))
    while (year, month) <= (end_year, end_month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month > 12:
            month = 1
            year += 1


def monthly_history(company_id: int) -> dict:
    """Group income and expenses by month with the same rule as training.

    - Excludes void documents.
    - Fills the months in between without movements with an explicit zero.
    - Does not use DIAN or Supersociedades: only the company's ERP documents.
    """
    income: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    expenses: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    all_months: set[str] = set()

    for model, bucket in ((IncomeDocument, income), (ExpenseDocument, expenses)):
        rows = (
            db.session.query(model.issue_date, model.total)
            .filter(model.company_id == company_id, model.status != "void")
            .all()
        )
        for issue_date, total in rows:
            key = f"{issue_date.year:04d}-{issue_date.month:02d}"
            bucket[key] += Decimal(str(total or 0))
            all_months.add(key)

    if not all_months:
        return {"months": [], "income": [], "expenses": [], "signature": None}

    months = list(_iter_months(min(all_months), max(all_months)))
    income_values = [round(float(income[month]), 2) for month in months]
    expenses_values = [round(float(expenses[month]), 2) for month in months]
    return {
        "months": months,
        "income": income_values,
        "expenses": expenses_values,
        "signature": history_signature(months, income_values, expenses_values),
    }


def canonical_history(months: list[str], income: list[float], expenses: list[float]) -> str:
    payload = {
        "months": list(months),
        "income": [f"{float(value):.2f}" for value in income],
        "expenses": [f"{float(value):.2f}" for value in expenses],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def history_signature(months: list[str], income: list[float], expenses: list[float]) -> str:
    return hashlib.sha256(canonical_history(months, income, expenses).encode("utf-8")).hexdigest()


def _next_month(month: str) -> str:
    year, number = (int(part) for part in month.split("-"))
    number += 1
    if number > 12:
        number = 1
        year += 1
    return f"{year:04d}-{number:02d}"


def _month_end(month: str) -> datetime:
    year, number = (int(part) for part in month.split("-"))
    last_day = calendar.monthrange(year, number)[1]
    return datetime(year, number, last_day, tzinfo=timezone.utc)


def _predict_value(model_name: str, params: dict, row: dict, history: list[float], features: list[str]) -> float:
    if model_name == "seasonal_naive":
        season = int(params.get("season_length", 12))
        if len(history) >= season:
            return float(history[-season])
        return float(history[-1])

    vector = [float(row[feature]) for feature in features]
    if model_name == "linear_regression":
        coefficients = params.get("coefficients") or []
        if len(coefficients) != len(vector):
            raise ForecastUnavailable(
                "artifact_invalid",
                "The linear model does not match the declared inputs.",
            )
        return float(params.get("intercept", 0.0)) + sum(
            float(coefficient) * value for coefficient, value in zip(coefficients, vector)
        )

    if model_name == "random_forest":
        trees = params.get("trees") or []
        if not trees:
            raise ForecastUnavailable("artifact_invalid", "The random forest has no trees.")
        predictions = []
        for tree in trees:
            node = 0
            left = tree["children_left"]
            while left[node] != -1:
                feature_index = int(tree["feature"][node])
                if feature_index < 0 or feature_index >= len(vector):
                    raise ForecastUnavailable(
                        "artifact_invalid",
                        "A tree of the artifact refers to an input that does not exist.",
                    )
                if vector[feature_index] <= float(tree["threshold"][node]):
                    node = int(left[node])
                else:
                    node = int(tree["children_right"][node])
            predictions.append(float(tree["value"][node]))
        return sum(predictions) / len(predictions)

    raise ForecastUnavailable("artifact_invalid", f"Unsupported model: {model_name}")


def predict_target(artifact: dict, target: str, history: dict, horizon: int) -> list[dict]:
    spec = artifact["targets"][target]
    model_name = spec["selected_model"]
    params = spec["models"][model_name]["params"]
    features = artifact["feature_spec"]["features"]
    values = [float(value) for value in history[target]]
    months = list(history["months"])
    month = months[-1]
    predictions: list[dict] = []

    for _ in range(horizon):
        month = _next_month(month)
        row: dict[str, float] = {}
        for feature in features:
            if feature == "t":
                row[feature] = float(len(values))
            elif feature == "month_sin":
                row[feature] = math.sin(2 * math.pi * int(month.split("-")[1]) / 12)
            elif feature == "month_cos":
                row[feature] = math.cos(2 * math.pi * int(month.split("-")[1]) / 12)
            elif feature.startswith("lag") and feature[3:].isdigit():
                lag = int(feature[3:])
                row[feature] = values[-lag] if len(values) >= lag else 0.0
            else:
                raise ForecastUnavailable(
                    "artifact_invalid",
                    f"The artifact declares an unsupported input: {feature}",
                )
        value = max(float(_predict_value(model_name, params, row, values, features)), 0.0)
        value = round(value, 2)
        predictions.append({"month": month, "value": value})
        values.append(value)

    return predictions


def _required_months(artifact: dict) -> int:
    lags = int((artifact.get("feature_spec") or {}).get("lags", 3))
    required = lags + 1
    for target in ("income", "expenses"):
        spec = artifact["targets"][target]
        if spec["selected_model"] == "seasonal_naive":
            season = int(spec["models"]["seasonal_naive"]["params"].get("season_length", 12))
            required = max(required, season)
    return required


def run_model_forecast(company_id: int, horizon: int) -> dict:
    artifact = load_artifact(company_id)
    history = monthly_history(company_id)
    required = _required_months(artifact)

    if len(history["months"]) < required:
        raise ForecastUnavailable(
            "insufficient_history",
            f"The model needs at least {required} months of history and the company has {len(history['months'])}.",
            {"required_months": required, "months_available": len(history["months"])},
        )

    income_forecast = predict_target(artifact, "income", history, horizon)
    expense_forecast = predict_target(artifact, "expenses", history, horizon)
    monthly = []
    for income_point, expense_point in zip(income_forecast, expense_forecast):
        monthly.append(
            {
                "month": income_point["month"],
                "projected_income": f"{Decimal(str(income_point['value'])):.2f}",
                "projected_expenses": f"{Decimal(str(expense_point['value'])):.2f}",
            }
        )

    projected_income = sum((Decimal(item["projected_income"]) for item in monthly), Decimal("0"))
    projected_expenses = sum((Decimal(item["projected_expenses"]) for item in monthly), Decimal("0"))
    artifact_signature = (artifact.get("history") or {}).get("signature")
    stale_inputs = bool(artifact_signature and artifact_signature != history["signature"])

    models = {
        target: {
            "selected_model": artifact["targets"][target]["selected_model"],
            "label": MODEL_LABEL.get(artifact["targets"][target]["selected_model"], artifact["targets"][target]["selected_model"]),
            "metrics": artifact["targets"][target].get("metrics") or {},
            "all_metrics": artifact["targets"][target].get("all_metrics") or {},
        }
        for target in ("income", "expenses")
    }

    assumptions = {
        "source": "ml_artifact",
        "artifact_kind": artifact.get("artifact_kind"),
        "schema_version": artifact.get("schema_version"),
        "model_version": artifact.get("model_version"),
        "trained_at": artifact.get("trained_at"),
        "feature_spec": artifact.get("feature_spec"),
        "models": models,
        "history_signature": history["signature"],
        "artifact_history_signature": artifact_signature,
        "inputs_changed_since_training": stale_inputs,
        "history_months": len(history["months"]),
        "history_period": {"from": history["months"][0], "to": history["months"][-1]},
        "monthly": monthly,
        "data_provenance": artifact.get("data_provenance") or {},
        "evaluation": artifact.get("evaluation") or {},
    }

    method = METHOD_MAP[artifact["targets"]["income"]["selected_model"]]
    run = ForecastRun(
        company_id=company_id,
        method=method,
        horizon_months=horizon,
        cutoff_date=_month_end(history["months"][-1]),
        assumptions=assumptions,
        projected_income=projected_income.quantize(Decimal("0.01")),
        projected_expenses=projected_expenses.quantize(Decimal("0.01")),
        model_version=str(artifact.get("model_version") or "")[:40] or None,
        created_by=getattr(getattr(g, "current_user", None), "id", None),
    )
    db.session.add(run)
    db.session.flush()
    record_audit(
        company_id,
        "forecast.model_run",
        f"forecast:{run.id}",
        {
            "method": method,
            "model_version": run.model_version,
            "horizon": horizon,
            "stale_inputs": stale_inputs,
        },
    )

    return forecast_run_dict(run)


def forecast_run_dict(run: ForecastRun) -> dict:
    assumptions = run.assumptions or {}
    return {
        "available": True,
        "id": run.id,
        "method": run.method,
        "method_label": MODEL_LABEL.get(
            {
                "linear": "linear_regression",
                "random_forest": "random_forest",
                "seasonal_naive": "seasonal_naive",
            }.get(run.method, run.method),
            "Manual average" if run.method == "manual" else run.method,
        ),
        "horizon_months": run.horizon_months,
        "cutoff_date": iso(run.cutoff_date),
        "projected_income": money(run.projected_income),
        "projected_expenses": money(run.projected_expenses),
        "projected_result": money(Decimal(str(run.projected_income)) - Decimal(str(run.projected_expenses))),
        "model_version": run.model_version,
        "created_at": iso(run.created_at),
        "assumptions": assumptions,
        "monthly": assumptions.get("monthly") or [],
        "models": assumptions.get("models") or {},
        "history_months": assumptions.get("history_months"),
        "history_period": assumptions.get("history_period"),
        "trained_at": assumptions.get("trained_at"),
        "stale_inputs": bool(assumptions.get("inputs_changed_since_training")),
        "data_provenance": assumptions.get("data_provenance") or {},
        "is_demo": bool((assumptions.get("data_provenance") or {}).get("is_demo")),
        "estimated": True,
        "disclaimer": "Planning forecast for guidance only. It is not an official tax assessment.",
    }


def latest_forecast(company_id: int) -> ForecastRun | None:
    return (
        db.session.query(ForecastRun)
        .filter(ForecastRun.company_id == company_id)
        .order_by(ForecastRun.created_at.desc(), ForecastRun.id.desc())
        .first()
    )
