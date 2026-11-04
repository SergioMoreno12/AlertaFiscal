"""Post-run diagnostic: errors of companies with a level shift versus the rest.

    python ml/src/level_shift_analysis.py

Allowed by section 4.2 of docs/04_evaluation_protocol.md: it runs only after the tag
eval-final-run exists, and it reads the column shock_month of company_profiles.csv only to
label companies. It changes no forecast, no metric of section 5 and no verdict. It recomputes
the same deterministic forecasts as the official run and stops if the overall MAE does not
match test_report.json, so the labels are attached to exactly the official errors.
"""

import csv
import json
import subprocess
import sys

import evaluate as ev

PROFILES_PATH = ev.PROCESSED_DIR / "company_profiles.csv"
OUTPUT_PATH = ev.ARTIFACT_DIR / "level_shift_analysis.json"


def shock_months():
    with open(PROFILES_PATH, newline="", encoding="utf-8") as handle:
        return {r["company_id"]: int(r["shock_month"]) for r in csv.DictReader(handle)}


def group_of(shock, history, scored):
    if shock < 0:
        return "no_shift"
    if shock <= history[1]:
        return "shift_in_history"
    if shock <= scored[1]:
        return "shift_in_forecast_window"
    return "no_shift"


def main():
    tag = subprocess.run(["git", "tag", "-l", ev.FINAL_TAG], capture_output=True, text=True, cwd=ev.ROOT)
    if not tag.stdout.strip():
        sys.exit(f"STOP: the tag {ev.FINAL_TAG} does not exist. This diagnostic runs only after the official run.")
    official = json.loads(ev.OFFICIAL_REPORT.read_text(encoding="utf-8"))
    predictor = ev.Predictor(json.loads(ev.DEFAULT_ARTIFACT.read_text(encoding="utf-8")))
    shocks = shock_months()
    config = ev.MODES["official"]
    out = {"source": "company_profiles.csv column shock_month (labels only)", "scenarios": {}}
    for name, splits in config["scenarios"].items():
        companies = ev.scenario_companies(ev.load_companies(set(splits)), splits,
                                          config["history"], config["scored"])
        records = ev.evaluate_scenario(predictor, companies, config["history"], config["scored"])
        for target in ev.TARGETS:
            subset = [r for r in records if r["model"] == "model" and r["target"] == target]
            expected = official["results"][name][f"model/{target}"]["overall"]["mae"]
            if ev.summarize(subset)["mae"] != expected:
                sys.exit(f"STOP: {name} {target} MAE does not match the official report.")
        scenario = {}
        for model in ("model", "baseline"):
            for target in ev.TARGETS:
                subset = [r for r in records if r["model"] == model and r["target"] == target]
                groups = {}
                for r in subset:
                    label = group_of(shocks[r["company_id"]], config["history"], config["scored"])
                    groups.setdefault(label, []).append(r)
                scenario[f"{model}/{target}"] = {k: ev.summarize(v) for k, v in sorted(groups.items())}
        out["scenarios"][name] = scenario
    OUTPUT_PATH.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("| Scenario | Model | Target | Group | Companies | MAE | Median norm. MAE (%) | Bias |")
    print("|---|---|---|---|---|---|---|---|")
    for name, scenario in out["scenarios"].items():
        for key, groups in scenario.items():
            model, target = key.split("/")
            for label, s in groups.items():
                print(f"| {name} | {model} | {target} | {label} | {s['n_companies']} | {s['mae']} "
                      f"| {s['median_normalized_mae_pct']} | {s['bias']} |")
    print(f"written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
