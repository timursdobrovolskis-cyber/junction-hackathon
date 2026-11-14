"""One bounded v3 experiment: fit three recency choices, validate, calibrate, test."""

from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, timedelta
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.improve_forecast import histories, compare
from scripts.evaluate_cash_flow import summarize
from src.cash_flow import forecast_cash_flow, actual_daily_balances
from src.income_model import held_out
from src.spending_model import MODEL_VERSION, category_features, predicted_purchase_total
from src.forecast_safety import (path_score, fit_scaled_calibration, apply_calibration, estimate_savings)


def main():
    out = Path("data/local/spending-experiment")
    out.mkdir(parents=True, exist_ok=True)
    income = json.loads(Path("data/models/income-v2.json").read_text())
    old_calibration = json.loads(Path("data/models/income-v2-calibration.json").read_text())
    losses, examples_per_category = defaultdict(Counter), Counter()
    train_dates = ("2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31")
    with closing(sqlite3.connect("file:data/local/bank.sqlite?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        for n, (customer, rows) in enumerate(histories(db), 1):
            if held_out(customer):
                continue
            for cutoff in train_dates:
                earlier = [r for r in rows if r["date"] <= cutoff]
                features = category_features(earlier, cutoff)
                end = (date.fromisoformat(cutoff) + timedelta(days=30)).isoformat()
                targets = Counter()
                for r in rows:
                    if cutoff < r["date"] <= end and r["transaction_type"] == "purchase" and r["amount_cents"] < 0:
                        targets[r["category"]] += -r["amount_cents"]
                for category, feature in features.items():
                    for alpha in (0, 50, 100):
                        losses[category][alpha] += abs(predicted_purchase_total(feature, alpha) - targets[category])
                    examples_per_category[category] += 1
            if n % 1000 == 0:
                print(f"Training: {n} customers visited", flush=True)
        weights = {cat: min((0, 50, 100), key=lambda alpha: (values[alpha], alpha)) for cat, values in sorted(losses.items())}
        model = {"modelVersion": MODEL_VERSION, "trainingThrough": "2026-04-30", "incomeModel": income,
                 "recentWeightPercentByCategory": weights,
                 "training": {"cutoffs": train_dates, "examplesByCategory": dict(examples_per_category),
                              "lossCentsByCategoryAndWeight": {c: {str(k): value for k, value in v.items()} for c, v in losses.items()},
                              "selection": "Minimum 30-day purchase-total absolute error on non-reserved customers; three fixed recency choices."},
                 "sourceRevision": income["sourceRevision"], "sources": income["sources"]}
        (out / "model.json").write_text(json.dumps(model, indent=2) + "\n")
        development = Counter()
        for n, (customer, rows) in enumerate(histories(db), 1):
            if held_out(customer):
                continue
            for cutoff in ("2026-05-31", "2026-06-15"):
                old = forecast_cash_flow(rows, customer, cutoff, income_model=income)
                new = forecast_cash_flow(rows, customer, cutoff, income_model=income, spending_model=model)
                if new["daily"]:
                    compare(development, new, actual_daily_balances(rows, new), old)
            if n % 500 == 0:
                print(f"Development: {n} customers visited", flush=True)
        dev = summarize(development)
        accepted = (development["absoluteError"] < development["flatAbsoluteError"]
                    and development["endAbsoluteError"] <= 1.05 * development["flatEndAbsoluteError"]
                    and development["minimumAbsoluteError"] <= 1.05 * development["flatMinimumAbsoluteError"])
        print("Development:", json.dumps(dev), flush=True)
        report = {"modelVersion": MODEL_VERSION, "acceptedOnDevelopment": accepted,
                  "development": dev, "learnedRecencyWeights": weights,
                  "comparisonNote": "flat* metrics refer to conditioned-income-v2 on identical customers/dates.",
                  "adoptionGate": "Lower daily MAE; final-day and minimum-balance MAE may not worsen by more than 5% on development.",
                  "splitNote": "Reserved customers are excluded from fit, selection, calibration; this benchmark was already inspected in previous iterations."}
        if not accepted:
            (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            print("Single candidate failed adoption gate. Keeping v2 as supported default.")
            return
        scores = []
        for n, (customer, rows) in enumerate(histories(db), 1):
            if held_out(customer):
                continue
            f = forecast_cash_flow(rows, customer, "2026-07-31", income_model=income, spending_model=model)
            if f["status"] == "estimated":
                scores.append((path_score(f, actual_daily_balances(rows, f)), f["uncertaintyScaleCents"]))
            if n % 1000 == 0:
                print(f"Calibration: {n} customers visited", flush=True)
        calibration = fit_scaled_calibration(scores, model, "2026-08-30")
        (out / "calibration.json").write_text(json.dumps(calibration, indent=2) + "\n")
        evaluation, coverage = Counter(), Counter()
        margins = []
        for customer, rows in histories(db):
            if not held_out(customer):
                continue
            old = forecast_cash_flow(rows, customer, "2026-08-31", income_model=income)
            new = forecast_cash_flow(rows, customer, "2026-08-31", income_model=income, spending_model=model)
            if not new["daily"]:
                continue
            actual = actual_daily_balances(rows, new)
            compare(evaluation, new, actual, old)
            old = apply_calibration(old, old_calibration, income)
            new = apply_calibration(new, calibration, model)
            for name, f in (("v2", old), ("v3", new)):
                inside = [d["calibratedLowerBalanceCents"] <= a <= d["calibratedUpperBalanceCents"] for d, a in zip(f["daily"], actual)]
                coverage[name + "Paths"] += 1
                coverage[name + "CoveredPaths"] += all(inside)
                coverage[name + "CoveredDays"] += sum(inside)
                coverage[name + "WidthCents"] += sum(d["calibratedUpperBalanceCents"] - d["calibratedLowerBalanceCents"] for d in f["daily"])
                capacity = estimate_savings(f, 50000, [], False)["conditionalCapacityCents"]
                if capacity is not None and capacity > 0:
                    coverage[name + "PositiveSavingsPreviews"] += 1
                    coverage[name + "BufferBreaches"] += min(actual) - capacity < 50000
            margins.append(new["calibration"]["effectiveMarginCents"])
        report.update({"evaluation": summarize(evaluation), "calibration": calibration, "coverageCounts": dict(coverage),
                       "marginRangeCents": {"min": min(margins), "mean": round(sum(margins) / len(margins)), "max": max(margins)},
                       "coverage": {name: {"wholePathPercent": round(100 * coverage[name + "CoveredPaths"] / coverage[name + "Paths"], 2),
                                           "dailyPercent": round(100 * coverage[name + "CoveredDays"] / (30 * coverage[name + "Paths"]), 2),
                                           "meanWidthCents": round(coverage[name + "WidthCents"] / (30 * coverage[name + "Paths"]))}
                                    for name in ("v2", "v3")}})
        report["recommendedDefault"] = "conditioned-income-v2"
        report["deploymentDecision"] = "Experiment only; no default artifact is overwritten. Review all error, coverage and savings-breach metrics before any promotion."
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
