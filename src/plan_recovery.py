"""Engine-owned current-plan evaluation and two explicit recovery alternatives."""
from copy import deepcopy
from src.category_budgets import build_category_budgets
from src.plan_store import digest


def budget_arguments(request, costs):
    return {"buffer_cents": request["bufferCents"], "savings_target_cents": request["savingsTargetCents"],
            "future_commitments": costs, "savings_confirmed": request.get("savingsConfirmed", False),
            "commitments_confirmed": request.get("commitmentsConfirmed", False),
            "adjustable_categories": request.get("adjustableCategories"),
            "minimum_category_cents": request.get("minimumCategoryCents"),
            "category_overrides": request.get("categoryOverrides")}


def current_and_recovery(base, scenario, request, costs, existing_limits=None, source=None):
    arguments = budget_arguments(request, costs)
    initial = build_category_budgets(base, **budget_arguments(request, request.get("futureCommitments", [])))
    # Preserve an accepted spending plan. If none exists, start with the base engine's feasible plan,
    # or historical spending when even the base plan is infeasible (never diagnostic zero cuts).
    limits = deepcopy(existing_limits) if existing_limits is not None else {
        c["category"]: c["previewLimitCents"] if initial.get("feasible") else max(c["historicalForecastCents"], c["protectedCents"])
        for c in initial["categories"]}
    limits.update(request.get("categoryOverrides", {}))
    for category, amount in (request.get("minimumCategoryCents") or {}).items():
        if category in limits:
            limits[category] = max(limits[category], amount)
    current = build_category_budgets(scenario, **arguments, fixed_spending_limits=limits)
    if current["status"] == "withheld" or current.get("feasible"):
        return current, [], limits
    context = {"customerId": request["customerId"], "asOf": request["asOf"],
               "sourcePlanId": (source or {}).get("planId"), "sourceRevision": (source or {}).get("revision", 0)}
    token_basis = {**context, "request": {k: v for k, v in request.items() if k != "plannedExpenses"},
                   "scenario": scenario, "spendingPlan": limits}
    target = request["savingsTargetCents"]
    preview_args = {**arguments, "savings_confirmed": False, "commitments_confirmed": False}
    zero = build_category_budgets(scenario, **{**preview_args, "savings_target_cents": 0}, fixed_spending_limits=limits)
    if zero.get("feasible"):
        low, high = 0, target
        while low < high:
            middle = (low + high + 1) // 2
            trial = build_category_budgets(scenario, **{**preview_args, "savings_target_cents": middle}, fixed_spending_limits=limits)
            if trial.get("feasible"):
                low = middle
            else:
                high = middle - 1
        less = build_category_budgets(scenario, **{**preview_args, "savings_target_cents": low}, fixed_spending_limits=limits)
    else:
        less = zero
    try:
        cuts = build_category_budgets(scenario, **preview_args, maximum_category_cents=limits)
        cut_error = None
    except ValueError as error:
        cuts, cut_error = None, str(error)
    options = []
    for kind, plan in (("save_less", less), ("reduce_flexible_spending", cuts)):
        feasible = bool(plan and plan.get("feasible"))
        after_target = plan["savingsTargetCents"] if plan else target
        after_limits = {c["category"]: c["previewLimitCents"] for c in plan["categories"]} if plan else {}
        changes = [{"category": category, "beforeCents": before, "afterCents": after_limits.get(category),
                    "changeCents": after_limits[category] - before if category in after_limits else None,
                    "evidenceIds": next((c["evidenceIds"] for c in (plan or {}).get("categories", []) if c["category"] == category), [])}
                   for category, before in limits.items()]
        explanation = ("Keep the existing spending plan and lower only the savings target."
                       if kind == "save_less" else "Keep the savings target and reduce only permitted flexible spending; bills, floors, fixed choices and new obligations stay protected.")
        reason = None if feasible else cut_error if kind == "reduce_flexible_spending" and cut_error else "This option cannot satisfy the income and daily cash-buffer constraints."
        options.append({**context, "id": digest({"basis": token_basis, "kind": kind})[:32], "kind": kind,
                        "available": feasible, "reason": reason, "explanation": explanation,
                        "savingsTargetBeforeCents": target, "savingsTargetAfterCents": after_target,
                        "preferenceChanges": {"savingsTargetCents": after_target} if kind == "save_less" else {},
                        "spendingPlan": after_limits, "categoryChanges": changes, "budget": plan,
                        "calibrationCoverageClaimApplies": False, "movesMoney": False})
    return current, options, limits
