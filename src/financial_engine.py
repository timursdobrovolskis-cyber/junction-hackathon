"""One read-only entry point for forecast, savings, and budget integration."""

from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3

from src.cash_flow import forecast_cash_flow
from src.forecast_safety import apply_calibration, estimate_savings
from src.category_budgets import build_category_budgets


class FinancialEngine:
    def __init__(self, database="data/local/bank.sqlite", model="data/models/income-v2.json",
                 calibration="data/models/income-v2-calibration.json"):
        self.database = Path(database).resolve()
        self.model = json.loads(Path(model).read_text())
        self.calibration = json.loads(Path(calibration).read_text())

    def plan(self, request):
        allowed = {"customerId", "asOf", "bufferCents", "savingsTargetCents", "futureCommitments",
                   "savingsConfirmed", "commitmentsConfirmed", "adjustableCategories",
                   "minimumCategoryCents", "categoryOverrides"}
        required = {"customerId", "asOf", "bufferCents", "savingsTargetCents"}
        if not isinstance(request, dict) or request.keys() - allowed or required - request.keys():
            raise ValueError("Supply customerId, asOf, bufferCents, savingsTargetCents and only supported preference fields")
        customer = request["customerId"]
        if not isinstance(customer, str) or not customer:
            raise ValueError("customerId must be a nonempty string")
        if not isinstance(request["asOf"], str):
            raise ValueError("asOf must be an ISO date")
        cutoff = date.fromisoformat(request["asOf"]).isoformat()
        for field in ("bufferCents", "savingsTargetCents"):
            if type(request[field]) is not int or request[field] < 0:
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
                    or type(cost["amountCents"]) is not int or cost["amountCents"] < 0):
                raise ValueError("Each commitment needs id, date, and nonnegative integer amountCents")
        for field in ("minimumCategoryCents", "categoryOverrides"):
            if field in request and (not isinstance(request[field], dict)
                    or any(not isinstance(k, str) or type(v) is not int or v < 0 for k, v in request[field].items())):
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
            rows = db.execute("SELECT * FROM transactions WHERE customer_id=? AND date<=? ORDER BY occurred_at,source_row", (customer, cutoff))
            is_v3 = self.model["modelVersion"] == "adaptive-spending-v3"
            income = self.model["incomeModel"] if is_v3 else self.model
            forecast = forecast_cash_flow(rows, customer, cutoff, buffer_cents=request["bufferCents"],
                                          income_model=income, spending_model=self.model if is_v3 else None)
        forecast = apply_calibration(forecast, self.calibration, self.model)
        savings = estimate_savings(forecast, request["bufferCents"], costs, request.get("commitmentsConfirmed", False))
        budget = build_category_budgets(forecast, request["bufferCents"], request["savingsTargetCents"],
                                       future_commitments=costs, savings_confirmed=request.get("savingsConfirmed", False),
                                       commitments_confirmed=request.get("commitmentsConfirmed", False),
                                       adjustable_categories=request.get("adjustableCategories"),
                                       minimum_category_cents=request.get("minimumCategoryCents"),
                                       category_overrides=request.get("categoryOverrides"))
        return {"customerId": customer, "asOf": cutoff, "modelVersion": forecast["modelVersion"],
                "forecast": forecast, "savings": savings, "budget": budget}
