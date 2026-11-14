"""Generate selected customer forecasts as JSON for the UI and coach."""

import argparse
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.cash_flow import MODEL_VERSION, forecast_cash_flow


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--customer-id", action="append", required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--horizon-days", type=int, default=30)
    parser.add_argument("--buffer-cents", type=int, default=0)
    parser.add_argument("--output", type=Path, default=Path("data/local/forecasts.json"))
    args = parser.parse_args()
    if not 1 <= args.horizon_days <= 90 or args.buffer_cents < 0:
        parser.error("Horizon must be 1–90 days and buffer must be nonnegative")
    if args.output.resolve() == args.database.resolve():
        parser.error("Output must not overwrite the database")
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        last = db.execute("SELECT MAX(date) FROM transactions").fetchone()[0]
        cutoff = args.as_of.isoformat()
        if last is None or cutoff > last:
            parser.error("Cutoff must be within export coverage")
        output = []
        for customer in sorted(set(args.customer_id)):
            if not db.execute("SELECT 1 FROM customers WHERE customer_id=?", (customer,)).fetchone():
                parser.error(f"Unknown customer {customer}")
            rows = db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row", (customer, cutoff))
            output.append(forecast_cash_flow(rows, customer, cutoff, args.horizon_days, args.buffer_cents))
        audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
    result = {"modelVersion": MODEL_VERSION, "sourceRevision": audit["source_revision"],
              "sources": audit["sources"], "forecasts": output}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(output)} forecasts to {args.output}")


if __name__ == "__main__":
    main()
