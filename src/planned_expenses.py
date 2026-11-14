"""Canonical expense lifecycle, strict observed-payment matching and conditional scenarios."""
from copy import deepcopy
from datetime import date, timedelta


PUBLIC_FIELDS = {"id", "date", "amountCents", "label", "category", "accountId", "merchantId", "inclusion", "status"}


def iso(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Dates must be YYYY-MM-DD")
    return value


def normalize_expenses(raw, customer, cutoff, previous=None):
    if not isinstance(raw, list) or len(raw) > 100:
        raise ValueError("plannedExpenses must contain at most 100 expenses")
    prior = {e["id"]: e for e in previous or []}
    result, seen = [], set()
    for expense in raw:
        if not isinstance(expense, dict) or set(expense) - PUBLIC_FIELDS:
            raise ValueError("Unsupported planned expense fields; matching metadata is server-owned")
        if not {"id", "date", "amountCents", "inclusion"} <= set(expense):
            raise ValueError("Expense requires id, date, amountCents and inclusion")
        identifier = expense["id"]
        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen:
            raise ValueError("Expense IDs must be nonempty and unique")
        seen.add(identifier)
        iso(expense["date"])
        if type(expense["amountCents"]) is not int or not 0 < expense["amountCents"] <= 9007199254740991:
            raise ValueError("Expense amount must be positive safe integer cents")
        if expense["inclusion"] not in {"additional", "already_included", "unsure"}:
            raise ValueError("Unknown expense inclusion")
        if expense.get("status", "planned") not in {"planned", "cancelled", "matched"}:
            raise ValueError("Unknown expense lifecycle")
        for key in ("label", "category", "accountId", "merchantId"):
            if key in expense and (not isinstance(expense[key], str) or not expense[key].strip()):
                raise ValueError(f"{key} must be a nonempty string")
        old = prior.get(identifier)
        if old and old["customerId"] != customer:
            raise ValueError("Expense belongs to another customer")
        status = expense.get("status", old["status"] if old else "planned")
        if status == "matched" and (not old or old["status"] != "matched"):
            raise ValueError("Only a verified matching decision may settle an expense")
        clean = {**expense, "status": status, "category": expense.get("category", "Other"),
                 "customerId": customer, "recordedAsOf": old["recordedAsOf"] if old else cutoff,
                 "rejectedTransactionIds": deepcopy(old.get("rejectedTransactionIds", [])) if old else []}
        changed_obligation = old and any(clean.get(k) != old.get(k) for k in ("date", "amountCents", "category", "accountId", "merchantId"))
        clean["matchingSince"] = cutoff if not old or changed_obligation else old.get("matchingSince", old["recordedAsOf"])
        clean["reservedPreviously"] = bool(old and not changed_obligation and clean["inclusion"] == "already_included"
                                            and (old.get("reservedPreviously")
                                                 or (old["inclusion"] == "additional" and date.fromisoformat(clean["date"]) > date.fromisoformat(cutoff) + timedelta(days=30))))
        if old and old["status"] == "matched":
            if any(clean.get(key) != old.get(key) for key in PUBLIC_FIELDS if key != "label"):
                raise ValueError("Undo the match before editing or cancelling a settled expense")
            clean["matchedTransactionId"] = old["matchedTransactionId"]
            clean["matchingReason"] = old["matchingReason"]
        result.append(clean)
    # Full-state removal is a cancellation, retaining the lifecycle and audit trail.
    for identifier, old in prior.items():
        if identifier not in seen:
            if old["status"] == "matched":
                raise ValueError("Undo a matched expense before removing it")
            result.append({**deepcopy(old), "status": "cancelled"})
    return result


def public_expenses(expenses):
    return [{k: v for k, v in e.items() if k in PUBLIC_FIELDS} for e in expenses]


def compatible(expense, tx, cutoff, exact=True):
    if tx["customer_id"] != expense["customerId"] or not expense.get("matchingSince", expense["recordedAsOf"]) < tx["date"] <= cutoff:
        return False
    if expense.get("accountId") and expense["accountId"] != tx["account_id"]:
        return False
    if abs((date.fromisoformat(tx["date"]) - date.fromisoformat(expense["date"])).days) > 3:
        return False
    if exact:
        return tx["amount_cents"] == -expense["amountCents"]
    return (expense.get("merchantId") and expense["merchantId"] == tx["merchant_id"]) or expense["category"] == tx["category"]


def transaction_evidence(tx):
    return {"id": tx["transaction_id"], "date": tx["date"], "amountCents": tx["amount_cents"],
            "accountId": tx["account_id"], "merchantId": tx["merchant_id"], "category": tx["category"]}


def reconcile(expenses, transactions, cutoff, decisions=None):
    result = deepcopy(expenses)
    observed = {t["transaction_id"]: dict(t) for t in transactions if t["date"] <= cutoff}
    events, used = [], set()
    for expense in result:
        if expense["status"] == "matched":
            tx = observed.get(expense["matchedTransactionId"])
            if tx is None or not compatible(expense, tx, cutoff) or tx["transaction_id"] in used:
                raise ValueError("Stored match is missing, duplicated, or outside this customer's observed history")
            if expense.get("matchingReason") == "unique_account_merchant_amount_within_3_days" and expense.get("merchantId") != tx["merchant_id"]:
                raise ValueError("Previously auto-matched merchant changed; review the source data")
            used.add(tx["transaction_id"])
    if decisions is not None and (not isinstance(decisions, list) or len(decisions) > 100):
        raise ValueError("matchingDecisions must be an array")
    decided = set()
    for decision in decisions or []:
        if not isinstance(decision, dict) or set(decision) != {"expenseId", "action", "transactionId"}:
            raise ValueError("Match decisions require expenseId, action and transactionId")
        expense = next((e for e in result if e["id"] == decision["expenseId"]), None)
        if not expense or expense["id"] in decided:
            raise ValueError("Unknown expense or competing matching decisions")
        decided.add(expense["id"])
        transaction_id, action = decision["transactionId"], decision["action"]
        tx = observed.get(transaction_id)
        if action == "undo":
            if expense["status"] != "matched" or expense["matchedTransactionId"] != transaction_id:
                raise ValueError("No such match to undo")
            used.remove(transaction_id)
            expense.pop("matchedTransactionId"); expense.pop("matchingReason")
            expense["status"] = "planned"
            expense["rejectedTransactionIds"] = sorted(set(expense["rejectedTransactionIds"] + [transaction_id]))
        elif action in {"confirm", "reject"}:
            if expense["status"] != "planned" or tx is None or not (compatible(expense, tx, cutoff) or compatible(expense, tx, cutoff, exact=False)):
                raise ValueError("Transaction is not an observed candidate for this expense/customer")
            if action == "confirm":
                if not compatible(expense, tx, cutoff) or transaction_id in used:
                    raise ValueError("Only an exact outflow can be settled; split/refund/competing payments need review")
                expense.update(status="matched", matchedTransactionId=transaction_id, matchingReason="customer_confirmed")
                used.add(transaction_id)
            else:
                expense["rejectedTransactionIds"] = sorted(set(expense["rejectedTransactionIds"] + [transaction_id]))
        else:
            raise ValueError("Unknown matching action")
        events.append({"actor": "customer", "action": action, "expenseId": expense["id"], "transactionId": transaction_id})
    candidates = {}
    for expense in result:
        if expense["status"] != "planned":
            continue
        candidates[expense["id"]] = [tx for identifier, tx in observed.items()
                                    if identifier not in expense["rejectedTransactionIds"]
                                    and (compatible(expense, tx, cutoff) or compatible(expense, tx, cutoff, exact=False))]
    reviews = []
    for expense in result:
        rows = candidates.get(expense["id"], [])
        if not rows:
            continue
        tx = rows[0]
        competitors = sum(any(r["transaction_id"] == tx["transaction_id"] for r in group) for group in candidates.values())
        strict = (len(rows) == 1 and competitors == 1 and tx["transaction_id"] not in used and compatible(expense, tx, cutoff)
                  and expense.get("accountId") == tx["account_id"]
                  and expense.get("merchantId") and expense["merchantId"] == tx["merchant_id"])
        if strict:
            expense.update(status="matched", matchedTransactionId=tx["transaction_id"], matchingReason="unique_account_merchant_amount_within_3_days")
            used.add(tx["transaction_id"])
            events.append({"actor": "matching_rule", "action": "match", "expenseId": expense["id"], "transactionId": tx["transaction_id"]})
        else:
            reviews.append({"expenseId": expense["id"], "reason": "Ambiguous, missing-merchant, partial, or refund candidates require review.",
                            "candidates": [transaction_evidence(row) for row in rows]})
    return result, reviews, events


def expense_scenario(base, expenses, legacy_costs, matching_reviews):
    scenario = deepcopy(base)
    calibration = scenario.pop("calibration", None)
    scenario.update(scenarioBasis="known_expense_plan", calibrationCoverageClaimApplies=False,
                    sourceEligibility={"baseStatus": base["status"], "calibrated": calibration is not None,
                                       "modelVersion": base["modelVersion"]},
                    inheritedErrorMarginCents=(calibration or {}).get("marginCents"),
                    lockedCommitments=[], plannedExpenses=deepcopy(expenses))
    scenario["warnings"] = list(base["warnings"]) + ["Known-expense scenario bounds are conditional; original calibration coverage does not apply to the changed plan."]
    costs = deepcopy(legacy_costs)
    expense_ids = {e["id"] for e in expenses}
    if expense_ids.intersection(cost["id"] for cost in costs):
        raise ValueError("Expense IDs cannot appear in both futureCommitments and plannedExpenses")
    blockers = [{"expenseId": r["expenseId"], "reason": "payment_match_needs_review"} for r in matching_reviews]
    days = {row["date"]: i for i, row in enumerate(base["daily"])}
    deltas = [0] * len(days)
    for expense in expenses:
        if expense["status"] in {"cancelled", "matched"}:
            continue
        reason = None
        if expense["inclusion"] == "unsure":
            reason = "expense_inclusion_requires_review"
        elif expense["date"] <= base["asOf"]:
            reason = "past_due_unmatched_expense"
        elif not days:
            reason = "source_data_requires_review"
        elif expense["inclusion"] == "already_included" and not expense.get("reservedPreviously"):
            if expense["date"] > base["daily"][-1]["date"]:
                reason = "later_expense_inclusion_requires_review"
        elif expense["date"] in days:
            amounts = [0] * len(days)
            amounts[days[expense["date"]]] = expense["amountCents"]
            deltas[days[expense["date"]]] += expense["amountCents"]
            scenario.setdefault("cashFlowComponents", []).append({"transactionType": "planned_expense", "category": expense["category"],
                "direction": "outflow", "locked": True, "expenseId": expense["id"], "dailyAmountsCents": amounts,
                "totalCents": expense["amountCents"], "evidenceIds": []})
            scenario["lockedCommitments"].append(deepcopy(expense))
        else:
            costs.append({key: expense[key] for key in ("id", "date", "amountCents")})
        if reason:
            blockers.append({"expenseId": expense["id"], "reason": reason})
    cumulative = 0
    for i, row in enumerate(scenario["daily"]):
        cumulative += deltas[i]
        row["expectedBalanceCents"] -= cumulative
        row["expectedNetChangeCents"] -= deltas[i]
        for key in ("lowerScenarioBalanceCents", "upperScenarioBalanceCents"):
            if key in row:
                row[key] -= cumulative
        for side in ("Lower", "Upper"):
            key = f"calibrated{side}BalanceCents"
            if key in row:
                row[f"conditional{side}BalanceCents"] = row.pop(key) - cumulative
        for path in scenario.get("scenarioPaths", []):
            path["balancesCents"][i] -= cumulative
    if scenario["daily"]:
        lowest = min(scenario["daily"], key=lambda row: row["expectedBalanceCents"])
        scenario["lowestExpectedBalance"] = {"date": lowest["date"], "amountCents": lowest["expectedBalanceCents"]}
        scenario["endingExpectedBalanceCents"] = scenario["daily"][-1]["expectedBalanceCents"]
        scenario["belowBufferDates"] = [r["date"] for r in scenario["daily"] if r["expectedBalanceCents"] < base["bufferCents"]]
        scenario["possibleBelowBufferDates"] = [r["date"] for r in scenario["daily"] if r.get("conditionalLowerBalanceCents", r["expectedBalanceCents"]) < base["bufferCents"]]
        if "lowestScenarioBalance" in scenario:
            low = min(scenario["daily"], key=lambda row: row["lowerScenarioBalanceCents"])
            scenario["lowestScenarioBalance"] = {"date": low["date"], "amountCents": low["lowerScenarioBalanceCents"]}
    if blockers and scenario["status"] == "estimated":
        scenario["status"] = "needs_review"
    scenario["expenseBlockers"] = blockers
    return scenario, costs
