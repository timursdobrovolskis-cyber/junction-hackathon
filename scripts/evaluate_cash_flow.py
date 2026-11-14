"""Replay historical forecasts and compare with a flat 90-day cash baseline."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, timedelta
import hashlib
from itertools import groupby
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import MODEL_VERSION, actual_daily_balances, flat_daily_baseline, forecast_cash_flow


def add_metrics(totals, predicted, actual, flat, lower, upper, buffer):
    totals["windows"] += 1
    totals["days"] += len(actual)
    totals["absoluteError"] += sum(abs(p - a) for p, a in zip(predicted, actual))
    totals["signedError"] += sum(p - a for p, a in zip(predicted, actual))
    totals["flatAbsoluteError"] += sum(abs(p - a) for p, a in zip(flat, actual))
    totals["endAbsoluteError"] += abs(predicted[-1] - actual[-1])
    totals["flatEndAbsoluteError"] += abs(flat[-1] - actual[-1])
    totals["minimumAbsoluteError"] += abs(min(predicted) - min(actual))
    totals["flatMinimumAbsoluteError"] += abs(min(flat) - min(actual))
    totals["coveredDays"] += sum(lo <= a <= hi for lo, a, hi in zip(lower, actual, upper))
    totals["envelopeWidth"] += sum(hi - lo for lo, hi in zip(lower, upper))
    actual_low = min(actual) < buffer
    totals["actualLowCashWindows"] += actual_low
    for name, path in (("central", predicted), ("scenario", lower), ("flat", flat)):
        flagged = min(path) < buffer
        totals[name + "Flags"] += flagged
        totals[name + "TruePositives"] += flagged and actual_low


def summarize(t):
    n, days = t["windows"], t["days"]
    if n == 0:
        return {"windows": 0}
    metrics = {"windows": n, "days": days,
               "dailyMAECents": round(t["absoluteError"] / days),
               "dailyBiasCents": round(t["signedError"] / days),
               "flatDailyMAECents": round(t["flatAbsoluteError"] / days),
               "day30MAECents": round(t["endAbsoluteError"] / n),
               "flatDay30MAECents": round(t["flatEndAbsoluteError"] / n),
               "lowestBalanceMAECents": round(t["minimumAbsoluteError"] / n),
               "flatLowestBalanceMAECents": round(t["flatMinimumAbsoluteError"] / n),
               "scenarioEnvelopeCoveragePercent": round(100 * t["coveredDays"] / days, 2),
               "meanEnvelopeWidthCents": round(t["envelopeWidth"] / days),
               "actualLowCashWindows": t["actualLowCashWindows"]}
    metrics["dailyMAEImprovementPercent"] = (round(100 * (1 - t["absoluteError"] / t["flatAbsoluteError"]), 2)
                                              if t["flatAbsoluteError"] else None)
    for name in ("central", "scenario", "flat"):
        metrics[name + "LowCash"] = {
            "flaggedWindows": t[name + "Flags"], "truePositives": t[name + "TruePositives"],
            "precision": round(t[name + "TruePositives"] / t[name + "Flags"], 4) if t[name + "Flags"] else None,
            "recall": round(t[name + "TruePositives"] / t["actualLowCashWindows"], 4) if t["actualLowCashWindows"] else None}
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--cutoff", action="append", type=date.fromisoformat)
    parser.add_argument("--limit-customers", type=int)
    parser.add_argument("--buffer-cents", type=int, default=0)
    parser.add_argument("--output", type=Path, default=Path("data/local/forecast-evaluation.json"))
    args = parser.parse_args()
    if args.buffer_cents < 0 or (args.limit_customers is not None and args.limit_customers < 1):
        parser.error("Buffer must be nonnegative and customer limit positive")
    if args.output.resolve() == args.database.resolve():
        parser.error("Output must not overwrite the database")
    cutoffs = sorted(set(args.cutoff or [date(2026, 5, 31), date(2026, 6, 15), date(2026, 7, 31), date(2026, 8, 31)]))
    totals = defaultdict(Counter)
    statuses = Counter()
    customers = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cases_path = args.output.with_suffix(".cases.jsonl")
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        last = db.execute("SELECT MAX(date) FROM transactions").fetchone()[0]
        if not last or (cutoffs[-1] + timedelta(days=30)).isoformat() > last:
            parser.error("Every cutoff must have a full 30-day evaluation period within the export")
        audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
        query = "SELECT * FROM transactions ORDER BY customer_id, occurred_at, source_row"
        with cases_path.open("w", encoding="utf-8") as cases:
            for customer, history in groupby(db.execute(query), key=lambda r: r["customer_id"]):
                if args.limit_customers is not None and customers >= args.limit_customers:
                    break
                rows = [dict(r) for r in history]
                customer_holdout = int(hashlib.sha256(customer.encode()).hexdigest()[:8], 16) % 5 == 0
                for cutoff in cutoffs:
                    as_of = cutoff.isoformat()
                    prediction = forecast_cash_flow(rows, customer, as_of, buffer_cents=args.buffer_cents)
                    statuses[prediction["status"]] += 1
                    if not prediction["daily"]:
                        continue
                    try:
                        actual = actual_daily_balances(rows, prediction)
                    except ValueError:
                        statuses["evaluation_new_account"] += 1
                        continue
                    predicted = [d["expectedBalanceCents"] for d in prediction["daily"]]
                    lower = [d["lowerScenarioBalanceCents"] for d in prediction["daily"]]
                    upper = [d["upperScenarioBalanceCents"] for d in prediction["daily"]]
                    flat = flat_daily_baseline(rows, customer, as_of, prediction["startingBalanceCents"], 30)
                    temporal_holdout = cutoff == cutoffs[-1]
                    partition = ("both_holdout" if customer_holdout and temporal_holdout else
                                 "customer_holdout" if customer_holdout else
                                 "temporal_holdout" if temporal_holdout else "development")
                    case_metrics = Counter()
                    add_metrics(case_metrics, predicted, actual, flat, lower, upper, args.buffer_cents)
                    for key in ("overall", "split:" + partition, "cutoff:" + as_of):
                        totals[key].update(case_metrics)
                    cases.write(json.dumps({"customerId": customer, "asOf": as_of, "split": partition,
                                            "status": prediction["status"], **summarize(case_metrics)}, separators=(",", ":")) + "\n")
                customers += 1
                if customers % 500 == 0:
                    print(f"Evaluated {customers:,} customers", flush=True)
    report = {"modelVersion": MODEL_VERSION, "cutoffs": [d.isoformat() for d in cutoffs],
              "horizonDays": 30, "bufferCents": args.buffer_cents, "customerCount": customers,
              "statuses": dict(statuses), "sourceRevision": audit["source_revision"], "sources": audit["sources"],
              "splitRule": "SHA256(customer_id) first 8 hex digits modulo 5 = 0 reserves customers; latest cutoff reserves time.",
              "notes": ["No parameters are fitted to evaluation outcomes. This evaluates a fixed baseline, not a trained model.",
                        "Overlapping forecast windows are correlated; this is not an independent sample confidence interval.",
                        "Coverage measures an uncalibrated historical-scenario envelope, not a promised probability.",
                        "Bank balance_after values are the evaluation target; quiet days carry the prior balance.",
                        "Zero buffer tests negative end-of-day balances. Intraday overdrafts are outside this evaluation."],
              "metrics": {key: summarize(value) for key, value in sorted(totals.items())}}
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["metrics"].get("overall", {}), indent=2))
    print(f"Evaluation report: {args.output}")


if __name__ == "__main__":
    main()
