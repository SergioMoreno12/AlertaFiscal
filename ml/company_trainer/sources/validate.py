"""Offline validation of the processed context CSV files.

Usage (from the repository root):

    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.validate

It downloads and writes nothing. It checks invariants that already failed once
(for example, a regional total row treated as a department) and compares
the files with the hashes and counts of the manifest. It exits with code 1 if
any check fails.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .build_context import _is_total_department_row
from .common import (
    MANIFEST_DIR,
    PROCESSED_DIR,
    load_manifest,
    read_csv_rows,
    relative_to_repo,
    sha256_file,
)

# The source publishes millions with two decimals. Since 2013 the regional sum
# follows the national total with rounding differences (each regional office is
# published in whole millions); 50 million covers 48 rounded cells.
TOLERANCE_COP = Decimal("50000000")
# Before 2013 the regional sheet does not cover all national collection; it is reported
# as information, not as a failure.
RECONCILED_FROM_YEAR = 2013


def _decimal(raw) -> Decimal | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _latest_dir(source_code: str) -> Path:
    base = PROCESSED_DIR / source_code
    candidates = sorted(path for path in base.glob("*") if path.is_dir())
    if not candidates:
        raise FileNotFoundError(f"No processed files for {source_code} in {base}")
    return candidates[-1]


def _latest_manifest(source_code: str) -> dict:
    base = MANIFEST_DIR / source_code
    candidates = sorted(base.glob("*.json"))
    if not candidates:
        raise FileNotFoundError(f"No manifests for {source_code} in {base}")
    return load_manifest(candidates[-1])


def _manifest_entry(manifest: dict, table: str) -> dict | None:
    for entry in manifest.get("version", {}).get("processed", []):
        if entry.get("table") == table:
            return entry
    return None


def _check_manifest(path: Path, manifest: dict, table: str, rows: int, checks: list[dict]) -> None:
    entry = _manifest_entry(manifest, table)
    if entry is None:
        checks.append({"name": f"{table}.manifest_entry", "ok": False, "detail": "the entry is missing in the manifest"})
        return
    digest = sha256_file(path)
    checks.append(
        {
            "name": f"{table}.manifest_sha256",
            "ok": digest == entry.get("sha256"),
            "detail": f"{digest} vs {entry.get('sha256')}",
        }
    )
    checks.append(
        {
            "name": f"{table}.manifest_rows",
            "ok": int(entry.get("rows") or 0) == rows,
            "detail": f"{rows} vs {entry.get('rows')}",
        }
    )


def validate_tax(path: Path, manifest: dict) -> dict:
    checks: list[dict] = []
    rows = list(read_csv_rows(path))

    checks.append({"name": "tax.rows_present", "ok": bool(rows), "detail": len(rows)})

    keys = {
        (
            row["scope"],
            row["frequency"],
            row["period_year"],
            row["period_month"],
            row["department_name"],
            row["series_code"],
        )
        for row in rows
    }
    checks.append(
        {
            "name": "tax.unique_rows",
            "ok": len(keys) == len(rows),
            "detail": f"{len(rows) - len(keys)} duplicados",
        }
    )

    total_like = sorted(
        {
            row["department_name"]
            for row in rows
            if row["scope"] == "department" and row["department_name"] and _is_total_department_row(row["department_name"])
        }
    )
    checks.append(
        {
            "name": "tax.no_total_rows_as_department",
            "ok": not total_like,
            "detail": total_like,
        }
    )

    national: dict[int, Decimal] = {}
    departments: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in rows:
        if row["frequency"] != "annual":
            continue
        year = int(row["period_year"])
        value = _decimal(row["value_cop"]) or Decimal("0")
        if row["scope"] == "national" and row["series_code"] == "total_dian":
            national[year] = value
        elif row["scope"] == "department" and row["series_code"] == "total":
            departments[year] += value

    diffs = {year: abs(national[year] - departments[year]) for year in sorted(national) if year in departments}
    checked = {year: diff for year, diff in diffs.items() if year >= RECONCILED_FROM_YEAR}
    worst = max(checked.values()) if checked else Decimal("0")
    worst_year = max(checked, key=checked.get) if checked else None
    checks.append(
        {
            "name": "tax.department_national_reconciliation",
            "ok": bool(checked) and worst <= TOLERANCE_COP,
            "detail": {
                "from_year": RECONCILED_FROM_YEAR,
                "worst_year": worst_year,
                "abs_diff_cop": str(worst),
                "years_checked": len(checked),
                "unreconciled_years": sorted(year for year in diffs if year < RECONCILED_FROM_YEAR),
            },
        }
    )

    preliminary_2026 = [
        row for row in rows if int(row["period_year"]) == 2026 and row["is_preliminary"].lower() != "true"
    ]
    checks.append(
        {
            "name": "tax.2026_preliminary",
            "ok": not preliminary_2026,
            "detail": len(preliminary_2026),
        }
    )

    _check_manifest(path, manifest, "tax_collections", len(rows), checks)
    return {
        "path": relative_to_repo(path),
        "rows": len(rows),
        "years": sorted({int(row["period_year"]) for row in rows}),
        "max_department_national_diff_cop": str(worst),
        "checks": checks,
        "ok": all(check["ok"] for check in checks),
    }


def validate_benchmarks(path: Path, manifest: dict) -> dict:
    checks: list[dict] = []
    rows = list(read_csv_rows(path))

    checks.append({"name": "benchmarks.rows_present", "ok": bool(rows), "detail": len(rows)})

    keys = {(row["year"], row["metric"], row["sector"]) for row in rows}
    checks.append(
        {
            "name": "benchmarks.unique_rows",
            "ok": len(keys) == len(rows),
            "detail": f"{len(rows) - len(keys)} duplicados",
        }
    )

    quantile_errors = []
    mean_errors = []
    for row in rows:
        sample = int(row["sample_size"])
        p25 = _decimal(row["p25_cop"])
        median = _decimal(row["median_cop"])
        p75 = _decimal(row["p75_cop"])
        low = _decimal(row["min_cop"])
        high = _decimal(row["max_cop"])
        if sample <= 0 or None in (p25, median, p75, low, high):
            quantile_errors.append(f"{row['year']}/{row['metric']}/{row['sector']}: invalid sample or quantiles")
            continue
        if not (low <= p25 <= median <= p75 <= high):
            quantile_errors.append(f"{row['year']}/{row['metric']}/{row['sector']}: quantiles out of order")
        total = _decimal(row["total_cop"])
        mean = _decimal(row["mean_cop"])
        if total is None or mean is None or abs((total / sample) - mean) > Decimal("1"):
            mean_errors.append(f"{row['year']}/{row['metric']}/{row['sector']}: media inconsistente")

    checks.append({"name": "benchmarks.quantiles_ordered", "ok": not quantile_errors, "detail": quantile_errors[:5]})
    checks.append({"name": "benchmarks.mean_matches_total", "ok": not mean_errors, "detail": mean_errors[:5]})

    all_present = all(
        any(row["year"] == str(year) and row["metric"] == metric and row["sector"] == "ALL" for row in rows)
        for year in {row["year"] for row in rows}
        for metric in {row["metric"] for row in rows}
    )
    checks.append({"name": "benchmarks.all_sector_present", "ok": all_present, "detail": ""})

    _check_manifest(path, manifest, "sector_benchmarks", len(rows), checks)
    return {
        "path": relative_to_repo(path),
        "rows": len(rows),
        "checks": checks,
        "ok": all(check["ok"] for check in checks),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate the processed context files without using the network.")
    parser.add_argument("--json", action="store_true", help="Print only the result JSON")
    args = parser.parse_args(argv)

    try:
        tax_path = _latest_dir("dian_recaudo") / "tax_collection.csv"
        bench_path = _latest_dir("supersociedades_top10000") / "sector_benchmarks.csv"
        report = {
            "tax_collections": validate_tax(tax_path, _latest_manifest("dian_recaudo")),
            "sector_benchmarks": validate_benchmarks(bench_path, _latest_manifest("supersociedades_top10000")),
        }
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    report["ok"] = report["tax_collections"]["ok"] and report["sector_benchmarks"]["ok"]
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not args.json:
        for section in ("tax_collections", "sector_benchmarks"):
            for check in report[section]["checks"]:
                state = "OK" if check["ok"] else "FALLA"
                print(f"[{state}] {check['name']}: {check['detail']}", file=sys.stderr)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
