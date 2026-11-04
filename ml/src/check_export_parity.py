from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import joblib

from features import HORIZON, recursive_forecast, seasonal_naive
from train_models import (
    ARTIFACT_DIR,
    TARGETS,
    VALIDATION_ORIGIN,
    histories_up_to,
    load_data,
)

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_PATH = ROOT / "ml" / "artifacts" / "model_global.json"
CASES_PATH = ROOT / "ml" / "artifacts" / "parity_cases.json"

N_CASES = 50
TOLERANCE = 1e-6
ROUND_DECIMALS = 2


def scale_of(history, normalization):
    if not normalization:
        return 1.0
    n = int(normalization["n"])
    return sum(float(value) for value in history[-n:]) / n


def features_of(spec, history, month_index):
    scale = scale_of(history, spec.get("normalization"))
    if scale <= 0.0:
        raise ValueError("the mean of the last three months must be greater than zero")
    month = ((int(month_index) - 1) % 12) + 1
    angle = 2.0 * math.pi * month / 12.0
    values = []
    for name in spec["features"]:
        if name == "t":
            values.append(float(len(history)))
        elif name == "month_sin":
            values.append(math.sin(angle))
        elif name == "month_cos":
            values.append(math.cos(angle))
        elif name == "lag1":
            values.append(float(history[-1]) / scale)
        elif name == "lag2":
            values.append(float(history[-2]) / scale)
        elif name == "lag3":
            values.append(float(history[-3]) / scale)
        else:
            raise ValueError(f"unsupported feature: {name}")
    return values, scale


def tree_output(tree, features):
    node = 0
    children_left = tree["children_left"]
    while children_left[node] != -1:
        index = tree["feature"][node]
        if features[index] <= tree["threshold"][node]:
            node = children_left[node]
        else:
            node = tree["children_right"][node]
    return tree["value"][node]


def predict_ratio(model_name, params, features):
    if model_name == "linear_regression":
        total = params["intercept"]
        for coefficient, value in zip(params["coefficients"], features):
            total += coefficient * value
        return total
    if model_name == "random_forest":
        trees = params["trees"]
        return sum(tree_output(tree, features) for tree in trees) / len(trees)
    raise ValueError(f"{model_name} cannot be evaluated in pure Python")


def forecast_pure_python(artifact, target, history, last_month_index, horizon=HORIZON):
    spec = artifact["feature_spec"]
    entry = artifact["targets"][target]
    model_name = entry["selected_model"]
    params = entry["models"][model_name]["params"]

    if model_name == "seasonal_naive":
        season = int(params["season_length"])
        return [
            max(0.0, float(history[len(history) - season + step - 1]))
            for step in range(1, horizon + 1)
        ]

    values = [float(value) for value in history]
    output = []
    for step in range(1, horizon + 1):
        features, scale = features_of(spec, values, last_month_index + step)
        value = max(0.0, predict_ratio(model_name, params, features) * scale)
        output.append(value)
        values.append(value)
    return output


def relative_difference(calculated, reference):
    return abs(calculated - reference) / max(abs(reference), 1e-9)


def main():
    if not ARTIFACT_PATH.exists():
        raise FileNotFoundError(f"{ARTIFACT_PATH} not found; run ml/src/export_artifact.py")

    artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    selected = {target: artifact["targets"][target]["selected_model"] for target in TARGETS}
    print(f"artifact {artifact['model_version']} | models: {selected}")

    data, _ = load_data()
    companies = sorted(data["company_id"].unique())[:N_CASES]
    if len(companies) != N_CASES:
        raise ValueError(f"expected {N_CASES} companies, found {len(companies)}")

    histories = {target: histories_up_to(data, target, VALIDATION_ORIGIN) for target in TARGETS}

    sklearn_forecasts = {}
    for target in TARGETS:
        subset = {company: histories[target][company] for company in companies}
        model_name = selected[target]
        if model_name == "seasonal_naive":
            sklearn_forecasts[target] = seasonal_naive(subset, HORIZON)
        else:
            path = ARTIFACT_DIR / f"{model_name}_{target}.joblib"
            model = joblib.load(path)
            sklearn_forecasts[target] = recursive_forecast(
                model.predict, subset, VALIDATION_ORIGIN, HORIZON
            )

    cases = []
    worst = 0.0
    worst_case = None
    for number, company in enumerate(companies, start=1):
        case = {
            "case_id": number,
            "company_id": company,
            "last_month": "2024-12",
            "last_month_index": VALIDATION_ORIGIN,
            "horizon": HORIZON,
            "history": {},
            "expected": {},
            "expected_rounded": {},
        }
        for target in TARGETS:
            history = histories[target][company]
            expected = forecast_pure_python(
                artifact, target, history, VALIDATION_ORIGIN, HORIZON
            )
            reference = sklearn_forecasts[target][company]
            for step, (ours, theirs) in enumerate(zip(expected, reference)):
                difference = relative_difference(ours, theirs)
                if difference > worst:
                    worst = difference
                    worst_case = (company, target, step + 1, ours, theirs)

            case["history"][target] = [round(float(value), 6) for value in history]
            case["expected"][target] = [float(value) for value in expected]
            case["expected_rounded"][target] = [
                round(float(value), ROUND_DECIMALS) for value in expected
            ]
        cases.append(case)

    payload = {
        "artifact_kind": "parity_cases",
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_version": artifact["model_version"],
        "models": selected,
        "feature_spec": artifact["feature_spec"],
        "last_month": "2024-12",
        "last_month_index": VALIDATION_ORIGIN,
        "horizon": HORIZON,
        "n_cases": len(cases),
        "tolerance_relative": TOLERANCE,
        "rounding": {
            "decimals": ROUND_DECIMALS,
            "applied_after_recursion": True,
            "note": (
                "values in 'expected' are unrounded and are the reference for the "
                "1e-6 parity test; 'expected_rounded' is what the API returns"
            ),
        },
        "cases": cases,
    }
    CASES_PATH.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")

    status = "PASS" if worst <= TOLERANCE else "FAIL"
    print(f"cases: {len(cases)}")
    print(f"max relative difference: {worst:.3e} (tolerance {TOLERANCE:.0e}) -> {status}")
    if worst_case:
        company, target, step, ours, theirs = worst_case
        print(f"worst case: {company} {target} +{step}: ours={ours:.10f} sklearn={theirs:.10f}")
    print(f"wrote {CASES_PATH}")

    if worst > TOLERANCE:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
