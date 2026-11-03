"""Entrenamiento y evaluación offline de proyecciones mensuales.

Este script NO forma parte del servidor web: se ejecuta a mano o en un job de
ciencia de datos. Lee la base de AlertaFiscal, agrega ingresos/gastos por mes,
entrena modelos simples, reporta métricas con una partición temporal y guarda
un artefacto JSON interpretable en ``ml/artifacts/``.

El artefacto es el único contrato entre el entrenamiento y Flask. No contiene
objetos de scikit-learn: guarda coeficientes, el lag estacional y los árboles
serializados para que el backend pueda predecir sin instalar scikit-learn.

Uso:
    python ml/company_trainer/train.py
    python ml/company_trainer/train.py --company-id 1 --horizon 6
    python ml/company_trainer/train.py --data-kind real
    python ml/company_trainer/train.py --database-url postgresql+psycopg://...

Las proyecciones son orientativas. No son liquidaciones oficiales de impuestos.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sqlalchemy import create_engine, text

# This file lives in ml/company_trainer/, so the repository root is three levels up.
ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEFAULT_SQLITE = BACKEND / "instance" / "dev.db"
LAGS = 3
SEASON_LENGTH = 12
FEATURES = ["t", "month_sin", "month_cos", *[f"lag{lag}" for lag in range(1, LAGS + 1)]]
ARTIFACT_KIND = "alertafiscal_monthly_forecast"
SCHEMA_VERSION = 1


def load_environment() -> None:
    env_file = BACKEND / ".env"
    if env_file.exists():
        load_dotenv(env_file)


def normalize_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def resolve_database_url(explicit: str | None) -> str:
    if explicit:
        return normalize_url(explicit)
    env_url = os.environ.get("DATABASE_URL", "").strip()
    db_mode = os.environ.get("DB_MODE", "").strip().lower()
    if env_url:
        if env_url.startswith("sqlite:") and db_mode != "sqlite":
            raise SystemExit(
                "DATABASE_URL apunta a SQLite. Define DB_MODE=sqlite de forma explícita "
                "o usa una URL de PostgreSQL."
            )
        return normalize_url(env_url)
    if db_mode == "sqlite" and DEFAULT_SQLITE.exists():
        return f"sqlite:///{DEFAULT_SQLITE.as_posix()}"
    raise SystemExit(
        "No hay DATABASE_URL. Configura PostgreSQL (por ejemplo en backend/.env) o, "
        "para una demo explícita con SQLite, define DB_MODE=sqlite y ejecuta antes: "
        "flask db upgrade && flask seed-demo --yes"
    )


def safe_url(url: str) -> str:
    engine = create_engine(url)
    try:
        return engine.url.render_as_string(hide_password=True)
    finally:
        engine.dispose()


def load_monthly_series(engine) -> tuple[dict[int, pd.DataFrame], dict[int, str]]:
    """Devuelve {company_id: DataFrame mensual} y nombres de empresa."""
    companies = pd.read_sql(text("SELECT id, name FROM companies"), engine)
    names = {int(row.id): str(row.name) for row in companies.itertuples()}

    frames: list[pd.DataFrame] = []
    for kind, table in (("income", "income_documents"), ("expenses", "expense_documents")):
        df = pd.read_sql(
            text(f"SELECT company_id, issue_date, total, status FROM {table}"), engine
        )
        if df.empty:
            continue
        df = df[df["status"] != "void"].copy()
        df["month"] = (
            pd.to_datetime(df["issue_date"], utc=True)
            .dt.tz_localize(None)
            .dt.to_period("M")
        )
        df["total"] = pd.to_numeric(df["total"], errors="coerce").fillna(0.0)
        grouped = df.groupby(["company_id", "month"], as_index=False)["total"].sum()
        grouped["kind"] = kind
        frames.append(grouped)

    if not frames:
        return {}, names

    stacked = pd.concat(frames, ignore_index=True)
    result: dict[int, pd.DataFrame] = {}
    for company_id, group in stacked.groupby("company_id"):
        pivot = (
            group.pivot(index="month", columns="kind", values="total")
            .sort_index()
            .astype(float)
        )
        for column in ("income", "expenses"):
            if column not in pivot.columns:
                pivot[column] = 0.0
        full_range = pd.period_range(pivot.index.min(), pivot.index.max(), freq="M")
        result[int(company_id)] = pivot.reindex(full_range, fill_value=0.0)
    return result, names


def build_features(frame: pd.DataFrame, target: str) -> pd.DataFrame:
    """y, tendencia, lags y estacionalidad (seno/coseno del mes)."""
    values = frame[target].astype(float).reset_index(drop=True)
    features = pd.DataFrame({"y": values})
    features["t"] = np.arange(len(features))
    months = np.asarray(frame.index.month, dtype=float)
    features["month_sin"] = np.sin(2 * np.pi * months / 12)
    features["month_cos"] = np.cos(2 * np.pi * months / 12)
    for lag in range(1, LAGS + 1):
        features[f"lag{lag}"] = features["y"].shift(lag)
    # Posición original en la serie; permite evaluar el lag-12 real sin
    # rellenar meses ni inventar observaciones.
    features["_pos"] = np.arange(len(features))
    return features.dropna().reset_index(drop=True)


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(math.sqrt(mean_squared_error(y_true, y_pred)))
    nonzero = np.abs(y_true) > 1.0
    mape = (
        float(np.mean(np.abs((y_true[nonzero] - y_pred[nonzero]) / y_true[nonzero])) * 100)
        if nonzero.any()
        else None
    )
    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape_percent": round(mape, 2) if mape is not None else None,
    }


def seasonal_naive_baseline(frame: pd.DataFrame, target: str, positions) -> np.ndarray:
    """Predice con el valor de hace 12 meses; si no existe, usa el mes anterior."""
    values = frame[target].astype(float).reset_index(drop=True)
    predictions = []
    for pos in positions:
        pos = int(pos)
        predictions.append(float(values.iloc[pos - SEASON_LENGTH]) if pos >= SEASON_LENGTH else float(values.iloc[pos - 1]))
    return np.asarray(predictions, dtype=float)


def export_model_params(name: str, model) -> dict:
    """Serializa el modelo ajustado sin pickles ni dependencia de sklearn."""
    if name == "linear_regression":
        return {
            "coefficients": [float(value) for value in model.coef_],
            "intercept": float(model.intercept_),
        }
    if name == "random_forest":
        trees = []
        for estimator in model.estimators_:
            tree = estimator.tree_
            trees.append(
                {
                    "children_left": [int(value) for value in tree.children_left],
                    "children_right": [int(value) for value in tree.children_right],
                    "feature": [int(value) for value in tree.feature],
                    "threshold": [float(value) for value in tree.threshold],
                    "value": [float(np.ravel(value)[0]) for value in tree.value],
                }
            )
        return {
            "n_estimators": len(trees),
            "max_depth": int(model.max_depth or 0),
            "trees": trees,
        }
    if name == "seasonal_naive":
        return {"season_length": SEASON_LENGTH}
    raise ValueError(f"Modelo no soportado: {name}")


def evaluate(frame: pd.DataFrame, target: str, test_size: int) -> tuple[dict, dict, str]:
    features = build_features(frame, target)
    if len(features) <= test_size:
        raise ValueError("Historial insuficiente para la partición de prueba.")

    train = features.iloc[:-test_size]
    test = features.iloc[-test_size:]
    columns = [c for c in features.columns if c not in ("y", "_pos")]

    baseline_pred = seasonal_naive_baseline(frame, target, test["_pos"].to_numpy())
    models = {
        "linear_regression": LinearRegression(),
        "random_forest": RandomForestRegressor(
            n_estimators=300, max_depth=6, min_samples_leaf=1, random_state=42
        ),
    }

    report: dict[str, dict] = {
        "seasonal_naive": metrics(test["y"].to_numpy(), baseline_pred)
    }
    fitted: dict[str, object] = {}
    for name, model in models.items():
        model.fit(train[columns], train["y"])
        prediction = model.predict(test[columns])
        report[name] = metrics(test["y"].to_numpy(), prediction)
        fitted[name] = model

    best = min(report, key=lambda key: report[key]["mae"])
    return report, fitted, best


def predict_from_params(name: str, params: dict, row: dict, history: list[float]) -> float:
    """Predicción de una fila usando solo el JSON del artefacto."""
    if name == "seasonal_naive":
        season = int(params.get("season_length", SEASON_LENGTH))
        if len(history) >= season:
            return float(history[-season])
        return float(history[-1])

    vector = [float(row[feature]) for feature in FEATURES]
    if name == "linear_regression":
        coefficients = params["coefficients"]
        return float(params["intercept"]) + sum(
            coefficient * value for coefficient, value in zip(coefficients, vector)
        )
    if name == "random_forest":
        trees = params["trees"]
        predictions = []
        for tree in trees:
            node = 0
            while tree["children_left"][node] != -1:
                feature = tree["feature"][node]
                if vector[feature] <= tree["threshold"][node]:
                    node = tree["children_left"][node]
                else:
                    node = tree["children_right"][node]
            predictions.append(tree["value"][node])
        return float(sum(predictions) / len(predictions)) if predictions else 0.0
    raise ValueError(f"Modelo no soportado: {name}")


def recursive_forecast(
    name: str, params: dict, frame: pd.DataFrame, target: str, horizon: int
) -> list[dict]:
    history = [float(v) for v in frame[target].tolist()]
    last_month = frame.index[-1]
    forecast: list[dict] = []
    for step in range(1, horizon + 1):
        month = last_month + step
        row = {"t": len(history)}
        for lag in range(1, LAGS + 1):
            row[f"lag{lag}"] = history[-lag]
        row["month_sin"] = math.sin(2 * math.pi * month.month / 12)
        row["month_cos"] = math.cos(2 * math.pi * month.month / 12)
        value = max(float(predict_from_params(name, params, row, history)), 0.0)
        forecast.append({"month": str(month), f"projected_{target}": round(value, 2)})
        history.append(value)
    return forecast


def canonical_history(months: list[str], income: list[float], expenses: list[float]) -> str:
    payload = {
        "months": list(months),
        "income": [f"{float(value):.2f}" for value in income],
        "expenses": [f"{float(value):.2f}" for value in expenses],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def history_signature(months: list[str], income: list[float], expenses: list[float]) -> str:
    return hashlib.sha256(canonical_history(months, income, expenses).encode("utf-8")).hexdigest()


def train_company(
    company_id: int,
    frame: pd.DataFrame,
    horizon: int,
    min_months: int,
    out_dir: Path,
    company_name: str,
    data_kind: str,
) -> dict | None:
    if len(frame) < min_months:
        print(f"  Empresa {company_id}: {len(frame)} meses (< {min_months}); se omite.")
        return None

    test_size = max(3, min(6, len(frame) // 4))
    trained_at = datetime.now(timezone.utc)
    model_version = trained_at.strftime("%Y%m%dT%H%M%SZ")
    months = [str(period) for period in frame.index]
    income_values = [round(float(value), 2) for value in frame["income"].tolist()]
    expense_values = [round(float(value), 2) for value in frame["expenses"].tolist()]
    signature = history_signature(months, income_values, expense_values)

    result: dict = {
        "company_id": company_id,
        "company_name": company_name,
        "model_version": model_version,
        "months_available": int(len(frame)),
        "period": {"from": months[0], "to": months[-1]},
        "test_months": test_size,
        "targets": {},
    }

    for target in ("income", "expenses"):
        try:
            report, fitted, best = evaluate(frame, target, test_size)
        except ValueError as exc:
            print(f"  Empresa {company_id} / {target}: {exc}")
            continue

        models = {
            "seasonal_naive": {
                "params": {"season_length": SEASON_LENGTH},
                "metrics": report["seasonal_naive"],
            }
        }
        for name, model in fitted.items():
            models[name] = {
                "params": export_model_params(name, model),
                "metrics": report[name],
            }

        selected_params = models[best]["params"]
        forecast = recursive_forecast(best, selected_params, frame, target, horizon)
        result["targets"][target] = {
            "best_model": best,
            "selected_model": best,
            "selection_metric": "mae",
            "metrics": report[best],
            "all_metrics": report,
            "models": models,
            "forecast": forecast,
        }

    if not result["targets"]:
        print(f"  Empresa {company_id}: ningún target pudo entrenarse.")
        return None

    artifact = {
        "schema_version": SCHEMA_VERSION,
        "artifact_kind": ARTIFACT_KIND,
        "company_id": company_id,
        "company_name": company_name,
        "trained_at": trained_at.isoformat(),
        "model_version": model_version,
        "horizon_months": horizon,
        "feature_spec": {
            "features": FEATURES,
            "lags": LAGS,
            "season_length": SEASON_LENGTH,
        },
        "history": {
            "months": months,
            "income": income_values,
            "expenses": expense_values,
            "signature": signature,
            "months_available": int(len(frame)),
            "period": {"from": months[0], "to": months[-1]},
        },
        "targets": result["targets"],
        "evaluation": {
            "method": "temporal_holdout",
            "test_months": test_size,
            "train_rows": max(int(len(frame)) - test_size - LAGS, 0),
            "selection_metric": "mae",
        },
        "data_provenance": {
            "kind": data_kind,
            "is_demo": data_kind == "demo",
            "warning": (
                "Datos sintéticos de demostración. Las métricas y proyecciones no "
                "validan el comportamiento de una empresa real."
                if data_kind == "demo"
                else "Datos cargados por el operador. Verificar origen y calidad antes de usar."
            ),
        },
        "disclaimer": (
            "Proyecciones orientativas de planificación. No son liquidaciones "
            "oficiales de impuestos ni sustituyen la revisión de un contador."
        ),
    }

    artifact_path = out_dir / f"model_company{company_id}.json"
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    frame.to_csv(out_dir / f"dataset_company{company_id}.csv")
    result["artifact"] = str(artifact_path)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Entrena proyecciones mensuales de AlertaFiscal.")
    parser.add_argument("--database-url", help="URL de SQLAlchemy (por defecto DATABASE_URL o SQLite local).")
    parser.add_argument("--company-id", type=int, action="append", help="Limita a una empresa (repetible).")
    parser.add_argument("--horizon", type=int, default=3, help="Meses a proyectar (1-12).")
    parser.add_argument("--min-months", type=int, default=12, help="Meses mínimos para entrenar.")
    parser.add_argument("--out", default=str(ROOT / "ml" / "artifacts"), help="Directorio de artefactos.")
    parser.add_argument(
        "--data-kind",
        choices=("demo", "real"),
        default="demo",
        help="Origen declarado del dataset. 'demo' marca el artefacto como sintético.",
    )
    return parser.parse_args()


def main() -> None:
    load_environment()
    args = parse_args()
    horizon = max(1, min(args.horizon, 12))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    url = resolve_database_url(args.database_url)
    print(f"Base de datos: {safe_url(url)}")
    engine = create_engine(url)

    series, names = load_monthly_series(engine)
    if not series:
        raise SystemExit("No hay movimientos para entrenar.")

    selected = args.company_id or sorted(series)
    results = []
    for company_id in selected:
        if company_id not in series:
            print(f"Empresa {company_id}: sin datos.")
            continue
        frame = series[company_id]
        company_name = names.get(company_id, "Sin nombre")
        print(f"\nEmpresa {company_id} · {company_name} ({len(frame)} meses)")
        result = train_company(
            company_id,
            frame,
            horizon,
            args.min_months,
            out_dir,
            company_name,
            args.data_kind,
        )
        if result is None:
            continue
        results.append(result)
        for target, payload in result["targets"].items():
            metric_line = ", ".join(
                f"{model} MAE={values['mae']:,.0f}"
                for model, values in payload["all_metrics"].items()
            )
            print(f"  {target}: mejor={payload['best_model']} | {metric_line}")

    if not results:
        raise SystemExit("Ninguna empresa cumplió el mínimo de meses.")

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "horizon_months": horizon,
        "database": safe_url(url),
        "data_provenance": {
            "kind": args.data_kind,
            "is_demo": args.data_kind == "demo",
        },
        "companies": results,
        "disclaimer": (
            "Proyecciones orientativas de planificación. No son liquidaciones "
            "oficiales de impuestos ni sustituyen la revisión de un contador."
        ),
    }
    summary_path = out_dir / "metrics.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nMétricas y artefactos guardados en {out_dir}")


if __name__ == "__main__":
    main()
