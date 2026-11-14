"""Adaptive purchase forecasts; large purchases retain a separate expected reserve."""

from collections import Counter, defaultdict
from datetime import date, timedelta
from fractions import Fraction
from math import sqrt
from statistics import pstdev

from src.financial_profile import median_int
from src.income_model import allocate_cents, payday_token

MODEL_VERSION = "adaptive-spending-v3"


def category_features(rows, as_of):
    """Daily rates from 28/84 days; excess over robust cap averaged over 180 days."""
    cutoff = date.fromisoformat(as_of)
    first = min((date.fromisoformat(r["date"]) for r in rows), default=cutoff)
    observed_days = (cutoff - first).days + 1
    groups = defaultdict(list)
    for row in rows:
        age = (cutoff - date.fromisoformat(row["date"])).days
        if 0 <= age < 180 and row["transaction_type"] == "purchase" and row["amount_cents"] < 0:
            groups[row["category"]].append((age, row))
    result = {}
    for category, group in sorted(groups.items()):
        cap = max(10000, 3 * median_int([-r["amount_cents"] for _, r in group]))
        recent = sum(min(-r["amount_cents"], cap) for age, r in group if age < 28)
        longer = sum(min(-r["amount_cents"], cap) for age, r in group if age < 84)
        excess = sum(max(0, -r["amount_cents"] - cap) for _, r in group)
        result[category] = {
            "recentRate": Fraction(recent, max(1, min(28, observed_days))),
            "longRate": Fraction(longer, max(1, min(84, observed_days))),
            "exceptionRate": Fraction(excess, max(1, min(180, observed_days))),
            "capCents": cap, "exceptionalObservedCents": excess,
            "evidenceIds": [r["transaction_id"] for _, r in group[-6:]],
        }
    return result


def predicted_purchase_total(features, alpha_percent, days=30):
    rate = (features["recentRate"] * alpha_percent + features["longRate"] * (100 - alpha_percent)) / 100
    value = (rate + features["exceptionRate"]) * days
    return (value.numerator * 2 + value.denominator) // (2 * value.denominator)


def purchase_plan(rows, as_of, dates, model, protected_keys=None):
    from src.income_model import key
    protected_keys = protected_keys or set()
    features = category_features([r for r in rows if key(r) not in protected_keys], as_of)
    events, explanations = [], []
    for category, feature in features.items():
        alpha = model["recentWeightPercentByCategory"].get(category, 50)
        total = predicted_purchase_total(feature, alpha, len(dates))
        # Daily smoothing models flexible purchases, not dates of actual bills.
        amounts = allocate_cents(total, {d.isoformat(): Fraction(1) for d in dates})
        for day, amount in amounts.items():
            if amount:
                events.append({"date": day, "amountCents": amount, "category": category,
                               "evidenceIds": feature["evidenceIds"]})
        irregular = feature["exceptionRate"] * len(dates)
        irregular_cents = (irregular.numerator * 2 + irregular.denominator) // (2 * irregular.denominator)
        explanations.append({"category": category, "expectedPurchaseCents": total,
                             "exceptionalExpenseAllowanceCents": irregular_cents,
                             "largePurchaseThresholdCents": feature["capCents"],
                             "recentWeightPercent": alpha, "evidenceIds": feature["evidenceIds"]})
    return events, explanations


def uncertainty_scale(rows, as_of):
    """History-only risk scale: daily outflow variation and payday instability."""
    cutoff = date.fromisoformat(as_of)
    expenses = [0] * 84
    salaries = []
    for r in rows:
        age = (cutoff - date.fromisoformat(r["date"])).days
        if 0 <= age < 84 and r["amount_cents"] < 0:
            expenses[age] += -r["amount_cents"]
        if 0 <= age < 180 and r["transaction_type"] == "salary" and r["amount_cents"] > 0:
            salaries.append(r)
    salary_scale = 0
    if salaries:
        tokens = Counter(payday_token(r["date"]) for r in salaries)
        instability = 1 - max(tokens.values()) / len(salaries)
        salary_scale = median_int([r["amount_cents"] for r in salaries]) * (0.1 + sqrt(instability))
    return max(25000, round(pstdev(expenses) * sqrt(30) + salary_scale))
