"""Personalized 30-day spending limits and conditional balance previews."""

from collections import defaultdict
from fractions import Fraction

from src.financial_profile import CONSUMPTION_TYPES, INCOME_TYPES
from src.forecast_safety import estimate_savings
from src.income_model import allocate_cents


DEFAULT_ADJUSTABLE = {"Restaurants", "Entertainment", "Lifestyle", "Travel", "Home & Tech"}


def money(value, label):
    if type(value) is not int or value < 0:
        raise ValueError(f"{label} must be nonnegative integer cents")


def build_category_budgets(forecast, buffer_cents, savings_target_cents,
                           future_commitments=None, savings_confirmed=False,
                           commitments_confirmed=False, adjustable_categories=None,
                           minimum_category_cents=None, category_overrides=None):
    """Build next-horizon limits. Savings is reserved NOW, not at month end.

    Unconfirmed inputs produce previews only. Fixed bill components never change.
    New spending behavior is a counterfactual; inherited uncertainty is not a
    newly calibrated probability claim. The input forecast is never mutated.
    """
    money(buffer_cents, "buffer_cents")
    money(savings_target_cents, "savings_target_cents")
    if type(savings_confirmed) is not bool or type(commitments_confirmed) is not bool:
        raise ValueError("Confirmation fields must be booleans")
    costs = future_commitments if future_commitments is not None else []
    adjustable = DEFAULT_ADJUSTABLE if adjustable_categories is None else set(adjustable_categories)
    floors, overrides = dict(minimum_category_cents or {}), dict(category_overrides or {})
    for category, amount in {**floors, **overrides}.items():
        money(amount, category)
    # Validate floors independently when the same category also has an override.
    for category, amount in floors.items():
        money(amount, category)
    result = {"schemaVersion": "1.0.0", "customerId": forecast["customerId"],
              "asOf": forecast["asOf"], "currency": "EUR", "status": "withheld",
              "movesMoney": False, "categories": [], "preview": None,
              "savingsTargetCents": savings_target_cents, "bufferCents": buffer_cents}
    eligibility = estimate_savings(forecast, buffer_cents, costs, commitments_confirmed)
    if eligibility["status"] == "withheld":
        return {**result, "reason": eligibility["reason"]}
    if "cashFlowComponents" not in forecast:
        return {**result, "reason": "Regenerate the forecast with category cash-flow components."}
    count = len(forecast["daily"])
    groups = defaultdict(lambda: {"purchaseDaily": [0] * count, "billDaily": [0] * count, "ids": set()})
    income, other_outflows = 0, 0
    for c in forecast["cashFlowComponents"]:
        if len(c["dailyAmountsCents"]) != count or sum(c["dailyAmountsCents"]) != c["totalCents"]:
            raise ValueError("Malformed forecast component")
        if c["direction"] == "inflow" and c["transactionType"] in INCOME_TYPES:
            income += c["totalCents"]
        if c["direction"] != "outflow":
            continue
        if c["transactionType"] not in CONSUMPTION_TYPES:
            other_outflows += c["totalCents"]
            continue
        group = groups[c["category"]]
        field = "purchaseDaily" if c["transactionType"] == "purchase" else "billDaily"
        group[field] = [a + b for a, b in zip(group[field], c["dailyAmountsCents"])]
        group["ids"].update(c["evidenceIds"])
    if (floors.keys() | overrides.keys()) - groups.keys():
        raise ValueError("A category has no spending projection; add evidence before budgeting it")
    baselines, minimums = {}, {}
    for category, group in groups.items():
        bills, purchases = sum(group["billDaily"]), sum(group["purchaseDaily"])
        baselines[category] = bills + purchases
        minimums[category] = max(bills if category in adjustable else bills + purchases, floors.get(category, 0))
        if category in overrides and overrides[category] < minimums[category]:
            raise ValueError(f"{category} override is below its protected amount")
    reserve = eligibility["reservedFutureCostsCents"]
    # This additional funding constraint avoids presenting existing capital or
    # investment withdrawals as renewable spending income.
    income_limit = income - other_outflows - savings_target_cents - reserve
    free_weights = {cat: max(0, baselines[cat] - minimums[cat]) for cat in groups if cat not in overrides}
    free_total = sum(free_weights.values())

    def allocation(flexible_total):
        shares = allocate_cents(flexible_total, {k: Fraction(v) for k, v in free_weights.items()}) if flexible_total else {}
        return {cat: overrides.get(cat, minimums[cat] + shares.get(cat, 0)) for cat in groups}

    def preview(limits):
        deltas = [0] * count
        for category, group in groups.items():
            planned_purchase = limits[category] - sum(group["billDaily"])
            weights = {i: Fraction(v) for i, v in enumerate(group["purchaseDaily"])}
            if not sum(weights.values()):
                weights = {i: Fraction(1) for i in range(count)}
            planned = allocate_cents(planned_purchase, weights)
            deltas = [d + original - planned.get(i, 0) for i, (d, original) in enumerate(zip(deltas, group["purchaseDaily"]))]
        running_delta = -savings_target_cents
        starting = forecast["startingBalanceCents"] - savings_target_cents
        previous = starting
        daily = []
        for i, row in enumerate(forecast["daily"]):
            running_delta += deltas[i]
            center = row["expectedBalanceCents"] + running_delta
            daily.append({"date": row["date"], "expectedBalanceCents": center,
                          "expectedNetChangeCents": center - previous,
                          "conditionalLowerBalanceCents": row["calibratedLowerBalanceCents"] + running_delta,
                          "conditionalUpperBalanceCents": row["calibratedUpperBalanceCents"] + running_delta,
                          "cumulativeChangeFromOriginalCents": running_delta})
            previous = center
        lowest = min(starting, *(d["conditionalLowerBalanceCents"] for d in daily))
        low_date = (forecast["asOf"] if lowest == starting else
                    next(d["date"] for d in daily if d["conditionalLowerBalanceCents"] == lowest))
        expected_low = min(daily, key=lambda d: d["expectedBalanceCents"])
        return {"startingBalanceAfterSavingsCents": starting, "daily": daily,
                "endingExpectedBalanceCents": daily[-1]["expectedBalanceCents"],
                "lowestConditionalBalanceCents": lowest,
                "lowestConditionalBalanceDate": low_date,
                "lowestExpectedBalance": {"date": expected_low["date"], "amountCents": expected_low["expectedBalanceCents"]},
                "bufferShortfallCents": max(0, buffer_cents + reserve - lowest),
                "incomeShortfallCents": max(0, sum(limits.values()) - income_limit),
                "assumesPlanFollowed": True, "calibrationCoverageClaimApplies": False}

    def fits(p):
        return p["bufferShortfallCents"] == 0 and p["incomeShortfallCents"] == 0

    minimum_plan = preview(allocation(0))
    if not fits(minimum_plan):
        chosen = allocation(0)
    else:
        low, high = 0, free_total
        while low < high:
            middle = (low + high + 1) // 2
            if fits(preview(allocation(middle))):
                low = middle
            else:
                high = middle - 1
        chosen = allocation(low)
    final = preview(chosen)
    feasible = fits(final)
    confirmed = savings_confirmed and commitments_confirmed
    status = "infeasible" if not feasible else "conditional_plan" if confirmed else "needs_confirmation"
    categories = []
    for category in sorted(groups):
        categories.append({"category": category, "historicalForecastCents": baselines[category],
                           "protectedCents": minimums[category], "previewLimitCents": chosen[category],
                           "suggestedLimitCents": chosen[category] if feasible and confirmed else None,
                           "changeFromHistoryCents": chosen[category] - baselines[category],
                           "adjustable": category in adjustable,
                           "source": "user_override" if category in overrides else "history_and_constraints",
                           "reason": "Bills and protected spending are retained; remaining amounts follow historical spending shares.",
                           "evidenceIds": sorted(groups[category]["ids"])})
    return {**result, "status": status, "feasible": feasible,
            "periodStart": forecast["daily"][0]["date"], "periodEnd": forecast["daily"][-1]["date"],
            "periodDays": count, "categories": categories, "preview": final,
            "expectedIncomeCents": income, "otherAccountOutflowsCents": other_outflows,
            "futureCostReserveCents": reserve, "futureCommitments": costs,
            "incomeAvailableForSpendingCents": income_limit,
            "totalHistoricalSpendingCents": sum(baselines.values()), "totalPlannedSpendingCents": sum(chosen.values()),
            "unallocatedIncomeCents": max(0, income_limit - sum(chosen.values())),
            "confirmationRequired": not confirmed, "savingsConfirmed": savings_confirmed,
            "commitmentsConfirmed": commitments_confirmed,
            "constraintFailures": (["income_limit"] if final["incomeShortfallCents"] else [])
                                  + (["cash_buffer"] if final["bufferShortfallCents"] else []),
            "assumptions": ["Limits cover the next forecast window, not a calendar month or money already spent.",
                            "Savings is previewed as a withdrawal now; future costs are reserved separately.",
                            "Expense changes occur on historical spending dates; spending earlier can break the buffer.",
                            "Conditional bounds retain the original error allowance but have not been calibrated under changed behavior.",
                            "Protected categories are a default policy, not inferred personal needs; users can supply preferences and floors.",
                            "Investment withdrawals and existing balances do not increase the recurring-income spending limit.",
                            "An infeasible result requires changing goals or constraints, not treating zero discretionary budgets as a recommendation."]}
