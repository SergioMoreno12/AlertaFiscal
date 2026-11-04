from __future__ import annotations

import json
import platform
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LinearRegression
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from features import (
    FEATURE_COLUMNS,
    HORIZON,
    TARGET,
    build_training_frame,
    month_index_from_label,
    recursive_forecast,
    seasonal_naive,
)

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"
ARTIFACT_DIR = ROOT / "ml" / "artifacts" / "candidates"

SEED = 42
VALIDATION_ORIGIN = 24
TARGETS = ("income", "expenses")
ALLOWED_SPLITS = ("train", "validation")
BLOCKED_SPLITS = ("test", "holdout")

EXPORTABLE_MODELS = ("seasonal_naive", "linear_regression", "random_forest")
NON_EXPORTABLE_MODELS = ("mlp",)
MODEL_ORDER = EXPORTABLE_MODELS + NON_EXPORTABLE_MODELS

CANDIDATES = {
    "linear_regression": [{}],
    "random_forest": [
        {"n_estimators": n, "max_depth": depth, "min_samples_leaf": leaf}
        for n in (100,)
        for depth in (4, 6, 8)
        for leaf in (5, 10)
    ],
    "mlp": [
        {"hidden_layer_sizes": hidden, "alpha": alpha}
        for hidden in ((16,), (32,), (32, 16))
        for alpha in (0.0001, 0.001, 0.01, 0.1)
    ],
}


def load_data():
    series_path = PROCESSED_DIR / "monthly_series.csv"
    manifest_path = PROCESSED_DIR / "split_manifest.csv"
    for path in (series_path, manifest_path):
        if not path.exists():
            raise FileNotFoundError(
                f"{path} not found. Run the Phase 2 scripts first (see ml/README.md)."
            )

    manifest = pd.read_csv(manifest_path, dtype={"company_id": str, "month": str})
    expected_columns = ["company_id", "month", "month_index", "split"]
    if list(manifest.columns) != expected_columns:
        raise ValueError(
            f"split_manifest.csv columns {list(manifest.columns)} != {expected_columns}"
        )

    allowed = manifest[manifest["split"].isin(ALLOWED_SPLITS)].copy()
    allowed["month_index"] = allowed["month_index"].astype(int)
    if allowed.empty:
        raise ValueError("split_manifest.csv has no train or validation rows")

    keys = allowed[["company_id", "month", "month_index", "split"]]
    parts = []
    for chunk in pd.read_csv(
        series_path,
        dtype={"company_id": str, "month": str, "sector": str, "origin": str},
        chunksize=5000,
    ):
        parts.append(
            chunk.merge(keys, on=["company_id", "month"], how="inner", validate="one_to_one")
        )
    data = pd.concat(parts, ignore_index=True)

    if len(data) != len(allowed):
        raise ValueError(f"expected {len(allowed)} train/validation rows, found {len(data)}")

    data = data.sort_values(["company_id", "month_index"]).reset_index(drop=True)
    check_contract(data)
    return data, len(manifest)


def check_contract(data):
    if set(data["split"].unique()) != set(ALLOWED_SPLITS):
        raise ValueError(
            f"only train and validation may be loaded, found {sorted(data['split'].unique())}"
        )
    if data[["income", "expenses"]].isna().any().any():
        raise ValueError("monthly_series.csv has null income or expenses")
    if (data[["income", "expenses"]] < 0).any().any():
        raise ValueError("monthly_series.csv has negative income or expenses")
    if data[["company_id", "month", "month_index"]].isna().any().any():
        raise ValueError("monthly_series.csv has null keys")

    expected_index = data["month"].map(month_index_from_label).to_numpy()
    if not (expected_index == data["month_index"].to_numpy()).all():
        raise ValueError("month_index does not match the month column")

    duplicated = int(data.duplicated(["company_id", "month"]).sum())
    if duplicated:
        raise ValueError(f"{duplicated} duplicated (company_id, month) rows")

    companies = data["company_id"].nunique()
    expected = {"train": (1, 24, 24), "validation": (25, 30, 6)}
    blocks = data.groupby(["company_id", "split"])["month_index"].agg(["min", "max", "count"])
    for (company, split), row in blocks.iterrows():
        low, high, count = expected[split]
        if (int(row["count"]), int(row["min"]), int(row["max"])) != (count, low, high):
            raise ValueError(
                f"{company} has an invalid {split} block: "
                f"months {row['min']}-{row['max']}, {row['count']} rows"
            )
    for split in ALLOWED_SPLITS:
        if data.loc[data["split"] == split, "company_id"].nunique() != companies:
            raise ValueError(f"not every company has {split} rows")


