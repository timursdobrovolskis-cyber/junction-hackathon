"""Check budget arithmetic across the synthetic population; not an accuracy test."""

from collections import Counter
from contextlib import closing
from itertools import groupby
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import forecast_cash_flow
from src.forecast_safety import apply_calibration
from src.category_budgets import build_category_budgets


def main():
    model = json.loads(Path("data/models/income-v2.json").read_text())
    calibration = json.loads(Path("data/models/income-v2-calibration.json").read_text())
    counts = Counter()
    adjusted_example = None
    with closing(sqlite3.connect("file:data/local/bank.sqlite?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        cursor = db.execute("SELECT * FROM transactions WHERE date<='2026-09-30' ORDER BY customer_id,occurred_at,source_row")
        for customer, rows in groupby(cursor, key=lambda r: r["customer_id"]):
            f = apply_calibration(forecast_cash_flow(rows, customer, "2026-09-30", income_model=model), calibration, model)
            p = build_category_budgets(f, 50000, 10000)
            counts["customers"] += 1
            counts[p["status"]] += 1
            if p["status"] == "withheld":
                continue
            assert sum(c["previewLimitCents"] for c in p["categories"]) == p["totalPlannedSpendingCents"]
            assert all(c["previewLimitCents"] >= c["protectedCents"] for c in p["categories"])
            assert all(c["suggestedLimitCents"] is None for c in p["categories"])
            preview = p["preview"]
            assert preview["startingBalanceAfterSavingsCents"] == f["startingBalanceCents"] - 10000
            assert preview["endingExpectedBalanceCents"] == (f["endingExpectedBalanceCents"] - 10000
                    + p["totalHistoricalSpendingCents"] - p["totalPlannedSpendingCents"])
            assert preview["startingBalanceAfterSavingsCents"] + sum(d["expectedNetChangeCents"] for d in preview["daily"]) == preview["endingExpectedBalanceCents"]
            for i, d in enumerate(f["daily"]):
                component_net = sum((1 if c["direction"] == "inflow" else -1) * c["dailyAmountsCents"][i] for c in f["cashFlowComponents"])
                assert component_net + d["componentRoundingResidualCents"] == d["expectedNetChangeCents"]
            if p["feasible"]:
                assert p["totalPlannedSpendingCents"] <= p["incomeAvailableForSpendingCents"]
                assert preview["lowestConditionalBalanceCents"] >= 50000
                if p["totalPlannedSpendingCents"] < p["totalHistoricalSpendingCents"]:
                    counts["feasible_with_reductions"] += 1
                    if adjusted_example is None:
                        adjusted_example = customer
            if counts["customers"] % 500 == 0:
                print(f"Validated {counts['customers']:,} budget plans", flush=True)
    report = {"asOf": "2026-09-30", "bufferCents": 50000, "savingsTargetCents": 10000,
              "counts": dict(counts), "customerWithFeasibleReductions": adjusted_example,
              "checks": ["component ledger reconciles", "budget totals reconcile", "protected floors preserved",
                         "savings subtracted once", "every daily preview reconciles", "feasible plans satisfy income and buffer constraints",
                         "unconfirmed plans do not expose suggested limits"],
              "note": "These are deterministic accounting checks with illustrative inputs, not evidence of future affordability or customer adherence."}
    output = Path("data/local/budget-validation.json")
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
