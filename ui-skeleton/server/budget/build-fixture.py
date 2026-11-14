"""Export one synthetic account's monthly activity; never package the full bank DB.
Run from repository root: python3 ui-skeleton/server/budget/build-fixture.py
"""
import argparse
import json
from pathlib import Path
import sqlite3
root = Path(__file__).resolve().parents[3]
plan = json.loads((root / 'ui-skeleton/server/coach/financial-plan-demo.json').read_text())
customer = plan['customerId']
parser = argparse.ArgumentParser()
parser.add_argument('--database', type=Path, default=root / 'data/local/bank.sqlite')
args = parser.parse_args()
with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
    db.row_factory = sqlite3.Row
    audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
    rows = db.execute('SELECT * FROM transactions WHERE customer_id=? AND date BETWEEN ? AND ? ORDER BY occurred_at,source_row',
                      (customer, audit['first_date'], audit['last_date'])).fetchall()
    data = {'customerId': customer, 'accountIds': [a['accountId'] for a in plan['forecast']['accounts']],
            'source': 'bank_provided_synthetic_data', 'sourceRevision': audit['source_revision'],
            'coverage': {'start': audit['first_date'], 'end': audit['last_date']},
            'transactions': [{'id': r['transaction_id'], 'customerId': r['customer_id'], 'accountId': r['account_id'],
                              'date': r['date'], 'category': r['category'], 'amountCents': r['amount_cents'],
                              'type': r['transaction_type'], 'merchantId': r['merchant_id']} for r in rows]}
    assert audit['last_date'] >= data['coverage']['end']
    assert all(r['accountId'] in data['accountIds'] for r in data['transactions'])
(root / 'ui-skeleton/server/budget/activity.json').write_text(json.dumps(data, indent=2) + '\n')
print(f'Exported {len(rows)} synthetic transactions for {customer}')
