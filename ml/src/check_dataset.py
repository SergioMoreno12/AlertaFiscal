"""
Phase 2 - Step 5: validate the dataset against the data contract.

Fails loudly (exit code 1) if any rule is broken. Prints a table that can be copied into
docs/02_dataset_report.md.

Run from the repository root, after the other three scripts:
    python ml/src/check_dataset.py
"""

import hashlib
import sys
from pathlib import Path

import pandas as pd

from generate_series import COLUMNS as SERIES_COLUMNS, csv_text as series_csv, generate
from split_series import COLUMNS as MANIFEST_COLUMNS, N_HOLDOUT, build_manifest, csv_text as manifest_csv

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"

N_COMPANIES, N_MONTHS = 500, 36
EXPECTED_MONTHS = list(pd.period_range("2023-01", periods=N_MONTHS, freq="M").strftime("%Y-%m"))

results = []


def check(name, expected, actual):
    ok = str(expected) == str(actual)
    results.append((name, expected, actual, ok))


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    series_path = PROCESSED_DIR / "monthly_series.csv"
    manifest_path = PROCESSED_DIR / "split_manifest.csv"
    series = pd.read_csv(series_path, dtype={"company_id": str, "sector": str, "month": str, "origin": str})
    manifest = pd.read_csv(manifest_path, dtype={"company_id": str, "month": str, "split": str})

    # ---------- monthly_series.csv ----------
    check("Series columns (names and order)", SERIES_COLUMNS, list(series.columns))
    check("Series rows", N_COMPANIES * N_MONTHS, len(series))
    check("Companies", N_COMPANIES, series["company_id"].nunique())
    check("Company ids C0001-C0500", True,
          sorted(series["company_id"].unique()) == [f"C{i:04d}" for i in range(1, N_COMPANIES + 1)])
    check("Rows per company", f"{N_MONTHS} for all",
          f"{N_MONTHS} for all" if (series.groupby("company_id").size() == N_MONTHS).all() else "mismatch")
    check("Months 2023-01 to 2025-12, no gaps, per company", True,
          all(sorted(g) == EXPECTED_MONTHS for _, g in series.groupby("company_id")["month"]))
    check("Duplicate (company_id, month)", 0, int(series.duplicated(["company_id", "month"]).sum()))
    check("Null values", 0, int(series.isna().sum().sum()))
    check("Negative income or expenses", 0, int((series[["income", "expenses"]] < 0).sum().sum()))
    check("Income and expenses have at most 2 decimals", True,
          bool(((series[["income", "expenses"]] * 100).round(6) % 1 == 0).all().all()))
    check("Sector names lowercase English", True,
          bool(series["sector"].str.fullmatch(r"[a-z]+").all()))
    check("origin values", ["derived", "simulated"], sorted(series["origin"].unique()))
    check("sector constant per company", 1, int(series.groupby("company_id")["sector"].nunique().max()))
    check("origin constant per company", 1, int(series.groupby("company_id")["origin"].nunique().max()))

    # ---------- split_manifest.csv ----------
    check("Manifest columns (names and order)", MANIFEST_COLUMNS, list(manifest.columns))
    keys_series = set(zip(series["company_id"], series["month"]))
    keys_manifest = set(zip(manifest["company_id"], manifest["month"]))
    check("Manifest rows", N_COMPANIES * N_MONTHS, len(manifest))
    check("Manifest keys equal series keys", True, keys_series == keys_manifest)
    expected_index = manifest["month"].map({m: i + 1 for i, m in enumerate(EXPECTED_MONTHS)})
    check("month_index matches month (1-36)", True, bool((manifest["month_index"] == expected_index).all()))
    check("split values", ["holdout", "test", "train", "validation"], sorted(manifest["split"].unique()))

    holdout_ids = manifest.loc[manifest["split"] == "holdout", "company_id"].unique()
    check("Holdout companies", N_HOLDOUT, len(holdout_ids))
    holdout_rows = manifest[manifest["company_id"].isin(holdout_ids)]
    check("Holdout companies have 36 holdout rows and nothing else", True,
          bool((holdout_rows["split"] == "holdout").all() and len(holdout_rows) == N_HOLDOUT * N_MONTHS))
    sectors = series.drop_duplicates("company_id").set_index("company_id")["sector"]
    check("Every sector has holdout companies", sorted(sectors.unique()), sorted(sectors.loc[holdout_ids].unique()))

    rest = manifest[~manifest["company_id"].isin(holdout_ids)]
    expected_split = pd.cut(rest["month_index"], [0, 24, 30, 36], labels=["train", "validation", "test"]).astype(str)
    check("Non-holdout: 1-24 train, 25-30 validation, 31-36 test", True, bool((rest["split"] == expected_split).all()))
    counts = manifest["split"].value_counts()
    check("Rows per split (train/validation/test/holdout)",
          "10200/2550/2550/2700",
          f"{counts.get('train', 0)}/{counts.get('validation', 0)}/{counts.get('test', 0)}/{counts.get('holdout', 0)}")

    # ---------- reproducibility ----------
    regenerated_series, _ = generate(PROCESSED_DIR)
    regenerated_manifest = build_manifest(regenerated_series.astype({"month": str}))
    check("Series identical when regenerated (SHA-256)", sha256(series_path.read_text(encoding="utf-8")),
          sha256(series_csv(regenerated_series)))
    check("Manifest identical when regenerated (SHA-256)", sha256(manifest_path.read_text(encoding="utf-8")),
          sha256(manifest_csv(regenerated_manifest)))

    # ---------- report ----------
    print("| Check | Expected | Result |")
    print("|---|---|---|")
    for name, expected, actual, ok in results:
        shown_expected = str(expected)[:16] + "..." if "SHA" in name else expected
        print(f"| {name} | {shown_expected} | {'PASS' if ok else 'FAIL: ' + str(actual)} |")

    failed = [r for r in results if not r[3]]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed.")
    if failed:
        print("DATASET CHECK FAILED", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()