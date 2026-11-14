"""Import the sponsor CSVs into a validated, reproducible SQLite database."""

import argparse
import csv
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile


SOURCE_REVISION = "fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f"
TRANSACTION_FIELDS = {
    "customer_id", "bank_account_id", "tx_date", "tx_timestamp", "category",
    "tx_amount_eur", "balance_after_eur", "transaction_type", "merchant_id", "mcc_code",
}
CUSTOMER_FIELDS = {"customer_id", "customer_postal_code", "customer_age"}


def read_csv(path, fields):
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        missing = fields - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path}: missing columns {sorted(missing)}. Check for an LFS pointer.")
        for source_row, row in enumerate(reader, start=2):
            if None in row or any(row.get(field) is None for field in fields):
                raise ValueError(f"{path}: malformed CSV row {source_row}")
            yield source_row, row


def cents(value):
    try:
        scaled = Decimal(value) * 100
    except InvalidOperation as error:
        raise ValueError(f"Invalid monetary amount {value!r}") from error
    if not scaled.is_finite() or scaled != scaled.to_integral_value():
        raise ValueError(f"Expected a finite amount with whole cents, got {value!r}")
    return int(scaled)


def file_hash(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def records(connection, query):
    return [dict(row) for row in connection.execute(query)]


def import_data(connection, customers_path, transactions_path, transaction_hash):
    connection.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE customers (
            customer_id TEXT PRIMARY KEY,
            postal_code TEXT NOT NULL,
            age INTEGER NOT NULL CHECK(age >= 0)
        );
        CREATE TABLE transactions (
            transaction_id TEXT PRIMARY KEY,
            source_row INTEGER UNIQUE NOT NULL,
            customer_id TEXT NOT NULL REFERENCES customers(customer_id),
            account_id TEXT NOT NULL CHECK(account_id != ''),
            date TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            category TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            balance_after_cents INTEGER NOT NULL,
            transaction_type TEXT NOT NULL,
            merchant_id TEXT,
            mcc_code TEXT
        );
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    for source_row, row in read_csv(customers_path, CUSTOMER_FIELDS):
        try:
            if not row["customer_id"]:
                raise ValueError("Missing customer_id")
            connection.execute("INSERT INTO customers VALUES (?, ?, ?)", (
                row["customer_id"], row["customer_postal_code"], int(row["customer_age"]),
            ))
        except (ValueError, sqlite3.Error) as error:
            raise ValueError(f"Customer CSV row {source_row}: {error}") from error

    batch = []
    for source_row, row in read_csv(transactions_path, TRANSACTION_FIELDS):
        try:
            timestamp = datetime.strptime(row["tx_timestamp"], "%d%b%y:%H:%M:%S")
            if timestamp.date() != date.fromisoformat(row["tx_date"]):
                raise ValueError("Date and timestamp disagree")
            batch.append((
                f"tx-{transaction_hash[:16]}-{source_row}", source_row,
                row["customer_id"], row["bank_account_id"], row["tx_date"],
                timestamp.isoformat(), row["category"], cents(row["tx_amount_eur"]),
                cents(row["balance_after_eur"]), row["transaction_type"],
                row["merchant_id"] or None, row["mcc_code"] or None,
            ))
        except ValueError as error:
            raise ValueError(f"Transaction CSV row {source_row}: {error}") from error
        if len(batch) == 10000:
            connection.executemany("INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            batch.clear()
            if (source_row - 1) % 250000 == 0:
                print(f"Imported {source_row - 1:,} transactions", flush=True)
    connection.executemany("INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    connection.executescript("""
        CREATE INDEX account_history ON transactions(account_id, occurred_at, source_row);
        CREATE INDEX customer_history ON transactions(customer_id, date);
        CREATE INDEX customer_categories ON transactions(customer_id, category, date);
        CREATE VIEW classified_transactions AS
        SELECT *,
            CASE
                WHEN transaction_type IN ('purchase', 'utilities_payment', 'housing_payment')
                    THEN 'living_expense'
                WHEN transaction_type = 'salary' THEN 'salary'
                WHEN transaction_type = 'other_income' THEN 'other_income'
                WHEN transaction_type IN ('investment_deposit', 'investment_withdrawal')
                    THEN 'investment_movement'
                WHEN transaction_type = 'salary_sweep' THEN 'sweep_unknown_destination'
                ELSE 'unclassified'
            END AS flow_group,
            CASE
                WHEN transaction_type IN ('purchase', 'utilities_payment', 'housing_payment') THEN 1
                WHEN transaction_type IN ('salary', 'other_income', 'investment_deposit',
                                          'investment_withdrawal', 'salary_sweep') THEN 0
                ELSE NULL
            END AS is_consumption
        FROM transactions;
        CREATE VIEW account_history_checked AS
        SELECT *, balance_after_cents - amount_cents -
            LAG(balance_after_cents) OVER (
                PARTITION BY account_id ORDER BY occurred_at, source_row
            ) AS balance_gap_cents
        FROM transactions;
    """)


def audit(connection):
    summary = records(connection, """
        SELECT COUNT(*) AS transactions, COUNT(DISTINCT customer_id) AS customers_with_transactions,
            COUNT(DISTINCT account_id) AS accounts, MIN(date) AS first_date, MAX(date) AS last_date,
            SUM(merchant_id IS NULL) AS missing_merchant_ids,
            SUM(balance_after_cents < 0) AS negative_balance_rows
        FROM transactions
    """)[0]
    summary["customers"] = connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    summary["transaction_types"] = records(connection, """
        SELECT transaction_type, COUNT(*) AS rows, SUM(amount_cents > 0) AS inflows,
            SUM(amount_cents < 0) AS outflows, SUM(merchant_id IS NULL) AS missing_merchant_ids
        FROM transactions GROUP BY transaction_type ORDER BY rows DESC
    """)
    summary["categories"] = records(connection, """
        SELECT category, COUNT(*) AS rows FROM transactions GROUP BY category ORDER BY rows DESC
    """)
    summary["history_months_per_customer"] = records(connection, """
        SELECT MIN(months) AS minimum, MAX(months) AS maximum, AVG(months) AS average
        FROM (SELECT customer_id, COUNT(DISTINCT SUBSTR(date, 1, 7)) AS months
              FROM transactions GROUP BY customer_id)
    """)[0]
    summary["balance_checks"] = records(connection, """
        SELECT COUNT(*) AS checked_rows, SUM(balance_gap_cents != 0) AS mismatched_rows,
            MAX(ABS(balance_gap_cents)) AS largest_absolute_gap_cents
        FROM account_history_checked WHERE balance_gap_cents IS NOT NULL
    """)[0]
    summary["balance_mismatch_examples"] = records(connection, """
        SELECT transaction_id, account_id, date, balance_gap_cents
        FROM account_history_checked WHERE balance_gap_cents != 0 LIMIT 5
    """)
    summary["accounts_with_multiple_customer_ids"] = connection.execute("""
        SELECT COUNT(*) FROM (
            SELECT account_id FROM transactions GROUP BY account_id
            HAVING COUNT(DISTINCT customer_id) > 1
        )
    """).fetchone()[0]
    summary["source_labelled_transfer_rows"] = records(connection, """
        SELECT transaction_type, category, COUNT(*) AS rows FROM transactions
        WHERE LOWER(transaction_type) LIKE '%transfer%' OR LOWER(category) LIKE '%transfer%'
        GROUP BY transaction_type, category
    """)
    summary["transfer_like_flows"] = records(connection, """
        SELECT flow_group, COUNT(*) AS rows FROM classified_transactions
        WHERE flow_group IN ('investment_movement', 'sweep_unknown_destination')
        GROUP BY flow_group
    """)
    summary["warnings"] = [
        "Generated transaction IDs identify source rows in the hashed CSV; the source has no transaction_id column.",
        "Balance checks use timestamp order, then source row order for timestamp ties.",
        "Salary sweeps have no destination account in these columns; confirm their meaning before treating them as savings.",
        "Investment movements and salary sweeps affect visible cash even though they are excluded from consumption.",
        "The first balance per account implies an opening balance; it cannot be independently reconciled.",
    ]
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("data/local"))
    parser.add_argument("--output", type=Path, default=Path("data/local/bank.sqlite"))
    args = parser.parse_args()
    customers_path = args.raw_dir / "tx_customers_junction.csv"
    transactions_path = args.raw_dir / "tx_junction_transactions.csv"
    sources = {path.name: {"sha256": file_hash(path), "bytes": path.stat().st_size}
               for path in (customers_path, transactions_path)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".sqlite", delete=False) as handle:
        staging_path = Path(handle.name)
    try:
        with closing(sqlite3.connect(staging_path)) as connection, connection:
            connection.row_factory = sqlite3.Row
            import_data(connection, customers_path, transactions_path,
                        sources[transactions_path.name]["sha256"])
            print("Checking account balances and data coverage", flush=True)
            summary = audit(connection)
            summary["source_revision"] = SOURCE_REVISION
            summary["sources"] = sources
            report = json.dumps(summary, indent=2) + "\n"
            connection.execute("INSERT INTO metadata VALUES ('audit', ?)", (report,))
        staging_path.replace(args.output)
        report_path = args.output.with_suffix(".audit.json")
        report_path.write_text(report, encoding="utf-8")
        print(f"Prepared {summary['transactions']:,} transactions in {args.output}")
        print(f"Audit: {report_path}")
    finally:
        staging_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
