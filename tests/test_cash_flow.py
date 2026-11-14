import unittest

from src.cash_flow import actual_daily_balances, flat_daily_baseline, forecast_cash_flow
from test_financial_profile import history, tx


class CashFlowTests(unittest.TestCase):
    def test_future_and_other_customer_rows_do_not_change_forecast(self):
        rows = history()
        before = forecast_cash_flow(rows, "C", "2026-06-30")
        rows += [tx("2026-07-01", 99999999, "salary", "Salary"), tx("2026-03-05", -99999999, customer="OTHER")]
        self.assertEqual(before, forecast_cash_flow(rows, "C", "2026-06-30"))
        self.assertTrue(all(e["date"] <= before["asOf"] for e in before["evidence"]))

    def test_identical_months_reproduce_flows_without_double_counting_bills(self):
        result = forecast_cash_flow(history(), "C", "2026-07-31")
        self.assertEqual(len(result["daily"]), 30)
        self.assertEqual(result["daily"][0]["date"], "2026-08-01")
        self.assertEqual(result["endingExpectedBalanceCents"] - result["startingBalanceCents"], 200000 - 60000 - 8000 - 1000)
        self.assertTrue(all(d["lowerScenarioBalanceCents"] == d["upperScenarioBalanceCents"] for d in result["daily"]))
        self.assertEqual(sum(d["expectedNetChangeCents"] for d in result["daily"]), result["endingExpectedBalanceCents"] - result["startingBalanceCents"])
        self.assertTrue(all(e["alreadyIncludedInForecast"] for e in result["upcomingPayments"]))

    def test_paid_monthly_salary_is_not_predicted_twice(self):
        rows = history()
        # In June salary arrived early; earlier templates still say the 15th.
        for row in rows:
            if row["transaction_type"] == "salary" and row["date"].startswith("2026-06"):
                row["date"] = "2026-06-10"
                row["occurred_at"] = "2026-06-10T12:00:00"
        result = forecast_cash_flow(rows, "C", "2026-06-12")
        self.assertFalse(any(e["transactionType"] == "salary" for e in result["upcomingPayments"]))
        self.assertTrue(any(e["transactionType"] == "salary" for e in result["suppressedAlreadyObservedMonthlyGroups"]))
        self.assertTrue(all(d["expectedNetChangeCents"] <= 0 for d in result["daily"]))

    def test_month_end_payday_maps_to_february_end(self):
        rows = [tx("2025-06-01", -100)]
        for day in ("2025-07-31", "2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"):
            rows.append(tx(day, 200000, "salary", "Salary", None))
        result = forecast_cash_flow(rows, "C", "2026-01-31", horizon_days=28)
        self.assertTrue(all(d["expectedNetChangeCents"] == 0 for d in result["daily"][:-1]))
        self.assertEqual(result["daily"][-1]["expectedNetChangeCents"], 200000)

    def test_investments_sweeps_and_unknown_flows_are_retained(self):
        rows = history()
        for month in range(2, 8):
            rows.extend([tx(f"2026-{month:02d}-28", -12345, "salary_sweep", "Sweep", None, order=10),
                         tx(f"2026-{month:02d}-29" if month != 2 else "2026-02-28", 2345, "investment_withdrawal", "Investment", None, order=11),
                         tx(f"2026-{month:02d}-26", -100, "unknown", "Other", None, order=12)])
        result = forecast_cash_flow(rows, "C", "2026-07-31", horizon_days=31)
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["endingExpectedBalanceCents"] - result["startingBalanceCents"], 131000 - 10100)

    def test_sparse_history_withholds_forecast(self):
        self.assertEqual(forecast_cash_flow([tx("2026-01-01", -100)], "C", "2026-01-31")["daily"], [])

    def test_zero_month_is_an_actual_scenario(self):
        rows = [tx("2026-01-15", 100), tx("2026-02-15", -3000), tx("2026-04-15", -3000)]
        result = forecast_cash_flow(rows, "C", "2026-04-30")
        self.assertEqual(result["scenarioCount"], 3)
        self.assertEqual(result["endingExpectedBalanceCents"] - result["startingBalanceCents"], -2000)
        self.assertEqual(result["daily"][-1]["upperScenarioBalanceCents"], result["startingBalanceCents"])

    def test_new_account_has_to_have_sufficient_history(self):
        rows = history() + [tx("2026-07-01", 100, account="NEW")]
        self.assertEqual(forecast_cash_flow(rows, "C", "2026-07-31")["status"], "insufficient_history")

    def test_actuals_use_bank_balances_and_carry_quiet_days(self):
        prediction = forecast_cash_flow(history(), "C", "2026-07-31")
        future = [tx("2026-08-03", -100, balance=12345), tx("2026-08-03", -1, balance=12344, order=2)]
        actual = actual_daily_balances(history() + future, prediction)
        self.assertEqual(actual[:2], [prediction["startingBalanceCents"]] * 2)
        self.assertEqual(actual[2:], [12344] * 28)

    def test_buffer_flags_and_evidence_resolve(self):
        result = forecast_cash_flow(history(), "C", "2026-07-31", buffer_cents=999999)
        self.assertEqual(len(result["belowBufferDates"]), 30)
        ids = {e["id"] for e in result["evidence"]}
        self.assertTrue(all(set(e["evidenceIds"]) <= ids for e in result["upcomingPayments"]))

    def test_flat_baseline_is_independent_of_future_transactions(self):
        rows = [tx("2026-03-01", 9000), tx("2026-06-01", 9999999)]
        result = flat_daily_baseline(rows, "C", "2026-05-29", 1000, 30)
        self.assertEqual(result[-1], 4000)


if __name__ == "__main__":
    unittest.main()
