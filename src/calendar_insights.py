"""Evidence-based calendar notices. No new balance or affordability forecast."""
from calendar import monthrange
from datetime import date
from hashlib import sha256
from src.financial_profile import shift_month, CONSUMPTION_TYPES


def calendar_insights(rows, customer, as_of, forecast, omitted, rules):
    rows = [r for r in rows if r["customer_id"] == customer and r["date"] <= as_of]
    cutoff = date.fromisoformat(as_of)
    end = shift_month(cutoff, 1) if cutoff.day == monthrange(cutoff.year, cutoff.month)[1] else shift_month(cutoff, 0)
    months = [shift_month(end, i).strftime('%Y-%m') for i in range(-3, 0)]
    first_observed = min((r['date'] for r in rows), default=as_of)
    complete = first_observed[:7] < months[0]
    recent = [r for r in rows if r['date'][:7] in months]
    notices = []

    def add(kind, severity, title, summary, explanation, action, evidence=(), **extra):
        notices.append({'id': sha256(f'{customer}:{kind}:{as_of}:{title}'.encode()).hexdigest()[:20],
                        'kind': kind, 'severity': severity, 'title': title, 'summary': summary,
                        'explanation': explanation, 'action': action, 'asOf': as_of,
                        'evidenceIds': list(dict.fromkeys(evidence)), **extra})

    if complete:
        purchase = [max(0, -sum(r['amount_cents'] for r in recent if r['date'].startswith(m) and r['transaction_type'] == 'purchase')) for m in months]
        if (purchase[0] > 0 and purchase[1] * 100 >= purchase[0] * 110
                and purchase[2] * 100 >= purchase[1] * 110
                and purchase[2] - purchase[0] >= 5000 and purchase[2] * 100 >= purchase[0] * 125):
            evidence = [r['transaction_id'] for r in recent if r['transaction_type'] == 'purchase'][-12:]
            add('spending_trend', 'warning', 'Day-to-day spending is climbing',
                'Spending increased in each of the last three complete months.',
                'Purchases rose by at least 10% in each comparison. If that pattern continues, it could leave less room for saving. This describes observed spending, not a prediction of your future balance. Refunds reduce these totals; transfers and investments are excluded.',
                'Review recurring purchases and choose a realistic limit for flexible spending before increasing savings.', evidence,
                monthlyTotals=[{'month': m, 'amountCents': v} for m, v in zip(months, purchase)],
                metrics=[{'label': 'Increase from first to last month', 'amountCents': purchase[2] - purchase[0]},
                         {'label': 'Increase', 'percent': ((purchase[2] - purchase[0]) * 100 + purchase[0] // 2) // purchase[0]}])
        income = [sum(r['amount_cents'] for r in recent if r['date'].startswith(m) and r['transaction_type'] in {'salary', 'other_income'}) for m in months]
        costs = [max(0, -sum(r['amount_cents'] for r in recent if r['date'].startswith(m) and r['transaction_type'] in CONSUMPTION_TYPES)) for m in months]
        if all(income[i] > 0 and costs[i] > income[i] for i in (1, 2)):
            add('spending_above_income', 'warning', 'Spending exceeded recorded income',
                'Recorded living costs exceeded income in both of the last two complete months.',
                'Continuing this pattern could use up cash reserves. This compares observed income with purchases, housing and utilities; investments and transfers are excluded. Income outside these accounts may be missing.',
                'Check whether any income is missing, then review flexible costs while protecting essentials.',
                [r['transaction_id'] for r in recent if r['transaction_type'] in CONSUMPTION_TYPES | {'salary', 'other_income'}][-12:],
                metrics=[{'label': 'Most recent monthly spending', 'amountCents': costs[2]}, {'label': 'Most recent recorded income', 'amountCents': income[2]}])

    below = forecast.get('belowBufferDates') or []
    possible = forecast.get('possibleBelowBufferDates') or []
    if below or possible:
        dates = below or possible
        add('buffer_risk', 'warning', 'Your cash buffer may be squeezed',
            f"{'The central forecast' if below else 'Some forecast scenarios'} falls below your chosen reserve from {dates[0]}.",
            'A cash buffer is money set aside for surprises. This notice comes from the calculation engine and only covers its forecast period. Estimated payment timing and amounts may change; it is not a warning about every future calendar month.',
            'Review upcoming bills and flexible spending before committing more money to savings.',
            [i for p in forecast.get('upcomingPayments', []) for i in p.get('evidenceIds', [])],
            metrics=[{'label': 'Chosen cash buffer', 'amountCents': forecast['bufferCents']}],
            forecastDates=dates)

    for item in omitted:
        if item.get('transactionType') not in {'utilities_payment', 'housing_payment'}:
            continue
        add('bill_timing_uncertain', 'info', f"{item['title']}: check the due dates",
            'These costs recur, but the history cannot identify reliable individual payment dates.',
            'Several payments or changing dates can belong to different providers. The monthly amount below is a historical estimate, not an extra bill or a scheduled deduction. These costs remain in the engine’s financial forecast.',
            'Check each provider’s next due date before adding individual reminders.', item.get('evidenceIds', []),
            metrics=[{'label': 'Typical active-month total', 'amountCents': item['monthlyAmountCents']}])

    candidates = [r for r in rules if r['transactionType'] == 'purchase']
    if candidates:
        add('subscription_candidates', 'info', 'Possible subscriptions found',
            f"{len(candidates)} recurring merchant pattern{'s' if len(candidates) != 1 else ''} detected.",
            'Repeated merchant payments with similar amounts and dates can indicate a subscription, but they may also be regular purchases. Calendar entries remain estimates until the provider schedule is checked.',
            'Open the payment evidence and check whether you still use each service.',
            [i for r in candidates for i in r['evidenceIds']])
    return sorted(notices, key=lambda n: n['severity'] != 'warning')
