"""Monthly forecast engine based on artifacts trained offline.

Contract:
- Two kinds of JSON artifact are read, never trained here:
  * the global model of Phase 3 (``model_global.json``, ``scope: "global"``), trained on
    425 companies and evaluated once in Phase 4; it is the default for every company;
  * a company artifact (``model_company<id>.json``) from ``ml/company_trainer/train.py``,
    which takes priority for that company when it exists.
- scikit-learn is never imported, nothing is trained and no input is made up.
- Global artifact rules (docs/phases/PHASE_5_INSTRUCTIONS.md, section 5.1): features are
  cast to float32 before walking the trees, a zero or negative scale is treated as
  insufficient history, the forecast is recursive with negatives clipped to 0, and values
  are rounded to 2 decimals only after the recursion.
- If the artifact or the minimum history is missing, ``ForecastUnavailable`` is raised
  so the route answers with an explicit error and the UI offers manual mode.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import struct
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from flask import current_app, g

from ...common.http import iso, money, record_audit
from ...extensions import db
from ...models import ExpenseDocument, ForecastRun, IncomeDocument

SCHEMA_VERSION = 1
ARTIFACT_KIND = "alertafiscal_monthly_forecast"  # company artifacts (ml/company_trainer)
GLOBAL_ARTIFACT_KIND = "forecast_model"  # global artifact (Phase 3, ml/src/export_artifact.py)
GLOBAL_ARTIFACT_FILE = "model_global.json"
GLOBAL_FEATURES = ("t", "month_sin", "month_cos", "lag1", "lag2", "lag3")
GLOBAL_MAX_HORIZON = 6  # the global model was evaluated on 6 recursive months
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


def _artifact_dir() -> Path:
    return Path(current_app.config["FORECAST_ARTIFACT_DIR"])


def _artifact_path(company_id: int) -> Path:
    return _artifact_dir() / f"model_company{company_id}.json"


def _global_artifact_path() -> Path:
    return _artifact_dir() / GLOBAL_ARTIFACT_FILE


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def float32(value: float) -> float:
    """Round to single precision, as scikit-learn does with tree inputs before comparing."""
    return struct.unpack("f", struct.pack("f", value))[0]


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ForecastUnavailable(
            "model_not_trained",
            "No trained model exists for this company. Train one offline or use manual planning.",
            {"artifact": path.name},
        ) from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The model artifact exists but is not valid JSON.",
            {"artifact": path.name},
        ) from exc


def _validate_targets(artifact: dict, path: Path) -> None:
    targets = artifact.get("targets") or {}
    for target in ("income", "expenses"):
        spec = targets.get(target)
        if not isinstance(spec, dict) or spec.get("selected_model") not in METHOD_MAP:
            raise ForecastUnavailable(
                "artifact_invalid",
                f"The artifact has no valid model for {target}.",
                {"artifact": path.name, "target": target},
            )
        if not isinstance((spec.get("models") or {}).get(spec["selected_model"]), dict):
            raise ForecastUnavailable(
                "artifact_invalid",
                f"The parameters of the selected model for {target} are missing.",
                {"artifact": path.name, "target": target},
            )


def _validate_global_artifact(artifact: dict, path: Path) -> dict:
    """Global artifact: no company_id and no training history, by design."""
    if artifact.get("artifact_kind") != GLOBAL_ARTIFACT_KIND or artifact.get("scope") != "global":
        raise ForecastUnavailable(
            "artifact_invalid",
            "The global artifact is not an AlertaFiscal global model.",
            {"artifact": path.name},
        )
    if int(artifact.get("schema_version", 0)) != SCHEMA_VERSION:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact version is not compatible with this backend.",
            {"artifact": path.name, "schema_version": artifact.get("schema_version")},
        )
    feature_spec = artifact.get("feature_spec") or {}
    features = feature_spec.get("features")
    if not isinstance(features, list) or sorted(features) != sorted(GLOBAL_FEATURES):
        raise ForecastUnavailable(
            "artifact_invalid",
            "The global artifact does not declare the agreed inputs.",
            {"artifact": path.name, "features": features},
        )
    normalization = feature_spec.get("normalization")
    if normalization is not None and normalization.get("type") != "mean_last_n":
        raise ForecastUnavailable(
            "artifact_invalid",
            "The global artifact declares an unsupported normalization.",
            {"artifact": path.name, "normalization": normalization},
        )
    _validate_targets(artifact, path)
    return artifact


def _validate_artifact(artifact: dict, company_id: int, path: Path) -> dict:
    if artifact.get("artifact_kind") != ARTIFACT_KIND:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact is not an AlertaFiscal model.",
            {"artifact": path.name},
        )
    if int(artifact.get("schema_version", 0)) != SCHEMA_VERSION:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact version is not compatible with this backend.",
            {"artifact": path.name, "schema_version": artifact.get("schema_version")},
        )
    if int(artifact.get("company_id", -1)) != company_id:
        raise ForecastUnavailable(
            "artifact_company_mismatch",
            "The artifact belongs to another company. It is not reused across companies.",
            {"artifact": path.name},
        )
    feature_spec = artifact.get("feature_spec") or {}
    features = feature_spec.get("features")
    if not isinstance(features, list) or not features:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact does not declare the inputs the model expects.",
            {"artifact": path.name},
        )
    history = artifact.get("history") or {}
    months = history.get("months")
    if not isinstance(months, list) or not months:
        raise ForecastUnavailable(
            "artifact_invalid",
            "The artifact does not include the history it was trained on.",
            {"artifact": path.name},
        )
    _validate_targets(artifact, path)
    return artifact


def load_artifact(company_id: int) -> tuple[dict, dict]:
    """Return (artifact, source): the company's own artifact first, then the global model.

    ``source`` says which file produced the forecast: scope, file name and SHA-256.
    """
    company_path = _artifact_path(company_id)
    if company_path.exists():
        artifact = _validate_artifact(_read_json(company_path), company_id, company_path)
        return artifact, {"scope": "company", "artifact_file": company_path.name,
                          "artifact_sha256": file_sha256(company_path)}
    global_path = _global_artifact_path()
    if global_path.exists():
        artifact = _validate_global_artifact(_read_json(global_path), global_path)
        return artifact, {"scope": "global", "artifact_file": global_path.name,
                          "artifact_sha256": file_sha256(global_path)}
    raise ForecastUnavailable(
        "model_not_trained",
        "No trained model exists for this company and the global model is missing. "
        "Continue with manual planning.",
        {"artifact": company_path.name, "global_artifact": global_path.name},
    )


def _iter_months(start: str, end: str):
    year, month = (int(part) for part in start.split("-"))
    end_year, end_month = (int(part) for part in end.split("-"))
    while (year, month) <= (end_year, end_month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month > 12:
            month = 1
            year += 1


def _current_month() -> str:
    today = datetime.now(timezone.utc)
    return f"{today.year:04d}-{today.month:02d}"


def monthly_history(company_id: int, closed_only: bool = False) -> dict:
    """Group income and expenses by month with the same rule as training.

    - Excludes void documents.
    - Fills the months in between without movements with an explicit zero.
    - Does not use DIAN or Supersociedades: only the company's ERP documents.
    - ``closed_only`` drops the month in progress (and any future-dated month): the model was
      trained on complete months, so a half-recorded month would enter as a fake drop in lag1.
    """
    income: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    expenses: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    all_months: set[str] = set()
    current = _current_month()

    for model, bucket in ((IncomeDocument, income), (ExpenseDocument, expenses)):
        rows = (
            db.session.query(model.issue_date, model.total)
            .filter(model.company_id == company_id, model.status != "void")
            .all()
        )
        for issue_date, total in rows:
            key = f"{issue_date.year:04d}-{issue_date.month:02d}"
            if closed_only and key >= current:
                continue
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
        vector = [float32(value) for value in vector]  # section 5.1, rule 1
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
            value = tree["value"][node]
            while isinstance(value, list):  # scikit-learn may store a leaf as [[v]]
                value = value[0]
            predictions.append(float(value))
        return sum(predictions) / len(predictions)

    raise ForecastUnavailable("artifact_invalid", f"Unsupported model: {model_name}")


def _scale(values: list[float], normalization: dict | None) -> float:
    if not normalization:
        return 1.0
    n = int(normalization.get("n", 3))
    window = values[-n:]
    scale = sum(window) / len(window) if window else 0.0
    if scale <= 0:
        # Section 5.1, rule 2: never divide by a fallback value.
        raise ForecastUnavailable(
            "insufficient_history",
            f"The mean of the last {n} months is zero or negative, so the model cannot be scaled. "
            "Continue with manual planning.",
            {"normalization": normalization, "scale": round(scale, 2)},
        )
    return scale


def predict_target(artifact: dict, target: str, history: dict, horizon: int) -> list[dict]:
    """Recursive forecast of one target, rounded to 2 decimals after the recursion."""
    raw = forecast_values(artifact, target, history[target], list(history["months"])[-1], horizon)
    return [{"month": label, "value": round(value, 2)} for label, value in raw]


def forecast_values(
    artifact: dict, target: str, history_values: list[float], last_month: str, horizon: int
) -> list[tuple[str, float]]:
    """Unrounded recursive forecast: [(month, value)]. Used by predict_target and the parity test."""
    spec = artifact["targets"][target]
    model_name = spec["selected_model"]
    params = spec["models"][model_name]["params"]
    feature_spec = artifact["feature_spec"]
    features = feature_spec["features"]
    normalization = feature_spec.get("normalization")
    values = [float(value) for value in history_values]
    month = last_month
    raw: list[tuple[str, float]] = []

    for _ in range(horizon):
        month = _next_month(month)
        scale = 1.0 if model_name == "seasonal_naive" else _scale(values, normalization)
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
                row[feature] = (values[-lag] if len(values) >= lag else 0.0) / scale
            else:
                raise ForecastUnavailable(
                    "artifact_invalid",
                    f"The artifact declares an unsupported input: {feature}",
                )
        value = max(float(_predict_value(model_name, params, row, values, features)) * scale, 0.0)
        raw.append((month, value))
        values.append(value)  # unrounded: rounding happens only after the recursion (rule 3)

    return raw


def _required_months(artifact: dict) -> int:
    lags = int((artifact.get("feature_spec") or {}).get("lags", 3))
    required = max(lags + 1, int(artifact.get("min_history_months") or 0))
    for target in ("income", "expenses"):
        spec = artifact["targets"][target]
        if spec["selected_model"] == "seasonal_naive":
            season = int(spec["models"]["seasonal_naive"]["params"].get("season_length", 12))
            required = max(required, season)
    return required


def run_model_forecast(company_id: int, horizon: int) -> dict:
    artifact, source = load_artifact(company_id)
    if source["scope"] == "global":
        horizon = min(horizon, GLOBAL_MAX_HORIZON)
    history = monthly_history(company_id, closed_only=True)
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

    provenance = artifact.get("data_provenance") or {}
    assumptions = {
        "source": "ml_artifact",
        "scope": source["scope"],
        "artifact_file": source["artifact_file"],
        "artifact_sha256": source["artifact_sha256"],
        "is_demo": bool(provenance.get("is_demo")),
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
        "data_provenance": provenance,
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
    from ..monitoring.service import record_predictions  # local import: monitoring reads this module

    record_predictions(run, history)
    record_audit(
        company_id,
        "forecast.model_run",
        f"forecast:{run.id}",
        {
            "method": method,
            "model_version": run.model_version,
            "horizon": horizon,
            "stale_inputs": stale_inputs,
            "scope": source["scope"],
            "artifact_sha256": source["artifact_sha256"],
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
        "is_demo": bool(assumptions.get("is_demo", (assumptions.get("data_provenance") or {}).get("is_demo"))),
        "scope": assumptions.get("scope"),
        "artifact_sha256": assumptions.get("artifact_sha256"),
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
