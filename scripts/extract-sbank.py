#!/usr/bin/env python3
"""Extract selected synthetic customers from a local S-Bank CSV using bounded memory."""
import argparse
import csv
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_file', type=Path)
    parser.add_argument('--customer', nargs='+', required=True)
    parser.add_argument('--from-date', type=date.fromisoformat, required=True)
    parser.add_argument('--to-date', type=date.fromisoformat, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.from_date > args.to_date:
        parser.error('--from-date must not follow --to-date')
    if args.output.resolve() == args.csv_file.resolve():
        parser.error('--output must not overwrite the source CSV')
    start, end = args.from_date.isoformat(), args.to_date.isoformat()
    digest = hashlib.sha256()
    with args.csv_file.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    selected = {customer: [] for customer in args.customer}
    first, last, count = None, None, 0
    with args.csv_file.open(encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source)
        required = {'customer_id', 'bank_account_id', 'tx_date', 'tx_amount_eur', 'category', 'transaction_type'}
        if not required.issubset(reader.fieldnames or []):
            parser.error('CSV schema is missing required columns; check that you downloaded data, not a Git LFS pointer')
        for source_row, row in enumerate(reader, start=2):
            count += 1
            observed = date.fromisoformat(row['tx_date']).isoformat()
            first = min(first or observed, observed)
            last = max(last or observed, observed)
            if row['customer_id'] in selected and start <= observed <= end:
                selected[row['customer_id']].append({**row, 'sourceRow': source_row})
    if not first or start < first or end > last:
        parser.error('requested coverage extends outside the dates observed in the source file')
    if any(not rows for rows in selected.values()):
        parser.error('one or more selected customers have no transactions in the requested window')
    extract = {
        'format': 'sbank-extract-v1',
        'source': {'fileName': args.csv_file.name, 'sha256': digest.hexdigest(), 'totalRecords': count},
        'coverage': {'startDate': start, 'endDate': end},
        'asOf': (args.to_date + timedelta(days=1)).isoformat(),
        'customers': [{'customerId': customer, 'rows': rows} for customer, rows in selected.items()],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(extract, indent=2) + '\n', encoding='utf-8')
    print(f"Saved {sum(map(len, selected.values()))} rows for {len(selected)} customers to {args.output}")


if __name__ == '__main__':
    main()
