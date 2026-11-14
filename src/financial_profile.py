"""Explainable customer profiles built only from observations at a given cutoff.

Amounts are integer cents. Recurring estimates overlap category totals; they are
not additional expenses. Confidence labels describe evidence, not probabilities.
"""

from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date


PROFILE_VERSION = "1.0.0"
CONSUMPTION_TYPES = {"purchase", "housing_payment", "utilities_payment"}
INCOME_TYPES = {"salary", "other_income"}
MOVEMENT_TYPES = {"investment_deposit", "investment_withdrawal", "salary_sweep"}
KNOWN_TYPES = CONSUMPTION_TYPES | INCOME_TYPES | MOVEMENT_TYPES


def month_start(value):
    return value.replace(day=1)


def shift_month(value, count):
    index = value.year * 12 + value.month - 1 + count
    year, month = divmod(index, 12)
    return date(year, month + 1, 1)


def median_int(values):
    """Round nonnegative half cents upward, without floating-point arithmetic."""
    values = sorted(values)
    if not values:
        return None
    middle = len(values) // 2
    return values[middle] if len(values) % 2 else (values[middle - 1] + values[middle] + 1) // 2


def distribution(values):
    if not values:
        return {"medianCents": None, "minCents": None, "maxCents": None,
                "medianAbsoluteDeviationCents": None}
    center = median_int(values)
    return {"medianCents": center, "minCents": min(values), "maxCents": max(values),
            "medianAbsoluteDeviationCents": median_int([abs(v - center) for v in values])}


def evidence_ids(rows, limit=6):
    return [r["transaction_id"] for r in rows[-limit:]]


def monthly_stats(rows, months, sign):
    totals = Counter()
    for row in rows:
        if row["date"][:7] in months:
            totals[row["date"][:7]] += sign * row["amount_cents"]
    values = [totals[m] for m in months]
    return {**distribution(values), "observedMonths": len(months),
            "monthsWithActivity": sum(v != 0 for v in values),
            "monthlyTotals": [{"month": m, "amountCents": totals[m]} for m in months]}


def timing(rows, single_per_month):
    days = [date.fromisoformat(r["date"]) for r in rows]
    counts = Counter(d.day for d in days)
    result = {"dayOfMonthCounts": [{"day": d, "count": counts[d]} for d in sorted(counts)],
              "estimatedDayOfMonth": None, "monthEnd": False,
              "status": "variable" if single_per_month else "multiple_payments"}
    if single_per_month and days:
        near_end = sum(monthrange(d.year, d.month)[1] - d.day <= 3 for d in days)
        if near_end == len(days):
            result.update(monthEnd=True, status="month_end_window")
        elif max(d.day for d in days) - min(d.day for d in days) <= 6:
            result.update(estimatedDayOfMonth=median_int([d.day for d in days]),
                          status="day_of_month_window")
    return result


