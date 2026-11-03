"""
Phase 4 - evaluation of the Phase 3 artifact (docs/04_evaluation_protocol.md).

Reads ml/artifacts/model_global.json and forecasts with a pure-Python predictor (no scikit-learn),
the same algorithm the backend runs. Compares the chosen model with the seasonal naive baseline
under the same recursive 6-month procedure and checks the acceptance criteria.

Two modes, run from the repository root:
    python ml/src/evaluate.py              validation dry run: history 1-24, forecast 25-30,
                                           regular companies only. Never reads test or holdout rows.
    python ml/src/evaluate.py --official   THE official run: history 1-30, forecast 31-36, temporal
                                           test and holdout. Runs once; writes test_report.json.

Only the Python standard library is used, so the numbers do not depend on numpy or scikit-learn.
"""

import argparse
import csv
import hashlib
import json
import math
import struct
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"
ARTIFACT_DIR = ROOT / "ml" / "artifacts"
SERIES_PATH = PROCESSED_DIR / "monthly_series.csv"
MANIFEST_PATH = PROCESSED_DIR / "split_manifest.csv"
DEFAULT_ARTIFACT = ARTIFACT_DIR / "model_global.json"
DEFAULT_PARITY = ARTIFACT_DIR / "parity_cases.json"
OFFICIAL_REPORT = ARTIFACT_DIR / "test_report.json"
DRY_RUN_REPORT = ARTIFACT_DIR / "validation_dry_run.json"
FINAL_TAG = "eval-final-run"

HORIZON = 6
TARGETS = ("income", "expenses")
SUPPORTED_MODELS = ("seasonal_naive", "linear_regression", "random_forest")
FEATURES = ("t", "month_sin", "month_cos", "lag1", "lag2", "lag3")
PARITY_TOLERANCE = 1e-6

# Acceptance criteria, protocol section 5 (Phase 1 sections 4.2-4.4).
MAX_MAE_RATIO_TO_BASELINE = 0.90
MAX_MEDIAN_NORMALIZED = 0.15
MAX_P90_NORMALIZED = 0.30

# (history months, scored months, splits that may be read, scenarios)
MODES = {
    "validation": {"history": (1, 24), "scored": (25, 30), "splits": ("train", "validation"),
                   "scenarios": {"validation": ("train", "validation")}},
    "official": {"history": (1, 30), "scored": (31, 36),
                 "splits": ("train", "validation", "test", "holdout"),
                 "scenarios": {"temporal_test": ("train", "validation", "test"),
                               "holdout_test": ("holdout",)}},
}


# ---------- Small helpers ----------

def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values, q):
    """Linear interpolation between ordered values, as numpy.percentile's default."""
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * q / 100.0
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def mean(values):
    return sum(values) / len(values) if values else None


def next_month(label):
    year, month = (int(part) for part in label.split("-"))
    return f"{year + month // 12:04d}-{month % 12 + 1:02d}"


def rounded(value, digits=4):
    return None if value is None else round(value, digits)


def float32(value):
    """Round to single precision, as scikit-learn does with tree inputs before comparing."""
    return struct.unpack("f", struct.pack("f", value))[0]


# ---------- Pure-Python predictor (protocol appendix A) ----------

