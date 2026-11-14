"""Calendar-aligned historical scenarios: an explainable cash-flow baseline."""

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta

from src.financial_profile import build_profile, shift_month


MODEL_VERSION = "calendar-scenarios-v1"


def rounded_mean(values):
    total, count = sum(values), len(values)
    return (1 if total >= 0 else -1) * ((abs(total) * 2 + count) // (2 * count))


def flow_key(row):
    return (row["account_id"], row["transaction_type"], row["category"], row["merchant_id"],
            "inflow" if row["amount_cents"] > 0 else "outflow")


def pattern_key(pattern):
    return (pattern["accountId"], pattern["transactionType"], pattern["category"],
            pattern["merchantId"], pattern["direction"])


def forecast_cash_flow(transactions, customer_id, as_of, horizon_days=30, buffer_cents=0, income_model=None):
    """Forecast the NEXT N end-of-day balances using only data through as_of.

    Each of the last six complete months is a scenario, mapped onto future
    calendar months. All signed cash movements are replayed exactly once.
    The mean is the central estimate; the min/max envelope is uncalibrated.
    """
    if not isinstance(horizon_days, int) or not 1 <= horizon_days <= 90:
        raise ValueError("horizon_days must be an integer from 1 to 90")
    if not isinstance(buffer_cents, int) or buffer_cents < 0:
        raise ValueError("buffer_cents must be a nonnegative integer")
    cutoff = date.fromisoformat(as_of)
    as_of = cutoff.isoformat()
    version = MODEL_VERSION
    if income_model is not None:
        from src.income_model import MODEL_VERSION as INCOME_VERSION
        if income_model["modelVersion"] != INCOME_VERSION or income_model["trainingThrough"] > as_of:
            raise ValueError("Income model version or training cutoff is incompatible")
        version = income_model["modelVersion"]
    rows = sorted((dict(r) for r in transactions
                   if r["customer_id"] == customer_id and r["date"] <= as_of),
                  key=lambda r: (r["occurred_at"], r["source_row"]))
    profile = build_profile(rows, customer_id, as_of)
    result = {"schemaVersion": "1.0.0", "modelVersion": version,
              "customerId": customer_id, "asOf": as_of, "currency": "EUR",
              "horizonDays": horizon_days, "bufferCents": buffer_cents,
              "status": "insufficient_history", "daily": [], "upcomingPayments": [],
              "warnings": list(profile["warnings"])}
    months = profile.get("coverage", {}).get("completeMonths", [])[-6:]
    if len(months) < 3:
        return result
    # A newly visible account must also have three complete observed months.
    newest_start = max(shift_month(date.fromisoformat(a["firstObservedDate"]), 1)
                       for a in profile["accounts"])
    months = [m for m in months if m >= newest_start.strftime("%Y-%m")]
    if len(months) < 3:
        result["warnings"].append("An account has fewer than three complete months; forecast withheld.")
        return result
    dates = [cutoff + timedelta(days=i) for i in range(1, horizon_days + 1)]
    replaced_income, modeled_income = set(), []
    if income_model is not None:
        from src.income_model import income_plan
        replaced_income, modeled_income = income_plan(rows, profile, as_of, dates, income_model)
        result["modelVersion"] = income_model["modelVersion"]
    date_indices = {d: i for i, d in enumerate(dates)}
    target_months = sorted({d.replace(day=1) for d in dates})
    templates = {m: [] for m in months}
    for row in rows:
        if row["date"][:7] in templates:
            templates[row["date"][:7]].append(row)
    patterns = {pattern_key(p): p for p in profile["recurringPatterns"]}
    single_monthly = {key for key, p in patterns.items()
                      if p["transactionCount"] == p["monthsWithPayments"]}
    paid_current_month = {flow_key(r) for r in rows if r["date"][:7] == as_of[:7] and r["amount_cents"] != 0}
    suppressed = (sorted(single_monthly & paid_current_month, key=str)
                  if cutoff.replace(day=1) in target_months else [])
    balance = profile["observedBalanceCents"]
    scenario_paths = []
    # Events are annotations of scenario cash flows, never extra deductions.
    event_groups = defaultdict(lambda: {"dates": set(), "scenarioAmounts": [0] * len(months), "evidenceIds": set()})
    for scenario_index, source_month in enumerate(months):
        changes = [0] * horizon_days
        for target_month in target_months:
            target_last = monthrange(target_month.year, target_month.month)[1]
            for row in templates[source_month]:
                key = flow_key(row)
                if key in replaced_income:
                    continue
                if target_month == cutoff.replace(day=1) and key in suppressed:
                    continue
                original = date.fromisoformat(row["date"])
                pattern = patterns.get(key)
                if pattern and pattern["timing"]["monthEnd"]:
                    offset = monthrange(original.year, original.month)[1] - original.day
                    target_day = max(1, target_last - offset)
                else:
                    target_day = min(original.day, target_last)
                projected_date = target_month.replace(day=target_day)
                if projected_date not in date_indices:
                    continue
                changes[date_indices[projected_date]] += row["amount_cents"]
                if pattern:
                    event = event_groups[(key, target_month.isoformat()[:7])]
                    event["dates"].add(projected_date.isoformat())
                    event["scenarioAmounts"][scenario_index] += abs(row["amount_cents"])
                    event["evidenceIds"].add(row["transaction_id"])
        for income in modeled_income:
            changes[date_indices[date.fromisoformat(income["date"])]] += income["amountCents"]
            event = event_groups[(income["key"], income["date"][:7])]
            event["dates"].add(income["date"])
            event["scenarioAmounts"][scenario_index] += income["amountCents"]
            event["evidenceIds"].update(income["evidenceIds"])
        running = balance
        path = []
        for change in changes:
            running += change
            path.append(running)
        scenario_paths.append({"sourceMonth": source_month, "balancesCents": path})
    daily = []
    previous = balance
    for i, day in enumerate(dates):
        values = [s["balancesCents"][i] for s in scenario_paths]
        center = rounded_mean(values)
        daily.append({"date": day.isoformat(), "expectedBalanceCents": center,
                      "expectedNetChangeCents": center - previous,
                      "lowerScenarioBalanceCents": min(values), "upperScenarioBalanceCents": max(values)})
        previous = center
    events = []
    for (key, month), event in sorted(event_groups.items(), key=lambda pair: str(pair[0])):
        pattern = patterns[key]
        events.append({"accountId": pattern["accountId"], "transactionType": pattern["transactionType"],
                       "category": pattern["category"], "merchantId": pattern["merchantId"],
                       "direction": pattern["direction"], "scope": pattern["scope"],
                       "month": month, "earliestDate": min(event["dates"]), "latestDate": max(event["dates"]),
                       "expectedTotalCents": rounded_mean(event["scenarioAmounts"]),
                       "minScenarioTotalCents": min(event["scenarioAmounts"]),
                       "maxScenarioTotalCents": max(event["scenarioAmounts"]),
                       "scenariosWithPayment": sum(v > 0 for v in event["scenarioAmounts"]),
                       "scenarioCount": len(months), "status": pattern["status"],
                       "isConfirmed": False, "alreadyIncludedInForecast": True,
                       "evidenceIds": sorted(event["evidenceIds"])})
    events.sort(key=lambda e: (e["earliestDate"], e["accountId"], e["transactionType"]))
    lowest = min(daily, key=lambda d: d["expectedBalanceCents"])
    lowest_scenario = min(daily, key=lambda d: d["lowerScenarioBalanceCents"])
    needs_review = profile["unclassifiedTransactionCount"] > 0 or any(a["daysSinceLastTransaction"] > 35 for a in profile["accounts"])
    warnings = result["warnings"] + [
        "Historical months are scenarios, not calibrated probabilities or guaranteed bounds.",
        "The mean path can spread uncertain income across dates; it is not a promised payday.",
        "Each source month repeats if the horizon crosses a month boundary; seasonal changes are not modeled.",
        "Balances are end-of-day totals across observed accounts; intraday and individual-account shortfalls can differ.",
        "Multiple-payment groups are replayed only on remaining dates; matching individual paid bills is not supported.",
        "Unknown future one-off costs and external accounts are not covered. Do not use this alone to promise affordable savings.",
    ]
    if income_model is not None:
        warnings.append("Modeled income is a probability-weighted expectation shared by scenarios; salary uncertainty requires separate error calibration.")
    ids = {i for event in events for i in event["evidenceIds"]}
    ids.update(i for account in profile["accounts"] for i in account["evidenceIds"])
    result.update({
        "status": "needs_review" if needs_review else "estimated",
        "startingBalanceCents": balance, "accounts": profile["accounts"],
        "sourceMonths": months, "scenarioCount": len(months), "daily": daily,
        "endingExpectedBalanceCents": daily[-1]["expectedBalanceCents"],
        "lowestExpectedBalance": {"date": lowest["date"], "amountCents": lowest["expectedBalanceCents"]},
        "lowestScenarioBalance": {"date": lowest_scenario["date"], "amountCents": lowest_scenario["lowerScenarioBalanceCents"]},
        "belowBufferDates": [d["date"] for d in daily if d["expectedBalanceCents"] < buffer_cents],
        "possibleBelowBufferDates": [d["date"] for d in daily if d["lowerScenarioBalanceCents"] < buffer_cents],
        "startingBalanceBelowBuffer": balance < buffer_cents, "upcomingPayments": events,
        "scenarioPaths": scenario_paths,
        "modeledIncomeGroupCount": len(replaced_income),
        "suppressedAlreadyObservedMonthlyGroups": [{"accountId": key[0], "transactionType": key[1],
                                                     "category": key[2], "merchantId": key[3], "direction": key[4]}
                                                    for key in suppressed],
        "warnings": warnings,
        "evidence": [{"id": r["transaction_id"], "date": r["date"], "accountId": r["account_id"],
                      "amountCents": r["amount_cents"], "category": r["category"],
                      "transactionType": r["transaction_type"]} for r in rows if r["transaction_id"] in ids],
    })
    return result


def actual_daily_balances(transactions, forecast):
    """Evaluation only: use held-back transactions; carry balances on quiet days."""
    accounts = {a["accountId"]: a["balanceCents"] for a in forecast["accounts"]}
    daily_rows = defaultdict(list)
    for row in sorted(transactions, key=lambda r: (r["occurred_at"], r["source_row"])):
        if (row["customer_id"] == forecast["customerId"]
                and forecast["asOf"] < row["date"] <= forecast["daily"][-1]["date"]):
            if row["account_id"] not in accounts:
                raise ValueError("Evaluation includes a new account not visible at cutoff")
            daily_rows[row["date"]].append(row)
    actual = []
    for day in forecast["daily"]:
        for row in daily_rows[day["date"]]:
            accounts[row["account_id"]] = row["balance_after_cents"]
        actual.append(sum(accounts.values()))
    return actual


def flat_daily_baseline(transactions, customer_id, as_of, starting_balance, horizon_days):
    cutoff = date.fromisoformat(as_of)
    start = (cutoff - timedelta(days=89)).isoformat()
    total = sum(r["amount_cents"] for r in transactions
                if r["customer_id"] == customer_id and start <= r["date"] <= as_of)
    # Independent comparator: trailing 90-day mean net cash change, no timing.
    return [starting_balance + ((1 if total >= 0 else -1) * ((abs(total) * i * 2 + 90) // 180))
            for i in range(1, horizon_days + 1)]
