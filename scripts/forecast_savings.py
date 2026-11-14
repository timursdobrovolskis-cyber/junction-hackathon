"""Generate a calibrated forecast and a conditional, non-executing savings preview."""

import argparse
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import forecast_cash_flow
from src.forecast_safety import apply_calibration, estimate_savings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--income-model", type=Path, default=Path("data/models/income-v2.json"))
    parser.add_argument("--calibration", type=Path, default=Path("data/models/income-v2-calibration.json"))
    parser.add_argument("--customer-id", action="append", required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--buffer-cents", type=int, required=True)
    parser.add_argument("--future-cost-file", type=Path, help="JSON array of beyond-horizon costs; one customer's costs per run.")
    parser.add_argument("--commitments-confirmed", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("data/local/savings-preview.json"))
    args = parser.parse_args()
    if args.buffer_cents < 0:
        parser.error("Cash buffer must be nonnegative")
    if args.future_cost_file and len(set(args.customer_id)) != 1:
        parser.error("Supply future costs for one customer at a time")
    inputs = [args.database, args.income_model, args.calibration] + ([args.future_cost_file] if args.future_cost_file else [])
    if args.output.resolve() in [p.resolve() for p in inputs]:
        parser.error("Output must not overwrite an input")
    model = json.loads(args.income_model.read_text())
    calibration = json.loads(args.calibration.read_text())
    costs = json.loads(args.future_cost_file.read_text()) if args.future_cost_file else []
    if not isinstance(costs, list):
        parser.error("Future costs must be a JSON array")
    cutoff = args.as_of.isoformat()
    examples = []
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        last = db.execute("SELECT MAX(date) FROM transactions").fetchone()[0]
        if last is None or cutoff > last:
            parser.error("Cutoff exceeds export coverage")
        for customer in sorted(set(args.customer_id)):
            if not db.execute("SELECT 1 FROM customers WHERE customer_id=?", (customer,)).fetchone():
                parser.error(f"Unknown customer {customer}")
            rows = db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row", (customer, cutoff))
            forecast = forecast_cash_flow(rows, customer, cutoff, buffer_cents=args.buffer_cents, income_model=model)
            forecast = apply_calibration(forecast, calibration, model)
            savings = estimate_savings(forecast, args.buffer_cents, costs, args.commitments_confirmed)
            examples.append({"forecast": forecast, "savings": savings})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"modelVersion": model["modelVersion"], "examples": examples}, indent=2) + "\n")
    print(f"Wrote {len(examples)} calibrated forecasts and savings previews to {args.output}")


if __name__ == "__main__":
    main()
