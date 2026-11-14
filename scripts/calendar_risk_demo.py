"""Explicitly fictional household used to demonstrate a cash-shortfall warning."""
from datetime import date
from src.cash_flow import forecast_cash_flow
from src.financial_calendar import build_financial_calendar


def risk_demo_rows():
    payments = []
    for year in [2024, 2025, 2026]:
        for month in range(1, 13):
            if year == 2026 and month > 10:
                break
            flexible = {8: 135000, 9: 160000, 10: 190000}.get(month, 100000) if year == 2026 else 100000
            for day, amount, kind, category, merchant in [
                (28, 240000, 'salary', 'Salary', None),
                (3, -120000, 'housing_payment', 'Housing', 'demo-landlord'),
                (12, -12000, 'utilities_payment', 'Utilities', 'demo-energy'),
                (18, -1599, 'purchase', 'Entertainment', 'demo-streaming'),
            ]:
                payments.append((f'{year}-{month:02d}-{day:02d}', amount, kind, category, merchant))
            # Irregular discretionary purchases affect forecasts, never calendar events.
            for index, day in enumerate([6, 11, 17, 23, 26]):
                amount = flexible // 5 + (flexible % 5 if index == 0 else 0)
                payments.append((f'{year}-{month:02d}-{day:02d}', -amount, 'purchase', 'Restaurants', None))
            if month == 11:
                payments.append((f'{year}-11-20', -12000, 'purchase', 'Insurance', 'demo-insurance'))
    balance = 90000 - sum(p[1] for p in payments)
    rows = []
    for index, (day, amount, kind, category, merchant) in enumerate(sorted(payments), 1):
        balance += amount
        rows.append({'transaction_id': f'risk-demo-tx-{index}', 'customer_id': 'RISK-DEMO', 'account_id': 'RISK-DEMO-ACCOUNT',
                     'date': day, 'occurred_at': day+'T12:00:00', 'source_row': index, 'amount_cents': amount,
                     'balance_after_cents': balance, 'transaction_type': kind, 'category': category, 'merchant_id': merchant})
    return rows


def build_risk_demo():
    rows = risk_demo_rows()
    forecast = forecast_cash_flow(rows, 'RISK-DEMO', '2026-10-31', buffer_cents=30000)
    result = build_financial_calendar(rows, {'customerId': 'RISK-DEMO', 'asOf': '2026-10-31', 'forecast': forecast})
    lowest = forecast['lowestExpectedBalance']
    first_negative = next(d['date'] for d in forecast['daily'] if d['expectedBalanceCents'] < 0)
    notice = next(n for n in result['notifications'] if n['kind'] == 'buffer_risk')
    notice.update(kind='demo_shortfall', title='Spending could leave you short before payday',
                  summary=f"Fictional scenario: cash could run short on {date.fromisoformat(first_negative).strftime('%-d %B')} if this pattern continues. Review it before essential bills are due.",
                  firstShortfallDate=first_negative,
                  explanation='This is an invented household, not a finding about a bank-data customer. It starts with €900 cash, pays €1,200 housing near the 3rd and receives €2,400 salary near the 28th. Flexible spending rose over the last three months. The existing Python cash-flow engine replays recent spending patterns and estimates a shortfall before payday; future outcomes remain uncertain. Annual reminders beyond the engine’s recurring forecast flows may add further costs.',
                  action='Check whether funds are available elsewhere or contact the biller early to discuss payment options. Review nonessential purchases with the coach to reduce further pressure. No spending limit, saving or payment is changed automatically.',
                  metrics=[{'label': 'Starting cash (fictional)', 'amountCents': 90000},
                           {'label': f"Estimated shortfall on {lowest['date']}", 'amountCents': -lowest['amountCents']},
                           {'label': 'Chosen reserve', 'amountCents': 30000}],
                  isIllustrative=True)
    result['notifications'] = [notice]
    result.update(label='Spending-pressure demo', isIllustrative=True,
                  sourceNotice='Fictional household · illustrative spending scenario. These transactions and warnings are separate from the bank-data customers.')
    return result