def recurring_patterns(rows, months, as_of):
    """Detect monthly patterns over at most six complete months.

    Missing merchant IDs permit a type/category aggregate for explicit salary,
    housing, utilities and transfers only. Purchases require a merchant, stable
    amounts and dates; a repeated purchase is never called a subscription.
    """
    recent_months = months[-6:]
    groups = defaultdict(list)
    for row in rows:
        kind = row["transaction_type"]
        if row["date"][:7] not in recent_months or row["amount_cents"] == 0:
            continue
        if kind not in KNOWN_TYPES or kind == "other_income":
            continue
        if kind == "purchase" and not row["merchant_id"]:
            continue
        if kind in CONSUMPTION_TYPES and row["amount_cents"] >= 0:
            continue
        if kind == "salary" and row["amount_cents"] <= 0:
            continue
        key = (row["account_id"], kind, row["category"], row["merchant_id"],
               "inflow" if row["amount_cents"] > 0 else "outflow")
        groups[key].append(row)
    patterns = []
    for key, group in sorted(groups.items(), key=lambda pair: str(pair[0])):
        account, kind, category, merchant, direction = key
        per_month = Counter(r["date"][:7] for r in group)
        active_months = len(per_month)
        if active_months < 3 or active_months * 3 < len(recent_months) * 2:
            continue
        single = max(per_month.values()) == 1
        schedule = timing(group, single)
        amounts = distribution([abs(r["amount_cents"]) for r in group])
        if kind == "purchase":
            if (not single or schedule["status"] == "variable"
                    or amounts["maxCents"] - amounts["minCents"] > max(100, amounts["medianCents"] // 10)):
                continue
        last_date = date.fromisoformat(group[-1]["date"])
        if (as_of - last_date).days > 62:
            continue
        needs_confirmation = recent_months[-1] not in per_month
        label = ("repeated_merchant_payment" if kind == "purchase" else
                 "income" if kind == "salary" else
                 "account_movement" if kind in MOVEMENT_TYPES else "bill_group")
        stats = monthly_stats(group, recent_months, 1 if direction == "inflow" else -1)
        # Active-month amount estimates do not dilute a bill with a missed month.
        active_totals = [x["amountCents"] for x in stats["monthlyTotals"] if x["amountCents"]]
        patterns.append({
            "accountId": account, "transactionType": kind, "category": category,
            "merchantId": merchant, "direction": direction, "kind": label,
            "scope": "merchant" if merchant else "account_type_category_aggregate",
            "cadence": "monthly", "status": "needs_confirmation" if needs_confirmation else "observed_recently",
            "evidenceStrength": "strong" if active_months >= 5 and not needs_confirmation else "limited",
            "monthsWithPayments": active_months, "monthsExamined": len(recent_months),
            "transactionCount": len(group), "lastObservedDate": last_date.isoformat(),
            "estimatedActiveMonthTotalCents": median_int(active_totals),
            "observedMonthlyTotals": stats["monthlyTotals"],
            "paymentAmount": amounts, "timing": schedule,
            "includedInCategorySpending": kind in CONSUMPTION_TYPES,
            "evidenceIds": evidence_ids(group),
        })
    return patterns


def build_profile(transactions, customer_id, as_of, lookback_months=12):
    """Return a JSON-compatible profile. Later/other-customer rows are ignored."""
    cutoff = date.fromisoformat(as_of)
    if lookback_months < 1 or lookback_months > 60:
        raise ValueError("lookback_months must be between 1 and 60")
    rows = sorted((dict(r) for r in transactions
                   if r["customer_id"] == customer_id and r["date"] <= as_of),
                  key=lambda r: (r["occurred_at"], r["source_row"]))
    if not rows:
        return {"schemaVersion": PROFILE_VERSION, "customerId": customer_id, "asOf": as_of,
                "currency": "EUR", "status": "no_history", "warnings": ["No transactions observed by cutoff."]}
    # Exclude the first observed month: the export does not establish when
    # coverage began for this account. Exclude an unfinished current month too.
    end = shift_month(cutoff, 1) if cutoff.day == monthrange(cutoff.year, cutoff.month)[1] else month_start(cutoff)
    first_complete = shift_month(date.fromisoformat(rows[0]["date"]), 1)
    start = max(first_complete, shift_month(end, -lookback_months))
    months = []
    cursor = start
    while cursor < end:
        months.append(cursor.strftime("%Y-%m"))
        cursor = shift_month(cursor, 1)
    observed = [r for r in rows if r["date"][:7] in months]
    consumption = [r for r in observed if r["transaction_type"] in CONSUMPTION_TYPES and r["amount_cents"] < 0]
    income = [r for r in observed if r["transaction_type"] in INCOME_TYPES and r["amount_cents"] > 0]
    categories = defaultdict(list)
    for row in consumption:
        categories[row["category"]].append(row)
    category_stats = []
    unusual = []
    for category, group in sorted(categories.items()):
        stats = monthly_stats(group, months, -1)
        baseline = median_int([-r["amount_cents"] for r in group])
        category_stats.append({"category": category, **stats, "transactionCount": len(group),
                               "evidenceIds": evidence_ids(group, 3)})
        # Large purchases are review candidates, not predictions or known bills.
        for row in group:
            if row["transaction_type"] == "purchase" and -row["amount_cents"] >= max(10000, baseline * 3):
                unusual.append({"date": row["date"], "category": category,
                                "amountCents": -row["amount_cents"],
                                "reason": "At least EUR 100 and three times the category's typical transaction.",
                                "evidenceIds": [row["transaction_id"]]})
    unusual.sort(key=lambda r: (-r["amountCents"], r["date"], r["evidenceIds"][0]))
    latest_accounts = {}
    first_accounts = {}
    for row in rows:
        latest_accounts[row["account_id"]] = row
        first_accounts.setdefault(row["account_id"], row)
    accounts = [{"accountId": account, "balanceCents": row["balance_after_cents"],
                 "balanceObservedDate": row["date"],
                 "daysSinceLastTransaction": (cutoff - date.fromisoformat(row["date"])).days,
                 "firstObservedDate": first_accounts[account]["date"],
                 "evidenceIds": [row["transaction_id"]]}
                for account, row in sorted(latest_accounts.items())]
    monthly_cash = []
    by_month = defaultdict(list)
    for row in observed:
        by_month[row["date"][:7]].append(row)
    for month in months:
        group = by_month[month]
        monthly_cash.append({"month": month,
                             "inflowCents": sum(max(0, r["amount_cents"]) for r in group),
                             "outflowCents": -sum(min(0, r["amount_cents"]) for r in group),
                             "netChangeCents": sum(r["amount_cents"] for r in group)})
    movements = []
    for kind in sorted(MOVEMENT_TYPES):
        group = [r for r in observed if r["transaction_type"] == kind]
        if group:
            movements.append({"transactionType": kind, "transactionCount": len(group),
                              "inflowCents": sum(max(0, r["amount_cents"]) for r in group),
                              "outflowCents": -sum(min(0, r["amount_cents"]) for r in group),
                              "evidenceIds": evidence_ids(group)})
    patterns = recurring_patterns(observed, months, cutoff)
    warnings = ["Only observed accounts are covered; external balances and commitments are unknown.",
                "Recurring payments overlap category totals. Do not add both as separate expenses.",
                "Evidence strength is a heuristic, not calibrated prediction accuracy.",
                "Zero-activity months assume continuous export coverage after the first observed month."]
    if len(months) < 3:
        warnings.append("Fewer than three complete months; insufficient history for recurring estimates.")
    if any(a["daysSinceLastTransaction"] > 35 for a in accounts):
        warnings.append("An account has no transaction for over 35 days; confirm data coverage and balance.")
    if any(shift_month(date.fromisoformat(a["firstObservedDate"]), 1) > start for a in accounts):
        warnings.append("An account starts within the analysis window; aggregate monthly coverage is incomplete.")
    if any(r["transaction_type"] == "salary_sweep" for r in observed):
        warnings.append("Salary sweep destinations are unknown; sweeps are not verified savings.")
    if any(p["scope"] == "account_type_category_aggregate" and p["kind"] == "bill_group" for p in patterns):
        warnings.append("Bills without merchant IDs are category aggregates, not identified providers.")
    unclassified = [r for r in observed if r["transaction_type"] not in KNOWN_TYPES
                    or (r["transaction_type"] in CONSUMPTION_TYPES and r["amount_cents"] > 0)
                    or (r["transaction_type"] in INCOME_TYPES and r["amount_cents"] < 0)]
    if unclassified:
        warnings.append("Unclassified or reversed flows remain in cash totals but need review before forecasting.")
    profile = {
        "schemaVersion": PROFILE_VERSION, "customerId": customer_id, "asOf": as_of,
        "currency": "EUR", "status": "ready" if len(months) >= 3 else "limited_history",
        "coverage": {"firstObservedDate": rows[0]["date"], "lastObservedDate": rows[-1]["date"],
                     "historyTransactionCount": len(rows), "analysisTransactionCount": len(observed),
                     "completeMonths": months, "lookbackMonths": lookback_months,
                     "firstObservedMonthExcluded": True,
                     "partialCurrentMonthExcluded": cutoff.day != monthrange(cutoff.year, cutoff.month)[1]},
        "accounts": accounts, "observedBalanceCents": sum(a["balanceCents"] for a in accounts),
        "income": {**monthly_stats(income, months, 1), "evidenceIds": evidence_ids(income),
                   "byType": [{"transactionType": kind, **monthly_stats([r for r in income if r["transaction_type"] == kind], months, 1)}
                              for kind in sorted(INCOME_TYPES)]},
        "consumption": monthly_stats(consumption, months, -1),
        "categorySpending": category_stats, "recurringPatterns": patterns,
        "irregularExpenseCandidates": unusual[:10], "irregularExpenseCandidateCount": len(unusual),
        "accountMovements": movements, "monthlyCashFlow": monthly_cash,
        "unclassifiedTransactionCount": len(unclassified), "warnings": warnings,
    }
    ids = set()

    def collect(value):
        if isinstance(value, dict):
            ids.update(value.get("evidenceIds", []))
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(profile)
    profile["evidence"] = [{"id": r["transaction_id"], "accountId": r["account_id"],
                            "date": r["date"], "amountCents": r["amount_cents"],
                            "category": r["category"], "transactionType": r["transaction_type"],
                            "merchantId": r["merchant_id"]} for r in rows if r["transaction_id"] in ids]
    return profile