def company_context(data):
    train = data[data["split"] == "train"]
    income_mean = train.groupby("company_id")["income"].mean()
    sector = data.groupby("company_id")["sector"].first()
    low, high = income_mean.quantile([1.0 / 3.0, 2.0 / 3.0])

    def tercile(value):
        if value <= low:
            return "small"
        if value <= high:
            return "medium"
        return "large"

    return {
        "income_mean": {company: float(value) for company, value in income_mean.items()},
        "sector": {company: str(value) for company, value in sector.items()},
        "size_tercile": {
            company: tercile(float(value)) for company, value in income_mean.items()
        },
        "tercile_bounds": {"p33": float(low), "p67": float(high)},
    }


def histories_up_to(data, target, origin):
    rows = data[(data["split"] == "train") & (data["month_index"] <= origin)]
    rows = rows.sort_values(["company_id", "month_index"])
    return {
        company: group[target].to_numpy(dtype=float).tolist()
        for company, group in rows.groupby("company_id", sort=True)
    }


def actual_values(data, split, target, start, end):
    rows = data[(data["split"] == split) & (data["month_index"].between(start, end))]
    rows = rows.sort_values(["company_id", "month_index"])
    values = {
        company: group[target].to_numpy(dtype=float).tolist()
        for company, group in rows.groupby("company_id", sort=True)
    }
    expected = end - start + 1
    for company, series in values.items():
        if len(series) != expected:
            raise ValueError(
                f"{company} has {len(series)} months between {start} and {end}, expected {expected}"
            )
    return values


def build_estimator(kind, params):
    if kind == "linear_regression":
        return Pipeline([("model", LinearRegression(**params))])
    if kind == "random_forest":
        return Pipeline(
            [("model", RandomForestRegressor(random_state=SEED, n_jobs=-1, **params))]
        )
    if kind == "mlp":
        return Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "model",
                    MLPRegressor(
                        hidden_layer_sizes=params["hidden_layer_sizes"],
                        alpha=params["alpha"],
                        early_stopping=True,
                        max_iter=3000,
                        n_iter_no_change=20,
                        random_state=SEED,
                    ),
                ),
            ]
        )
    raise ValueError(f"unknown model: {kind}")


def fit_model(kind, params, target, data):
    rows = build_training_frame(data[data["split"] == "train"], target)
    model = build_estimator(kind, params)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        model.fit(rows[FEATURE_COLUMNS], rows[TARGET])
    return model


def _summary(values):
    values = np.asarray(list(values), dtype=float)
    return {
        "companies": int(values.size),
        "mean": round(float(values.mean()), 4),
        "median": round(float(np.median(values)), 4),
        "p90": round(float(np.percentile(values, 90)), 4),
    }


def score(forecasts, actual, context):
    errors = [[] for _ in range(HORIZON)]
    normalized = {}
    predicted_all, real_all = [], []
    for company, real in actual.items():
        if company not in forecasts:
            raise KeyError(f"missing forecast for {company}")
        if len(forecasts[company]) != len(real):
            raise ValueError(f"{company}: forecast and actual lengths differ")
        scale = context["income_mean"][company]
        if scale <= 0.0:
            raise ValueError(f"{company}: mean monthly income must be greater than zero")
        normalized[company] = []
        for step, (predicted, observed) in enumerate(zip(forecasts[company], real)):
            error = abs(predicted - observed)
            errors[step].append(error)
            normalized[company].append(error / scale * 100.0)
            predicted_all.append(predicted)
            real_all.append(observed)

    predicted_all = np.asarray(predicted_all)
    real_all = np.asarray(real_all)
    residual = predicted_all - real_all
    mae = float(np.mean(np.abs(residual)))
    rmse = float(np.sqrt(np.mean(residual**2)))
    nonzero = real_all > 0
    mape = (
        float(np.mean(np.abs(residual[nonzero] / real_all[nonzero])) * 100.0)
        if nonzero.any()
        else None
    )

    per_company = {company: float(np.mean(values)) for company, values in normalized.items()}
    by_sector = {}
    for sector in sorted(set(context["sector"].values())):
        values = [per_company[c] for c in per_company if context["sector"][c] == sector]
        if values:
            by_sector[sector] = _summary(values)
    by_tercile = {}
    for name in ("small", "medium", "large"):
        values = [per_company[c] for c in per_company if context["size_tercile"][c] == name]
        if values:
            by_tercile[name] = _summary(values)

    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "mape_pct": None if mape is None else round(mape, 4),
        "n_points": int(real_all.size),
        "per_horizon_mae": [round(float(np.mean(step_errors)), 4) for step_errors in errors],
        "normalized_mae_pct": {
            "definition": (
                "absolute error divided by the company's mean monthly income "
                "(train months 1-24), in percent"
            ),
            "per_horizon": [
                {
                    "horizon": step + 1,
                    **_summary([normalized[c][step] for c in normalized]),
                }
                for step in range(HORIZON)
            ],
            "overall": _summary(per_company.values()),
            "by_sector": by_sector,
            "by_size_tercile": by_tercile,
        },
    }