class Predictor:
    def __init__(self, artifact):
        if artifact.get("scope") != "global":
            raise ValueError("artifact scope must be 'global'")
        spec = artifact.get("feature_spec", {})
        features = tuple(spec.get("features", FEATURES))
        if sorted(features) != sorted(FEATURES):
            raise ValueError(f"artifact features {features} differ from the contract {FEATURES}")
        self.features = features
        normalization = spec.get("normalization")
        if normalization is None:
            self.norm_n = None
        elif normalization.get("type") == "mean_last_n":
            self.norm_n = int(normalization.get("n", 3))
        else:
            raise ValueError(f"unsupported normalization {normalization}")
        self.min_history = int(artifact.get("min_history_months", 6))
        self.model_version = artifact.get("model_version")
        self.targets = {}
        for target in TARGETS:
            block = artifact.get("targets", {}).get(target)
            if block is None:
                raise ValueError(f"artifact has no model for target '{target}'")
            kind = block.get("model_type", artifact.get("model_type"))
            if kind not in SUPPORTED_MODELS:
                raise ValueError(f"{target}: model_type {kind!r} is not supported by the backend")
            if kind == "linear_regression" and len(block["coef"]) != len(self.features):
                raise ValueError(f"{target}: {len(block['coef'])} coefficients for {len(self.features)} features")
            if kind == "random_forest" and not block.get("trees"):
                raise ValueError(f"{target}: random_forest without trees")
            self.targets[target] = dict(block, model_type=kind)

    def model_types(self):
        return {target: block["model_type"] for target, block in self.targets.items()}

    def _row(self, history, month_number):
        n = self.norm_n
        scale = mean(history[-n:]) if n else 1.0
        if scale is None or scale <= 0:
            # same rule as Phase 3 and the backend: treated as insufficient history
            raise ValueError("the mean of the last months is zero or negative: insufficient history")
        angle = 2.0 * math.pi * month_number / 12.0
        values = {
            "t": float(len(history)),
            "month_sin": math.sin(angle),
            "month_cos": math.cos(angle),
            "lag1": history[-1] / scale,
            "lag2": history[-2] / scale,
            "lag3": history[-3] / scale,
        }
        return [values[name] for name in self.features], scale

    @staticmethod
    def _tree(tree, row):
        node = 0
        left, right = tree["children_left"], tree["children_right"]
        while left[node] != -1:
            node = left[node] if row[tree["feature"][node]] <= tree["threshold"][node] else right[node]
        value = tree["value"][node]
        while isinstance(value, list):  # scikit-learn stores leaf values as [[v]]
            value = value[0]
        return float(value)

    def _output(self, block, row):
        if block["model_type"] == "linear_regression":
            return block["intercept"] + sum(c * x for c, x in zip(block["coef"], row))
        trees = block["trees"]
        row = [float32(x) for x in row]
        return sum(self._tree(tree, row) for tree in trees) / len(trees)

    def forecast(self, history, last_month, target, horizon=HORIZON):
        history = [float(v) for v in history]
        if len(history) < self.min_history:
            raise ValueError(f"at least {self.min_history} months of history are required")
        block = self.targets[target]
        if block["model_type"] == "seasonal_naive":
            return seasonal_naive(history, horizon)
        month = last_month
        result = []
        for _ in range(horizon):
            month = next_month(month)
            row, scale = self._row(history, int(month[5:]))
            value = max(0.0, self._output(block, row) * scale)
            result.append(value)
            history.append(value)
        return result


def seasonal_naive(history, horizon=HORIZON):
    if len(history) < 12:
        raise ValueError("the seasonal naive baseline needs 12 months of history")
    return [max(0.0, float(history[len(history) - 12 + step])) for step in range(horizon)]


def check_parity(predictor, parity_path):
    cases = json.loads(parity_path.read_text(encoding="utf-8"))
    cases = cases.get("cases", cases) if isinstance(cases, dict) else cases
    worst = 0.0
    for case in cases:
        histories = {"income": case["income_history"], "expenses": case["expense_history"]}
        for target in TARGETS:
            expected = case["expected"][target]
            got = predictor.forecast(histories[target], case["last_month"], target, len(expected))
            for a, b in zip(got, expected):
                worst = max(worst, abs(a - b) / max(abs(b), 1e-9))
    return {"cases": len(cases), "max_relative_difference": worst,
            "tolerance": PARITY_TOLERANCE, "passed": worst <= PARITY_TOLERANCE}


# ---------- Data ----------

def load_companies(allowed_splits):
    """Read only the rows whose split is allowed. Other rows are discarded while streaming."""
    with open(MANIFEST_PATH, newline="", encoding="utf-8") as handle:
        split_of = {(r["company_id"], r["month"]): (r["split"], int(r["month_index"]))
                    for r in csv.DictReader(handle) if r["split"] in allowed_splits}
    companies = {}
    with open(SERIES_PATH, newline="", encoding="utf-8") as handle:
        for r in csv.DictReader(handle):
            key = (r["company_id"], r["month"])
            if key not in split_of:
                continue
            split, index = split_of[key]
            company = companies.setdefault(r["company_id"], {"sector": r["sector"], "rows": {}})
            company["rows"][index] = {"month": r["month"], "split": split,
                                      "income": float(r["income"]), "expenses": float(r["expenses"])}
    return companies


def scenario_companies(companies, splits, history, scored):
    selected = {}
    for company_id, company in sorted(companies.items()):
        if {row["split"] for row in company["rows"].values()} - set(splits):
            continue
        months = range(history[0], scored[1] + 1)
        if not all(m in company["rows"] for m in months):
            continue
        selected[company_id] = company
    return selected


# ---------- Evaluation ----------

