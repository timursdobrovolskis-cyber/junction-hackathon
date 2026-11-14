"""Read-only calendar annotations. Never add these amounts to a balance forecast.

Calendar dates are single-day estimates, separate from cash-flow uncertainty.
Only stable monthly/yearly recurrences or customer-scoped schedules are shown.
"""
from calendar import monthrange
from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
from hashlib import sha256

from src.financial_profile import build_profile, median_int, shift_month, CONSUMPTION_TYPES, timing, distribution
from src.calendar_insights import calendar_insights


def series_key(value):
    return tuple(value.get(k) for k in ("accountId", "transactionType", "category", "merchantId", "direction"))


def stable_id(parts):
    return sha256(repr(tuple(parts)).encode()).hexdigest()[:18]


def title(value):
    if value["direction"] == "inflow":
        return value.get("category") or "Expected income"
    if value.get("transactionType") == "housing_payment":
        return "Housing payment"
    if value.get("transactionType") == "utilities_payment":
        return "Utilities payment"
    if value.get("transactionType") == "purchase":
        return f"Possible subscription · {value.get('category', 'Purchase')}"
    return value.get("category") or "Account movement"


def yearly_patterns(rows, cutoff):
    groups = defaultdict(list)
    for row in rows:
        if row["merchant_id"] and row["transaction_type"] in CONSUMPTION_TYPES and row["amount_cents"] < 0:
            groups[(row["account_id"], row["transaction_type"], row["category"], row["merchant_id"])].append(row)
    rules = []
    for key, group in groups.items():
        days = [date.fromisoformat(r["date"]) for r in group]
        if len(days) < 2 or any(not 350 <= (b - a).days <= 380 for a, b in zip(days, days[1:])):
            continue
        anchor_day = max(d.day for d in days)
        if len({d.month for d in days}) != 1 or any(d.day != min(anchor_day, monthrange(d.year, d.month)[1]) for d in days):
            continue
        amounts = [abs(r["amount_cents"]) for r in group]
        center = median_int(amounts)
        if max(amounts) - min(amounts) > max(100, center // 10) or (cutoff - days[-1]).days > 380:
            continue
        rules.append({"accountId": key[0], "transactionType": key[1], "category": key[2], "merchantId": key[3],
                      "direction": "outflow", "cadence": "yearly", "scope": "merchant", "kind": "repeated_merchant_payment",
                      "status": "needs_confirmation", "evidenceStrength": "limited", "lastObservedDate": days[-1].isoformat(),
                      "estimatedActiveMonthTotalCents": center, "evidenceIds": [r["transaction_id"] for r in group],
                      "timing": {"month": days[-1].month, "day": anchor_day}, "transactionCount": len(group)})
    return rules


def fixed_monthly_day(rule, observed):
    """Accept one payment in every examined month, with a reproducible date."""
    if (rule["status"] != "observed_recently" or rule["transactionCount"] != rule["monthsWithPayments"]
            or rule["monthsWithPayments"] != rule["monthsExamined"]):
        return None
    days = [date.fromisoformat(r["date"]) for r in observed if r["transaction_id"] in rule["evidenceIds"]]
    if len(days) < 3:
        return None
    anchor = max(d.day for d in days)
    # Explicit end of month, or a fixed day clipped in short months.
    if all(d.day == monthrange(d.year, d.month)[1] for d in days):
        anchor = 31
    if any(d.day != min(anchor, monthrange(d.year, d.month)[1]) for d in days):
        # Posting dates may drift a few days while the bill remains monthly.
        # Keep salary strict: mid-month/end-month ambiguity is not a payday.
        if rule["direction"] == "outflow" and max(d.day for d in days) - min(d.day for d in days) <= 6:
            anchor = median_int([d.day for d in days])
        else:
            return None
    amount = rule["paymentAmount"]
    if rule["direction"] == "outflow" and amount["maxCents"] - amount["minCents"] > max(100, amount["medianCents"] // 10):
        return None
    return anchor


def new_subscription_patterns(rows, cutoff):
    """Detect a new merchant series after three consecutive complete months."""
    end = shift_month(cutoff, 1) if cutoff.day == monthrange(cutoff.year, cutoff.month)[1] else shift_month(cutoff, 0)
    months = [shift_month(end, n).strftime("%Y-%m") for n in range(-6, 0)]
    groups = defaultdict(list)
    for row in rows:
        if row["transaction_type"] == "purchase" and row["merchant_id"] and row["amount_cents"] < 0 and row["date"][:7] in months:
            key = (row["account_id"], "purchase", row["category"], row["merchant_id"], "outflow")
            groups[key].append(row)
    rules = []
    for key, group in groups.items():
        by_month = defaultdict(list)
        for row in group:
            by_month[row["date"][:7]].append(row)
        recent = []
        for month in reversed(months):
            if len(by_month[month]) != 1:
                break
            recent.extend(by_month[month])
        if len(recent) < 3:
            continue
        recent.sort(key=lambda r: r["date"])
        # Frequent shopping with this merchant earlier in the lookback is not a subscription.
        if any(len(items) > 1 for items in by_month.values()):
            continue
        rules.append({"accountId": key[0], "transactionType": key[1], "category": key[2], "merchantId": key[3],
            "direction": "outflow", "cadence": "monthly", "scope": "merchant", "status": "observed_recently",
            "monthsWithPayments": len(recent), "monthsExamined": len(recent), "transactionCount": len(recent),
            "paymentAmount": distribution([abs(r["amount_cents"]) for r in recent]),
            "estimatedActiveMonthTotalCents": median_int([abs(r["amount_cents"]) for r in recent]),
            "timing": timing(recent, True), "evidenceIds": [r["transaction_id"] for r in recent],
            "evidenceStrength": "limited" if len(recent) < 5 else "strong"})
    return rules


def build_financial_calendar(transactions, result, months=24, *, subscriptions=None):
    if type(months) is not int or not 1 <= months <= 24:
        raise ValueError("Calendar must cover 1–24 months")
    forecast = result.get("planScenario") or result["forecast"]
    customer, as_of = result["customerId"], result["asOf"]
    if forecast["customerId"] != customer or forecast["asOf"] != as_of:
        raise ValueError("Calendar result belongs to another customer or cutoff")
    cutoff = date.fromisoformat(as_of)
    end = shift_month(cutoff, months + 1) - timedelta(days=1)
    rows = sorted((dict(r) for r in transactions if r["customer_id"] == customer and r["date"] <= as_of),
                  key=lambda r: (r["date"], r["occurred_at"], r["source_row"]))
    groups = defaultdict(list)
    for row in rows:
        key = (row["account_id"], row["transaction_type"], row["category"], row["merchant_id"],
               "inflow" if row["amount_cents"] > 0 else "outflow")
        groups[key].append(row)
    profile = build_profile(rows, customer, as_of)
    rules, omitted = [], []
    patterns = [p for p in profile.get("recurringPatterns", []) if p["transactionType"] != "purchase"]
    patterns += new_subscription_patterns(rows, cutoff)
    for rule in patterns:
        if rule["transactionType"] not in CONSUMPTION_TYPES | {"salary"}:
            continue
        anchor = fixed_monthly_day(rule, groups[series_key(rule)])
        if anchor is None:
            omitted.append({"title": title(rule), "reason": "Payment dates, amounts or monthly frequency are not consistent enough for one scheduled day.", "transactionType": rule["transactionType"], "monthlyAmountCents": rule["estimatedActiveMonthTotalCents"], "evidenceIds": rule["evidenceIds"]})
            continue
        rules.append({**rule, "calendarDay": anchor})
    rules += yearly_patterns(rows, cutoff)
    events, evidence = [], {r["transaction_id"]: {"id": r["transaction_id"], "date": r["date"], "amountCents": r["amount_cents"],
                        "category": r["category"], "accountId": r["account_id"], "merchantId": r["merchant_id"]} for r in rows}
    # Schedules must be supplied by a customer-scoped server integration. Never
    # attach the unowned subscription demo to a bank-data customer implicitly.
    schedules, overridden, schedule_ids = [], set(), set()
    if subscriptions is not None and not isinstance(subscriptions, list):
        raise ValueError("Subscriptions must be a list")
    for sub in subscriptions or []:
        if not isinstance(sub, dict) or sub.get("customerId") != customer:
            raise ValueError("Subscription belongs to another customer")
        if not isinstance(sub.get("id"), str) or not sub["id"] or sub["id"] in schedule_ids:
            raise ValueError("Subscription IDs must be unique")
        schedule_ids.add(sub["id"])
        if sub.get("status") not in {"active", "cancelled", "needs_confirmation"}:
            raise ValueError("Subscription needs an explicit status")
        if sub.get("accountId") and sub.get("merchantId"):
            overridden.add((sub["accountId"], sub["merchantId"]))
        if sub["status"] != "active":
            continue
        if (type(sub.get("intervalMonths")) is not int or sub["intervalMonths"] not in (1, 12)
                or type(sub.get("amountCents")) is not int or not 0 < sub["amountCents"] <= 9007199254740991
                or not isinstance(sub.get("merchant"), str) or not sub["merchant"]):
            raise ValueError("Subscription needs a name, positive integer cents and monthly/yearly interval")
        anchor = date.fromisoformat(sub["nextPaymentDate"])
        schedules.append((sub, anchor))
        for tx in sub.get("transactions", []):
            if tx["date"] <= as_of:
                evidence[tx["id"]] = {**tx, "amountCents": -abs(tx["amountCents"])}

    payments = {(series_key(p), p["month"]): p for p in forecast.get("upcomingPayments", [])}
    for rule in rules:
        key = series_key(rule)
        if (rule.get("accountId"), rule.get("merchantId")) in overridden:
            continue
        observed = groups[key]
        for offset in range(months + 1):
            month = shift_month(cutoff, offset)
            label = month.strftime("%Y-%m")
            if rule["cadence"] == "yearly" and month.month != rule["timing"]["month"]:
                continue
            day = rule["timing"]["day"] if rule["cadence"] == "yearly" else rule["calendarDay"]
            scheduled = month.replace(day=min(day, monthrange(month.year, month.month)[1]))
            if not cutoff < scheduled <= end:
                continue
            if any(r["date"][:7] == label for r in observed):
                continue
            payment = payments.get((key, label))
            events.append({"id": "recurring-" + stable_id([customer, *key, label]), "seriesId": stable_id([customer, *key]),
                "title": title(rule), "source": "forecast" if payment else "history_pattern",
                "kind": "income" if rule["direction"] == "inflow" else "subscription" if rule["transactionType"] == "purchase" else "bill", "cadence": rule["cadence"],
                "date": scheduled.isoformat(), "earliestDate": scheduled.isoformat(), "latestDate": scheduled.isoformat(),
                "amountCents": payment["expectedTotalCents"] if payment else rule["estimatedActiveMonthTotalCents"],
                "direction": rule["direction"], "status": "estimated", "isConfirmed": False,
                "alreadyIncludedInForecast": True if payment else None, "scope": rule["scope"],
                "merchantId": rule["merchantId"], "accountId": rule["accountId"], "category": rule["category"],
                "evidenceIds": rule["evidenceIds"], "evidenceStrength": rule["evidenceStrength"],
                "dateBasis": "Estimated from historical payment dates",
                "observedDayRange": [min(date.fromisoformat(r["date"]).day for r in observed if r["transaction_id"] in rule["evidenceIds"]), max(date.fromisoformat(r["date"]).day for r in observed if r["transaction_id"] in rule["evidenceIds"])],
                "historicalAmountRange": rule.get("paymentAmount"),
                "explanation": f"One estimated {rule['cadence']} date based on {rule['transactionCount']} regular payments. Future dates and amounts may change; this is not a confirmed bank instruction."})

    for sub, anchor in schedules:
        # Always advance from the original anchor: Jan 31 → Feb 28 → Mar 31.
        for offset in range(0, (end.year - anchor.year) * 12 + end.month - anchor.month + 1, sub["intervalMonths"]):
            month = shift_month(anchor, offset)
            scheduled = month.replace(day=min(anchor.day, monthrange(month.year, month.month)[1]))
            if not cutoff < scheduled <= end:
                continue
            events.append({"id": "subscription-" + stable_id([customer, sub["id"], scheduled.isoformat()]),
                "seriesId": stable_id([customer, sub["id"]]), "title": sub["merchant"], "source": "subscription_schedule",
                "kind": "subscription", "cadence": "monthly" if sub["intervalMonths"] == 1 else "yearly",
                "date": scheduled.isoformat(), "earliestDate": scheduled.isoformat(), "latestDate": scheduled.isoformat(),
                "amountCents": sub["amountCents"], "direction": "outflow", "status": "estimated", "isConfirmed": False,
                "alreadyIncludedInForecast": None, "evidenceIds": [t["id"] for t in sub.get("transactions", []) if t["date"] <= as_of],
                "explanation": "Expected renewal from the supplied subscription schedule. Changes at the provider may affect the date or amount. This reminder does not recalculate balances."})
    # One-off expenses still affect the financial plan, but do not belong on this recurring calendar.
    for expense in result.get("plannedExpenses", []):
        if expense.get("customerId", customer) != customer:
            raise ValueError("Expense belongs to another customer")
    active_rules = [r for r in rules if (r.get("accountId"), r.get("merchantId")) not in overridden]
    notifications = calendar_insights(rows, customer, as_of, forecast, omitted, active_rules)
    ids = {i for event in events for i in event["evidenceIds"]} | {i for notice in notifications for i in notice["evidenceIds"]}
    month_summaries = {}
    for event in events:
        month = event["date"][:7]
        summary = month_summaries.setdefault(month, {"incomeCents": 0, "outflowCents": 0, "paymentCount": 0})
        summary["incomeCents" if event["direction"] == "inflow" else "outflowCents"] += event["amountCents"]
        summary["paymentCount"] += 1
    return {"monthSummaries": month_summaries, "schemaVersion": "2.0", "customerId": customer, "asOf": as_of, "currency": "EUR", "modelVersion": forecast["modelVersion"],
            "rangeStart": (cutoff + timedelta(days=1)).isoformat(), "rangeEnd": end.isoformat(), "forecastStatus": forecast["status"],
            "forecastThrough": forecast.get("daily", [{}])[-1].get("date") if forecast.get("daily") else None,
            "events": sorted(events, key=lambda e: (e["date"], e["id"])), "daily": deepcopy(forecast.get("daily", [])),
            "bufferCents": forecast["bufferCents"], "belowBufferDates": forecast.get("belowBufferDates", []),
            "possibleBelowBufferDates": forecast.get("possibleBelowBufferDates", []),
            "evidence": [evidence[i] for i in sorted(ids) if i in evidence], "warnings": list(forecast.get("warnings", [])),
            "omittedPatterns": omitted, "notifications": notifications,
            "notice": "Only regular payments with a predictable date are shown. Dates and amounts are estimates. Irregular spending is excluded; reminders do not extend the balance forecast."}
