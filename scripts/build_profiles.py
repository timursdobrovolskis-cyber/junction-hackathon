"""Build reproducible profile JSONL from the prepared bank SQLite database."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import date
from itertools import groupby
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.financial_profile import PROFILE_VERSION, build_profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--as-of", type=date.fromisoformat, help="Defaults to the last date in the export.")
    parser.add_argument("--customer-id", action="append", help="Repeat to select customers; defaults to all.")
    parser.add_argument("--lookback-months", type=int, default=12)
    parser.add_argument("--output", type=Path, default=Path("data/local/profiles.jsonl"))
    args = parser.parse_args()
    if not 1 <= args.lookback_months <= 60:
        parser.error("--lookback-months must be between 1 and 60")
    if args.output.resolve() == args.database.resolve():
        parser.error("Output must not overwrite the input database")
    with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        last_date = db.execute("SELECT MAX(date) FROM transactions").fetchone()[0]
        if last_date is None:
            parser.error("Database has no transactions")
        cutoff = args.as_of.isoformat() if args.as_of else last_date
        if cutoff > last_date:
            parser.error(f"Cutoff exceeds export coverage ({last_date})")
        customer_ids = {r[0] for r in db.execute("SELECT customer_id FROM customers")}
        selected = set(args.customer_id) if args.customer_id else customer_ids
        if selected - customer_ids:
            parser.error(f"Unknown customers: {sorted(selected - customer_ids)}")
        query = "SELECT * FROM transactions WHERE date <= ?"
        parameters = [cutoff]
        if args.customer_id:
            query += " AND customer_id IN (" + ",".join("?" for _ in selected) + ")"
            parameters.extend(sorted(selected))
        query += " ORDER BY customer_id, occurred_at, source_row"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        statuses, pattern_kinds = Counter(), Counter()
        visited = set()
        source_audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                         suffix=".jsonl", delete=False) as output:
            temporary = Path(output.name)
            try:
                for customer_id, rows in groupby(db.execute(query, parameters), key=lambda row: row["customer_id"]):
                    profile = build_profile(rows, customer_id, cutoff, args.lookback_months)
                    output.write(json.dumps(profile, separators=(",", ":")) + "\n")
                    statuses[profile["status"]] += 1
                    pattern_kinds.update(p["kind"] for p in profile.get("recurringPatterns", []))
                    visited.add(customer_id)
                    if len(visited) % 1000 == 0:
                        print(f"Built {len(visited):,} profiles", flush=True)
                for customer_id in sorted(selected - visited):
                    output.write(json.dumps(build_profile([], customer_id, cutoff, args.lookback_months)) + "\n")
                    statuses["no_history"] += 1
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        temporary.replace(args.output)
        manifest = {"schemaVersion": PROFILE_VERSION, "asOf": cutoff,
                    "lookbackMonths": args.lookback_months, "customerCount": sum(statuses.values()),
                    "statuses": dict(statuses), "recurringPatternCounts": dict(pattern_kinds),
                    "sourceRevision": source_audit["source_revision"], "sources": source_audit["sources"]}
        args.output.with_suffix(".audit.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"Built {sum(statuses.values()):,} profiles as of {cutoff}: {args.output}")


if __name__ == "__main__":
    main()
