"""Read-only calendar annotations. Never add these amounts to a balance forecast.

Monthly rules reuse the profile engine. Yearly candidates require repeated
merchant observations; neither detector establishes a subscription contract.
"""
from calendar import monthrange
from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
from hashlib import sha256

from src.financial_profile import build_profile, median_int, shift_month, CONSUMPTION_TYPES


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
        return "Utilities · payment group"
    if value.get("transactionType") == "purchase":
        return f"Possible recurring payment · {value.get('category', 'Purchase')}"
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
        amounts = [abs(r["amount_cents"]) for r in group]
        center = median_int(amounts)
        if max(amounts) - min(amounts) > max(100, center // 10) or (cutoff - days[-1]).days > 380:
            continue
        rules.append({"accountId": key[0], "transactionType": key[1], "category": key[2], "merchantId": key[3],
                      "direction": "outflow", "cadence": "yearly", "scope": "merchant", "kind": "repeated_merchant_payment",
                      "status": "needs_confirmation", "evidenceStrength": "limited", "lastObservedDate": days[-1].isoformat(),
                      "estimatedActiveMonthTotalCents": center, "evidenceIds": [r["transaction_id"] for r in group],
                      "timing": {"month": days[-1].month, "day": days[-1].day}, "transactionCount": len(group)})
    return rules


def build_financial_calendar(transactions, result, months=12):
    if type(months) is not int or not 1 <= months <= 12:
        raise ValueError("Calendar must cover 1–12 months")
    forecast = result.get("planScenario") or result["forecast"]
    customer, as_of = result["customerId"], result["asOf"]
    if forecast["customerId"] != customer or forecast["asOf"] != as_of:
        raise ValueError("Calendar result belongs to another customer or cutoff")
    cutoff = date.fromisoformat(as_of)
    end = shift_month(cutoff, months + 1) - timedelta(days=1)
    rows = sorted((dict(r) for r in transactions if r["customer_id"] == customer and r["date"] <= as_of),
                  key=lambda r: (r["date"], r["occurred_at"], r["source_row"]))
    profile = build_profile(rows, customer, as_of)
    rules = [p for p in profile["recurringPatterns"] if p["direction"] == "outflow" and p["transactionType"] in CONSUMPTION_TYPES]
    rules += yearly_patterns(rows, cutoff)
    rule_cadences = {series_key(rule): rule["cadence"] for rule in rules}
    events, covered = [], set()
    for payment in forecast.get("upcomingPayments", []):
        # These exact amounts/windows are already in the engine's daily path.
        key = series_key(payment)
        first, last = payment["earliestDate"], payment["latestDate"]
        if last <= as_of or first > end.isoformat():
            continue
        covered.add((key, payment["month"]))
        events.append({"id": "forecast-" + stable_id([customer, *key, payment["month"]]),
                       "seriesId": stable_id([customer, *key]), "title": title(payment), "source": "forecast",
                       "kind": "income" if payment["direction"] == "inflow" else "bill" if payment["transactionType"] in CONSUMPTION_TYPES else "movement",
                       "cadence": rule_cadences.get(key, "forecast"), "earliestDate": max(first, (cutoff + timedelta(days=1)).isoformat()), "latestDate": last,
                       "amountCents": payment["expectedTotalCents"], "direction": payment["direction"],
                       "status": "needs_review" if forecast["status"] != "estimated" else "estimated", "isConfirmed": False,
                       "alreadyIncludedInForecast": True, "scope": payment.get("scope"), "merchantId": payment.get("merchantId"),
                       "accountId": payment.get("accountId"), "category": payment.get("category"),
                       "evidenceIds": payment.get("evidenceIds", []),
                       "explanation": "Copied from the cash-flow forecast. This window is an estimate, not a scheduled bank payment."})

    for rule in rules:
        key = series_key(rule)
        observed = [r for r in rows if (r["account_id"], r["transaction_type"], r["category"], r["merchant_id"],
                                       "inflow" if r["amount_cents"] > 0 else "outflow") == key]
        for offset in range(months + 1):
            month = shift_month(cutoff, offset)
            if month > end:
                break
            month_label = month.strftime("%Y-%m")
            if (key, month_label) in covered:
                continue
            last_day = monthrange(month.year, month.month)[1]
            timing = rule["timing"]
            if rule["cadence"] == "yearly":
                if month.month != timing["month"]:
                    continue
                anchor = month.replace(day=min(timing["day"], last_day))
                first, last = anchor - timedelta(days=7), anchor + timedelta(days=7)
                # A renewal already observed this year must not be re-added.
                if any(date.fromisoformat(r["date"]).year == month.year for r in observed):
                    continue
            else:
                single = rule["transactionCount"] == rule["monthsWithPayments"]
                if month_label == as_of[:7] and (not single or any(r["date"][:7] == month_label for r in observed)):
                    continue
                days = [v["day"] for v in timing["dayOfMonthCounts"]]
                if timing["monthEnd"]:
                    first, last = month.replace(day=max(1, last_day - 3)), month.replace(day=last_day)
                elif timing["status"] == "day_of_month_window":
                    first, last = month.replace(day=min(min(days), last_day)), month.replace(day=min(max(days), last_day))
                else:
                    first, last = month, month.replace(day=last_day)
            if last <= cutoff or first > end:
                continue
            events.append({"id": "recurring-" + stable_id([customer, *key, month_label]), "seriesId": stable_id([customer, *key]),
                           "title": title(rule), "source": "history_pattern", "kind": "bill", "cadence": rule["cadence"],
                           "earliestDate": max(first, cutoff + timedelta(days=1)).isoformat(), "latestDate": min(last, end).isoformat(),
                           "amountCents": rule["estimatedActiveMonthTotalCents"], "direction": "outflow", "status": "needs_review",
                           "isConfirmed": False, "alreadyIncludedInForecast": None, "scope": rule["scope"], "merchantId": rule["merchantId"],
                           "evidenceIds": rule["evidenceIds"], "evidenceStrength": rule["evidenceStrength"],
                           "explanation": f"Possible {rule['cadence']} recurrence based on {rule['transactionCount']} observed payments. Verify the provider and renewal date. This annotation does not change the forecast."})

    for expense in result.get("plannedExpenses", []):
        if expense.get("customerId", customer) != customer:
            raise ValueError("Expense belongs to another customer")
        if expense["status"] != "planned" or not as_of < expense["date"] <= end.isoformat():
            continue
        # Merge only an unambiguous supplied cost with its existing annotation.
        # A bare 'already included' flag cannot identify a particular bill group.
        if expense["inclusion"] == "already_included":
            matches = [event for event in events if event["source"] == "forecast"
                       and event["direction"] == "outflow" and event["amountCents"] == expense["amountCents"]
                       and event["earliestDate"] <= expense["date"] <= event["latestDate"]
                       and expense.get("accountId") == event.get("accountId")
                       and expense.get("category") == event.get("category")
                       and expense.get("accountId") and expense.get("category")]
            if len(matches) == 1:
                matches[0].setdefault("plannedExpenseIds", []).append(expense["id"])
                continue
        events.append({"id": "expense-" + expense["id"], "seriesId": expense["id"], "title": expense.get("label") or "Planned expense",
                       "source": "customer", "kind": "expense", "cadence": "once", "earliestDate": expense["date"], "latestDate": expense["date"],
                       "amountCents": expense["amountCents"], "direction": "outflow", "status": "planned" if expense["inclusion"] == "additional" else "needs_review",
                       "isConfirmed": False, "alreadyIncludedInForecast": bool(result.get("planScenario")) if expense["inclusion"] == "additional" else None,
                       "evidenceIds": [], "explanation": "Customer-supplied cost and date. Planned does not mean paid. If its forecast link is unclear, check for an existing payment group before counting it as another cost."})

    evidence = {r["transaction_id"]: {"id": r["transaction_id"], "date": r["date"], "amountCents": r["amount_cents"],
                                     "category": r["category"], "accountId": r["account_id"], "merchantId": r["merchant_id"]} for r in rows}
    ids = {i for event in events for i in event["evidenceIds"]}
    # Bundled engine fixtures may carry evidence even when raw rows aren't supplied.
    for item in forecast.get("evidence", []):
        if item["date"] <= as_of:
            evidence.setdefault(item["id"], deepcopy(item))
    return {"schemaVersion": "1.0", "customerId": customer, "asOf": as_of, "currency": "EUR", "modelVersion": forecast["modelVersion"],
            "rangeStart": (cutoff + timedelta(days=1)).isoformat(), "rangeEnd": end.isoformat(), "forecastStatus": forecast["status"],
            "forecastThrough": forecast.get("daily", [{}])[-1].get("date") if forecast.get("daily") else None,
            "events": sorted(events, key=lambda e: (e["earliestDate"], e["id"])), "daily": deepcopy(forecast.get("daily", [])),
            "bufferCents": forecast["bufferCents"], "belowBufferDates": forecast.get("belowBufferDates", []),
            "possibleBelowBufferDates": forecast.get("possibleBelowBufferDates", []),
            "evidence": [evidence[i] for i in sorted(ids) if i in evidence], "warnings": list(forecast.get("warnings", [])),
            "notice": "Payment windows are estimates. Recurring entries beyond the forecast are reminders, not balance predictions. No money is moved."}
