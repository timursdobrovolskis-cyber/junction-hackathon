from copy import deepcopy
import unittest

from src.category_budgets import build_category_budgets
from src.cash_flow import forecast_cash_flow
from test_financial_profile import history


def sample():
    components = []
    for kind, category, direction, day, amount in (
        ("salary", "Salary", "inflow", 10, 200000),
        ("housing_payment", "Housing", "outflow", 1, 80000),
        ("purchase", "Groceries", "outflow", 5, 40000),
        ("purchase", "Restaurants", "outflow", 15, 60000),
        ("purchase", "Entertainment", "outflow", 20, 20000),
    ):
        amounts = [amount if i == day else 0 for i in range(1, 31)]
        components.append({"transactionType": kind, "category": category, "direction": direction,
                           "dailyAmountsCents": amounts, "totalCents": amount, "evidenceIds": []})
    running = 150000
    daily = []
    for i in range(30):
        delta = sum((1 if c["direction"] == "inflow" else -1) * c["dailyAmountsCents"][i] for c in components)
        running += delta
        daily.append({"date": f"2026-10-{i+1:02d}", "expectedBalanceCents": running,
                      "expectedNetChangeCents": delta, "calibratedLowerBalanceCents": running - 5000,
                      "calibratedUpperBalanceCents": running + 5000})
    return {"customerId": "C", "asOf": "2026-09-30", "status": "estimated", "daily": daily,
            "startingBalanceCents": 150000, "accounts": [{"accountId": "A"}],
            "calibration": {"method": "test-only"}, "cashFlowComponents": components}


class CategoryBudgetTests(unittest.TestCase):
    def test_allocates_from_habits_and_protects_bills_and_essentials(self):
        f = sample()
        p = build_category_budgets(f, 10000, 10000, savings_confirmed=True, commitments_confirmed=True)
        self.assertEqual(p["status"], "conditional_plan")
        amounts = {x["category"]: x["suggestedLimitCents"] for x in p["categories"]}
        self.assertEqual(amounts, {"Housing": 80000, "Groceries": 40000, "Restaurants": 52500, "Entertainment": 17500})
        self.assertEqual(p["totalPlannedSpendingCents"] + p["savingsTargetCents"], p["expectedIncomeCents"])
        self.assertFalse(p["movesMoney"])

    def test_input_is_immutable_and_baseline_is_unchanged_if_no_cut_needed(self):
        f = sample()
        before = deepcopy(f)
        p = build_category_budgets(f, 10000, 0)
        self.assertEqual(f, before)
        self.assertEqual([d["expectedBalanceCents"] for d in p["preview"]["daily"]], [d["expectedBalanceCents"] for d in f["daily"]])
        self.assertEqual(p["status"], "needs_confirmation")
        self.assertTrue(all(c["suggestedLimitCents"] is None for c in p["categories"]))

    def test_override_reallocates_other_categories_and_updates_correct_dates(self):
        f = sample()
        original = build_category_budgets(f, 10000, 10000)
        revised = build_category_budgets(f, 10000, 10000, category_overrides={"Restaurants": 65000})
        amounts = {c["category"]: c["previewLimitCents"] for c in revised["categories"]}
        self.assertEqual(amounts["Entertainment"], 5000)
        self.assertEqual(revised["preview"]["daily"][13], original["preview"]["daily"][13])
        self.assertEqual(revised["preview"]["daily"][14]["expectedBalanceCents"], original["preview"]["daily"][14]["expectedBalanceCents"] - 12500)
        self.assertEqual(revised["preview"]["endingExpectedBalanceCents"], original["preview"]["endingExpectedBalanceCents"])

    def test_savings_cannot_use_later_cuts_to_fund_an_immediate_transfer(self):
        p = build_category_budgets(sample(), 10000, 160000)
        self.assertEqual(p["status"], "infeasible")
        self.assertGreater(p["preview"]["bufferShortfallCents"], 0)
        self.assertTrue(all(c["suggestedLimitCents"] is None for c in p["categories"]))
        self.assertEqual(next(c["previewLimitCents"] for c in p["categories"] if c["category"] == "Groceries"), 40000)

    def test_future_costs_are_reserved_once_without_deducting_them_as_current_bills(self):
        p = build_category_budgets(sample(), 10000, 10000, future_commitments=[{"id": "gift", "date": "2026-12-01", "amountCents": 2000}])
        self.assertEqual(p["futureCostReserveCents"], 2000)
        self.assertEqual(p["totalPlannedSpendingCents"], 188000)
        self.assertEqual(p["preview"]["endingExpectedBalanceCents"], 152000)

    def test_integer_rounding_reconciles_every_cent(self):
        f = sample()
        p = build_category_budgets(f, 10000, 10001)
        self.assertEqual(p["totalPlannedSpendingCents"], 189999)
        self.assertEqual(p["preview"]["startingBalanceAfterSavingsCents"] + sum(d["expectedNetChangeCents"] for d in p["preview"]["daily"]), p["preview"]["endingExpectedBalanceCents"])
        self.assertFalse(p["preview"]["calibrationCoverageClaimApplies"])

    def test_preserves_floors_and_flags_unachievable_overrides(self):
        p = build_category_budgets(sample(), 10000, 10000, category_overrides={"Restaurants": 100000})
        self.assertEqual(p["status"], "infeasible")
        p = build_category_budgets(sample(), 10000, 10000, minimum_category_cents={"Entertainment": 20000})
        self.assertEqual(next(c["previewLimitCents"] for c in p["categories"] if c["category"] == "Entertainment"), 20000)

    def test_income_limit_does_not_treat_capital_or_withdrawals_as_salary(self):
        f = sample()
        f["cashFlowComponents"].append({"transactionType": "investment_withdrawal", "category": "Invest", "direction": "inflow", "dailyAmountsCents": [100000] + [0] * 29, "totalCents": 100000, "evidenceIds": []})
        p = build_category_budgets(f, 10000, 10000)
        self.assertEqual(p["expectedIncomeCents"], 200000)

    def test_withholds_review_and_sparse_forecasts(self):
        f = sample()
        f["status"] = "needs_review"
        self.assertEqual(build_category_budgets(f, 10000, 0)["status"], "withheld")

    def test_invalid_preferences_and_in_horizon_costs_are_rejected(self):
        for kwargs in ({"category_overrides": {"Unknown": 100}}, {"category_overrides": {"Housing": 0}},
                       {"minimum_category_cents": {"Restaurants": -1}}, {"category_overrides": {"Restaurants": 1.5}}):
            with self.assertRaises(ValueError):
                build_category_budgets(sample(), 10000, 0, **kwargs)
        with self.assertRaises(ValueError):
            build_category_budgets(sample(), 10000, 0, future_commitments=[{"id": "rent", "date": "2026-10-01", "amountCents": 1000}])

    def test_forecast_components_reconcile_and_respect_cutoff(self):
        f = forecast_cash_flow(history(), "C", "2026-06-30")
        for i, d in enumerate(f["daily"]):
            net = sum((1 if c["direction"] == "inflow" else -1) * c["dailyAmountsCents"][i] for c in f["cashFlowComponents"])
            self.assertEqual(net + d["componentRoundingResidualCents"], d["expectedNetChangeCents"])
        self.assertTrue(all(e["date"] <= f["asOf"] for e in f["evidence"]))


if __name__ == "__main__":
    unittest.main()
