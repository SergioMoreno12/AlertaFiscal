from __future__ import annotations

import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

from features import FEATURE_COLUMNS, HORIZON, MIN_HISTORY, NORMALIZATION

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_DIR = ROOT / "ml" / "artifacts" / "candidates"
METRICS_PATH = CANDIDATE_DIR / "metrics.json"
SERIES_PATH = ROOT / "ml" / "data" / "processed" / "monthly_series.csv"
OUTPUT_PATH = ROOT / "ml" / "artifacts" / "model_global.json"

TARGETS = ("income", "expenses")
SUPPORTED_MODELS = ("seasonal_naive", "linear_regression", "random_forest")
MAX_SIZE_MB = 5.0


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def serialize_tree(estimator):
    tree = estimator.tree_
    return {
        "children_left": tree.children_left.tolist(),
        "children_right": tree.children_right.tolist(),
        "feature": [int(value) for value in tree.feature],
        "threshold": tree.threshold.tolist(),
        "value": [float(value) for value in tree.value[:, 0, 0]],
    }


def serialize_params(model_name, model):
    if model_name == "seasonal_naive":
        return {"season_length": 12}

    estimator = model.named_steps["model"]
    if model_name == "linear_regression":
        return {
            "coefficients": [float(value) for value in estimator.coef_],
            "intercept": float(estimator.intercept_),
        }
    if model_name == "random_forest":
        return {"trees": [serialize_tree(tree) for tree in estimator.estimators_]}
    raise ValueError(f"model {model_name} cannot be exported")


def load_model(model_name, target):
    if model_name == "seasonal_naive":
        return None
    path = CANDIDATE_DIR / f"{model_name}_{target}.joblib"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run ml/src/train_models.py first")
    return joblib.load(path)


def compact_metrics(metrics):
    return {
        "mae": metrics["mae"],
        "rmse": metrics["rmse"],
        "mape_pct": metrics["mape_pct"],
        "hyperparameters": metrics.get("hyperparameters"),
    }


def build_target_block(report, target):
    selection = report["selection"]["recommended_model"]
    if selection not in SUPPORTED_MODELS:
        raise ValueError(f"{selection} is not supported by the backend")

    model = load_model(selection, target)
    validation = report["validation"]
    params = serialize_params(selection, model)

    block = {
        "selected_model": selection,
        "models": {selection: {"params": params}},
        "metrics": {
            "mae": validation[selection][target]["mae"],
            "rmse": validation[selection][target]["rmse"],
            "mape_pct": validation[selection][target]["mape_pct"],
            "n_points": validation[selection][target]["n_points"],
            "per_horizon_mae": validation[selection][target]["per_horizon_mae"],
            "normalized_mae_pct": validation[selection][target]["normalized_mae_pct"],
        },
        "all_metrics": {
            name: compact_metrics(validation[name][target])
            for name in ("seasonal_naive", "linear_regression", "random_forest", "mlp")
        },
    }
    return block, model


def main():
    if not METRICS_PATH.exists():
        raise FileNotFoundError(f"{METRICS_PATH} not found; run ml/src/train_models.py first")

    report = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    selected = report["selection"]["recommended_model"]
    trained_at = report.get("generated_at_utc") or datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    stamp = trained_at[:10].replace("-", "")

    print(f"selected model: {selected}")
    targets = {}
    for target in TARGETS:
        block, _ = build_target_block(report, target)
        targets[target] = block
        if selected == "random_forest":
            nodes = sum(len(tree["value"]) for tree in block["models"][selected]["params"]["trees"])
            print(f"  {target}: {len(block['models'][selected]['params']['trees'])} trees, {nodes} nodes")
        else:
            print(f"  {target}: exported as {selected}")

    library_versions = {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }

    artifact = {
        "artifact_kind": "forecast_model",
        "schema_version": 1,
        "scope": "global",
        "model_version": None,
        "trained_at": trained_at,
        "min_history_months": MIN_HISTORY,
        "feature_spec": {
            "features": list(FEATURE_COLUMNS),
            "lags": 3,
            "normalization": dict(NORMALIZATION),
        },
        "targets": targets,
        "data_provenance": {
            "kind": "semi_synthetic",
            "is_demo": True,
            "dataset_sha256": file_sha256(SERIES_PATH),
            "train_companies": int(report["data"]["companies"]),
            "train_months": "1-24",
            "library_versions": library_versions,
        },
        "evaluation": {
            "validation": {
                "origin_month_index": report["protocol"]["validation_origin_month_index"],
                "months": "25-30",
                "horizon": HORIZON,
                "recursive": True,
                "selection_criterion": report["selection"]["criterion"],
                "mean_mae": report["scores"]["mean_mae"],
                "targets": {
                    target: {
                        "mae": targets[target]["metrics"]["mae"],
                        "rmse": targets[target]["metrics"]["rmse"],
                        "mape_pct": targets[target]["metrics"]["mape_pct"],
                        "normalized_mae_pct": targets[target]["metrics"]["normalized_mae_pct"],
                    }
                    for target in TARGETS
                },
            }
        },
    }

    body = json.dumps(artifact, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
    artifact["model_version"] = f"global-{stamp}-{digest}"

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8"
    )

    size_mb = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\nwrote {OUTPUT_PATH}")
    print(f"model_version: {artifact['model_version']}")
    print(f"size: {size_mb:.2f} MB (limit {MAX_SIZE_MB:.1f} MB)")
    if size_mb > MAX_SIZE_MB:
        raise SystemExit(
            f"ERROR: {size_mb:.2f} MB exceeds the {MAX_SIZE_MB:.1f} MB limit. "
            "Reduce n_estimators or max_depth and retrain."
        )


if __name__ == "__main__":
    main()