def evaluate_scenario(predictor, companies, history, scored):
    """Forecast every company with the chosen model and the baseline; return per-company errors."""
    records = []
    for company_id, company in companies.items():
        rows = company["rows"]
        past = range(history[0], history[1] + 1)
        mean_income = mean([rows[m]["income"] for m in past])
        last_month = rows[history[1]]["month"]
        for target in TARGETS:
            series = [rows[m][target] for m in past]
            real = [rows[m][target] for m in range(scored[0], scored[1] + 1)]
            forecasts = {"model": predictor.forecast(series, last_month, target),
                         "baseline": seasonal_naive(series)}
            for model, values in forecasts.items():
                for step, (predicted, observed) in enumerate(zip(values, real), start=1):
                    records.append({"company_id": company_id, "sector": company["sector"],
                                    "mean_income": mean_income, "target": target, "model": model,
                                    "step": step, "month": rows[scored[0] + step - 1]["month"],
                                    "forecast": predicted, "real": observed})
    return records


def summarize(records):
    errors = [r["forecast"] - r["real"] for r in records]
    nonzero = [r for r in records if r["real"] > 0]
    per_company = {}
    for r in records:
        per_company.setdefault(r["company_id"], []).append(abs(r["forecast"] - r["real"]) / r["mean_income"])
    normalized = [mean(v) for v in per_company.values()]
    return {
        "n_points": len(records),
        "n_companies": len(per_company),
        "mae": rounded(mean([abs(e) for e in errors])),
        "rmse": rounded(math.sqrt(mean([e * e for e in errors]))),
        "median_normalized_mae_pct": rounded(100 * percentile(normalized, 50)),
        "p90_normalized_mae_pct": rounded(100 * percentile(normalized, 90)),
        "mape_pct": rounded(100 * mean([abs(r["forecast"] - r["real"]) / r["real"] for r in nonzero])),
        "mape_excluded_zero_months": len(records) - len(nonzero),
        "bias": rounded(mean(errors)),
    }


