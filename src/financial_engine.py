"""One read-only entry point for forecast, savings, and budget integration."""

from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3

from src.cash_flow import forecast_cash_flow
from src.forecast_safety import apply_calibration, estimate_savings
from src.category_budgets import build_category_budgets
from src.planned_expenses import normalize_expenses, reconcile, expense_scenario
from src.plan_recovery import current_and_recovery


class FinancialEngine:
    def __init__(self, database="data/local/bank.sqlite", model="data/models/income-v2.json",
                 calibration="data/models/income-v2-calibration.json"):
        self.database = Path(database).resolve()
        self.model = json.loads(Path(model).read_text())
        self.calibration = json.loads(Path(calibration).read_text())

    def calendar(self, request):
        from src.financial_calendar import build_financial_calendar
        result = self.plan(request)
        with closing(sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            rows = list(db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row",
                                   (result["customerId"], result["asOf"])))
        return build_financial_calendar(rows, result)

    def plan(self, request, *, expense_state=None, spending_plan=None, source=None, matching_decisions=None):
        allowed = {"customerId", "asOf", "bufferCents", "savingsTargetCents", "futureCommitments",
                   "savingsConfirmed", "commitmentsConfirmed", "adjustableCategories",
                   "minimumCategoryCents", "categoryOverrides", "plannedExpenses"}
        required = {"customerId", "asOf", "bufferCents", "savingsTargetCents"}
        if not isinstance(request, dict) or request.keys() - allowed or required - request.keys():
            raise ValueError("Supply customerId, asOf, bufferCents, savingsTargetCents and only supported preference fields")
        customer = request["customerId"]
        if not isinstance(customer, str) or not customer:
            raise ValueError("customerId must be a nonempty string")
        if not isinstance(request["asOf"], str):
            raise ValueError("asOf must be an ISO date")
        cutoff = date.fromisoformat(request["asOf"]).isoformat()
        expenses = normalize_expenses(request.get("plannedExpenses", []), customer, cutoff, expense_state)
        for field in ("bufferCents", "savingsTargetCents"):
            if type(request[field]) is not int or not 0 <= request[field] <= 9007199254740991:
                raise ValueError(f"{field} must be nonnegative integer cents")
        for field in ("savingsConfirmed", "commitmentsConfirmed"):
            if field in request and type(request[field]) is not bool:
                raise ValueError(f"{field} must be boolean")
        costs = request.get("futureCommitments", [])
        if not isinstance(costs, list):
            raise ValueError("futureCommitments must be an array")
        for cost in costs:
            if (not isinstance(cost, dict) or set(cost) != {"id", "date", "amountCents"}
                    or not isinstance(cost["id"], str) or not isinstance(cost["date"], str)
                    or type(cost["amountCents"]) is not int or not 0 <= cost["amountCents"] <= 9007199254740991):
                raise ValueError("Each commitment needs id, date, and nonnegative integer amountCents")
        for field in ("minimumCategoryCents", "categoryOverrides"):
            if field in request and (not isinstance(request[field], dict)
                    or any(not isinstance(k, str) or type(v) is not int or not 0 <= v <= 9007199254740991 for k, v in request[field].items())):
                raise ValueError(f"{field} must map category names to nonnegative integer cents")
        if "adjustableCategories" in request and (not isinstance(request["adjustableCategories"], list)
                or any(not isinstance(c, str) for c in request["adjustableCategories"])):
            raise ValueError("adjustableCategories must be an array of category names")
        with closing(sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            audit = json.loads(db.execute("SELECT value FROM metadata WHERE key='audit'").fetchone()[0])
            if cutoff > audit["last_date"]:
                raise ValueError(f"Observation cutoff exceeds export coverage ({audit['last_date']})")
            if not db.execute("SELECT 1 FROM customers WHERE customer_id=?", (customer,)).fetchone():
                raise ValueError("Unknown customer")
            rows = list(db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row", (customer, cutoff)))
            account_ids = {row["account_id"] for row in rows}
            if any(e.get("accountId") and e["accountId"] not in account_ids for e in expenses):
                raise ValueError("Planned expense account does not belong to this customer's observed accounts")
            is_v3 = self.model["modelVersion"] == "adaptive-spending-v3"
            income = self.model["incomeModel"] if is_v3 else self.model
            forecast = forecast_cash_flow(rows, customer, cutoff, buffer_cents=request["bufferCents"],
                                          income_model=income, spending_model=self.model if is_v3 else None)
        forecast = apply_calibration(forecast, self.calibration, self.model)
        if "plannedExpenses" in request or expense_state is not None:
            expenses, reviews, decisions = reconcile(expenses, rows, cutoff, matching_decisions)
            scenario, plan_costs = expense_scenario(forecast, expenses, costs, reviews)
            savings = estimate_savings(scenario, request["bufferCents"], plan_costs, request.get("commitmentsConfirmed", False))
            budget, alternatives, limits = current_and_recovery(forecast, scenario, request, plan_costs, spending_plan, source)
            return {"customerId": customer, "asOf": cutoff, "modelVersion": forecast["modelVersion"],
                    "forecast": forecast, "planScenario": scenario, "savings": savings, "budget": budget,
                    "plannedExpenses": expenses, "matchingReviews": reviews, "matchingDecisions": decisions,
                    "expenseBlockers": scenario["expenseBlockers"], "alternatives": alternatives,
                    "spendingPlan": limits, "legacyFutureCommitments": costs, "sourcePlanId": (source or {}).get("planId"),
                    "sourceRevision": (source or {}).get("revision", 0)}
        savings = estimate_savings(forecast, request["bufferCents"], costs, request.get("commitmentsConfirmed", False))
        budget = build_category_budgets(forecast, request["bufferCents"], request["savingsTargetCents"],
                                       future_commitments=costs, savings_confirmed=request.get("savingsConfirmed", False),
                                       commitments_confirmed=request.get("commitmentsConfirmed", False),
                                       adjustable_categories=request.get("adjustableCategories"),
                                       minimum_category_cents=request.get("minimumCategoryCents"),
                                       category_overrides=request.get("categoryOverrides"))
        return {"customerId": customer, "asOf": cutoff, "modelVersion": forecast["modelVersion"],
                "forecast": forecast, "savings": savings, "budget": budget}
