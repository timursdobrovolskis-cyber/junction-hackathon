"""Fit, select, calibrate and evaluate an income model using separated periods."""

from collections import Counter
from contextlib import closing
from itertools import groupby
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import forecast_cash_flow, actual_daily_balances
from src.income_model import fit_income_model, held_out
from src.forecast_safety import fit_calibration, path_score, apply_calibration, estimate_savings
from scripts.evaluate_cash_flow import add_metrics, summarize


def histories(db):
    for customer, rows in groupby(db.execute("SELECT * FROM transactions ORDER BY customer_id,occurred_at,source_row"), key=lambda r: r["customer_id"]):
        yield customer, [dict(r) for r in rows]


def compare(counter, forecast, actual, baseline):
    add_metrics(counter, [d["expectedBalanceCents"] for d in forecast["daily"]], actual,
                [d["expectedBalanceCents"] for d in baseline["daily"]],
                [d["lowerScenarioBalanceCents"] for d in forecast["daily"]],
                [d["upperScenarioBalanceCents"] for d in forecast["daily"]], 0)


def main():
    output = Path("data/local/income-experiment")
    output.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect("file:data/local/bank.sqlite?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        model = fit_income_model(db.execute("SELECT * FROM transactions WHERE transaction_type='salary' AND date<='2026-04-30'"), "2026-04-30")
        audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
        model["sourceRevision"] = audit["source_revision"]
        model["sources"] = audit["sources"]
        (output / "income-model.json").write_text(json.dumps(model, indent=2) + "\n")
        development = Counter()
        for n, (customer, rows) in enumerate(histories(db), 1):
            if held_out(customer):
                continue
            for cutoff in ("2026-05-31", "2026-06-15"):
                base = forecast_cash_flow(rows, customer, cutoff)
                candidate = forecast_cash_flow(rows, customer, cutoff, income_model=model)
                if not candidate["daily"]:
                    continue
                compare(development, candidate, actual_daily_balances(rows, candidate), base)
            if n % 500 == 0:
                print(f"Development comparison: {n} customers visited", flush=True)
        development_report = summarize(development)
        accepted = development["absoluteError"] < development["flatAbsoluteError"]
        print("Development:", json.dumps(development_report), flush=True)
        if not accepted:
            (output / "report.json").write_text(json.dumps({"accepted": False, "development": development_report}, indent=2))
            print("Candidate did not beat baseline; no calibration or savings artifact promoted.")
            return
        scores = []
        for customer, rows in histories(db):
            if held_out(customer):
                continue
            prediction = forecast_cash_flow(rows, customer, "2026-07-31", income_model=model)
            if prediction["status"] == "estimated":
                scores.append(path_score(prediction, actual_daily_balances(rows, prediction)))
        calibration = fit_calibration(scores, model, "2026-08-30")
        (output / "calibration.json").write_text(json.dumps(calibration, indent=2) + "\n")
        print("Calibration:", json.dumps(calibration), flush=True)
        evaluation, coverage, examples = Counter(), Counter(), []
        for n, (customer, rows) in enumerate(histories(db), 1):
            if customer in {"CUST00001", "CUST00002", "CUST00003"}:
                forecast = apply_calibration(forecast_cash_flow(rows, customer, "2026-09-30", income_model=model), calibration, model)
                examples.append({"forecast": forecast, "savings": estimate_savings(forecast, 50000, [], commitments_confirmed=False)})
            if not held_out(customer):
                continue
            base = forecast_cash_flow(rows, customer, "2026-08-31")
            candidate = forecast_cash_flow(rows, customer, "2026-08-31", income_model=model)
            if not candidate["daily"]:
                continue
            actual = actual_daily_balances(rows, candidate)
            compare(evaluation, candidate, actual, base)
            calibrated = apply_calibration(candidate, calibration, model)
            inside = [d["calibratedLowerBalanceCents"] <= a <= d["calibratedUpperBalanceCents"] for d, a in zip(calibrated["daily"], actual)]
            coverage["paths"] += 1
            coverage["coveredPaths"] += all(inside)
            coverage["days"] += len(inside)
            coverage["coveredDays"] += sum(inside)
            # Evaluate the hypothetical capacity; no transfer is made or suggested.
            savings = estimate_savings(calibrated, 50000, [], commitments_confirmed=False)
            capacity = savings["conditionalCapacityCents"]
            if capacity is not None and capacity > 0:
                coverage["positiveSavingsPreviews"] += 1
                coverage["previewBufferViolations"] += min(actual) - capacity < 50000
        report = {"acceptedOnDevelopment": True, "modelVersion": model["modelVersion"],
                  "trainingThrough": model["trainingThrough"], "developmentCutoffs": ["2026-05-31", "2026-06-15"],
                  "calibrationCutoff": "2026-07-31", "evaluationCutoff": "2026-08-31",
                  "development": development_report, "evaluation": summarize(evaluation),
                  "calibration": calibration, "coverage": dict(coverage),
                  "observedPathCoveragePercent": round(100 * coverage["coveredPaths"] / coverage["paths"], 2),
                  "observedDailyCoveragePercent": round(100 * coverage["coveredDays"] / coverage["days"], 2),
                  "comparisonNote": "flat* metric fields here refer to frozen calendar-scenarios-v1, not the original flat daily baseline.",
                  "limitations": ["Evaluation customers were excluded from fitting, selection and calibration; their baseline metrics were inspected in the previous iteration.",
                                  "Target coverage depends on distributional stability; it is not an individual guarantee.",
                                  "Savings previews use an illustrative EUR 500 buffer and assume no supplied additional commitments. No funds are moved."]}
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "examples.json").write_text(json.dumps({"examples": examples}, indent=2) + "\n")
        print("Evaluation:", json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