def validation_metrics(model, target, data, context):
    histories = histories_up_to(data, target, VALIDATION_ORIGIN)
    actual = actual_values(
        data, "validation", target, VALIDATION_ORIGIN + 1, VALIDATION_ORIGIN + HORIZON
    )
    forecasts = recursive_forecast(model.predict, histories, VALIDATION_ORIGIN, HORIZON)
    return score(forecasts, actual, context)


def _fmt(value, digits=3):
    return "n/a" if value is None else f"{value:.{digits}f}"


def print_tables(results):
    print("\n| Model | Target | MAE | RMSE | MAPE (%) | Normalized MAE (%) | Best hyperparameters |")
    print("|---|---|---|---|---|---|---|")
    for kind in MODEL_ORDER:
        for target in TARGETS:
            row = results[kind][target]
            params = row.get("hyperparameters")
            params_text = "none" if params is None else json.dumps(params, separators=(",", ":"))
            print(
                f"| {kind} | {target} | {_fmt(row['mae'])} | {_fmt(row['rmse'])} | "
                f"{_fmt(row['mape_pct'], 2)} | "
                f"{_fmt(row['normalized_mae_pct']['overall']['mean'], 2)} | {params_text} |"
            )

    print("\n| Model | Target | +1 | +2 | +3 | +4 | +5 | +6 |")
    print("|---|---|---|---|---|---|---|---|")
    for kind in MODEL_ORDER:
        for target in TARGETS:
            values = results[kind][target]["per_horizon_mae"]
            print(f"| {kind} | {target} | " + " | ".join(f"{v:.2f}" for v in values) + " |")


def print_extra_tables(results, best_kind):
    for target in TARGETS:
        block = results[best_kind][target]["normalized_mae_pct"]
        print(f"\n### {best_kind} / {target} - normalized MAE (%) by horizon")
        print("| Horizon | Mean | Median | P90 |")
        print("|---|---|---|---|")
        for row in block["per_horizon"]:
            print(
                f"| +{row['horizon']} | {row['mean']:.2f} | {row['median']:.2f} | "
                f"{row['p90']:.2f} |"
            )

        print(f"\n### {best_kind} / {target} - normalized MAE (%) by sector")
        print("| Sector | Companies | Mean | Median | P90 |")
        print("|---|---|---|---|---|")
        for sector, row in block["by_sector"].items():
            print(
                f"| {sector} | {row['companies']} | {row['mean']:.2f} | "
                f"{row['median']:.2f} | {row['p90']:.2f} |"
            )

        print(f"\n### {best_kind} / {target} - normalized MAE (%) by size tercile")
        print("| Tercile | Companies | Mean | Median | P90 |")
        print("|---|---|---|---|---|")
        for name, row in block["by_size_tercile"].items():
            print(
                f"| {name} | {row['companies']} | {row['mean']:.2f} | "
                f"{row['median']:.2f} | {row['p90']:.2f} |"
            )


