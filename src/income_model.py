"""Small learned payday transition model with customer-history conditioning."""

from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date
from fractions import Fraction
import hashlib

from src.financial_profile import median_int

MODEL_VERSION = "conditioned-income-v2"


def held_out(customer):
    return int(hashlib.sha256(customer.encode()).hexdigest()[:8], 16) % 5 == 0


def payday_token(day):
    value = date.fromisoformat(day)
    remaining = monthrange(value.year, value.month)[1] - value.day
    return f"end-{remaining}" if remaining <= 3 else str(value.day)


def key(row):
    return (row["account_id"], row["transaction_type"], row["category"], row["merchant_id"],
            "inflow" if row["amount_cents"] > 0 else "outflow")


def fit_income_model(rows, training_through, prior_strength=3):
    """Only adjacent single-salary months of non-reserved customers train priors."""
    cutoff = date.fromisoformat(training_through).isoformat()
    groups = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r["date"] <= cutoff and not held_out(r["customer_id"]) and r["transaction_type"] == "salary" and r["amount_cents"] > 0:
            groups[(r["customer_id"], key(r))][r["date"][:7]].append(r)
    marginal, transitions = Counter(), defaultdict(Counter)
    for months in groups.values():
        previous = None
        for month, payments in sorted(months.items()):
            if len(payments) != 1:
                previous = None
                continue
            row = payments[0]
            token = payday_token(row["date"])
            marginal[token] += 1
            index = int(month[:4]) * 12 + int(month[5:])
            if previous and index == previous[0] + 1:
                transitions[previous[1]][token] += 1
            previous = (index, token)
    if not marginal:
        raise ValueError("No eligible training salaries")
    return {"modelVersion": MODEL_VERSION, "trainingThrough": cutoff,
            "priorStrength": prior_strength, "globalDayCounts": dict(sorted(marginal.items())),
            "transitionCounts": {k: dict(sorted(v.items())) for k, v in sorted(transitions.items())},
            "trainingSalaryCount": sum(marginal.values()),
            "heldOutRule": "SHA256(customer_id) first 8 hex digits modulo 5 == 0"}


def allocate_cents(total, weights):
    """Largest-remainder allocation preserves the exact monthly total."""
    denominator = sum(weights.values())
    if denominator <= 0:
        return {}
    exact = {k: Fraction(total) * v / denominator for k, v in weights.items()}
    amounts = {k: v.numerator // v.denominator for k, v in exact.items()}
    remainder = total - sum(amounts.values())
    for k in sorted(exact, key=lambda k: (-(exact[k] - amounts[k]), k))[:remainder]:
        amounts[k] += 1
    return amounts


def income_plan(rows, profile, as_of, horizon_dates, model):
    if model["modelVersion"] != MODEL_VERSION:
        raise ValueError("Unsupported income model")
    if model["trainingThrough"] > as_of:
        raise ValueError("Income model contains training observations after forecast cutoff")
    cutoff = date.fromisoformat(as_of)
    target_months = sorted({d.replace(day=1) for d in horizon_dates})
    marginal = model["globalDayCounts"]
    total = sum(marginal.values())
    replaced, events = set(), []
    for p in profile["recurringPatterns"]:
        if (p["kind"] != "income" or p["status"] != "observed_recently"
                or p["transactionCount"] != p["monthsWithPayments"]
                or p["monthsWithPayments"] != p["monthsExamined"]):
            continue
        group_key = (p["accountId"], p["transactionType"], p["category"], p["merchantId"], p["direction"])
        group = [r for r in rows if key(r) == group_key]
        recent = group[-6:]
        if len({r["date"][:7] for r in recent}) != len(recent):
            continue
        local = Counter(payday_token(r["date"]) for r in recent)
        transition = model["transitionCounts"].get(payday_token(recent[-1]["date"]), {})
        n = sum(transition.values())
        # Five global pseudo-observations stabilize rare transition states.
        weights = {token: Fraction(local[token]) + model["priorStrength"] *
                   (Fraction(transition.get(token, 0)) + Fraction(5 * count, total)) / (n + 5)
                   for token, count in marginal.items()}
        for token in local.keys() - marginal.keys():
            weights[token] = Fraction(local[token])
        amount = median_int([r["amount_cents"] for r in group[-3:]])
        replaced.add(group_key)
        for month in target_months:
            if month == cutoff.replace(day=1) and any(r["date"][:7] == as_of[:7] for r in group):
                continue
            last_day = monthrange(month.year, month.month)[1]
            date_weights = defaultdict(Fraction)
            for token, weight in weights.items():
                day = last_day - int(token[4:]) if token.startswith("end-") else min(int(token), last_day)
                target = month.replace(day=day)
                if target > cutoff:
                    date_weights[target.isoformat()] += weight
            # Condition on no salary so far this month, then truncate the horizon.
            allocated = allocate_cents(amount, date_weights)
            for day, expected in allocated.items():
                if day > horizon_dates[-1].isoformat() or expected == 0:
                    continue
                events.append({"date": day, "amountCents": expected, "key": group_key,
                               "monthlyAmountCents": amount,
                               "evidenceIds": [r["transaction_id"] for r in recent]})
    return replaced, events
