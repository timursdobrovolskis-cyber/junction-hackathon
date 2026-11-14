"""Generate personalized category limits and conditional forecast previews."""

import argparse
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import forecast_cash_flow
from src.forecast_safety import apply_calibration
from src.category_budgets import build_category_budgets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--income-model", type=Path, default=Path("data/models/income-v2.json"))
    parser.add_argument("--calibration", type=Path, default=Path("data/models/income-v2-calibration.json"))
    parser.add_argument("--customer-id", action="append", required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--buffer-cents", type=int, required=True)
    parser.add_argument("--savings-target-cents", type=int, required=True)
    parser.add_argument("--savings-confirmed", action="store_true")
    parser.add_argument("--commitments-confirmed", action="store_true")
    parser.add_argument("--preferences-file", type=Path, help="JSON with optional adjustableCategories, minimumCategoryCents, categoryOverrides, futureCommitments")
    parser.add_argument("--output", type=Path, default=Path("data/local/budgets.json"))
    args = parser.parse_args()
    if min(args.buffer_cents, args.savings_target_cents) < 0:
        parser.error("Buffer and savings target must be nonnegative")
    if args.preferences_file and len(set(args.customer_id)) != 1:
        parser.error("Customer-specific preferences require one customer per run")
    inputs = [args.database, args.income_model, args.calibration] + ([args.preferences_file] if args.preferences_file else [])
    if args.output.resolve() in [p.resolve() for p in inputs]:
        parser.error("Output must not overwrite an input")
    model = json.loads(args.income_model.read_text())
    calibration = json.loads(args.calibration.read_text())
    preferences = json.loads(args.preferences_file.read_text()) if args.preferences_file else {}
    allowed = {"adjustableCategories", "minimumCategoryCents", "categoryOverrides", "futureCommitments"}
    if not isinstance(preferences, dict) or preferences.keys() - allowed:
        parser.error("Unknown or invalid preference fields")
    cutoff = args.as_of.isoformat()
    examples = []
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        last = db.execute("SELECT MAX(date) FROM transactions").fetchone()[0]
        if not last or cutoff > last:
            parser.error("Cutoff exceeds export coverage")
        for customer in sorted(set(args.customer_id)):
            if not db.execute("SELECT 1 FROM customers WHERE customer_id=?", (customer,)).fetchone():
                parser.error(f"Unknown customer {customer}")
            history = db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row", (customer, cutoff))
            forecast = apply_calibration(forecast_cash_flow(history, customer, cutoff, buffer_cents=args.buffer_cents, income_model=model), calibration, model)
            plan = build_category_budgets(forecast, args.buffer_cents, args.savings_target_cents,
                                         future_commitments=preferences.get("futureCommitments", []),
                                         savings_confirmed=args.savings_confirmed,
                                         commitments_confirmed=args.commitments_confirmed,
                                         adjustable_categories=preferences.get("adjustableCategories"),
                                         minimum_category_cents=preferences.get("minimumCategoryCents"),
                                         category_overrides=preferences.get("categoryOverrides"))
            examples.append({"budget": plan, "originalForecast": forecast})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"examples": examples}, indent=2) + "\n")
    print(f"Wrote {len(examples)} category budget previews to {args.output}")


if __name__ == "__main__":
    main()