def main():
    started = time.perf_counter()
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"scikit-learn {sklearn.__version__} | random_state={SEED}")
    data, total_rows = load_data()
    companies = int(data["company_id"].nunique())
    context = company_context(data)
    print(f"loaded {len(data)} rows, {companies} companies, train and validation only")
    print(f"{total_rows - len(data)} rows marked test or holdout were discarded before use")

    results = {"seasonal_naive": {}}
    for target in TARGETS:
        histories = histories_up_to(data, target, VALIDATION_ORIGIN)
        actual = actual_values(
            data, "validation", target, VALIDATION_ORIGIN + 1, VALIDATION_ORIGIN + HORIZON
        )
        results["seasonal_naive"][target] = score(
            seasonal_naive(histories, HORIZON), actual, context
        )

    search_log = []
    for kind, space in CANDIDATES.items():
        results[kind] = {}
        for target in TARGETS:
            best = None
            for params in space:
                model = fit_model(kind, params, target, data)
                metrics = validation_metrics(model, target, data, context)
                search_log.append(
                    {
                        "model": kind,
                        "target": target,
                        "params": params,
                        "validation_mae": metrics["mae"],
                    }
                )
                print(
                    f"  {kind:17s} {target:8s} validation_mae={metrics['mae']:9.3f}  {params}",
                    flush=True,
                )
                if best is None or metrics["mae"] < best["metrics"]["mae"]:
                    best = {"params": params, "metrics": metrics, "model": model}

            results[kind][target] = dict(best["metrics"], hyperparameters=best["params"])
            path = ARTIFACT_DIR / f"{kind}_{target}.joblib"
            joblib.dump(best["model"], path, compress=3)
            print(f"  saved {path.name}")

    mean_scores = {
        kind: round((results[kind]["income"]["mae"] + results[kind]["expenses"]["mae"]) / 2.0, 4)
        for kind in MODEL_ORDER
    }
    baseline_score = mean_scores["seasonal_naive"]
    exportable_scores = {kind: mean_scores[kind] for kind in EXPORTABLE_MODELS}
    best_kind = min(exportable_scores, key=exportable_scores.get)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "random_state": SEED,
        "features": {
            "columns": list(FEATURE_COLUMNS),
            "normalization": {"type": "mean_last_n", "n": 3},
            "sector_used_as_feature": False,
        },
        "data": {
            "rows_used": int(len(data)),
            "companies": companies,
            "rows_blocked": int(total_rows - len(data)),
            "splits_used": list(ALLOWED_SPLITS),
            "splits_blocked": list(BLOCKED_SPLITS),
            "train_months": [1, 24],
            "validation_months": [25, 30],
            "size_tercile_bounds_income_mean": context["tercile_bounds"],
        },
        "protocol": {
            "validation_origin_month_index": VALIDATION_ORIGIN,
            "horizon": HORIZON,
            "recursive": True,
            "targets": list(TARGETS),
        },
        "constraints": {
            "exportable_models": list(EXPORTABLE_MODELS),
            "non_exportable_models": list(NON_EXPORTABLE_MODELS),
            "random_forest_limits": {
                "n_estimators_max": 100,
                "max_depth_max": 8,
                "min_samples_leaf_min": 5,
            },
        },
        "search": search_log,
        "validation": results,
        "scores": {
            "mean_mae": mean_scores,
            "exportable_mean_mae": exportable_scores,
            "baseline_mean_mae": baseline_score,
        },
        "selection": {
            "criterion": (
                "lowest mean of income and expenses MAE on validation months 25-30, "
                "restricted to models the backend can evaluate"
            ),
            "recommended_model": best_kind,
            "beats_baseline": bool(exportable_scores[best_kind] < baseline_score),
            "experiments_not_exportable": list(NON_EXPORTABLE_MODELS),
        },
    }

    (ARTIFACT_DIR / "metrics.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    print_tables(results)
    print_extra_tables(results, best_kind)
    print(
        "\nMean validation MAE: "
        + ", ".join(f"{kind}={value:.3f}" for kind, value in mean_scores.items())
        + f"; baseline={baseline_score:.3f}"
    )
    print(f"Recommended exportable model: {best_kind}")
    if not exportable_scores[best_kind] < baseline_score:
        print("WARNING: no exportable candidate beats the seasonal naive baseline.")
    print(f"\nartifacts: {ARTIFACT_DIR}")
    print(f"elapsed: {time.perf_counter() - started:.1f} s")


if __name__ == "__main__":
    main()
