"""
Phase 2 - Step 4: build the split manifest.

Input:  ml/data/processed/monthly_series.csv
Output: ml/data/processed/split_manifest.csv

Rules:
    - 75 companies (15 %) are `holdout`, chosen at random inside each sector (seed 42).
      All 36 of their rows are marked `holdout`; the model never trains on them.
    - For the other companies: months 1-24 `train`, 25-30 `validation`, 31-36 `test`.

Run from the repository root:
    python ml/src/split_series.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

from generate_series import allocate

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"

SEED = 42
N_HOLDOUT = 75
TRAIN_END, VALIDATION_END = 24, 30  # last month_index of each period

COLUMNS = ["company_id", "month", "month_index", "split"]


def csv_text(df):
    return df.to_csv(index=False, lineterminator="\n")


def choose_holdout(companies, rng):
    """Pick N_HOLDOUT companies, proportional to each sector's size, at least one per sector."""
    sizes = companies["sector"].value_counts().sort_index()
    counts = allocate(N_HOLDOUT - len(sizes), sizes) + 1
    chosen = []
    for sector in sizes.index:
        ids = np.sort(companies.loc[companies["sector"] == sector, "company_id"].to_numpy())
        chosen.extend(rng.choice(ids, size=int(counts[sector]), replace=False))
    return set(chosen)


def build_manifest(series):
    rng = np.random.default_rng(SEED)
    companies = series[["company_id", "sector"]].drop_duplicates().sort_values("company_id")
    holdout = choose_holdout(companies, rng)

    months = sorted(series["month"].unique())
    month_index = {m: i + 1 for i, m in enumerate(months)}

    manifest = series[["company_id", "month"]].copy()
    manifest["month_index"] = manifest["month"].map(month_index)
    manifest["split"] = np.select(
        [manifest["month_index"] <= TRAIN_END, manifest["month_index"] <= VALIDATION_END],
        ["train", "validation"],
        default="test",
    )
    manifest.loc[manifest["company_id"].isin(holdout), "split"] = "holdout"
    return manifest[COLUMNS]


def main():
    series = pd.read_csv(PROCESSED_DIR / "monthly_series.csv", dtype=str)
    manifest = build_manifest(series)
    (PROCESSED_DIR / "split_manifest.csv").write_text(csv_text(manifest), encoding="utf-8")

    print(f"split_manifest.csv: {len(manifest)} rows")
    print(manifest["split"].value_counts().to_string())
    holdout = manifest.loc[manifest["split"] == "holdout", "company_id"].unique()
    sectors = series.drop_duplicates("company_id").set_index("company_id")["sector"]
    print("\nHoldout companies per sector:")
    print(sectors.loc[holdout].value_counts().sort_index().to_string())


if __name__ == "__main__":
    main()