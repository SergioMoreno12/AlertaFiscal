from __future__ import annotations

import math
from typing import Callable, Mapping, Sequence

import numpy as np
import pandas as pd

BASE_MONTH = "2023-01"
HORIZON = 6
MIN_HISTORY = 6
MIN_LAGS = 3

FEATURE_COLUMNS = ["t", "month_sin", "month_cos", "lag1", "lag2", "lag3"]
TARGET = "ratio"

NORMALIZATION = {"type": "mean_last_n", "n": MIN_LAGS}


def month_of_year(month_index: int) -> int:
    return ((int(month_index) - 1) % 12) + 1


def seasonal_terms(month_index: int) -> tuple[float, float]:
    angle = 2.0 * math.pi * month_of_year(month_index) / 12.0
    return math.sin(angle), math.cos(angle)


def month_index_from_label(label: str, base_month: str = BASE_MONTH) -> int:
    try:
        year, month = (int(part) for part in str(label).split("-"))
        base_year, base_m = (int(part) for part in base_month.split("-"))
    except (TypeError, ValueError):
        raise ValueError(f"month must be 'YYYY-MM', got {label!r}") from None
    if not 1 <= month <= 12:
        raise ValueError(f"month must be 'YYYY-MM', got {label!r}")
    index = (year - base_year) * 12 + (month - base_m) + 1
    if index < 1:
        raise ValueError(f"{label} is before the first month ({base_month})")
    return index


def month_label(month_index: int, base_month: str = BASE_MONTH) -> str:
    base_year, base_m = (int(part) for part in base_month.split("-"))
    total = base_year * 12 + (base_m - 1) + int(month_index) - 1
    year, month0 = divmod(total, 12)
    return f"{year:04d}-{month0 + 1:02d}"


def _denominator(history: Sequence[float]) -> float:
    if len(history) < MIN_LAGS:
        raise ValueError(f"at least {MIN_LAGS} months of history are required")
    value = float(np.mean([float(v) for v in history[-MIN_LAGS:]]))
    if value <= 0.0:
        raise ValueError("the mean of the last three months must be greater than zero")
    return value


def prediction_row(history: Sequence[float], month_index: int) -> tuple[list[float], float]:
    denominator = _denominator(history)
    sin_month, cos_month = seasonal_terms(month_index)
    row = [
        float(len(history)),
        sin_month,
        cos_month,
        float(history[-1]) / denominator,
        float(history[-2]) / denominator,
        float(history[-3]) / denominator,
    ]
    return row, denominator


def build_training_frame(series: pd.DataFrame, target: str) -> pd.DataFrame:
    required = {"company_id", "month_index", target}
    missing = required - set(series.columns)
    if missing:
        raise KeyError(f"missing columns: {sorted(missing)}")

    frame = (
        series[["company_id", "month_index", target]]
        .sort_values(["company_id", "month_index"])
        .reset_index(drop=True)
        .copy()
    )

    frame["t"] = frame.groupby("company_id", sort=False).cumcount().astype(float)

    grouped = frame.groupby("company_id", sort=False)[target]
    frame["lag1"] = grouped.shift(1)
    frame["lag2"] = grouped.shift(2)
    frame["lag3"] = grouped.shift(3)
    frame["_denominator"] = frame[["lag1", "lag2", "lag3"]].mean(axis=1)

    frame = frame.dropna(subset=["lag1", "lag2", "lag3", "_denominator"]).copy()
    frame = frame[frame["_denominator"] > 0.0].copy()

    for lag in ("lag1", "lag2", "lag3"):
        frame[lag] = frame[lag] / frame["_denominator"]
    frame[TARGET] = frame[target] / frame["_denominator"]

    months = ((frame["month_index"].astype(int) - 1) % 12) + 1
    frame["month_sin"] = np.sin(2.0 * np.pi * months / 12.0)
    frame["month_cos"] = np.cos(2.0 * np.pi * months / 12.0)

    columns = ["company_id", "month_index", target, TARGET] + FEATURE_COLUMNS
    return frame[columns].reset_index(drop=True)


def recursive_forecast(
    predict_ratio: Callable[[pd.DataFrame], Sequence[float]],
    histories: Mapping[str, Sequence[float]],
    last_month_index: int,
    horizon: int = HORIZON,
) -> dict[str, list[float]]:
    if horizon < 1:
        raise ValueError("horizon must be at least 1")

    values = {company: [float(v) for v in history] for company, history in histories.items()}
    if not values:
        return {}

    forecasts = {company: [] for company in values}
    companies = list(values)

    for step in range(1, horizon + 1):
        month_index = int(last_month_index) + step
        rows, denominators = [], []
        for company in companies:
            row, denominator = prediction_row(values[company], month_index)
            rows.append(row)
            denominators.append(denominator)

        features = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
        ratios = np.asarray(predict_ratio(features), dtype=float).reshape(-1)
        if ratios.shape[0] != len(companies):
            raise RuntimeError("the model returned a different number of predictions than rows")

        for company, ratio, denominator in zip(companies, ratios, denominators):
            value = max(0.0, float(ratio) * denominator)
            forecasts[company].append(value)
            values[company].append(value)

    return forecasts


def seasonal_naive(
    histories: Mapping[str, Sequence[float]], horizon: int = HORIZON
) -> dict[str, list[float]]:
    forecasts = {}
    for company, history in histories.items():
        if len(history) < 12:
            raise ValueError(f"{company}: the seasonal naive baseline needs 12 months")
        forecasts[company] = [
            max(0.0, float(history[len(history) - 12 + step - 1]))
            for step in range(1, horizon + 1)
        ]
    return forecasts