def terciles(records):
    sizes = sorted({(r["mean_income"], r["company_id"]) for r in records})
    n = len(sizes)
    label = {}
    for i, (_, company_id) in enumerate(sizes):
        label[company_id] = ("small", "medium", "large")[min(3 * i // n, 2)]
    return label


def breakdowns(records):
    size = terciles(records)
    out = {}
    for model in ("model", "baseline"):
        for target in TARGETS:
            subset = [r for r in records if r["model"] == model and r["target"] == target]
            key = f"{model}/{target}"
            out[key] = {
                "overall": summarize(subset),
                "by_horizon_mae": [summarize([r for r in subset if r["step"] == s])["mae"]
                                   for s in range(1, HORIZON + 1)],
                "by_sector": {s: summarize([r for r in subset if r["sector"] == s])
                              for s in sorted({r["sector"] for r in subset})},
                "by_size_tercile": {t: summarize([r for r in subset if size[r["company_id"]] == t])
                                    for t in ("small", "medium", "large")},
            }
    largest = sorted((r for r in records if r["model"] == "model"),
                     key=lambda r: abs(r["forecast"] - r["real"]), reverse=True)[:10]
    out["largest_errors"] = [dict(company_id=r["company_id"], sector=r["sector"], month=r["month"],
                                  target=r["target"], forecast=rounded(r["forecast"], 2),
                                  real=rounded(r["real"], 2),
                                  abs_error=rounded(abs(r["forecast"] - r["real"]), 2))
                             for r in largest]
    return out


def acceptance(results):
    checks = []
    for scenario, result in results.items():
        for target in TARGETS:
            model = result[f"model/{target}"]["overall"]
            base = result[f"baseline/{target}"]["overall"]
            checks.append({"id": "C1", "scenario": scenario, "target": target,
                           "rule": f"MAE <= {MAX_MAE_RATIO_TO_BASELINE} x baseline MAE",
                           "value": rounded(model["mae"] / base["mae"]),
                           "passed": model["mae"] <= MAX_MAE_RATIO_TO_BASELINE * base["mae"]})
            checks.append({"id": "C2", "scenario": scenario, "target": target,
                           "rule": f"median normalized MAE <= {100 * MAX_MEDIAN_NORMALIZED:.0f} %",
                           "value": model["median_normalized_mae_pct"],
                           "passed": model["median_normalized_mae_pct"] <= 100 * MAX_MEDIAN_NORMALIZED})
            checks.append({"id": "C3", "scenario": scenario, "target": target,
                           "rule": f"p90 normalized MAE <= {100 * MAX_P90_NORMALIZED:.0f} %",
                           "value": model["p90_normalized_mae_pct"],
                           "passed": model["p90_normalized_mae_pct"] <= 100 * MAX_P90_NORMALIZED})
    return checks


def print_tables(results, checks):
    print("\n| Scenario | Model | Target | MAE | RMSE | Median norm. MAE (%) | P90 norm. MAE (%) | MAPE (%) | Bias |")
    print("|---|---|---|---|---|---|---|---|---|")
    for scenario, result in results.items():
        for model in ("model", "baseline"):
            for target in TARGETS:
                o = result[f"{model}/{target}"]["overall"]
                print(f"| {scenario} | {model} | {target} | {o['mae']:.3f} | {o['rmse']:.3f} | "
                      f"{o['median_normalized_mae_pct']:.2f} | {o['p90_normalized_mae_pct']:.2f} | "
                      f"{o['mape_pct']:.2f} | {o['bias']:.3f} |")
    print("\n| Scenario | Model | Target | +1 | +2 | +3 | +4 | +5 | +6 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for scenario, result in results.items():
        for model in ("model", "baseline"):
            for target in TARGETS:
                h = result[f"{model}/{target}"]["by_horizon_mae"]
                print(f"| {scenario} | {model} | {target} | " + " | ".join(f"{v:.2f}" for v in h) + " |")
    print("\n| Check | Scenario | Target | Rule | Value | Result |")
    print("|---|---|---|---|---|---|")
    for c in checks:
        print(f"| {c['id']} | {c['scenario']} | {c['target']} | {c['rule']} | {c['value']} | "
              f"{'PASS' if c['passed'] else 'FAIL'} |")


# ---------- Main ----------

def guard_official_run():
    if OFFICIAL_REPORT.exists():
        sys.exit(f"STOP: {OFFICIAL_REPORT.name} already exists. The test set is used once.")
    tags = subprocess.run(["git", "tag", "-l", FINAL_TAG], capture_output=True, text=True, cwd=ROOT)
    if tags.stdout.strip():
        sys.exit(f"STOP: the tag {FINAL_TAG} already exists. The test set is used once.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--official", action="store_true", help="run the official test evaluation (once)")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--parity", type=Path, default=DEFAULT_PARITY)
    parser.add_argument("--output", type=Path, help="report path (default depends on the mode)")
    args = parser.parse_args()

    mode = "official" if args.official else "validation"
    config = MODES[mode]
    if args.official:
        guard_official_run()

    artifact_bytes_sha = sha256(args.artifact)
    predictor = Predictor(json.loads(args.artifact.read_text(encoding="utf-8")))
    print(f"mode: {mode} | artifact {args.artifact.name} sha256 {artifact_bytes_sha}")
    print(f"model types: {predictor.model_types()} | version: {predictor.model_version}")

    parity = None
    if args.parity.exists():
        parity = check_parity(predictor, args.parity)
        print(f"parity: {parity['cases']} cases, max relative difference "
              f"{parity['max_relative_difference']:.2e} -> {'PASS' if parity['passed'] else 'FAIL'}")
    if args.official and not (parity and parity["passed"]):
        sys.exit("STOP: parity_cases.json is missing or fails. Fix the predictor before reading test rows.")

    companies = load_companies(config["splits"])
    results = {}
    for scenario, splits in config["scenarios"].items():
        selected = scenario_companies(companies, splits, config["history"], config["scored"])
        records = evaluate_scenario(predictor, selected, config["history"], config["scored"])
        results[scenario] = breakdowns(records)
        print(f"{scenario}: {len(selected)} companies, months {config['scored'][0]}-{config['scored'][1]}")

    checks = acceptance(results)
    verdict = "accepted" if all(c["passed"] for c in checks) else "not accepted"
    report = {
        "mode": mode,
        "official": args.official,
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "protocol": "docs/04_evaluation_protocol.md (tag eval-protocol-v1)",
        "artifact": str(args.artifact.relative_to(ROOT)) if args.artifact.is_relative_to(ROOT) else str(args.artifact),
        "artifact_sha256": artifact_bytes_sha,
        "model_version": predictor.model_version,
        "model_types": predictor.model_types(),
        "parity": parity,
        "parity_sha256": sha256(args.parity) if args.parity.exists() else None,
        "data_sha256": {"monthly_series.csv": sha256(SERIES_PATH), "split_manifest.csv": sha256(MANIFEST_PATH)},
        "history_months": list(config["history"]),
        "scored_months": list(config["scored"]),
        "results": results,
        "acceptance_checks": checks,
        "verdict": verdict,
        "python": sys.version.split()[0],
    }
    output = args.output or (OFFICIAL_REPORT if args.official else DRY_RUN_REPORT)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print_tables(results, checks)
    label = "VERDICT" if args.official else "Dry-run verdict (validation only, not the official result)"
    print(f"\n{label}: {verdict}")
    print(f"report written to {output}")


if __name__ == "__main__":
    main()
