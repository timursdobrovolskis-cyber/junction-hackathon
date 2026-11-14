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
                (7, -2990, 'utilities_payment', 'Internet', 'demo-internet'),
                (10, -1990, 'utilities_payment', 'Phone', 'demo-phone'),
                (16, -4500, 'utilities_payment', 'Water', 'demo-water'),
                (19, -299, 'purchase', 'Cloud storage', 'demo-icloud'),
                (21, -1599, 'purchase', 'Entertainment', 'demo-streaming'),
                (25, -1199, 'purchase', 'Music', 'demo-spotify'),
                (28, -2999, 'purchase', 'Fitness', 'demo-gym'),
            ]:
                payments.append((f'{year}-{month:02d}-{day:02d}', amount, kind, category, merchant))
            # Irregular discretionary purchases affect forecasts, never calendar events.
            for index, day in enumerate([6, 11, 17, 23, 26]):
                amount = flexible // 5 + (flexible % 5 if index == 0 else 0)
                payments.append((f'{year}-{month:02d}-{day:02d}', -amount, 'purchase', 'Restaurants', None))
            if month == 3:
                payments.append((f'{year}-03-03', -71900, 'purchase', 'Software', 'demo-adobe'))
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
    names = {'demo-landlord': 'Rent', 'demo-energy': 'Electricity', 'demo-internet': 'Home internet',
             'demo-phone': 'Phone plan', 'demo-water': 'Water bill', 'demo-icloud': 'iCloud+',
             'demo-streaming': 'Netflix', 'demo-spotify': 'Spotify Premium', 'demo-gym': 'Gym membership',
             'demo-adobe': 'Adobe Creative Cloud', 'demo-insurance': 'Home insurance renewal'}
    for event in result['events']:
        if event.get('merchantId') in names:
            event['title'] = names[event['merchantId']]
            event['explanation'] = 'Fictional demonstration payment. ' + event['explanation']
    lowest = forecast['lowestExpectedBalance']
    first_negative = next(d['date'] for d in forecast['daily'] if d['expectedBalanceCents'] < 0)
    notice = next(n for n in result['notifications'] if n['kind'] == 'buffer_risk')
    first_deficit = -next(d['expectedBalanceCents'] for d in forecast['daily'] if d['date'] == first_negative)
    rent = next(e for e in result['events'] if e['title'] == 'Rent')
    salary = next(e for e in result['events'] if e['kind'] == 'income')
    notice.update(kind='demo_shortfall', title=f"Rent could be €{first_deficit / 100:,.2f} short on {date.fromisoformat(first_negative).strftime('%-d %b')}",
                  summary='€900 available · €1,200 rent · next salary 28 Nov.',
                  firstShortfallDate=first_negative,
                  firstShortfallCents=first_deficit,
                  laterShortfallCents=-lowest['amountCents'],
                  explanation=f'Fictional household: €900 remains on 31 October. Estimated rent of €1,200 is due on 3 November, while the next €2,400 salary is expected on 28 November. The Python forecast reaches −€{first_deficit / 100:,.2f} when rent is due. Without additional funds or an agreed change to payment timing, the rent may not be covered in full. The other subscriptions renew later; cancelling them would not create cash for 3 November. Dates and outcomes are estimates, not a confirmed missed payment.',
                  action=f'Before 3 November, check whether €{first_deficit / 100:,.2f} can be made available from another account. If not, contact the landlord early to discuss an agreed payment arrangement. Then review Netflix, gym and other optional renewals to reduce later pressure. No payment, cancellation or money transfer is made here.',
                  metrics=[{'label': 'Cash available before rent', 'amountCents': 90000},
                           {'label': 'Estimated rent due', 'amountCents': rent['amountCents']},
                           {'label': 'Gap to address before 3 Nov', 'amountCents': first_deficit}],
                  timeline=[{'date': '2026-10-31', 'label': 'Cash available', 'amountCents': 90000, 'direction': 'balance'},
                            {'date': rent['date'], 'label': 'Rent due (estimated)', 'amountCents': rent['amountCents'], 'direction': 'outflow'},
                            {'date': salary['date'], 'label': 'Next salary (estimated)', 'amountCents': salary['amountCents'], 'direction': 'inflow'}],
                  isIllustrative=True)
    result['notifications'] = [notice]
    result.update(label='Spending-pressure demo', isIllustrative=True,
                  sourceNotice='Fictional household · illustrative spending scenario. These transactions and warnings are separate from the bank-data customers.')
    return result
